const { chromium } = require('playwright');
const crypto = require('crypto');
const { couponChannels } = require('../config/env');
const logger = require('../utils/logger');

const NOT_CODES = new Set([
  'OFF', 'COM', 'SEM', 'ATE', 'PARA', 'POR', 'MAIS', 'MENOS',
  'DEZ', 'VINTE', 'TRINTA', 'MAX', 'MIN', 'VER', 'USE',
  'CUPOM', 'CODIGO', 'CODE', 'APP', 'PIX', 'FRETE', 'SAIBA',
  'ACESSE', 'CLIQUE', 'VEJA', 'GRATIS', 'NOVO', 'NOVA',
  'DESCONTO', 'PROMOS', 'PROMO', 'OFERTA', 'VENDA',
  'MODA', 'ESTILO', 'COMPRA', 'LOJA', 'LINK', 'ACIMA',
  'HOJE', 'AGORA', 'CONFIRA', 'APROVEITE', 'VALIDO',
]);

function looksLikeCode(str) {
  if (!str || str.length < 4 || str.length > 20) return false;
  const s = str.toUpperCase();
  if (NOT_CODES.has(s)) return false;
  // Formato de cupom real: letras + dígitos obrigatórios, ou 6+ letras maiúsculas
  return /^[A-Z][A-Z0-9]{3,19}$/.test(s) && (/\d/.test(s) || s.length >= 6);
}

function isMlRelated(text) {
  return /mercado\s*livre|mercadolivre|meli\.la|\.meli\.|mlb|\bml\b/i.test(text);
}

function extractDiscount(text) {
  // "10% off" / "10% de desconto" / "10%off"
  const afterPct = text.match(/(\d+)\s*%\s*(?:off|de desconto|desconto)/i);
  if (afterPct) return parseInt(afterPct[1], 10);

  // "desconto de 10%" / "até 10%"
  const beforePct = text.match(/(?:desconto|até)\s+(?:de\s+)?(\d+)\s*%/i);
  if (beforePct) return parseInt(beforePct[1], 10);

  // qualquer "X%" com sanidade
  const any = text.match(/(\d+)\s*%/);
  if (any) {
    const val = parseInt(any[1], 10);
    if (val >= 5 && val <= 90) return val;
  }

  return null;
}

function extractMinimum(text) {
  // "acima de R$49" / "acima de R$ 49,00" / "mínimo de R$49" / "compras acima de R$49"
  const m = text.match(/(?:acima|m[ií]nimo)\s+de\s+R\$\s*([\d.,]+)/i);
  if (m) return `R$${m[1].replace('.', ',')}`;
  // "em compras de R$49"
  const m2 = text.match(/compras\s+(?:de|acima\s+de)\s+R\$\s*([\d.,]+)/i);
  if (m2) return `R$${m2[1].replace('.', ',')}`;
  return null;
}

function extractLimit(text) {
  // "Limite de 100" / "limite: 100" / "primeiros 100 usos" / "100 usos"
  const m = text.match(/limite\s*(?:de|:)\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  const m2 = text.match(/primeiros\s+(\d+)/i);
  if (m2) return parseInt(m2[1], 10);
  const m3 = text.match(/(\d+)\s+usos/i);
  if (m3) return parseInt(m3[1], 10);
  return null;
}

function extractCode(text) {
  // Prioridade 1: padrão explícito "cupom: CODE" ou "código: CODE"
  const explicit = text.match(/(?:cupom|c[oó]digo|code|promo)\s*[:\-\s]+([A-Z0-9]{4,20})/i);
  if (explicit) {
    const code = explicit[1].toUpperCase();
    if (looksLikeCode(code)) return code;
  }

  // Prioridade 2: token isolado que parece código (letras maiúsculas + números)
  const tokens = text.match(/\b([A-Z]{2,}[0-9]{1,}[A-Z0-9]*|[A-Z]{6,20})\b/g) || [];
  for (const token of tokens) {
    if (looksLikeCode(token)) return token;
  }

  return null;
}

class CouponListener {
  async getCoupons() {
    let browser;
    const found = [];

    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      for (const channel of couponChannels) {
        try {
          const coupons = await this._scrapeChannel(browser, channel);
          logger.info(`[Cupons] ${channel}: ${coupons.length} encontrado(s)`);
          found.push(...coupons);
        } catch (err) {
          logger.warn(`[Cupons] Erro canal ${channel}: ${err.message}`);
        }
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    // Dedup por código (mesmo cupom em canais diferentes conta uma vez)
    const seen = new Set();
    return found.filter(c => {
      if (seen.has(c.code)) return false;
      seen.add(c.code);
      return true;
    });
  }

  async _scrapeChannel(browser, channelName) {
    const page = await browser.newPage();
    const found = [];

    try {
      await page.goto(`https://t.me/s/${channelName}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForTimeout(2000);

      const messages = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.tgme_widget_message_text'))
          .map(el => el.textContent.replace(/\s+/g, ' ').trim())
          .filter(t => t.length >= 10 && t.length <= 600)
      );

      for (const msg of messages) {
        if (!isMlRelated(msg)) continue;
        const code = extractCode(msg);
        if (!code) continue;

        const id = crypto.createHash('md5').update(code).digest('hex').substring(0, 16);
        const discount = extractDiscount(msg);
        const minimum = extractMinimum(msg);
        const limit = extractLimit(msg);
        found.push({ id, code, description: msg.substring(0, 250), channel: channelName, discount, minimum, limit });
      }
    } finally {
      await page.close().catch(() => {});
    }

    return found;
  }
}

module.exports = new CouponListener();

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
  // Nomes de loja — sem isso, "Cupom Shopee!!!" ou "Cupom Mercado Livre: ABC123"
  // (nome logo após "cupom", sem dois-pontos) casa como se o nome da loja fosse
  // o próprio código, roubando a vaga do código real que vem depois na mensagem.
  'SHOPEE', 'MERCADO', 'LIVRE', 'MERCADOLIVRE',
]);

function looksLikeCode(str) {
  if (!str || str.length < 4 || str.length > 20) return false;
  const s = str.toUpperCase();
  if (NOT_CODES.has(s)) return false;
  // Formato de cupom real: letras + dígitos obrigatórios, ou 6+ letras maiúsculas
  return /^[A-Z][A-Z0-9]{3,19}$/.test(s) && (/\d/.test(s) || s.length >= 6);
}

// ─────────────────────────────────────────────
// Detecção de loja — o canal do Telegram mistura cupons de lojas diferentes
// no mesmo feed; o texto da mensagem é o único jeito de saber de qual se trata.
// ─────────────────────────────────────────────

function isMlRelated(text) {
  return /mercado\s*livre|mercadolivre|meli\.la|\.meli\.|mlb|\bml\b/i.test(text);
}

function isShopeeRelated(text) {
  return /\bshopee\b|s\.shopee\.com|shope\.ee/i.test(text);
}

// ML primeiro por ser a fonte majoritária hoje; na rara mensagem que citar as
// duas lojas, prevalece ML. Cada loja tem sua função isolada acima — dá pra
// adicionar uma terceira loja só acrescentando outro isXRelated + um `if`.
function detectStore(text) {
  if (isMlRelated(text)) return 'ml';
  if (isShopeeRelated(text)) return 'shopee';
  return null;
}

// ─────────────────────────────────────────────
// Extração — formato de cupom (código, %, valor fixo, mínimo, limite, link)
// é parecido o bastante entre lojas pra compartilhar a mesma lógica.
// ─────────────────────────────────────────────

function extractPercentDiscount(text) {
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

// Cupom de valor fixo em R$ ("R$10 OFF") — raro no ML (quase tudo é %),
// comum na Shopee ("TODAS AS LOJAS R$10 OFF nas compras acima de R$40").
function extractAmount(text) {
  const m = text.match(/R\$\s*([\d.,]+)\s*(?:off|de desconto|desconto)/i);
  return m ? `R$${cleanAmount(m[1])}` : null;
}

function extractMinimum(text) {
  // "acima de R$49" / "acima de R$ 49,00" / "mínimo de R$49" / "compras acima de R$49"
  const m = text.match(/(?:acima|m[ií]nimo)\s+de\s+R\$\s*([\d.,]+)/i);
  if (m) return `R$${cleanAmount(m[1])}`;
  // "em compras de R$49"
  const m2 = text.match(/compras\s+(?:de|acima\s+de)\s+R\$\s*([\d.,]+)/i);
  if (m2) return `R$${cleanAmount(m2[1])}`;
  return null;
}

// "99." (ponto final de frase grudado no valor) → "99" — o valor nunca termina em
// separador, então qualquer . ou , sobrando no fim é pontuação, não parte do número.
function cleanAmount(raw) {
  return raw.replace(/[.,]+$/, '').replace('.', ',');
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

// Só aceita código anunciado explicitamente ("Usem o cupom: XXXX").
//
// Antes havia um fallback que varria a mensagem atrás de qualquer token parecido com
// código, e ele era a fonte de TODOS os códigos falsos publicados: "PRECINHO" (de
// "PRECINHO!- Minibola..."), "CUIDAR" (de "PRÁTICO PRA CUIDAR DO VISUAL!"), "MICROFONE",
// "IP68" (spec do celular). Não dá pra separar pelo formato — cupom real do ML é
// palavra em caixa alta sem dígito também (PIPOCA, TODEBOA, MELIVIP) — mas dá pra
// separar pela posição: post com cupom sempre diz "use o cupom X"; post sem essa
// construção não tem cupom nenhum.
function extractCode(text) {
  // A mensagem pode citar "cupom" mais de uma vez (ex.: "Cupom Shopee!!! ... Cupom:
  // D31X4C0M1G0"), então percorre TODAS as ocorrências até achar um código plausível.
  const explicitMatches = text.matchAll(/(?:cupom|c[oó]digo|code|promo)\s*[:\-\s]+([A-Za-z0-9]{4,20})/gi);
  for (const match of explicitMatches) {
    const raw = match[1];
    // Código de verdade é sempre escrito em caixa alta nesses canais. Sem essa checagem
    // a flag /i faz o próprio texto corrido virar código: "deixe o cupom pronto para
    // usar" virava o cupom "PRONTO".
    if (raw !== raw.toUpperCase()) continue;
    if (looksLikeCode(raw)) return raw.toUpperCase();
  }

  return null;
}

// Link de resgate/uso do cupom, quando a mensagem traz um (nem sempre traz —
// cupons ML geralmente não trazem, cupons Shopee costumam trazer "Resgate aqui").
function extractLink(text) {
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0].replace(/[).,;!]+$/, '') : null;
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

    // Dedup por loja+código (mesmo código pode existir em lojas diferentes)
    const seen = new Set();
    return found.filter(c => {
      const key = `${c.store}:${c.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
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
        const store = detectStore(msg);
        if (!store) continue;

        const code = extractCode(msg);
        if (!code) continue;

        // ID inclui a loja só quando não é ML, pra não invalidar o dedup de
        // cupons ML já salvos no banco antes dessa mudança (era md5(code)).
        const id = crypto.createHash('md5').update(store === 'ml' ? code : `${store}-${code}`).digest('hex').substring(0, 16);
        const discount = extractPercentDiscount(msg);
        const amount = extractAmount(msg);
        const minimum = extractMinimum(msg);
        const limit = extractLimit(msg);
        const link = extractLink(msg);
        found.push({ id, code, store, description: msg.substring(0, 250), channel: channelName, discount, amount, minimum, limit, link });
      }
    } finally {
      await page.close().catch(() => {});
    }

    return found;
  }
}

module.exports = new CouponListener();

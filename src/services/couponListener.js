/**
 * couponListener.js
 *
 * Monitora canais públicos do Telegram (ex: PromoTop) via t.me/s/CANAL
 * e extrai cupons reais do Mercado Livre com código explícito.
 *
 * Fontes suportadas:
 *   - Telegram: t.me/s/{channelName}  (web view público, sem autenticação)
 *   - ML Homepage: mercadolivre.com.br (header com cupom ativo)
 */

const { chromium } = require('playwright');
const logger = require('../utils/logger');

// Palavras que comprovam que o post é sobre ML (não Amazon, Shopee, etc.)
const ML_INDICATORS = [
  'mercado livre', 'mercadolivre', 'meli.la/', 'mercadolivre.com/sec',
  'mercadolivre.com.br',
];

// Códigos que parecem ML mas não são cupons (palavras comuns em maiúsculo)
const NOT_CODES = new Set([
  'OFF', 'COM', 'SEM', 'ATE', 'POR', 'MAIS', 'MENOS', 'MAX', 'MIN',
  'VER', 'USE', 'CUPOM', 'CODIGO', 'APP', 'PIX', 'FRETE', 'LINK',
  'SMART', 'MELI', 'ML', 'VIA',
]);

function looksLikeCode(str) {
  if (!str || str.length < 4 || str.length > 25) return false;
  if (NOT_CODES.has(str.toUpperCase())) return false;
  // Deve ter pelo menos uma letra e ser todo maiúsculo+número
  return /^[A-Z][A-Z0-9]{3,24}$/.test(str.toUpperCase()) && /[A-Z]/.test(str) && !/\s/.test(str);
}

function isMlRelated(text) {
  const t = text.toLowerCase();
  return ML_INDICATORS.some(ind => t.includes(ind));
}

function extractCodes(text) {
  const codes = [];
  // Padrão principal: "cupom: XXXXX" ou "Usem o cupom: XXXXX [+ YYYY]"
  const mainMatch = text.match(/usem?\s*o?\s*cup[oõ]m\s*:?\s*([A-Z0-9+\s]{4,60})/i);
  if (mainMatch) {
    // Pode ter múltiplos: "BORALEVAR + SMART250"
    const parts = mainMatch[1].split(/[\s+,|]+/);
    parts.forEach(p => {
      const clean = p.trim().toUpperCase();
      if (looksLikeCode(clean)) codes.push(clean);
    });
  }
  // Fallback: busca palavra "código:" seguida de código
  if (codes.length === 0) {
    const m2 = text.match(/c[oó]digo\s*:?\s*([A-Z0-9]{4,20})/i);
    if (m2 && looksLikeCode(m2[1])) codes.push(m2[1].toUpperCase());
  }
  return [...new Set(codes)];
}

function extractDiscount(text) {
  // Tenta pegar linha de desconto (▪️ ou ➖ ou linha com %)
  const m = text.match(/[▪➖•]\s*([^\n🛒🎯]{5,120})/u);
  if (m) return m[1].trim();
  // Fallback: qualquer menção de % + off
  const m2 = text.match(/(\d+(?:[.,]\d+)?%\s*off[^🛒\n]*)/i);
  return m2 ? m2[1].trim() : '';
}

function extractMlLink(text) {
  const m = text.match(/https?:\/\/(?:www\.)?(?:mercadolivre\.com(?:\.br)?\/sec|meli\.la)\/[A-Za-z0-9]+/i);
  return m ? m[0] : null;
}

class CouponListener {
  constructor() {
    this._browser = null;
  }

  async _ensureBrowser() {
    if (this._browser) return;
    this._browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  async close() {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }

  // ─────────────────────────────────────────────
  // Telegram — lê posts do canal público
  // ─────────────────────────────────────────────

  async scanTelegramChannel(channelName) {
    await this._ensureBrowser();
    const context = await this._browser.newContext({ locale: 'pt-BR' });
    const page = await context.newPage();
    const coupons = [];

    try {
      const url = `https://t.me/s/${channelName}`;
      logger.info(`[CouponListener] Escaneando @${channelName}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const posts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.tgme_widget_message')).map(el => ({
          text: (el.querySelector('.tgme_widget_message_text') || {}).textContent || '',
          date: (el.querySelector('time') || {}).getAttribute('datetime') || '',
          postLink: (el.querySelector('.tgme_widget_message_date') || {}).getAttribute('href') || '',
        }));
      });

      logger.info(`[CouponListener] @${channelName}: ${posts.length} posts`);

      for (const post of posts) {
        if (!isMlRelated(post.text)) continue;

        const codes = extractCodes(post.text);
        if (codes.length === 0) continue;

        const discount = extractDiscount(post.text);
        const link = extractMlLink(post.text) || 'https://www.mercadolivre.com.br/cupons';

        for (const code of codes) {
          const id = require('crypto').createHash('md5').update(code).digest('hex').substring(0, 16);
          coupons.push({
            id,
            code,
            description: post.text.substring(0, 300),
            discountText: discount,
            link,
            category: '',
            isActive: true,
            source: `telegram:${channelName}`,
            postDate: post.date,
          });
        }
      }

      logger.info(`[CouponListener] @${channelName}: ${coupons.length} cupons ML com código real`);
    } catch (err) {
      logger.error(`[CouponListener] Erro @${channelName}: ${err.message}`);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }

    return coupons;
  }

  // ─────────────────────────────────────────────
  // ML Homepage — captura cupom do header
  // ─────────────────────────────────────────────

  async scanMlHomepage() {
    await this._ensureBrowser();
    const context = await this._browser.newContext({ locale: 'pt-BR' });
    const page = await context.newPage();
    const coupons = [];

    try {
      logger.info('[CouponListener] Verificando homepage ML...');
      await page.goto('https://www.mercadolivre.com.br', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const homepageCodes = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('a, span, p, div, li').forEach(el => {
          if (el.children.length > 5) return;
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length > 200 || text.length < 4) return;

          // Padrão "cupom: XXXXX" no header do ML
          const m = text.match(/(?:cupom|c[oó]digo)\s*:?\s*([A-Z0-9]{4,20})/i);
          if (m) {
            const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
            results.push({ code: m[1].toUpperCase(), text, link });
          }
        });
        const seen = new Set();
        return results.filter(c => { if (seen.has(c.code)) return false; seen.add(c.code); return true; });
      });

      for (const c of homepageCodes) {
        if (!looksLikeCode(c.code)) continue;
        const id = require('crypto').createHash('md5').update(c.code).digest('hex').substring(0, 16);
        coupons.push({
          id,
          code: c.code,
          description: c.text,
          discountText: extractDiscount(c.text) || c.text.substring(0, 100),
          link: c.link || 'https://www.mercadolivre.com.br/cupons',
          category: '',
          isActive: true,
          source: 'ml-homepage',
        });
      }

      if (coupons.length > 0) {
        logger.info(`[CouponListener] Homepage ML: ${coupons.length} cupom(s) no header`);
      }
    } catch (err) {
      logger.error(`[CouponListener] Erro homepage: ${err.message}`);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }

    return coupons;
  }

  // ─────────────────────────────────────────────
  // Scan completo — todas as fontes
  // ─────────────────────────────────────────────

  async scanAll(telegramChannels = []) {
    const allCoupons = [];
    const seen = new Set();

    // ML Homepage
    const homepageCoupons = await this.scanMlHomepage();
    for (const c of homepageCoupons) {
      if (!seen.has(c.code)) { seen.add(c.code); allCoupons.push(c); }
    }

    // Canais do Telegram
    for (const channel of telegramChannels) {
      const channelCoupons = await this.scanTelegramChannel(channel);
      for (const c of channelCoupons) {
        if (!seen.has(c.code)) { seen.add(c.code); allCoupons.push(c); }
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    return allCoupons;
  }
}

module.exports = new CouponListener();

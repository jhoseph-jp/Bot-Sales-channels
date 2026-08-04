const { chromium } = require('playwright');
const crypto = require('crypto');
const logger = require('../utils/logger');

const URL = 'https://www.cuponomia.com.br/desconto/mercado-livre';

function extractDiscount(text) {
  const m = text.match(/(\d{1,3})\s*%\s*(?:off|de desconto|desconto)?/i);
  if (m) {
    const val = parseInt(m[1], 10);
    if (val >= 1 && val <= 90) return val;
  }
  return null;
}

function extractMinimum(text) {
  const m = text.match(/(?:a partir de|acima de|m[ií]nimo de)\s*R\$\s*([\d.,]+)/i);
  return m ? `R$${m[1].replace('.', ',')}` : null;
}

function extractMaxDiscount(text) {
  const m = text.match(/limitad[oa]\s*(?:a|em)?\s*R\$\s*([\d.,]+)/i);
  return m ? `R$${m[1].replace('.', ',')}` : null;
}

class CuponomiaScraper {
  async getCoupons() {
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      });

      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2500);

      const cards = await page.evaluate(() => {
        const items = Array.from(
          document.querySelectorAll('li[data-test-id="coupon-list-item"][data-type="code"]:not(.expired-item)')
        );
        return items.map(li => ({
          code: li.querySelector('.js-itemCode')?.textContent?.trim() || '',
          title: li.querySelector('h3')?.textContent?.trim() || '',
          desc: li.querySelector('.item-desc')?.textContent?.trim() || '',
        })).filter(c => c.code);
      });

      const found = [];
      for (const card of cards) {
        const code = card.code.toUpperCase();
        const text = `${card.title} ${card.desc}`;
        const id = crypto.createHash('md5').update(code).digest('hex').substring(0, 16);

        found.push({
          id,
          code,
          description: (card.desc || card.title).substring(0, 250),
          discount: extractDiscount(text),
          minimum: extractMinimum(text),
          maxDiscount: extractMaxDiscount(text),
          limit: null,
          category: null, // cupom de checkout, vale pra qualquer categoria
          link: URL,
          source: 'cuponomia',
        });
      }

      logger.info(`[Cupons] cuponomia: ${found.length} encontrado(s)`);
      return found;
    } catch (err) {
      logger.warn(`[Cupons] Erro cuponomia: ${err.message}`);
      return [];
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
}

module.exports = new CuponomiaScraper();

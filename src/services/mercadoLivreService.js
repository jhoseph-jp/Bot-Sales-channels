const { chromium } = require('playwright');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { mercadoLivre, settings } = require('../config/env');
const logger = require('../utils/logger');
const db = require('../repositories/database');
const PriceCalculator = require('../utils/priceCalculator');
const CouponValidator = require('../utils/couponValidator');
const AffiliateAutomation = require('../utils/affiliate_automation');
// Classificação de nicho compartilhada com o filtro de cupons (ver nicheFilter.js)
const {
  normalize, isHardBlocked, isFeminine,
  HAIR_ELECTRONICS, SHOES_KEYWORDS, CLOTHES_KEYWORDS, KITCHEN_KEYWORDS,
} = require('../utils/nicheFilter');

const SESSION_FILE = path.resolve(process.cwd(), 'data', 'ml_session.json');
const ML_LOGO = 'https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/5.21.22/mercadolibre/logo__large_plus.png';

// ─────────────────────────────────────────────
// Targets de scraping
// ─────────────────────────────────────────────

// Categorias de moda/calçados/acessórios têm URL direta e ordem de prioridade fixa —
// MLB1430 (Calçados, Roupas e Bolsas) é a principal, depois Camisetas e Regatas,
// Calças, Tênis e Acessórios, nessa ordem. Isso substitui a busca antiga por abas de
// texto ("moda", "calçados") que dependia do layout da página de ofertas.
const CLOTHING_CATEGORY_TARGETS = [
  { id: 'MLB1430',   label: 'Calçados, Roupas e Bolsas', priority: 1 },
  { id: 'MLB31447',  label: 'Camisetas e Regatas',        priority: 2 },
  { id: 'MLB188065', label: 'Calças',                     priority: 3 },
  { id: 'MLB23332',  label: 'Tênis',                      priority: 4 },
  { id: 'MLB1451',   label: 'Acessórios',                 priority: 5 },
].map(c => ({ ...c, url: `https://www.mercadolivre.com.br/ofertas?category=${c.id}&container_id=MLB779362-1` }));

// Demais nichos femininos — continuam localizados via aba de texto na página de ofertas
const FEMININE_CATEGORY_TABS = ['beleza', 'joias', 'bijuteria', 'cozinha'];

const OFFER_TARGET = {
  url: 'https://www.mercadolivre.com.br/ofertas',
  label: 'Ofertas do Dia',
  isFlash: false,
  useCategoryNav: true,
};

const FLASH_TARGET = {
  url: 'https://www.mercadolivre.com.br/ofertas?container_id=MLB779362-1&promotion_type=lightning',
  label: 'Relâmpago',
  isFlash: true,
  useCategoryNav: false,
};

// ─────────────────────────────────────────────
// Filtros de nicho feminino
// ─────────────────────────────────────────────
// As listas de keywords e isFeminine/isHardBlocked vivem em utils/nicheFilter.js,
// compartilhadas com o filtro de cupons (importadas no topo deste arquivo).

// Não é público-alvo — não bloqueia, só reduz a proporção (ver PLUS_SIZE_KEEP_RATIO)
const PLUS_SIZE_KEYWORDS = ['plus size', 'plus-size', 'plussize', 'tamanho grande especial', 'tamanho especial plus'];
// Mantém só 1 a cada N ofertas plus-size (as demais são descartadas em _processRawOffers)
const PLUS_SIZE_KEEP_RATIO = 4;

function isPlusSize(title) {
  const t = normalize(title);
  return PLUS_SIZE_KEYWORDS.some(kw => t.includes(normalize(kw)));
}

function getCategoryInfo(title) {
  const t = title.toLowerCase();
  if (HAIR_ELECTRONICS.some(kw => t.includes(kw.toLowerCase())))
    return { emoji: '💇', label: 'Cabelo' };
  if (/maquiagem|batom|blush|sombra|base de maquiagem|rímel|delineador|paleta|iluminador|gloss|lápis labial/.test(t))
    return { emoji: '💄', label: 'Maquiagem' };
  if (/esmalte|unhas|nail/.test(t))
    return { emoji: '💅', label: 'Unhas' };
  if (SHOES_KEYWORDS.some(kw => t.includes(kw.toLowerCase())))
    return { emoji: '👠', label: 'Calçados' };
  if (/bolsa feminina|carteira feminina|clutch|pochete/.test(t))
    return { emoji: '👜', label: 'Bolsas' };
  if (/brinco|anel feminino|colar feminino|pulseira|bijuteria|joia/.test(t))
    return { emoji: '💍', label: 'Joias' };
  if (/perfume feminino|eau de parfum|body splash/.test(t))
    return { emoji: '🌸', label: 'Perfumaria' };
  if (/sérum|hidratante facial|skincare|protetor solar|retinol|vitamina c/.test(t))
    return { emoji: '🧴', label: 'Skincare' };
  if (/shampoo|condicionador|máscara capilar/.test(t))
    return { emoji: '🧴', label: 'Cabelo' };
  if (CLOTHES_KEYWORDS.some(kw => t.includes(kw.toLowerCase())))
    return { emoji: '👗', label: 'Moda' };
  if (KITCHEN_KEYWORDS.some(kw => t.includes(kw.toLowerCase())))
    return { emoji: '🍳', label: 'Cozinha' };
  if (/toalha|lençol|edredom|colcha/.test(t))
    return { emoji: '🏠', label: 'Casa' };
  return { emoji: '✨', label: 'Achadinho' };
}

// ─────────────────────────────────────────────
// Service principal
// ─────────────────────────────────────────────

class MercadoLivreService {
  constructor() {
    this.clientId = mercadoLivre.clientId;
    this.clientSecret = mercadoLivre.clientSecret;
    this.affiliateId = mercadoLivre.affiliateId;
    this.refreshToken = mercadoLivre.refreshToken;
    this.baseUrl = 'https://api.mercadolibre.com';

    this._browser = null;
    this._context = null;
    this._initLock = false;

    this.affiliate = new AffiliateAutomation({
      affiliateId: this.affiliateId,
      accessToken: mercadoLivre.accessToken,
      refreshToken: () => this.refreshAccessToken(),
      email: mercadoLivre.email,
      password: mercadoLivre.password,
      baseUrl: this.baseUrl,
    });

    this._setupGracefulShutdown();
  }

  async init() {
    const savedRefreshToken = await db.getConfig('ml_refresh_token');
    if (savedRefreshToken) this.refreshToken = savedRefreshToken;
    logger.info('MercadoLivreService inicializado.');
    if (!fs.existsSync(SESSION_FILE)) {
      logger.warn('Sessão ML não encontrada. Execute "npm run save-session".');
    }
  }

  async refreshAccessToken() {
    try {
      const response = await axios.post(`${this.baseUrl}/oauth/token`, {
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
      });
      const { access_token, refresh_token } = response.data;
      this.refreshToken = refresh_token;
      await db.setConfig('ml_access_token', access_token);
      await db.setConfig('ml_refresh_token', refresh_token);
      if (this.affiliate) this.affiliate.updateAccessToken(access_token);
      return access_token;
    } catch (error) {
      logger.error('Erro ao renovar token:', error.response?.data || error.message);
      throw error;
    }
  }

  // ─────────────────────────────────────────────
  // Browser singleton
  // ─────────────────────────────────────────────

  async _ensureBrowser() {
    if (this._browser && this._context) return;
    if (this._initLock) {
      while (this._initLock) await new Promise(r => setTimeout(r, 100));
      return;
    }
    this._initLock = true;
    try {
      const contextOpts = {
        viewport: { width: 1280, height: 900 },
        locale: 'pt-BR',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
      };
      if (fs.existsSync(SESSION_FILE)) contextOpts.storageState = SESSION_FILE;

      this._browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
      });
      this._context = await this._browser.newContext(contextOpts);
      logger.info('[Scraper] Browser Playwright iniciado.');
    } finally {
      this._initLock = false;
    }
  }

  async _resetBrowser() {
    if (this._browser) await this._browser.close().catch(() => {});
    this._browser = null;
    this._context = null;
  }

  // ─────────────────────────────────────────────
  // Extração de cards
  // ─────────────────────────────────────────────

  // ML carrega mais cards via lazy-load conforme a página rola. Sem isso, só os
  // cards já visíveis no primeiro paint entram na extração — a aba "moda" perde
  // a maior parte do catálogo disponível.
  async _scrollToLoadMore(page, times = 4) {
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(700);
    }
  }

  async _extractRawOffers(page) {
    return page.evaluate(() => {
      const results = [];

      // ML usa diferentes estruturas dependendo da página
      // Tenta poly-card (ofertas), depois ui-search-result (categoria/busca)
      const CARD_SELECTORS = ['.poly-card', '.ui-search-result__wrapper', '.ui-search-result', '[class*="result--core"]'];
      let cards = [];
      for (const sel of CARD_SELECTORS) {
        const found = document.querySelectorAll(sel);
        if (found.length > 0) { cards = Array.from(found); break; }
      }

      cards.forEach(card => {
        try {
          // Título — tenta seletores de offers e de search
          const title = (
            card.querySelector('.poly-component__title')?.textContent ||
            card.querySelector('.ui-search-item__title')?.textContent ||
            card.querySelector('[class*="item__title"]')?.textContent ||
            card.querySelector('h2')?.textContent ||
            ''
          ).trim();
          if (!title) return;

          // Link — ignora links de acessibilidade/feedback do ML
          const isProductLink = (href) => href && href.includes('mercadolivre.com') && !href.includes('acessibilidade') && !href.includes('/feedback') && !href.includes('ajuda.mercadolivre');
          const link = (
            card.querySelector('a.poly-component__title')?.href ||
            card.querySelector('a.ui-search-item__title-label')?.href ||
            Array.from(card.querySelectorAll('a')).map(a => a.href).find(isProductLink) ||
            ''
          );
          if (!isProductLink(link)) return;

          // Preço atual
          const priceEl = card.querySelector('.poly-price__current') || card.querySelector('.ui-search-price__second-line') || card;
          const currentFraction = priceEl.querySelector('.andes-money-amount__fraction')?.textContent?.trim() || '';
          const currentCents    = priceEl.querySelector('.andes-money-amount__cents')?.textContent?.trim() || '';

          // Preço original (tachado)
          const originalFraction = card.querySelector('s .andes-money-amount__fraction')?.textContent?.trim() || '';
          const originalCents    = card.querySelector('s .andes-money-amount__cents')?.textContent?.trim() || '';

          // Desconto badge
          const discountBadge = (
            card.querySelector('[class*="discount"]')?.textContent ||
            card.querySelector('[class*="promo"]')?.textContent ||
            ''
          ).trim();

          // Cupom inline
          const couponText = (
            card.querySelector('.poly-component__highlight')?.textContent ||
            card.querySelector('[class*="highlight"]')?.textContent ||
            ''
          ).trim();

          // Imagem
          let image = '';
          const img = card.querySelector('img');
          if (img) image = img.src || img.dataset?.src || img.getAttribute('data-srcset')?.split(',')[0]?.trim() || '';

          results.push({ title, link, currentFraction, currentCents, originalFraction, originalCents, discountBadge, couponText, image });
        } catch (_) {}
      });

      return results;
    });
  }

  _processRawOffers(rawOffers, target) {
    const offers = [];
    const seenUrls = new Set();
    let plusSizeCount = 0;
    for (const raw of rawOffers) {
      const currentPrice  = PriceCalculator.parsePrice(raw.currentFraction, raw.currentCents);
      if (currentPrice <= 0) continue;
      const originalPrice = PriceCalculator.parsePrice(raw.originalFraction, raw.originalCents);
      let discount = originalPrice > currentPrice
        ? PriceCalculator.calculateDiscount(originalPrice, currentPrice)
        : PriceCalculator.extractDiscountFromBadge(raw.discountBadge);
      if (discount < settings.minDiscount) continue;
      if (!isFeminine(raw.title, raw._fromFeminineCategory)) continue;
      // Plus size não é o público-alvo — não bloqueia, mas reduz a proporção
      if (isPlusSize(raw.title)) {
        plusSizeCount++;
        if (plusSizeCount % PLUS_SIZE_KEEP_RATIO !== 1) continue;
      }
      // Alguns cards (ex.: carrossel "plus-size") anexam tracking depois de '#'
      // (c_tracking_id, deal_print_id, c_container_id...) que muda a cada scrape —
      // sem remover, o mesmo produto nunca bate como duplicata.
      const cleanLink = raw.link.split('?')[0].split('#')[0];
      if (seenUrls.has(cleanLink)) continue;
      seenUrls.add(cleanLink);
      const { emoji, label } = getCategoryInfo(raw.title);
      const coupon   = CouponValidator.shouldIncludeCoupon(raw.couponText) ? CouponValidator.formatCoupon(raw.couponText) : '';
      // MLB ID é o identificador estável do produto — não muda com preço ou URL.
      // Links tipo produto.mercadolivre.com.br usam "MLB-1234567" (com hífen);
      // sem o hífen opcional, o regex nunca casava esse formato e caía no fallback
      // MD5 (ou pior: casava um MLB\d+ de tracking dentro do próprio fragmento).
      const mlbMatch = cleanLink.match(/MLB-?\d+/i);
      const id = mlbMatch ? mlbMatch[0].replace(/-/g, '').toUpperCase() : crypto.createHash('md5').update(`${raw.title}-${currentPrice}`).digest('hex');
      offers.push({ id, title: raw.title, price: currentPrice, originalPrice: originalPrice > 0 ? originalPrice : currentPrice, discount, link: cleanLink, image: raw.image, coupon, category: label, emoji, isFlash: target.isFlash, categoryPriority: raw._categoryPriority });
    }
    return offers;
  }

  // ─────────────────────────────────────────────
  // Scraping de ofertas
  // ─────────────────────────────────────────────

  async _scrapeTarget(target) {
    try { await this._ensureBrowser(); } catch (err) {
      logger.error(`[Scraper] Falha ao iniciar browser: ${err.message}`);
      return [];
    }

    const page = await this._context.newPage();
    try {
      logger.info(`[Scraper] ${target.label} → ${target.url}`);
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      if (target.useCategoryNav) {
        const allRaw = [];

        // 1) Moda/calçados/acessórios — URLs diretas, ordem de prioridade fixa
        //    (MLB1430 principal → Camisetas e Regatas → Calças → Tênis → Acessórios)
        for (const cat of CLOTHING_CATEGORY_TARGETS) {
          try {
            await page.goto(cat.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForSelector('.poly-card', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(1500);
            await this._scrollToLoadMore(page);
            const raw = await this._extractRawOffers(page);
            raw.forEach(r => { r._fromFeminineCategory = true; r._categoryPriority = cat.priority; });
            allRaw.push(...raw);
            logger.info(`[Scraper] ${cat.label} (prioridade ${cat.priority}): ${raw.length} cards`);
          } catch (err) {
            logger.debug(`[Scraper] Erro ${cat.label}: ${err.message}`);
          }
          await new Promise(r => setTimeout(r, 1500));
        }

        // 2) Demais nichos femininos — localizados via aba de texto na página de ofertas
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        const categoryLinks = await page.evaluate((tabs) => {
          const seen = new Set();
          const links = [];
          document.querySelectorAll('a').forEach(el => {
            const text = (el.textContent || '').toLowerCase().trim();
            if (tabs.some(kw => text === kw || text.startsWith(kw + ' ')) && el.href && !seen.has(el.href)) {
              seen.add(el.href);
              links.push({ text: el.textContent.trim(), href: el.href });
            }
          });
          return links;
        }, FEMININE_CATEGORY_TABS);

        logger.info(`[Scraper] Abas: ${categoryLinks.map(l => l.text).join(', ') || 'nenhuma'}`);

        for (const link of categoryLinks.slice(0, 8)) {
          try {
            await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForSelector('.poly-card', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(1500);
            await this._scrollToLoadMore(page);
            const raw = await this._extractRawOffers(page);
            raw.forEach(r => { r._fromFeminineCategory = true; });
            allRaw.push(...raw);
            logger.info(`[Scraper] ${link.text}: ${raw.length} cards`);
          } catch (err) {
            logger.debug(`[Scraper] Erro ${link.text}: ${err.message}`);
          }
          await new Promise(r => setTimeout(r, 1500));
        }

        if (allRaw.length > 0) {
          const offers = this._processRawOffers(allRaw, target);
          logger.info(`[Scraper] ${target.label}: ${offers.length} femininas ≥${settings.minDiscount}%`);
          return offers;
        }
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
      }

      await page.waitForSelector('.poly-card', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await this._scrollToLoadMore(page);
      const rawOffers = await this._extractRawOffers(page);
      const offers = this._processRawOffers(rawOffers, target);
      logger.info(`[Scraper] ${target.label}: ${offers.length} femininas ≥${settings.minDiscount}%`);
      return offers;
    } catch (error) {
      logger.error(`[Scraper] Erro ${target.label}: ${error.message}`);
      await this._resetBrowser();
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  async getDailyOffers() {
    return this._scrapeTarget(OFFER_TARGET);
  }

  async getFlashOffers() {
    return this._scrapeTarget(FLASH_TARGET);
  }

  // ─────────────────────────────────────────────
  // Timer de relâmpago
  // ─────────────────────────────────────────────

  async getFlashTimer(productUrl) {
    try { await this._ensureBrowser(); } catch { return null; }
    const page = await this._context.newPage();
    try {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);

      return await page.evaluate(() => {
        const selectors = [
          '[class*="countdown"]', '[class*="timer"]', '[class*="deal-end"]',
          '[class*="vpp"]', '[class*="flash"]', '[data-testid*="countdown"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          if (/\d+[h:]\d+|\d+\s*hora|\d+\s*min/.test(text)) return text.substring(0, 50);
        }
        // Fallback: scan page text for time pattern
        const full = document.body.innerText;
        const m = full.match(/termina\s+em[:\s]+([0-9h\s:min]+)/i);
        return m ? m[1].trim().substring(0, 30) : null;
      });
    } catch { return null; }
    finally { await page.close().catch(() => {}); }
  }

  // ─────────────────────────────────────────────
  // Verificação de gênero na página do produto
  // ─────────────────────────────────────────────

  async checkProductIsMasculine(productUrl) {
    try { await this._ensureBrowser(); } catch { return false; }
    const page = await this._context.newPage();
    try {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);

      return await page.evaluate(() => {
        const MASC = ['masculino', 'masculina', 'para homem', 'homem adulto', 'menino', ' male '];
        const FEM  = ['feminino', 'feminina', 'para mulher', 'mulher', 'senhora'];

        function hasMasc(text) {
          const t = (text || '').toLowerCase();
          return MASC.some(m => t.includes(m));
        }

        function hasFem(text) {
          const t = (text || '').toLowerCase();
          return FEM.some(f => t.includes(f));
        }

        // 1. Tabela de especificações técnicas — campo Gênero / Sexo
        const specRows = document.querySelectorAll(
          'tr.andes-table__row, .ui-pdp-specs__item, [class*="specs"] tr, [class*="attribute-row"]'
        );
        for (const row of specRows) {
          const header = (row.querySelector('th, .andes-table__header, [class*="label"]')?.textContent || '').toLowerCase();
          if (!header.includes('gênero') && !header.includes('genero') && !header.includes('sexo')) continue;
          const value = (row.querySelector('td, .andes-table__column, [class*="value"]')?.textContent || '');
          // Unissex: campo contém ambos → não bloquear
          if (hasMasc(value) && hasFem(value)) return false;
          if (hasMasc(value)) return true;
          // Feminino/unissex explícito → não é masculino
          return false;
        }

        // 2. Fallback: texto completo da tabela de atributos com padrão "Gênero: Masculino"
        // Só bloqueia se masculino aparecer sem feminino/unissex no mesmo bloco
        const specsBlock = document.querySelector('[class*="specs"], [class*="technical"], [class*="attributes"]');
        if (specsBlock) {
          const st = specsBlock.textContent;
          if (/g[eê]nero\s*[:\|]\s*masculin/i.test(st) && !/g[eê]nero\s*[:\|]\s*(feminin|unissex)/i.test(st)) return true;
        }

        // 3. Breadcrumb — só bloqueia se masculino sem nenhum indicador feminino
        const breadcrumb = document.querySelector('[class*="breadcrumb"], nav[aria-label*="breadcrumb"]');
        if (breadcrumb) {
          const bc = breadcrumb.textContent;
          if (hasMasc(bc) && !hasFem(bc)) return true;
        }

        // 4. Título completo na página do produto
        const title = document.querySelector('h1[class*="title"], .ui-pdp-title, h1');
        if (title) {
          const t = title.textContent;
          if (hasMasc(t) && !hasFem(t)) return true;
        }

        return false;
      });
    } catch (err) {
      logger.debug(`Verificação de gênero falhou (${productUrl.substring(0, 60)}): ${err.message}`);
      return false;
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ─────────────────────────────────────────────
  // Cupons — só códigos reais
  // ─────────────────────────────────────────────

  async getCoupons() {
    try { await this._ensureBrowser(); } catch { return []; }
    const page = await this._context.newPage();
    const found = [];

    // Palavras que parecem código mas não são
    const NOT_CODES = new Set([
      'OFF', 'COM', 'SEM', 'ATE', 'PARA', 'POR', 'MAIS', 'MENOS',
      'DEZ', 'VINTE', 'TRINTA', 'MAX', 'MIN', 'VER', 'USE',
      'CUPOM', 'CODIGO', 'CODE', 'APP', 'PIX', 'FRETE',
    ]);

    function looksLikeCode(str) {
      if (!str || str.length < 4 || str.length > 20) return false;
      if (NOT_CODES.has(str.toUpperCase())) return false;
      // Código real: letras maiúsculas + dígitos, pelo menos 1 dígito
      return /^[A-Z]+[0-9]+[A-Z0-9]*$|^[A-Z]{2,}[0-9]{1,}$/.test(str.toUpperCase());
    }

    try {
      // ── 1. Homepage ML — header com cupom explícito ──
      logger.info('[Coupons] Verificando homepage ML...');
      await page.goto('https://www.mercadolivre.com.br', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const homepageCodes = await page.evaluate(() => {
        const results = [];
        // Busca padrão "CUPOM: XXXXX" ou "código: XXXXX" em qualquer elemento pequeno
        document.querySelectorAll('a, span, p, div, li').forEach(el => {
          if (el.children.length > 5) return;
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length > 150 || text.length < 4) return;

          const match = text.match(/(?:cupom|código|code)\s*:?\s*([A-Z0-9]{4,20})/i);
          if (match) {
            const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
            results.push({ code: match[1].toUpperCase(), text, link });
          }
        });
        const seen = new Set();
        return results.filter(c => { if (seen.has(c.code)) return false; seen.add(c.code); return true; });
      });

      for (const c of homepageCodes) {
        if (!looksLikeCode(c.code)) continue;
        const id = crypto.createHash('md5').update(c.code).digest('hex').substring(0, 16);
        found.push({ id, code: c.code, description: c.text, discountText: c.text, category: '', link: c.link || 'https://www.mercadolivre.com.br/cupons', isActive: true });
      }

      // ── 2. Página /cupons — busca códigos visíveis ──
      logger.info('[Coupons] Verificando página /cupons...');
      await page.goto('https://www.mercadolivre.com.br/cupons', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      // Screenshot 1x/dia
      const today = new Date().toISOString().slice(0, 10);
      if (await db.getConfig('last_coupon_screenshot') !== today) {
        await page.screenshot({ path: path.resolve(process.cwd(), 'logs', `coupons_${today}.png`), fullPage: true }).catch(() => {});
        await db.setConfig('last_coupon_screenshot', today);
      }

      const pageCodes = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('*').forEach(el => {
          if (el.children.length > 0) return;       // só folhas do DOM
          const text = (el.textContent || '').trim();
          if (!text || text.length > 25) return;
          // Texto que parece exatamente um código
          if (/^[A-Z0-9]{4,20}$/.test(text)) {
            const card = el.closest('[class*="card"], [class*="coupon"], [class*="item"], li, article');
            const cardText = card ? card.textContent.replace(/\s+/g, ' ').trim().substring(0, 250) : text;
            const link = card?.closest('a')?.href || card?.querySelector('a')?.href || '';
            results.push({ code: text, cardText, link });
          }
        });
        const seen = new Set();
        return results.filter(c => { if (seen.has(c.code)) return false; seen.add(c.code); return true; });
      });

      for (const c of pageCodes) {
        if (!looksLikeCode(c.code)) continue;
        if (found.some(f => f.code === c.code)) continue;
        const discountMatch = c.cardText.match(/(\d+%\s*(?:de\s*)?(?:off|desconto)|R\$\s*\d+(?:[.,]\d+)?\s*(?:off|desconto)?)/i);
        const minMatch = c.cardText.match(/compras?\s+(?:acima\s+de\s+)?R\$\s*[\d.,]+/i);
        const limitMatch = c.cardText.match(/(?:limite|desconto\s+de)\s+R\$\s*[\d.,]+/i);
        const discountText = [
          discountMatch?.[0],
          minMatch?.[0] ? `em ${minMatch[0]}` : '',
          limitMatch?.[0] ? `- ${limitMatch[0]}` : '',
        ].filter(Boolean).join(' ');

        const id = crypto.createHash('md5').update(c.code).digest('hex').substring(0, 16);
        found.push({ id, code: c.code, description: c.cardText, discountText: discountText || c.cardText.substring(0, 100), category: '', link: c.link || 'https://www.mercadolivre.com.br/cupons', isActive: true });
      }

      logger.info(`[Coupons] ${found.length} cupons com código real encontrados.`);
      return found;
    } catch (err) {
      logger.error(`[Coupons] Erro: ${err.message}`);
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ─────────────────────────────────────────────
  // Link de Afiliado
  // ─────────────────────────────────────────────

  async buildAffiliateLink(url) {
    return this.affiliate.buildLink(url);
  }

  // ─────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────

  _setupGracefulShutdown() {
    const cleanup = async () => {
      if (this._browser) { await this._browser.close().catch(() => {}); this._browser = null; }
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }
}

module.exports = new MercadoLivreService();

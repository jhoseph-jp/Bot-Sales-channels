/**
 * affiliate_automation.js
 *
 * Gera links de afiliado autênticos ("Melu") via scraping do portal ML.
 * URL alvo: https://www.mercadolivre.com.br/afiliados/linkbuilder
 *
 * PRÉ-REQUISITO: rode "node src/utils/save-session.js" uma vez para salvar
 * os cookies de sessão em data/ml_session.json. O bot usa essa sessão
 * automaticamente. Rode o script novamente se a sessão expirar.
 */

const { chromium } = require('playwright');
const path  = require('path');
const fs    = require('fs');
const logger = require('./logger');

const LINK_BUILDER_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub';
const SESSION_FILE     = path.resolve(process.cwd(), 'data', 'ml_session.json');
const SCREENSHOT_DIR   = path.resolve(process.cwd(), 'logs');
const MAX_SCREENSHOTS  = 30;   // so os mais recentes servem para diagnostico

const UTM_FALLBACK = {
  utm_source   : 'telegram',
  utm_medium   : 'bot',
  utm_campaign : 'ofertadelas_ofertas',
};

class AffiliateAutomation {
  constructor({ affiliateId, accessToken, refreshToken, email, password, baseUrl }) {
    this.affiliateId    = affiliateId;
    this.accessToken    = accessToken;
    this.refreshTokenFn = refreshToken;
    this.baseUrl        = baseUrl || 'https://api.mercadolibre.com';

    this.browser   = null;
    this.context   = null;
    this._initLock = false;

    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    this._setupGracefulShutdown();
  }

  // ─────────────────────────────────────────────
  // API pública
  // ─────────────────────────────────────────────

  async buildLink(rawUrl) {
    const cleanUrl = this._cleanUrl(rawUrl);
    const meluLink = await this._tryLinkBuilder(cleanUrl);
    if (meluLink) {
      logger.info(`[AffiliateAutomation] Link Melu gerado: ${meluLink}`);
      return meluLink;
    }
    // Retorna null — o caller decide se envia ou descarta a oferta.
    // Nunca envia link direto sem rastreamento Melu.
    logger.warn(`[AffiliateAutomation] Link Melu não gerado. Oferta será descartada neste ciclo.`);
    return null;
  }

  updateAccessToken(newToken) { this.accessToken = newToken; }

  // ─────────────────────────────────────────────
  // Browser singleton
  // ─────────────────────────────────────────────

  async _ensureBrowser() {
    if (this.browser && this.context) return;
    if (this._initLock) {
      while (this._initLock) await new Promise(r => setTimeout(r, 100));
      return;
    }
    this._initLock = true;
    try {
      // Verifica se a sessão existe antes de iniciar
      if (!fs.existsSync(SESSION_FILE)) {
        throw new Error(
          'Sessão ML não encontrada. Execute primeiro:\n  node src/utils/save-session.js'
        );
      }

      logger.info('[AffiliateAutomation] Iniciando Chromium com sessão salva...');
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
      });
      this.context = await this.browser.newContext({
        viewport     : { width: 1280, height: 800 },
        locale       : 'pt-BR',
        userAgent    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        storageState : SESSION_FILE,   // ← carrega cookies da sessão manual
      });
      logger.info('[AffiliateAutomation] Browser pronto com sessão ML carregada.');
    } finally {
      this._initLock = false;
    }
  }

  _setupGracefulShutdown() {
    const cleanup = async () => {
      if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; }
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  // ─────────────────────────────────────────────
  // Link Builder
  // ─────────────────────────────────────────────

  async _tryLinkBuilder(productUrl) {
    let page = null;
    try {
      await this._ensureBrowser();
      page = await this.context.newPage();

      // ── Navega para o link builder ──
      logger.debug('[AffiliateAutomation] Abrindo link builder...');
      await page.goto(LINK_BUILDER_URL, { waitUntil: 'networkidle', timeout: 25000 });
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      logger.debug(`[AffiliateAutomation] URL atual: ${currentUrl}`);

      // Sessão expirada → ML redireciona para alguma URL de login
      if (currentUrl.includes('/login') || currentUrl.includes('iniciar-sessao') || currentUrl.includes('entrar')) {
        logger.error('[AffiliateAutomation] Sessão expirada! Rode novamente:');
        logger.error('  node src/utils/save-session.js');

        // Deleta a sessão inválida para forçar novo save-session na próxima tentativa
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);

        // Reinicia o browser (sem sessão, cairia no erro de "sessão não encontrada" e usaria fallback)
        if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; this.context = null; }
        return null;
      }

      // ── Intercepta API interna — só ativa APÓS clicar em "Gerar" ──
      let interceptedLink = null;
      let capturingResponses = false;

      page.on('response', async response => {
        if (!capturingResponses) return; // ignora requests do carregamento inicial da página
        try {
          const url = response.url();
          if (response.status() !== 200) return;
          if (/\.(js|css|png|jpg|woff|svg)/.test(url)) return;
          const ct = response.headers()['content-type'] || '';
          if (!ct.includes('json')) return;

          const body = await response.json().catch(() => null);
          if (!body) return;

          const candidate =
            body.short_url     || body.link          || body.url     ||
            body.affiliate_url || body.data?.url     || body.data?.link ||
            body.result?.url   || body.result?.link  || null;

          // Só aceita links que parecem afiliados ou me.li — rejeita URLs internas do ML
          const REJECT_PATHS = ['/acessibilidade', '/feedback', '/login', '/ajuda', '/nosso-blog', '/perfil'];
          const isAffiliate = candidate && typeof candidate === 'string' && (
            candidate.includes('meli.la/') ||
            /mercadolivre\.com\.br\/(MLB|p\/|MLB)/.test(candidate) ||
            candidate.includes('?aff_id=') ||
            candidate.includes('_Afiliados')
          ) && !REJECT_PATHS.some(p => candidate.includes(p));

          if (isAffiliate) {
            interceptedLink = candidate;
            logger.debug(`[AffiliateAutomation] Link capturado via API: ${candidate}`);
          }
        } catch { /* silencia */ }
      });

      // ── Preenche a URL do produto ──
      // IMPORTANTE: o gerador usa <textarea>, não <input>
      const inputSelectors = [
        'textarea',
        'textarea[placeholder*="URL"]',
        'textarea[placeholder*="url"]',
        'input[data-testid="link-builder-input"]',
        'input[placeholder*="Cole o link"]',
        'input[placeholder*="URL"]',
        'input[placeholder*="url"]',
        'input[placeholder*="produto"]',
        'main input[type="text"]',
        'form input[type="text"]',
        'input[type="text"]',
      ];

      let inputFilled = false;
      for (const sel of inputSelectors) {
        try {
          const el = await page.waitForSelector(sel, { timeout: 3000 });
          if (el) {
            await el.click();
            await el.fill(productUrl);
            inputFilled = true;
            logger.debug(`[AffiliateAutomation] URL preenchida (${sel})`);
            break;
          }
        } catch { /* próximo */ }
      }

      if (!inputFilled) {
        await this._screenshot(page, 'linkbuilder_input_not_found');
        logger.warn('[AffiliateAutomation] Campo de URL não encontrado. Screenshot salvo em logs/');
        return null;
      }

      // ── Clica em gerar ──
      const btnSelectors = [
        'button[data-testid="link-builder-generate"]',
        'button:has-text("Gerar link")',
        'button:has-text("Criar link")',
        'button:has-text("Gerar")',
        'button:has-text("Criar")',
        'button[type="submit"]',
      ];
      let clicked = false;
      for (const sel of btnSelectors) {
        try { await page.click(sel, { timeout: 3000 }); clicked = true; break; } catch { /* próximo */ }
      }
      // Ativa a captura de respostas API só a partir de agora
      capturingResponses = true;

      if (!clicked) { await page.keyboard.press('Enter'); }

      await page.waitForTimeout(5000);

      // Sem screenshot aqui: isto roda a cada link gerado com sucesso e acumulou 471
      // PNGs / 60 MB em logs/. Se a extracao abaixo falhar, os caminhos de erro
      // ('linkbuilder_result_not_found' / '_exception') capturam o mesmo estado.

      // ── Captura o resultado ──
      // O gerador mostra o link gerado num campo input no painel direito.
      // O domínio do link curto é meli.la (ex: https://meli.la/1juxJXy)

      // 1. Via intercept de rede (mais confiável — captura a resposta da API do "Gerar")
      if (interceptedLink) return interceptedLink;

      // 2. Lê o valor live de todos os inputs/textareas (funciona com React)
      // inputValue() reflete o valor atual mesmo quando o atributo HTML não é atualizado
      const allFormEls = await page.$$('input, textarea');
      for (const el of allFormEls) {
        const val = await el.inputValue().catch(() => '');
        if (val && val.includes('meli.la/')) return val.trim();
      }

      // 3. Varredura DOM procurando meli.la — regex restrito a código alfanumérico (5-12 chars)
      const meliUrl = await page.evaluate(() => {
        const els = document.querySelectorAll('input, textarea, a, span, p, div');
        for (const el of els) {
          const val = el.value || el.href || el.textContent || '';
          const match = val.match(/https?:\/\/meli\.la\/([A-Za-z0-9]{5,12})/);
          if (match) return `https://meli.la/${match[1]}`;
        }
        return null;
      });
      if (meliUrl) return meliUrl;

      // 4. Link meli.la em elemento <a>
      try {
        const meliAnchor = await page.waitForSelector('a[href*="meli.la/"]', { timeout: 3000 });
        if (meliAnchor) {
          const href = await meliAnchor.getAttribute('href');
          if (href) return href.trim();
        }
      } catch { /* próximo */ }

      await this._screenshot(page, 'linkbuilder_result_not_found');
      logger.warn('[AffiliateAutomation] Link Melu não capturado. Screenshot salvo em logs/');
      return null;

    } catch (err) {
      // Erro de "sessão não encontrada" → vai para fallback silenciosamente
      if (err.message.includes('save-session')) {
        logger.error(`[AffiliateAutomation] ${err.message}`);
      } else {
        logger.error(`[AffiliateAutomation] Erro no link builder: ${err.message}`);
        if (page) await this._screenshot(page, 'linkbuilder_exception');
      }

      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
        this.context = null;
      }
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  _cleanUrl(url) {
    try {
      const parsed = new URL(url);
      ['search_id', 'origin', 'position', 'promotion_id', 'aff_id', 'picker',
       'utm_source', 'utm_medium', 'utm_campaign'].forEach(p => parsed.searchParams.delete(p));
      return parsed.toString();
    } catch { return url; }
  }

  _buildFallbackUrl(cleanUrl) {
    try {
      const parsed = new URL(cleanUrl);
      parsed.searchParams.set('aff_id', this.affiliateId);
      Object.entries(UTM_FALLBACK).forEach(([k, v]) => parsed.searchParams.set(k, v));
      return parsed.toString();
    } catch {
      const sep = cleanUrl.includes('?') ? '&' : '?';
      return `${cleanUrl}${sep}aff_id=${this.affiliateId}`;
    }
  }

  async _screenshot(page, name) {
    try {
      const file = path.join(SCREENSHOT_DIR, `${name}_${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: true });
      logger.info(`[AffiliateAutomation] Screenshot: ${file}`);
      this._podarScreenshots();
    } catch { /* ignora */ }
  }

  // Mantem apenas os N screenshots mais recentes. Diagnostico so olha os ultimos
  // mesmo, e sem poda a pasta cresce para sempre.
  _podarScreenshots(manter = MAX_SCREENSHOTS) {
    try {
      const pngs = fs.readdirSync(SCREENSHOT_DIR)
        .filter(f => f.startsWith('linkbuilder_') && f.endsWith('.png'))
        .map(f => ({ f, t: fs.statSync(path.join(SCREENSHOT_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const { f } of pngs.slice(manter)) {
        fs.unlinkSync(path.join(SCREENSHOT_DIR, f));
      }
    } catch { /* ignora */ }
  }
}

module.exports = AffiliateAutomation;

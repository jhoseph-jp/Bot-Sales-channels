const { exec } = require('child_process');
const { settings } = require('./config/env');
const logger = require('./utils/logger');
const db = require('./repositories/database');
const mlService = require('./services/mercadoLivreService');
const telegramService = require('./services/telegramService');
const couponListener = require('./services/couponListener');
const cuponomiaScraper = require('./services/cuponomiaScraper');
const { isRelevantForAudience } = require('./utils/couponAudience');
const instagramService = require('./services/instagramService');
const whatsappService = require('./services/whatsappService');

// Comando de sync do SQLite com o EC2/VPS do website. Definido em WEBSITE_SYNC_CMD
// no .env. Vazio (padrão) = sync desligado — útil rodando local sem servidor do site.
const WEBSITE_SYNC_CMD = settings.websiteSyncCmd;

const OFFER_INTERVAL_MS  = 1800000;  // 30 min — ofertas do dia
const FLASH_INTERVAL_MS  =  600000;  // 10 min — relâmpago
const COUPON_INTERVAL_MS = 3600000;  // 60 min — cupons de canais Telegram

const MAX_OFFERS_PER_CYCLE = 8;      // máx por ciclo diário
const MAX_FLASH_PER_CYCLE  = 5;      // máx por ciclo relâmpago

class BotApp {
  constructor() {
    this.isRunning = false;
  }

  async start() {
    try {
      await mlService.init();
      this.isRunning = true;

      this.runOfferCycle();
      this.runFlashCycle();
      this.runCouponCycle();

      logger.info(`Bot iniciado. Ofertas: 30 min (max ${MAX_OFFERS_PER_CYCLE}) | Relâmpago: 10 min (max ${MAX_FLASH_PER_CYCLE}) | Cupons: 60 min | Categorias: ${['moda','calçados','beleza','esportes','acessórios','joias'].join(', ')}`);
    } catch (err) {
      logger.error('Erro fatal ao iniciar:', err.message);
      process.exit(1);
    }
  }

  // ─────────────────────────────────────────────
  // Ciclo Ofertas do Dia — 30 min, max 5
  // ─────────────────────────────────────────────

  async runOfferCycle() {
    if (!this.isRunning) return;
    try {
      const offers = await mlService.getDailyOffers();
      const sent = await this._processOffers(offers, MAX_OFFERS_PER_CYCLE, false);
      logger.info(`[Ofertas do Dia] ${sent} novas enviadas.`);
      if (sent > 0) this._syncWebsite();
    } catch (err) {
      logger.error('[Ofertas do Dia] Erro:', err.message);
    } finally {
      setTimeout(() => this.runOfferCycle(), OFFER_INTERVAL_MS);
    }
  }

  // ─────────────────────────────────────────────
  // Ciclo Relâmpago — 10 min, max 3, com timer
  // ─────────────────────────────────────────────

  async runFlashCycle() {
    if (!this.isRunning) return;
    try {
      const offers = await mlService.getFlashOffers();
      const sent = await this._processOffers(offers, MAX_FLASH_PER_CYCLE, true);
      logger.info(`[Relâmpago] ${sent} novas enviadas.`);
      if (sent > 0) this._syncWebsite();
    } catch (err) {
      logger.error('[Relâmpago] Erro:', err.message);
    } finally {
      setTimeout(() => this.runFlashCycle(), FLASH_INTERVAL_MS);
    }
  }

  // ─────────────────────────────────────────────
  // Ciclo Cupons — 60 min, via canais Telegram
  // ─────────────────────────────────────────────

  async runCouponCycle() {
    if (!this.isRunning) return;
    try {
      // Busca de três fontes em paralelo: cuponomia (mais estruturado) + canais Telegram + página ML
      const [cuponomiaCoupons, listenerCoupons, mlCoupons] = await Promise.all([
        cuponomiaScraper.getCoupons().catch(() => []),
        couponListener.getCoupons().catch(() => []),
        mlService.getCoupons().catch(() => []),
      ]);

      // Mapa código → discountText do ML (fonte mais confiável para %desconto quando falta)
      const mlDiscountMap = new Map(mlCoupons.map(c => [c.code, c.discountText]));

      // Cada fonte só pode ser confirmada/revalidada contra ela mesma — a página de
      // cupons do ML NUNCA lista os códigos genéricos de terceiros da cuponomia (são
      // catálogos diferentes), então cruzar cuponomia contra mlCodes sempre falha (ou,
      // pior, quando o scrape do ML cai — comum, ML bloqueia bot de IP de VPS — a
      // checagem inteira era pulada e cupons ficavam "presos" ativos pra sempre. Por
      // isso cada fonte é seu próprio ground-truth.
      const mlCodes = new Set(mlCoupons.map(c => c.code));
      const cuponomiaCodes = new Set(cuponomiaCoupons.map(c => c.code));

      const taggedCuponomia = cuponomiaCoupons.map(c => ({ ...c, source: 'cuponomia' }));
      const taggedListener  = listenerCoupons.map(c => ({ ...c, source: 'listener', discount: c.discount ?? null, minimum: c.minimum ?? null, limit: c.limit ?? null }));
      const taggedMl        = mlCoupons.map(c => ({ ...c, source: 'ml', discount: c.discount ?? null, minimum: c.minimum ?? null, limit: c.limit ?? null }));

      // Merge: cuponomia tem prioridade (campos numéricos mais confiáveis),
      // depois soma exclusivos do listener e da página ML.
      const allCoupons = [...taggedCuponomia];
      for (const source of [taggedListener, taggedMl]) {
        for (const c of source) {
          if (!allCoupons.some(existing => existing.code === c.code)) {
            allCoupons.push(c);
          }
        }
      }

      // Confirma um cupom contra a fonte que pode atestar sua validade. cuponomia e
      // ml são confiadas ao ingerir (acabaram de ser raspadas frescas agora); listener
      // (canais Telegram) é terceiro não-oficial reivindicando cupom do ML, então
      // precisa aparecer na página real do ML pra ser confirmado.
      function isVerified(coupon) {
        if (coupon.source === 'listener') {
          return mlCoupons.length === 0 || mlCodes.has(coupon.code); // sem dado do ML: não bloqueia
        }
        return true; // cuponomia/ml: a própria presença no scrape desse ciclo já confirma
      }

      const newCoupons = [];
      let filtered = 0;
      let unverified = 0;
      for (const coupon of allCoupons) {
        if (await db.isCouponProcessed(coupon.id)) continue;

        // Enriquece com discountText do ML quando ainda não tem %
        if (!coupon.discount && mlDiscountMap.has(coupon.code)) {
          coupon.discountText = mlDiscountMap.get(coupon.code);
        }

        // Fora do público-alvo (veículos, construção, pet, infantil...) — salva como
        // inativo só pra não reprocessar, mas não entra na mensagem nem vira cupom ativo.
        if (!isRelevantForAudience(coupon)) {
          await db.saveCoupon({ ...coupon, discountText: coupon.discountText || '', isActive: false });
          filtered++;
          continue;
        }

        if (!isVerified(coupon)) {
          await db.saveCoupon({ ...coupon, discountText: coupon.discountText || '', isActive: false });
          unverified++;
          continue;
        }

        await db.saveCoupon({ ...coupon, discountText: coupon.discountText || '', isActive: true });
        newCoupons.push(coupon);
        logger.info(`Novo cupom: ${coupon.code}${coupon.discount ? ` (${coupon.discount}% OFF)` : coupon.discountText ? ` (${coupon.discountText})` : ''}`);
      }
      if (filtered > 0) logger.info(`[Cupons] ${filtered} filtrado(s) (fora do público-alvo).`);
      if (unverified > 0) logger.info(`[Cupons] ${unverified} não confirmado(s) na fonte de origem.`);

      // Revalida cupons já ativos contra a fonte que os originou: se sumiram desse
      // ciclo, provavelmente expiraram — desativa pra não serem mais enviados/ofertados.
      const stillActive = await db.getActiveCoupons();
      let deactivated = 0;
      for (const c of stillActive) {
        if (c.source === 'cuponomia' && cuponomiaCoupons.length > 0 && !cuponomiaCodes.has(c.code)) {
          await db.updateCouponStatus(c.id, false);
          deactivated++;
        } else if (c.source !== 'cuponomia' && mlCoupons.length > 0 && !mlCodes.has(c.code)) {
          await db.updateCouponStatus(c.id, false);
          deactivated++;
        }
      }
      if (deactivated > 0) logger.info(`[Cupons] ${deactivated} desativado(s) (não encontrados mais na fonte de origem).`);

      // Trava de segurança: se as raspagens ficarem fora do ar por dias seguidos, um
      // cupom ativo nunca revalidado se auto-expira em vez de ficar preso pra sempre.
      const stale = await db.deactivateStaleCoupons(72);
      if (stale.changes > 0) logger.info(`[Cupons] ${stale.changes} desativado(s) por TTL (72h sem revalidação).`);

      if (newCoupons.length > 0) {
        const genericLink = await mlService.buildAffiliateLink('https://www.mercadolivre.com.br/ofertas')
          .catch(() => null) || 'https://www.mercadolivre.com.br/cupons';
        telegramService.enqueueCouponBatch(newCoupons, genericLink);
        whatsappService.enqueueCouponBatch(newCoupons, genericLink);
      }

      logger.info(`[Cupons] ${newCoupons.length} novo(s) enviado(s).`);
    } catch (err) {
      logger.error('[Cupons] Erro:', err.message);
    } finally {
      setTimeout(() => this.runCouponCycle(), COUPON_INTERVAL_MS);
    }
  }

  // ─────────────────────────────────────────────
  // Processamento comum de ofertas
  // ─────────────────────────────────────────────

  async _processOffers(offers, maxPerCycle, fetchTimer) {
    const newOffers = [];
    for (const offer of offers) {
      const dup = await db.isOfferProcessed(offer.id) || await db.isOfferUrlProcessed(offer.link);
      if (!dup) newOffers.push(offer);
    }

    if (newOffers.length === 0) return 0;

    // Pega até 3x o limite para compensar descartes por gênero
    const candidates = newOffers
      .sort((a, b) => b.discount - a.discount)
      .slice(0, maxPerCycle * 3);

    let sent = 0;

    for (const offer of candidates) {
      if (sent >= maxPerCycle) break;

      // Verifica gênero na página do produto — descarta masculinos
      const isMasculine = await mlService.checkProductIsMasculine(offer.link);
      if (isMasculine) {
        logger.info(`Descartado (masculino): ${offer.title.substring(0, 60)}`);
        continue;
      }

      if (fetchTimer) {
        offer.timer = await mlService.getFlashTimer(offer.link).catch(() => null);
      }

      const originalLink = offer.link;
      const meluUrl = await mlService.buildAffiliateLink(offer.link);
      if (!meluUrl) {
        logger.warn(`Sem link afiliado (próx. ciclo): ${offer.title.substring(0, 50)}`);
        continue;
      }

      offer.originalLink = originalLink;
      offer.link = meluUrl;

      const saved = await db.saveOffer(offer);
      if (!saved) continue;
      await telegramService.enqueueOffer(offer);
      instagramService.enqueueOffer(offer);   // Caminho A: espelha as melhores no Instagram
      whatsappService.enqueueOffer(offer);    // Espelha no grupo do WhatsApp
      sent++;

      logger.info(`Nova oferta: ${offer.discount}% OFF | ${offer.category} | ${offer.title.substring(0, 50)}`);
    }

    return sent;
  }

  _syncWebsite() {
    if (!WEBSITE_SYNC_CMD) return;   // sync desligado (rodando local sem servidor do site)
    exec(WEBSITE_SYNC_CMD, (err) => {
      if (err) logger.warn('[Sync] Falha ao sincronizar SQLite com website:', err.message);
      else logger.info('[Sync] SQLite sincronizado com o website.');
    });
  }

  stop() {
    this.isRunning = false;
    logger.info('Bot encerrando...');
  }
}

const app = new BotApp();
app.start();

process.on('SIGINT',  () => { app.stop(); process.exit(0); });
process.on('SIGTERM', () => { app.stop(); process.exit(0); });
process.on('uncaughtException',  (e) => { logger.error('Exceção:', e.message); process.exit(1); });
process.on('unhandledRejection', (r)  => { logger.error('Promise rejeitada:', r); });

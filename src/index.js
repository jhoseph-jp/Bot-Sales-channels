const { settings, couponChannels } = require('./config/env');
const logger = require('./utils/logger');
const db = require('./repositories/database');
const mlService = require('./services/mercadoLivreService');
const telegramService = require('./services/telegramService');
const couponListener = require('./services/couponListener');

const OFFER_INTERVAL_MS  = 1800000;  // 30 min — ofertas do dia
const FLASH_INTERVAL_MS  =  600000;  // 10 min — relâmpago
const COUPON_INTERVAL_MS = 3600000;  // 60 min — cupons

const MAX_OFFERS_PER_CYCLE = 5;      // máx por ciclo diário
const MAX_FLASH_PER_CYCLE  = 3;      // máx por ciclo relâmpago

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

      logger.info(`Bot iniciado. Ofertas: 30 min (max ${MAX_OFFERS_PER_CYCLE}) | Relâmpago: 10 min (max ${MAX_FLASH_PER_CYCLE}) | Cupons: 60 min (fontes: ML homepage + @${couponChannels.join(', @')})`);
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
    } catch (err) {
      logger.error('[Relâmpago] Erro:', err.message);
    } finally {
      setTimeout(() => this.runFlashCycle(), FLASH_INTERVAL_MS);
    }
  }

  // ─────────────────────────────────────────────
  // Processamento comum de ofertas
  // ─────────────────────────────────────────────

  async _processOffers(offers, maxPerCycle, fetchTimer) {
    // Filtra já enviados (dupla checagem: id + URL original)
    const newOffers = [];
    for (const offer of offers) {
      const dup = await db.isOfferProcessed(offer.id) || await db.isOfferUrlProcessed(offer.link);
      if (!dup) newOffers.push(offer);
    }

    if (newOffers.length === 0) return 0;

    // Ordena por desconto (maior primeiro) e limita
    const topOffers = newOffers
      .sort((a, b) => b.discount - a.discount)
      .slice(0, maxPerCycle);

    let sent = 0;

    for (const offer of topOffers) {
      // Enriquece com cupom ativo se o produto não tem cupom inline
      if (!offer.coupon) {
        const activeCoupons = await db.getActiveCouponsForCategory(offer.category || '');
        if (activeCoupons.length > 0) {
          const best = activeCoupons[0];
          offer.coupon = best.discountText ? `${best.code} — ${best.discountText}` : best.code;
        }
      }

      // Timer para relâmpago
      if (fetchTimer) {
        offer.timer = await mlService.getFlashTimer(offer.link).catch(() => null);
      }

      // Gera link afiliado
      const originalLink = offer.link;
      const meluUrl = await mlService.buildAffiliateLink(offer.link);
      if (!meluUrl) {
        logger.warn(`Sem link afiliado (próx. ciclo): ${offer.title.substring(0, 50)}`);
        continue;
      }

      offer.originalLink = originalLink;
      offer.link = meluUrl;

      await db.saveOffer(offer);
      await telegramService.enqueueOffer(offer);
      sent++;

      logger.info(`Nova oferta: ${offer.discount}% OFF | ${offer.category} | ${offer.title.substring(0, 50)}`);
    }

    return sent;
  }

  // ─────────────────────────────────────────────
  // Ciclo Cupons — 60 min
  // Fontes: ML homepage + canais Telegram configurados
  // Só posta cupons com código real e explícito
  // ─────────────────────────────────────────────

  async runCouponCycle() {
    if (!this.isRunning) return;
    try {
      logger.info('[Cupons] Verificando fontes de cupons...');

      // Agrega cupons das duas fontes (dedup interno por código)
      const allCoupons = await couponListener.scanAll(couponChannels);

      let newCount = 0;
      for (const coupon of allCoupons) {
        if (!await db.isCouponProcessed(coupon.id)) {
          logger.info(`Novo cupom [${coupon.source}]: ${coupon.code} — ${coupon.discountText}`);
          await db.saveCoupon(coupon);
          await telegramService.enqueueCoupon(coupon);
          newCount++;
        }
      }

      logger.info(`[Cupons] ${newCount} novo(s) | ${allCoupons.length} encontrado(s) nas fontes.`);
    } catch (err) {
      logger.error('[Cupons] Erro:', err.message);
    } finally {
      setTimeout(() => this.runCouponCycle(), COUPON_INTERVAL_MS);
    }
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

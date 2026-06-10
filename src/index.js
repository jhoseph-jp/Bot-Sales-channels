const { exec } = require('child_process');
const { settings } = require('./config/env');
const logger = require('./utils/logger');
const db = require('./repositories/database');
const mlService = require('./services/mercadoLivreService');
const telegramService = require('./services/telegramService');
const couponListener = require('./services/couponListener');

const WEBSITE_SYNC_CMD = 'scp -o StrictHostKeyChecking=no -i /home/ubuntu/.ssh/sync_key /home/ubuntu/Bot-Sales-channels/data/bot.sqlite ubuntu@18.216.121.64:/home/ubuntu/jppromo-website/data/bot.sqlite';

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
      const coupons = await couponListener.getCoupons();
      let sent = 0;
      for (const coupon of coupons) {
        if (await db.isCouponProcessed(coupon.id)) continue;
        await db.saveCoupon({ ...coupon, discountText: '', isActive: true });
        telegramService.enqueueCoupon(coupon);
        sent++;
        logger.info(`Novo cupom: ${coupon.code} (canal: ${coupon.channel})`);
      }
      logger.info(`[Cupons] ${sent} novo(s) enviado(s).`);
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
      sent++;

      logger.info(`Nova oferta: ${offer.discount}% OFF | ${offer.category} | ${offer.title.substring(0, 50)}`);
    }

    return sent;
  }

  _syncWebsite() {
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

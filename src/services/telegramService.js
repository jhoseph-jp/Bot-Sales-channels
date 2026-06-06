const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { telegram } = require('../config/env');
const logger = require('../utils/logger');
const PriceCalculator = require('../utils/priceCalculator');

const ML_LOGO_PATH = path.resolve(__dirname, '../assets/ml-logo.jpg');

class TelegramService {
  constructor() {
    this.bot = new TelegramBot(telegram.token, { polling: false });
    this.chatId = telegram.chatId;
    this.queue = [];
    this.isProcessing = false;
    logger.info('TelegramService inicializado.');
  }

  // ─────────────────────────────────────────────
  // Fila
  // ─────────────────────────────────────────────

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const { type, data } = this.queue.shift();
      try {
        if (type === 'offer')       await this.sendOfferMessage(data);
        else if (type === 'coupon') await this.sendCouponMessage(data);
        await new Promise(r => setTimeout(r, 1500));
      } catch (error) {
        logger.error(`Fila (${type}): ${error.message}`);
      }
    }
    this.isProcessing = false;
  }

  enqueueOffer(offer)   { this.queue.push({ type: 'offer',  data: offer });  this.processQueue(); }
  enqueueCoupon(coupon) { this.queue.push({ type: 'coupon', data: coupon }); this.processQueue(); }

  // ─────────────────────────────────────────────
  // Mensagem de Oferta
  // ─────────────────────────────────────────────

  async sendOfferMessage(offer) {
    if (!offer.discount || offer.discount <= 0) return;

    const emoji    = offer.emoji || '✨';
    const original = PriceCalculator.formatPrice(offer.originalPrice);
    const current  = PriceCalculator.formatPrice(offer.price);

    let msg = '';
    if (offer.isFlash) msg += `⚡ OFERTA RELÂMPAGO!\n\n`;

    msg += `${emoji} ${offer.title}\n\n`;
    msg += `~~${original}~~\n`;
    msg += `💰 *${current}*\n`;
    msg += `📉 ${offer.discount}% OFF\n`;

    if (offer.timer)                     msg += `⏱ Termina em: ${offer.timer}\n`;
    if (offer.coupon && offer.coupon.trim()) msg += `\n🎟 Cupom: \`${offer.coupon}\`\n`;

    msg += `\n🔗 ${offer.link}`;

    if (offer.image) {
      try {
        await this.bot.sendPhoto(this.chatId, offer.image, { caption: msg, parse_mode: 'Markdown' });
        return;
      } catch (err) {
        logger.debug(`Foto oferta falhou, enviando texto: ${err.message}`);
      }
    }

    await this.bot.sendMessage(this.chatId, msg, { parse_mode: 'Markdown', disable_web_page_preview: false });
  }

  // ─────────────────────────────────────────────
  // Mensagem de Cupom — formato PromoTop
  // ─────────────────────────────────────────────

  async sendCouponMessage(coupon) {
    if (!coupon.code || !coupon.code.trim()) {
      logger.warn('Cupom ignorado: sem código real.');
      return;
    }

    const discount = coupon.discountText || '';
    const link     = coupon.link || 'https://www.mercadolivre.com.br/cupons';

    let msg = `🔥 *Novo Cupom Mercado Livre!*\n\n`;
    if (discount) msg += `➖ ${discount}\n`;
    msg += `🎯 Usem o cupom: \`${coupon.code}\`\n\n`;
    msg += `🔗 ${link}`;

    try {
      await this.bot.sendPhoto(
        this.chatId,
        fs.createReadStream(ML_LOGO_PATH),
        { caption: msg, parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error('Foto cupom falhou:', err.message);
      await this.bot.sendMessage(this.chatId, msg, { parse_mode: 'Markdown' })
        .catch(e => logger.error('Mensagem cupom:', e.message));
    }
  }
}

module.exports = new TelegramService();

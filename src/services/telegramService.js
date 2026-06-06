const TelegramBot = require('node-telegram-bot-api');
const { telegram } = require('../config/env');
const logger = require('../utils/logger');
const PriceCalculator = require('../utils/priceCalculator');

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
      const { data } = this.queue.shift();
      try {
        await this.sendOfferMessage(data);
        await new Promise(r => setTimeout(r, 1500));
      } catch (error) {
        logger.error(`Fila: ${error.message}`);
      }
    }
    this.isProcessing = false;
  }

  enqueueOffer(offer) { this.queue.push({ data: offer }); this.processQueue(); }

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

    if (offer.timer) msg += `⏱ Termina em: ${offer.timer}\n`;

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
}

module.exports = new TelegramService();

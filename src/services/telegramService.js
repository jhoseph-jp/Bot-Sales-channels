/**
 * Serviço de integração com Telegram
 * @module services/telegramService
 */

const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const config = require('../config/env');

let bot = null;
let lastMessageTime = 0;

/**
 * Inicializa o bot do Telegram
 */
function init() {
  try {
    bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });
    logger.info('Bot Telegram inicializado com sucesso');
  } catch (error) {
    logger.error('Erro ao inicializar bot Telegram', error);
    throw error;
  }
}

/**
 * Aplica rate limit entre mensagens
 */
async function applyRateLimit() {
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;

  if (timeSinceLastMessage < config.TELEGRAM_RATE_LIMIT_DELAY) {
    const delayNeeded = config.TELEGRAM_RATE_LIMIT_DELAY - timeSinceLastMessage;
    await new Promise(resolve => setTimeout(resolve, delayNeeded));
  }

  lastMessageTime = Date.now();
}

/**
 * Envia mensagem de oferta para o canal
 * @param {object} offer - Dados da oferta
 * @returns {Promise<boolean>} Sucesso
 */
async function sendOfferMessage(offer) {
  try {
    await applyRateLimit();

    const message = formatOfferMessage(offer);
    
    await bot.sendMessage(config.TELEGRAM_CHANNEL_ID, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });

    logger.info('Mensagem de oferta enviada', { title: offer.title });
    return true;
  } catch (error) {
    logger.error('Erro ao enviar mensagem de oferta', error, { title: offer.title });
    return false;
  }
}

/**
 * Envia mensagem de cupom para o canal
 * @param {object} coupon - Dados do cupom
 * @returns {Promise<boolean>} Sucesso
 */
async function sendCouponMessage(coupon) {
  try {
    await applyRateLimit();

    const message = formatCouponMessage(coupon);

    await bot.sendMessage(config.TELEGRAM_CHANNEL_ID, message, {
      parse_mode: 'HTML',
    });

    logger.info('Mensagem de cupom enviada', { code: coupon.code });
    return true;
  } catch (error) {
    logger.error('Erro ao enviar mensagem de cupom', error, { code: coupon.code });
    return false;
  }
}

/**
 * Envia imagem com mensagem
 * @param {string} imageUrl - URL da imagem
 * @param {string} caption - Legenda
 * @returns {Promise<boolean>} Sucesso
 */
async function sendPhotoMessage(imageUrl, caption) {
  try {
    await applyRateLimit();

    await bot.sendPhoto(config.TELEGRAM_CHANNEL_ID, imageUrl, {
      caption,
      parse_mode: 'HTML',
    });

    logger.info('Mensagem com foto enviada');
    return true;
  } catch (error) {
    logger.error('Erro ao enviar mensagem com foto', error);
    return false;
  }
}

/**
 * Formata mensagem de oferta
 * @param {object} offer - Dados da oferta
 * @returns {string} Mensagem formatada
 */
function formatOfferMessage(offer) {
  const discount = offer.discountPercentage > 0 ? `<b>-${offer.discountPercentage}%</b>` : '';
  
  return `
🛍️ <b>${offer.title}</b>

💰 Preço: <b>R$ ${offer.price.toFixed(2)}</b>
📉 De: <s>R$ ${offer.originalPrice.toFixed(2)}</s> ${discount}

👤 Vendedor: ${offer.sellerName}

<a href="${offer.affiliateLink}">🔗 Comprar Agora</a>
  `.trim();
}

/**
 * Formata mensagem de cupom
 * @param {object} coupon - Dados do cupom
 * @returns {string} Mensagem formatada
 */
function formatCouponMessage(coupon) {
  const endDate = new Date(coupon.endDate);
  const daysLeft = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));
  const urgency = daysLeft <= 3 ? '🔥 URGENTE!' : daysLeft <= 7 ? '⚡ Válido por poucos dias' : '✅ Válido';

  return `
🎟️ <b>Novo Cupom Disponível!</b>

💻 Código: <code>${coupon.code}</code>

🎁 Desconto: <b>${coupon.discountPercentage}%</b>
📅 Válido até: ${endDate.toLocaleDateString('pt-BR')} (${daysLeft} dias)

${urgency}

<i>Copie o código e use no carrinho do Mercado Livre</i>
  `.trim();
}

module.exports = {
  init,
  sendOfferMessage,
  sendCouponMessage,
  sendPhotoMessage,
  formatOfferMessage,
  formatCouponMessage,
};

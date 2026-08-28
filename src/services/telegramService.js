const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { telegram } = require('../config/env');
const logger = require('../utils/logger');
const PriceCalculator = require('../utils/priceCalculator');
const { textoMenorPreco } = require('../utils/priceHistory');

const ML_LOGO_URL = 'https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/5.21.22/mercadolibre/logo__large_plus.png';
const ML_LOGO_LOCAL = path.resolve(process.cwd(), 'data', 'ml_logo.jpg');

// Cada loja tem seu próprio rótulo/link de fallback — nunca reaproveitar o do ML pra
// Shopee (ou vice-versa). Sem logo dedicada pra Shopee ainda: manda a foto só pro ML
// (sendPhoto já cai pro texto puro sozinho se a imagem falhar, então isso é seguro).
const STORE_LABEL = { ml: 'CUPOM MERCADO LIVRE', shopee: 'CUPOM SHOPEE' };
const STORE_BATCH_LABEL = { ml: 'Novo Cupom Mercado Livre!', shopee: 'Novo Cupom Shopee!' };
const STORE_FALLBACK_LINK = { ml: 'mercadolivre.com.br', shopee: 'shopee.com.br' };
// Rotulo da oferta. Desde que a Shopee entrou, o assinante recebe as duas lojas
// misturadas — e frete/prazo mudam muito entre elas, entao a origem precisa aparecer.
const STORE_OFFER_LABEL = { ml: 'Mercado Livre', shopee: 'Shopee' };
// Fallback pelo id: ofertas gravadas antes do campo `store` existir nao o tem.
const lojaDe = (offer) => offer.store || (String(offer.id).startsWith('SHOPEE-') ? 'shopee' : 'ml');

// A node-telegram-bot-api forca keep-alive (`options.forever = true`, hardcoded no
// _request) e nao define timeout nenhum. Quando a rede mata em silencio uma conexao do
// pool, a requisicao fica pendurada pra sempre: foi o que travou o canal de 2026-08-23
// a 2026-08-27 sem uma linha de erro no log. `timeout` e repassado pro request pelo
// merge de `options.request`; o watchdog cobre o que escapar dele (upload de stream).
const REQUEST_TIMEOUT_MS = 30000;
const WATCHDOG_MS = 45000;

// Promise.race ja anexa handler na promise original, entao a que perder a corrida nao
// vira unhandledRejection.
function comLimite(promise, ms, rotulo) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${rotulo}: sem resposta em ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class TelegramService {
  constructor() {
    this.bot = new TelegramBot(telegram.token, { polling: false, request: { timeout: REQUEST_TIMEOUT_MS } });
    // Envolve os metodos de envio em vez de cada chamada: nenhum caminho novo escapa.
    for (const metodo of ['sendPhoto', 'sendMessage']) {
      const original = this.bot[metodo].bind(this.bot);
      this.bot[metodo] = (...args) => comLimite(original(...args), WATCHDOG_MS, metodo);
    }
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

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        try {
          await this._enviarComRetentativa(item);
          await new Promise(r => setTimeout(r, 1500));
        } catch (error) {
          logger.error(`Fila: ${error.message}`);
        }
      }
    } finally {
      // Precisa ser `finally`: se algo estourar fora do try interno, a fila nao pode
      // ficar trancada com isProcessing=true — era esse o modo de falha silenciosa.
      this.isProcessing = false;
    }
  }

  _enviar({ type, data }) {
    if (type === 'couponBatch') return this.sendCouponBatchMessage(data.coupons, data.link, data.store);
    if (type === 'coupon') return this.sendCouponMessage(data);
    return this.sendOfferMessage(data);
  }

  // Timeout quase sempre e a conexao reaproveitada, nao a API: a segunda tentativa pega
  // socket novo e passa. Uma retentativa so, e nunca em lote de cupons — o lote e
  // paginado e reenviar repetiria as paginas que ja sairam.
  async _enviarComRetentativa(item) {
    try {
      return await this._enviar(item);
    } catch (err) {
      if (item.type === 'couponBatch') throw err;
      logger.warn(`Telegram falhou (${err.message}). Retentando em 3s...`);
      await new Promise(r => setTimeout(r, 3000));
      return this._enviar(item);
    }
  }

  enqueueOffer(offer) { this.queue.push({ type: 'offer', data: offer }); this.processQueue(); }
  enqueueCoupon(coupon) { this.queue.push({ type: 'coupon', data: coupon }); this.processQueue(); }
  enqueueCouponBatch(coupons, link, store = 'ml') { this.queue.push({ type: 'couponBatch', data: { coupons, link, store } }); this.processQueue(); }

  // ─────────────────────────────────────────────
  // Mensagem de Oferta
  // ─────────────────────────────────────────────

  // Botao inline: alvo de toque grande no mobile, onde esta quase toda a audiencia, e
  // sobrevive a encaminhamento (ao contrario de teclado de resposta).
  _opcoesOferta(offer) {
    const loja = STORE_OFFER_LABEL[lojaDe(offer)];
    return {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: `🛒 PEGAR NA ${loja.toUpperCase()}`, url: offer.link }]] },
    };
  }

  async sendOfferMessage(offer) {
    if (!offer.discount || offer.discount <= 0) return;

    const emoji    = offer.emoji || '✨';
    const original = PriceCalculator.formatPrice(offer.originalPrice);
    const current  = PriceCalculator.formatPrice(offer.price);

    let msg = '';
    if (offer.isFlash) msg += `⚡ <b>OFERTA RELÂMPAGO!</b>\n\n`;

    msg += `${emoji} ${escapeHtml(offer.title)}\n\n`;
    // Só mostra o "De:" quando ele é de fato maior — evita "R$ X riscado / R$ X"
    if (offer.originalPrice > offer.price) msg += `🏷 De: <s>${escapeHtml(original)}</s>\n`;
    msg += `💰 Por: <b>${escapeHtml(current)}</b>  (📉 ${offer.discount}% OFF)\n`;
    msg += `🏬 ${escapeHtml(STORE_OFFER_LABEL[lojaDe(offer)])}\n`;
    // Selo de menor preco — so aparece quando o historico sustenta (ver utils/priceHistory)
    const selo = textoMenorPreco(offer.menorPreco);
    if (selo) msg += `🏆 <b>${escapeHtml(selo)}</b>\n`;

    if (offer.timer) msg += `⏱ Termina em: ${escapeHtml(offer.timer)}\n`;

    msg += `\n🔗 ${escapeHtml(offer.link)}`;

    if (offer.image) {
      try {
        await this.bot.sendPhoto(this.chatId, offer.image, { caption: msg, ...this._opcoesOferta(offer) });
        return;
      } catch (err) {
        logger.debug(`Foto oferta falhou, enviando texto: ${err.message}`);
      }
    }

    await this.bot.sendMessage(this.chatId, msg, { ...this._opcoesOferta(offer), disable_web_page_preview: false });
  }

  // ─────────────────────────────────────────────
  // Mensagem de Cupom
  // ─────────────────────────────────────────────

  async sendCouponMessage(coupon) {
    const store = coupon.store === 'shopee' ? 'shopee' : 'ml';
    let msg = `🏷️ *${STORE_LABEL[store]}*\n\n`;
    msg += `📋 Código: \`${coupon.code}\`\n`;
    if (coupon.discount) {
      msg += `📉 *${coupon.discount}% OFF*`;
      if (coupon.minimum) msg += ` em compras acima de *${coupon.minimum}*`;
      msg += `\n`;
    } else if (coupon.amount) {
      msg += `📉 *${coupon.amount} OFF*`;
      if (coupon.minimum) msg += ` em compras acima de *${coupon.minimum}*`;
      msg += `\n`;
    } else if (coupon.discountText) {
      msg += `📉 *${coupon.discountText}*\n`;
    }
    if (coupon.limit) msg += `⚠️ Limite de ${coupon.limit} usos\n`;
    msg += `\n✅ Copie o código e aplique no checkout!\n\n`;
    msg += `🛒 ${coupon.link || STORE_FALLBACK_LINK[store]}`;

    if (store === 'ml') {
      const photo = fs.existsSync(ML_LOGO_LOCAL)
        ? fs.createReadStream(ML_LOGO_LOCAL)
        : ML_LOGO_URL;
      try {
        await this.bot.sendPhoto(this.chatId, photo, { caption: msg, parse_mode: 'Markdown' });
        return;
      } catch (err) {
        logger.debug(`Foto cupom falhou, enviando texto: ${err.message}`);
      }
    }

    await this.bot.sendMessage(this.chatId, msg, { parse_mode: 'Markdown' });
  }

  // ─────────────────────────────────────────────
  // Mensagem de Cupons (lote — agrupa por desconto/mínimo/teto)
  // ─────────────────────────────────────────────

  _groupCoupons(coupons) {
    const groups = new Map();
    for (const c of coupons) {
      const key = `${c.discount || ''}|${c.amount || ''}|${c.minimum || ''}|${c.maxDiscount || ''}|${c.discountText || ''}`;
      if (!groups.has(key)) groups.set(key, { ...c, codes: [] });
      groups.get(key).codes.push(c.code);
    }
    return Array.from(groups.values());
  }

  _formatCouponGroup(g) {
    let line = '';
    if (g.discount) {
      line += `➖ *${g.discount}% OFF*`;
      if (g.minimum) line += ` em compras acima de ${g.minimum}`;
      if (g.maxDiscount) line += `, limitado a ${g.maxDiscount}`;
      line += `\n`;
    } else if (g.amount) {
      line += `➖ *${g.amount} OFF*`;
      if (g.minimum) line += ` em compras acima de ${g.minimum}`;
      line += `\n`;
    } else if (g.discountText) {
      line += `➖ *${g.discountText}*\n`;
    } else {
      line += `➖ *Cupom de desconto*\n`;
    }
    line += `🎯 Use o cupom: \`${g.codes.join('`, `')}\`\n\n`;
    return line;
  }

  // Divide os grupos em páginas que cabem no limite de legenda do Telegram (1024)
  _paginateCouponGroups(groups, link, store) {
    const HEADER = `🔥 *${STORE_BATCH_LABEL[store]}*\n\n`;
    const FOOTER = `🔗 ${link}`;
    const MAX_LEN = 950; // margem de segurança sob o limite de 1024 da legenda

    const pages = [];
    let current = HEADER;
    for (const g of groups) {
      const line = this._formatCouponGroup(g);
      if ((current + line + FOOTER).length > MAX_LEN && current !== HEADER) {
        pages.push(current + FOOTER);
        current = HEADER;
      }
      current += line;
    }
    pages.push(current + FOOTER);
    return pages;
  }

  async sendCouponBatchMessage(coupons, link, store = 'ml') {
    if (!coupons || coupons.length === 0) return;
    const groups = this._groupCoupons(coupons);
    const pages = this._paginateCouponGroups(groups, link, store);

    for (const msg of pages) {
      if (store === 'ml') {
        const photo = fs.existsSync(ML_LOGO_LOCAL)
          ? fs.createReadStream(ML_LOGO_LOCAL)
          : ML_LOGO_URL;
        try {
          await this.bot.sendPhoto(this.chatId, photo, { caption: msg, parse_mode: 'Markdown' });
          if (pages.length > 1) await new Promise(r => setTimeout(r, 1500));
          continue;
        } catch (err) {
          logger.debug(`Foto cupons (lote) falhou, enviando texto: ${err.message}`);
        }
      }
      await this.bot.sendMessage(this.chatId, msg, { parse_mode: 'Markdown' });
      if (pages.length > 1) await new Promise(r => setTimeout(r, 1500));
    }
  }
}

module.exports = new TelegramService();

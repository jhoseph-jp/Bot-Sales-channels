const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { whatsapp } = require('../config/env');
const logger = require('../utils/logger');
const PriceCalculator = require('../utils/priceCalculator');

const ML_LOGO_URL = 'https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/5.21.22/mercadolibre/logo__large_plus.png';
const ML_LOGO_LOCAL = path.resolve(process.cwd(), 'data', 'ml_logo.jpg');

// Baileys usa seu próprio logger (pino). Silenciamos para não poluir os logs do bot.
const waLogger = pino({ level: 'silent' });

class WhatsAppService {
  constructor() {
    this.groupId = whatsapp.groupId;
    this.authDir = whatsapp.authDir;
    this.sock = null;
    this.isReady = false;
    this.queue = [];
    this.isProcessing = false;

    if (!this.groupId) {
      logger.warn('WhatsApp desativado: WHATSAPP_GROUP_ID não configurado no .env.');
      return;
    }
    this._connect().catch(err => logger.error(`[WA] Falha ao conectar: ${err.message}`));
  }

  // ─────────────────────────────────────────────
  // Conexão (Baileys)
  // ─────────────────────────────────────────────

  async _connect() {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({ version, auth: state, logger: waLogger });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('[WA] Escaneie o QR Code abaixo com o WhatsApp do número do bot:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.isReady = true;
        logger.info('[WA] Conectado. Fila liberada.');
        this.processQueue();
      }

      if (connection === 'close') {
        this.isReady = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        logger.warn(`[WA] Conexão fechada (code ${code}).${loggedOut ? ' Sessão encerrada — rode npm run wa-login.' : ' Reconectando...'}`);
        if (!loggedOut) setTimeout(() => this._connect().catch(() => {}), 5000);
      }
    });
  }

  // ─────────────────────────────────────────────
  // Fila (espelha o TelegramService)
  // ─────────────────────────────────────────────

  async processQueue() {
    if (this.isProcessing || !this.isReady || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0 && this.isReady) {
      const { type, data } = this.queue.shift();
      try {
        if (type === 'couponBatch') await this.sendCouponBatchMessage(data.coupons, data.link);
        else if (type === 'coupon') await this.sendCouponMessage(data);
        else await this.sendOfferMessage(data);
        await new Promise(r => setTimeout(r, 1500));
      } catch (error) {
        logger.error(`[WA] Fila: ${error.message}`);
      }
    }
    this.isProcessing = false;
  }

  enqueueOffer(offer) {
    if (!this.groupId) return;
    this.queue.push({ type: 'offer', data: offer });
    this.processQueue();
  }

  enqueueCoupon(coupon) {
    if (!this.groupId) return;
    this.queue.push({ type: 'coupon', data: coupon });
    this.processQueue();
  }

  enqueueCouponBatch(coupons, link) {
    if (!this.groupId) return;
    this.queue.push({ type: 'couponBatch', data: { coupons, link } });
    this.processQueue();
  }

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
    msg += `~${original}~\n`;                 // WhatsApp: tachado usa um único ~
    msg += `💰 *${current}*\n`;
    msg += `📉 ${offer.discount}% OFF\n`;

    if (offer.timer) msg += `⏱ Termina em: ${offer.timer}\n`;

    msg += `\n🔗 ${offer.link}`;

    if (offer.image) {
      try {
        await this.sock.sendMessage(this.groupId, { image: { url: offer.image }, caption: msg });
        return;
      } catch (err) {
        logger.debug(`[WA] Foto oferta falhou, enviando texto: ${err.message}`);
      }
    }

    await this.sock.sendMessage(this.groupId, { text: msg });
  }

  // ─────────────────────────────────────────────
  // Mensagem de Cupom
  // ─────────────────────────────────────────────

  async sendCouponMessage(coupon) {
    let msg = `🏷️ *CUPOM MERCADO LIVRE*\n\n`;
    msg += `📋 Código: \`\`\`${coupon.code}\`\`\`\n`;   // WhatsApp: monoespaçado = ```
    if (coupon.discount) {
      msg += `📉 *${coupon.discount}% OFF*`;
      if (coupon.minimum) msg += ` em compras acima de *${coupon.minimum}*`;
      msg += `\n`;
    } else if (coupon.discountText) {
      msg += `📉 *${coupon.discountText}*\n`;
    }
    if (coupon.limit) msg += `⚠️ Limite de ${coupon.limit} usos\n`;
    msg += `\n✅ Copie o código e aplique no checkout!\n\n`;
    msg += `🛒 mercadolivre.com.br`;

    const image = fs.existsSync(ML_LOGO_LOCAL)
      ? { url: ML_LOGO_LOCAL }
      : { url: ML_LOGO_URL };

    try {
      await this.sock.sendMessage(this.groupId, { image, caption: msg });
    } catch (err) {
      logger.debug(`[WA] Foto cupom falhou, enviando texto: ${err.message}`);
      await this.sock.sendMessage(this.groupId, { text: msg });
    }
  }

  // ─────────────────────────────────────────────
  // Mensagem de Cupons (lote — agrupa por desconto/mínimo/teto)
  // ─────────────────────────────────────────────

  _groupCoupons(coupons) {
    const groups = new Map();
    for (const c of coupons) {
      const key = `${c.discount || ''}|${c.minimum || ''}|${c.maxDiscount || ''}|${c.discountText || ''}`;
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
    } else if (g.discountText) {
      line += `➖ *${g.discountText}*\n`;
    } else {
      line += `➖ *Cupom de desconto*\n`;
    }
    line += `🎯 Use o cupom: \`\`\`${g.codes.join('```, ```')}\`\`\`\n\n`;
    return line;
  }

  // Divide os grupos em páginas pra não estourar o limite de legenda
  _paginateCouponGroups(groups, link) {
    const HEADER = `🔥 *Novo Cupom Mercado Livre!*\n\n`;
    const FOOTER = `🔗 ${link}`;
    const MAX_LEN = 950;

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

  async sendCouponBatchMessage(coupons, link) {
    if (!coupons || coupons.length === 0) return;
    const groups = this._groupCoupons(coupons);
    const pages = this._paginateCouponGroups(groups, link);

    for (const msg of pages) {
      const image = fs.existsSync(ML_LOGO_LOCAL)
        ? { url: ML_LOGO_LOCAL }
        : { url: ML_LOGO_URL };

      try {
        await this.sock.sendMessage(this.groupId, { image, caption: msg });
      } catch (err) {
        logger.debug(`[WA] Foto cupons (lote) falhou, enviando texto: ${err.message}`);
        await this.sock.sendMessage(this.groupId, { text: msg });
      }
      if (pages.length > 1) await new Promise(r => setTimeout(r, 1500));
    }
  }
}

module.exports = new WhatsAppService();

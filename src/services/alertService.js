const TelegramBot = require('node-telegram-bot-api');
const { telegram } = require('../config/env');
const logger = require('../utils/logger');
const db = require('../repositories/database');

/**
 * Alertas operacionais para o administrador.
 *
 * IMPORTANTE: nunca cai no canal público. Se TELEGRAM_ADMIN_CHAT_ID não estiver
 * configurado, o alerta fica só no log — mandar "sua sessão expirou" para os
 * assinantes seria pior que não alertar. Use `node scripts/telegram-chat-id.js`
 * para descobrir o id.
 *
 * A carência entre alertas é persistida na tabela config, e não em memória: sem
 * isso, um `pm2 restart` zeraria o controle e o alerta voltaria a repetir.
 */
class AlertService {
  constructor() {
    this.chatId = telegram.adminChatId;
    this.bot = this.chatId ? new TelegramBot(telegram.token, { polling: false }) : null;

    if (!this.chatId) {
      logger.warn('Alertas administrativos desativados: TELEGRAM_ADMIN_CHAT_ID não configurado no .env.');
    }
  }

  get isEnabled() {
    return !!(this.chatId && this.bot);
  }

  async ultimoAlerta(chave) {
    const v = await db.getConfig(`alerta_${chave}`);
    return v ? parseInt(v, 10) : 0;
  }

  async registrarAlerta(chave, quando = Date.now()) {
    return db.setConfig(`alerta_${chave}`, String(quando));
  }

  /**
   * Envia um alerta e registra o instante para a carência.
   * @param {string} chave   identifica a causa (uma carência por causa)
   * @param {string} titulo
   * @param {string[]} linhas
   */
  async enviar(chave, titulo, linhas = []) {
    const corpo = [`🚨 <b>${titulo}</b>`, '', ...linhas].join('\n');

    if (!this.isEnabled) {
      logger.error(`[Alerta:${chave}] ${titulo} — ${linhas.join(' | ')} (sem TELEGRAM_ADMIN_CHAT_ID, não enviado)`);
      return false;
    }

    try {
      await this.bot.sendMessage(this.chatId, corpo, { parse_mode: 'HTML', disable_web_page_preview: true });
      await this.registrarAlerta(chave);
      logger.warn(`[Alerta:${chave}] enviado ao admin: ${titulo}`);
      return true;
    } catch (err) {
      logger.error(`[Alerta:${chave}] falha ao enviar: ${err.message}`);
      return false;
    }
  }
}

module.exports = new AlertService();

#!/usr/bin/env node
/**
 * Descobre o chat_id para TELEGRAM_ADMIN_CHAT_ID.
 *
 * Como usar:
 *   1. Abra uma conversa privada com o SEU bot no Telegram e mande qualquer mensagem
 *      (um "oi" serve).
 *   2. Rode: node scripts/telegram-chat-id.js
 *   3. Copie o id que aparecer e coloque no .env como TELEGRAM_ADMIN_CHAT_ID.
 *
 * Só faz leitura (getUpdates); não envia nada nem altera o bot.
 */

const axios = require('axios');
const { telegram } = require('../src/config/env');

const API = `https://api.telegram.org/bot${telegram.token}`;

(async () => {
  try {
    const { data } = await axios.get(`${API}/getUpdates`, { timeout: 20000 });

    if (!data.ok) {
      console.error(`Telegram respondeu erro: ${data.description || 'desconhecido'}`);
      process.exit(1);
    }

    const chats = new Map();
    for (const u of data.result || []) {
      const msg = u.message || u.edited_message || u.channel_post;
      const chat = msg && msg.chat;
      if (chat && !chats.has(chat.id)) chats.set(chat.id, chat);
    }

    if (chats.size === 0) {
      console.log('Nenhuma mensagem recente encontrada.');
      console.log('');
      console.log('Mande uma mensagem qualquer para o bot em conversa PRIVADA e rode de novo.');
      console.log('Obs.: o Telegram so guarda updates por ~24h, e se o bot estiver com');
      console.log('webhook configurado o getUpdates vem vazio.');
      process.exit(0);
    }

    console.log('Chats encontrados:');
    console.log('');
    for (const chat of chats.values()) {
      const nome = [chat.first_name, chat.last_name].filter(Boolean).join(' ')
        || chat.title || chat.username || '(sem nome)';
      const marca = chat.id === Number(telegram.chatId) || String(chat.id) === String(telegram.chatId)
        ? '  <-- este e o CANAL PUBLICO, nao use para alertas'
        : (chat.type === 'private' ? '  <-- use este' : '');
      console.log(`  ${String(chat.id).padEnd(16)} ${chat.type.padEnd(10)} ${nome}${marca}`);
    }
    console.log('');
    console.log('Coloque o escolhido no .env:  TELEGRAM_ADMIN_CHAT_ID=<id>');
  } catch (err) {
    console.error(`Falha: ${err.response ? JSON.stringify(err.response.data) : err.message}`);
    process.exit(1);
  }
})();

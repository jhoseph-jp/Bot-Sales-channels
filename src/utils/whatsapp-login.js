/**
 * Login do WhatsApp + descoberta do JID do grupo.
 *
 * Uso:
 *   npm run wa-login
 *
 * Passos:
 *   1. Rode este script.
 *   2. Escaneie o QR Code com o WhatsApp do número do bot (menu > Aparelhos conectados).
 *   3. A sessão é salva em data/whatsapp_auth/ (não precisa reescanear depois).
 *   4. O script lista todos os grupos em que o número está, com o JID de cada um.
 *   5. Copie o JID do grupo desejado (algo como 120363XXXXXXXXXXXX@g.us)
 *      e coloque em WHATSAPP_GROUP_ID no .env.
 */
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const pino = require('pino');

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || path.resolve(process.cwd(), 'data', 'whatsapp_auth');

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Baileys usando versão de protocolo WA: ${version.join('.')} (mais recente: ${isLatest})`);

  const waLogger = pino({ level: 'silent' });
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, waLogger),
    },
    logger: waLogger,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr } = update;

    if (qr) {
      console.log('\n📲 Escaneie este QR Code com o WhatsApp do número do bot:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const err = update.lastDisconnect?.error;
      const statusCode = err?.output?.statusCode;

      // Esperado logo após o QR ser aceito: credenciais já foram salvas,
      // só falta reconectar pra sessão abrir de verdade.
      if (statusCode === DisconnectReason.restartRequired) {
        console.log('\n🔄 Pareamento aceito, reconectando...\n');
        main();
        return;
      }

      console.log('\n❌ Conexão fechada.');
      console.log(`   statusCode: ${statusCode ?? '(nenhum)'}`);
      console.log(`   motivo: ${err?.message ?? '(sem mensagem)'}`);
      if (err?.output?.payload) console.log('   payload:', JSON.stringify(err.output.payload));
      process.exit(1);
    }

    if (connection === 'open') {
      console.log('\n✅ Conectado! Buscando grupos...\n');
      try {
        const groups = await sock.groupFetchAllParticipating();
        const list = Object.values(groups);
        if (list.length === 0) {
          console.log('Nenhum grupo encontrado. Adicione o número do bot a um grupo e rode novamente.');
        } else {
          console.log('─'.repeat(70));
          for (const g of list) {
            console.log(`📛 ${g.subject}`);
            console.log(`   JID: ${g.id}`);
            console.log('─'.repeat(70));
          }
          console.log('\n👉 Copie o JID do grupo desejado para WHATSAPP_GROUP_ID no .env\n');
        }
      } catch (err) {
        console.error('Erro ao buscar grupos:', err.message);
      }
      process.exit(0);
    }
  });
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});

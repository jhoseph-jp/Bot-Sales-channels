/**
 * Renova o token de longa duração do Instagram (~60 dias) e atualiza o
 * arquivo de env em disco. Pensado pra rodar via cron mensal — o token
 * INSTAGRAM_TOKEN nunca era renovado automaticamente antes disso (a função
 * já existia em instagramService.js mas não era chamada em lugar nenhum).
 *
 * Uso: node src/utils/refresh-instagram-token.js
 */
const fs = require('fs');
const path = require('path');

// Mesma resolução de arquivo do src/config/env.js: .env.prod (produção) com
// fallback pro .env padrão se não existir.
const envFile = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
let envPath = path.resolve(process.cwd(), envFile);
if (!fs.existsSync(envPath)) envPath = path.resolve(process.cwd(), '.env');

require('dotenv').config({ path: envPath });

const axios = require('axios');

const IG_REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';

async function main() {
  const token = process.env.INSTAGRAM_TOKEN;
  if (!token) {
    console.error(`[IG] INSTAGRAM_TOKEN não encontrado em ${envPath}`);
    process.exit(1);
  }

  const res = await axios.get(IG_REFRESH_URL, {
    params: { grant_type: 'ig_refresh_token', access_token: token },
    timeout: 20000,
  });

  const newToken = res.data && res.data.access_token;
  if (!newToken) throw new Error('resposta da API sem access_token');

  const content = fs.readFileSync(envPath, 'utf8');
  const updated = /^INSTAGRAM_TOKEN=.*/m.test(content)
    ? content.replace(/^INSTAGRAM_TOKEN=.*/m, `INSTAGRAM_TOKEN=${newToken}`)
    : `${content.trimEnd()}\nINSTAGRAM_TOKEN=${newToken}\n`;
  fs.writeFileSync(envPath, updated);

  const days = Math.round((res.data.expires_in || 0) / 86400);
  console.log(`[IG] Token renovado com sucesso em ${envPath}. Expira em ~${days} dias.`);
}

main().catch((err) => {
  const msg = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message;
  console.error(`[IG] Falha ao renovar token: ${msg}`);
  process.exit(1);
});

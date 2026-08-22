#!/usr/bin/env node
/**
 * Backup do banco SQLite do bot.
 *
 * Usa VACUUM INTO em vez de copiar o arquivo: `cp` de um SQLite com escrita
 * concorrente pode gerar cópia corrompida (o WAL/journal fica de fora). VACUUM INTO
 * produz um snapshot consistente e já compactado, sem travar o bot — que segue
 * escrevendo durante a operação. O site também lê esse mesmo arquivo.
 *
 * Uso:  node scripts/backup-db.js
 * Cron: 20 4 * * *  cd /opt/Bot-Sales-channels && /usr/bin/node scripts/backup-db.js
 *
 * Destino e retenção via env: BACKUP_DIR (padrão /opt/backups/bot-sqlite),
 * BACKUP_KEEP (padrão 14 cópias).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sqlite3 = require('sqlite3');
const { database } = require('../src/config/env');

const ORIGEM   = path.resolve(database.path);
const DESTINO  = process.env.BACKUP_DIR || '/opt/backups/bot-sqlite';
const MANTER   = parseInt(process.env.BACKUP_KEEP || '14', 10);
const PREFIXO  = 'bot-sqlite-';

const log = (msg) => console.log(`[backup ${new Date().toISOString()}] ${msg}`);

function carimbo() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// Remove as cópias mais antigas, mantendo as MANTER mais recentes.
function podar() {
  const arquivos = fs.readdirSync(DESTINO)
    .filter(f => f.startsWith(PREFIXO) && f.endsWith('.sqlite.gz'))
    .map(f => ({ f, t: fs.statSync(path.join(DESTINO, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  for (const { f } of arquivos.slice(MANTER)) {
    fs.unlinkSync(path.join(DESTINO, f));
    log(`removido antigo: ${f}`);
  }
  return arquivos.length;
}

function comprimir(origem, destino) {
  return new Promise((resolve, reject) => {
    const entrada = fs.createReadStream(origem);
    const saida = fs.createWriteStream(destino);
    entrada.on('error', reject);
    saida.on('error', reject);
    saida.on('finish', resolve);
    entrada.pipe(zlib.createGzip({ level: 9 })).pipe(saida);
  });
}

async function main() {
  if (!fs.existsSync(ORIGEM)) {
    log(`ERRO: banco nao encontrado em ${ORIGEM}`);
    process.exit(1);
  }
  fs.mkdirSync(DESTINO, { recursive: true });

  const bruto = path.join(DESTINO, `${PREFIXO}${carimbo()}.sqlite`);
  const gz = `${bruto}.gz`;

  const db = new sqlite3.Database(ORIGEM, sqlite3.OPEN_READONLY);
  await new Promise((resolve, reject) => {
    // Aspas simples escapadas ao estilo SQL — o caminho vem de env/config, nao de usuario
    db.run(`VACUUM INTO '${bruto.replace(/'/g, "''")}'`, (err) => (err ? reject(err) : resolve()));
  });
  await new Promise((resolve) => db.close(resolve));

  await comprimir(bruto, gz);
  fs.unlinkSync(bruto);

  const tamanho = (fs.statSync(gz).size / 1024).toFixed(0);
  log(`ok: ${path.basename(gz)} (${tamanho} KB)`);

  const total = podar();
  log(`copias mantidas: ${Math.min(total, MANTER)} de ${MANTER}`);
}

main().catch((err) => {
  log(`ERRO: ${err.message}`);
  process.exit(1);
});

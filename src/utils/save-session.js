/**
 * save-session.js
 *
 * Abre um Chrome visível para login manual no ML.
 * Após fazer login, pressione ENTER no terminal para salvar a sessão.
 *
 * Execute UMA VEZ antes de rodar o bot:
 *   node src/utils/save-session.js
 */

const { chromium } = require('playwright');
const path     = require('path');
const fs       = require('fs');
const readline = require('readline');

const SESSION_FILE = path.resolve(process.cwd(), 'data', 'ml_session.json');
const ML_LOGIN_URL = 'https://www.mercadolivre.com.br';

function waitForEnter() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => { rl.close(); resolve(); });
  });
}

(async () => {
  const dataDir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     ML Bot — Salvar Sessão           ║');
  console.log('╚══════════════════════════════════════╝\n');
  console.log('1. Um Chrome vai abrir na tela de login do Mercado Livre.');
  console.log('2. Faça login normalmente (resolva o reCAPTCHA se aparecer).');
  console.log('3. Após fazer login com sucesso, volte aqui e pressione ENTER.\n');

  const browser = await chromium.launch({
    headless : false,
    slowMo   : 80,
    args     : ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport  : null,
    locale    : 'pt-BR',
    userAgent : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    await page.goto(ML_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {
    // Ignora erros de timeout no carregamento inicial
  }

  console.log('>>> Chrome aberto. Faça o login no Mercado Livre.');
  console.log('>>> Quando estiver logado, pressione ENTER aqui para salvar a sessão...\n');

  // Aguarda o usuário pressionar Enter
  await waitForEnter();

  // Verifica se o login foi feito checando a URL atual
  const currentUrl = page.url();
  console.log(`\nURL atual: ${currentUrl}`);

  if (currentUrl.includes('/login') || currentUrl.includes('/lgz') || currentUrl.includes('iniciar-sessao')) {
    console.error('\n❌ Parece que você ainda está na tela de login.');
    console.error('   Complete o login no Chrome e tente novamente.\n');
    await browser.close();
    process.exit(1);
  }

  // Salva os cookies e localStorage da sessão atual
  await context.storageState({ path: SESSION_FILE });

  const sessionSize = fs.statSync(SESSION_FILE).size;
  console.log(`\n✅ Sessão salva com sucesso!`);
  console.log(`   Arquivo : ${SESSION_FILE}`);
  console.log(`   Tamanho : ${(sessionSize / 1024).toFixed(1)} KB`);
  console.log(`\nAgora rode o bot:`);
  console.log(`   node src/index.js\n`);

  await browser.close();
  process.exit(0);
})();

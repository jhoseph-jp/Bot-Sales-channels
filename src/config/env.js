/**
 * Validação e carregamento de variáveis de ambiente
 * @module config/env
 */

require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev'
});

/**
 * Valida se uma variável de ambiente existe
 * @param {string} key - Chave da variável
 * @param {string} defaultValue - Valor padrão
 * @returns {string} Valor da variável ou padrão
 */
function getEnv(key, defaultValue = null) {
  const value = process.env[key];
  
  if (!value && !defaultValue) {
    throw new Error(`Variável de ambiente obrigatória não configurada: ${key}`);
  }
  
  return value || defaultValue;
}

/**
 * Valida todas as variáveis de ambiente obrigatórias
 */
function validateEnv() {
  const requiredVars = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHANNEL_ID',
    'MERCADO_LIVRE_AFFILIATE_CODE'
  ];

  const missing = requiredVars.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias não configuradas: ${missing.join(', ')}`);
  }
}

// Validar ao carregar o módulo
validateEnv();

module.exports = {
  // Ambiente
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  IS_DEVELOPMENT: process.env.NODE_ENV === 'development',

  // Telegram
  TELEGRAM_BOT_TOKEN: getEnv('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHANNEL_ID: getEnv('TELEGRAM_CHANNEL_ID'),

  // Mercado Livre
  MERCADO_LIVRE_AFFILIATE_CODE: getEnv('MERCADO_LIVRE_AFFILIATE_CODE'),
  MERCADO_LIVRE_ACCESS_TOKEN: getEnv('MERCADO_LIVRE_ACCESS_TOKEN', null),
  MERCADO_LIVRE_CLIENT_ID: getEnv('MERCADO_LIVRE_CLIENT_ID', null),
  MERCADO_LIVRE_CLIENT_SECRET: getEnv('MERCADO_LIVRE_CLIENT_SECRET', null),

  // Filtros de ofertas
  MIN_DISCOUNT: parseInt(getEnv('MIN_DISCOUNT', '10')),
  MIN_PRICE: parseFloat(getEnv('MIN_PRICE', '0')),
  MAX_PRICE: parseFloat(getEnv('MAX_PRICE', '999999')),
  REQUIRE_FREE_SHIPPING: getEnv('REQUIRE_FREE_SHIPPING', 'false') === 'true',
  REQUIRE_FULL_STOCK: getEnv('REQUIRE_FULL_STOCK', 'false') === 'true',

  // Scheduler
  CHECK_OFFERS_INTERVAL: getEnv('CHECK_OFFERS_INTERVAL', '*/2 * * * *'), // A cada 2 minutos
  CHECK_COUPONS_INTERVAL: getEnv('CHECK_COUPONS_INTERVAL', '0 * * * *'), // A cada 1 hora

  // Web App Sync
  WEB_APP_SYNC_ENABLED: getEnv('WEB_APP_SYNC_ENABLED', 'true') === 'true',
  WEB_APP_URL: getEnv('WEB_APP_URL', 'http://localhost:3000'),

  // Rate Limit
  TELEGRAM_RATE_LIMIT_DELAY: parseInt(getEnv('TELEGRAM_RATE_LIMIT_DELAY', '1000')), // 1 segundo entre mensagens

  // Logs
  LOG_LEVEL: getEnv('LOG_LEVEL', 'info'),
  LOG_FILE: getEnv('LOG_FILE', 'logs/app.log'),

  // Database
  DATABASE_PATH: getEnv('DATABASE_PATH', 'data/bot.db'),

  // Busca
  SEARCH_QUERY: getEnv('SEARCH_QUERY', 'eletrônicos'),
  SEARCH_LIMIT: parseInt(getEnv('SEARCH_LIMIT', '20')),
};

// Exportar função getEnv para uso em outros módulos
module.exports.getEnv = getEnv;

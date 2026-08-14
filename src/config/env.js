const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');

// Carrega o arquivo .env baseado no NODE_ENV com fallback para .env padrão
const envFile = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
const envPath = path.resolve(process.cwd(), envFile);

if (require('fs').existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // Fallback para o arquivo .env padrão
}

// Esquema de validação para variáveis de ambiente
const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  TELEGRAM_TOKEN: Joi.string().required(),
  TELEGRAM_CHAT_ID: Joi.string().required(),
  ML_CLIENT_ID: Joi.string().required(),
  ML_CLIENT_SECRET: Joi.string().required(),
  ML_ACCESS_TOKEN: Joi.string().allow(''),
  ML_REFRESH_TOKEN: Joi.string().required(),
  ML_AFFILIATE_ID: Joi.string().default('ofertadelas'),
  ML_EMAIL: Joi.string().email().allow(''),
  ML_PASSWORD: Joi.string().allow(''),
  REDIS_HOST: Joi.string().default('127.0.0.1').allow(''),
  REDIS_PORT: Joi.number().default(6379).allow(''),
  DB_PATH: Joi.string().default('./data/bot.sqlite'),
  CHECK_INTERVAL_MS: Joi.number().default(300000), // 5 minutos
  MIN_DISCOUNT: Joi.number().default(0),
  LOG_LEVEL: Joi.string().valid('info', 'debug', 'error', 'warn').default('info'),
  COUPON_CHANNELS: Joi.string().default('promotop,grupo_promocoes'),
  WHATSAPP_GROUP_ID: Joi.string().allow('').default(''),
  WHATSAPP_AUTH_DIR: Joi.string().allow('').default('./data/whatsapp_auth'),
  WEBSITE_SYNC_CMD: Joi.string().allow('').default(''),
  SHOPEE_APP_ID: Joi.string().allow('').default(''),
  SHOPEE_SECRET: Joi.string().allow('').default(''),
}).unknown().required();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Configuração de ambiente inválida: ${error.message}`);
}

module.exports = {
  env: envVars.NODE_ENV,
  telegram: {
    token: envVars.TELEGRAM_TOKEN,
    chatId: envVars.TELEGRAM_CHAT_ID
  },
  mercadoLivre: {
    clientId: envVars.ML_CLIENT_ID,
    clientSecret: envVars.ML_CLIENT_SECRET,
    accessToken: envVars.ML_ACCESS_TOKEN,
    refreshToken: envVars.ML_REFRESH_TOKEN,
    affiliateId: envVars.ML_AFFILIATE_ID,
    email: envVars.ML_EMAIL,
    password: envVars.ML_PASSWORD
  },
  redis: {
    host: envVars.REDIS_HOST,
    port: envVars.REDIS_PORT
  },
  database: {
    path: envVars.DB_PATH
  },
  settings: {
    checkInterval: envVars.CHECK_INTERVAL_MS,
    minDiscount: envVars.MIN_DISCOUNT,
    websiteSyncCmd: envVars.WEBSITE_SYNC_CMD,
    instagram: {
      userId: process.env.INSTAGRAM_USER_ID,
      token:  process.env.INSTAGRAM_TOKEN,
    },
  },
  whatsapp: {
    groupId: envVars.WHATSAPP_GROUP_ID,
    authDir: path.resolve(process.cwd(), envVars.WHATSAPP_AUTH_DIR),
  },
  shopee: {
    appId: envVars.SHOPEE_APP_ID,
    secret: envVars.SHOPEE_SECRET,
  },
  logLevel: envVars.LOG_LEVEL,
  couponChannels: envVars.COUPON_CHANNELS.split(',').map(s => s.trim()).filter(Boolean),
};

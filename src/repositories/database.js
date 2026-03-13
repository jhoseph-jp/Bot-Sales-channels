/**
 * Repositório de banco de dados SQLite
 * @module repositories/database
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const config = require('../config/env');

// Criar diretório de dados se não existir
fs.ensureDirSync(path.dirname(config.DATABASE_PATH));

let db = null;

/**
 * Inicializa a conexão com o banco de dados
 */
function init() {
  try {
    db = new Database(config.DATABASE_PATH);
    db.pragma('journal_mode = WAL');
    
    createTables();
    logger.info('Banco de dados inicializado com sucesso', { path: config.DATABASE_PATH });
  } catch (error) {
    logger.error('Erro ao inicializar banco de dados', error);
    throw error;
  }
}

/**
 * Cria as tabelas necessárias
 */
function createTables() {
  // Tabela de histórico de ofertas
  db.exec(`
    CREATE TABLE IF NOT EXISTS offers_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ml_product_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      price REAL NOT NULL,
      original_price REAL,
      discount_percentage INTEGER,
      hash TEXT UNIQUE NOT NULL,
      seller_id INTEGER,
      seller_name TEXT,
      link TEXT,
      affiliate_link TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_offers_hash ON offers_history(hash);
    CREATE INDEX IF NOT EXISTS idx_offers_sent_at ON offers_history(sent_at);
  `);

  // Tabela de histórico de cupons
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_percentage INTEGER,
      discount_value REAL,
      end_date DATETIME,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons_history(code);
    CREATE INDEX IF NOT EXISTS idx_coupons_sent_at ON coupons_history(sent_at);
  `);

  // Tabela de métricas
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offers_sent INTEGER DEFAULT 0,
      coupons_sent INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      last_check DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Inserir registro inicial de métricas
  db.prepare(`
    INSERT OR IGNORE INTO metrics (id, offers_sent, coupons_sent, errors_count)
    VALUES (1, 0, 0, 0)
  `).run();
}

/**
 * Adiciona uma oferta ao histórico
 * @param {object} offer - Dados da oferta
 * @returns {boolean} Sucesso
 */
function addOfferToHistory(offer) {
  try {
    const stmt = db.prepare(`
      INSERT INTO offers_history (
        ml_product_id, title, price, original_price, discount_percentage,
        hash, seller_id, seller_name, link, affiliate_link
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      offer.mlProductId,
      offer.title,
      offer.price,
      offer.originalPrice,
      offer.discountPercentage,
      offer.hash,
      offer.sellerId,
      offer.sellerName,
      offer.link,
      offer.affiliateLink
    );

    return true;
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      logger.debug('Oferta já existe no histórico', { hash: offer.hash });
      return false;
    }
    logger.error('Erro ao adicionar oferta ao histórico', error);
    throw error;
  }
}

/**
 * Verifica se uma oferta já foi enviada
 * @param {string} hash - Hash da oferta
 * @returns {boolean} Oferta existe
 */
function offerExists(hash) {
  try {
    const stmt = db.prepare('SELECT id FROM offers_history WHERE hash = ? LIMIT 1');
    return stmt.get(hash) !== undefined;
  } catch (error) {
    logger.error('Erro ao verificar oferta', error);
    return false;
  }
}

/**
 * Adiciona um cupom ao histórico
 * @param {object} coupon - Dados do cupom
 * @returns {boolean} Sucesso
 */
function addCouponToHistory(coupon) {
  try {
    const stmt = db.prepare(`
      INSERT INTO coupons_history (
        code, discount_percentage, discount_value, end_date
      ) VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      coupon.code,
      coupon.discountPercentage,
      coupon.discountValue,
      coupon.endDate
    );

    return true;
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      logger.debug('Cupom já existe no histórico', { code: coupon.code });
      return false;
    }
    logger.error('Erro ao adicionar cupom ao histórico', error);
    throw error;
  }
}

/**
 * Verifica se um cupom já foi enviado
 * @param {string} code - Código do cupom
 * @returns {boolean} Cupom existe
 */
function couponExists(code) {
  try {
    const stmt = db.prepare('SELECT id FROM coupons_history WHERE code = ? LIMIT 1');
    return stmt.get(code) !== undefined;
  } catch (error) {
    logger.error('Erro ao verificar cupom', error);
    return false;
  }
}

/**
 * Métricas permitidas para incremento
 */
const ALLOWED_METRICS = {
  offers_sent: true,
  coupons_sent: true,
  errors_count: true,
};

/**
 * Incrementa métrica
 * @param {string} metric - Nome da métrica
 * @param {number} value - Valor a incrementar
 */
function incrementMetric(metric, value = 1) {
  try {
    // Validar métrica para evitar SQL injection
    if (!ALLOWED_METRICS[metric]) {
      logger.warn('Métrica inválida ignorada', { metric });
      return;
    }

    // Interpolação segura pois validamos acima
    const stmt = db.prepare(`
      UPDATE metrics SET ${metric} = ${metric} + ? WHERE id = 1
    `);
    stmt.run(value);
  } catch (error) {
    logger.error('Erro ao incrementar métrica', error);
  }
}

/**
 * Obtém as métricas
 * @returns {object} Métricas
 */
function getMetrics() {
  try {
    const stmt = db.prepare('SELECT * FROM metrics WHERE id = 1');
    return stmt.get() || { offers_sent: 0, coupons_sent: 0, errors_count: 0 };
  } catch (error) {
    logger.error('Erro ao obter métricas', error);
    return { offers_sent: 0, coupons_sent: 0, errors_count: 0 };
  }
}

/**
 * Fecha a conexão com o banco de dados
 */
function close() {
  if (db) {
    db.close();
    logger.info('Banco de dados fechado');
  }
}

module.exports = {
  init,
  addOfferToHistory,
  offerExists,
  addCouponToHistory,
  couponExists,
  incrementMetric,
  getMetrics,
  close,
};

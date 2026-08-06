const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const { database } = require('../config/env');
const logger = require('../utils/logger');

class Database {
  constructor() {
    const dbDir = path.dirname(database.path);
    fs.ensureDirSync(dbDir);

    this.db = new sqlite3.Database(database.path, (err) => {
      if (err) {
        logger.error('Erro ao conectar ao SQLite:', err.message);
      } else {
        logger.info('Conectado ao banco de dados SQLite.');
        this.init();
      }
    });
  }

  init() {
    const sql = `
      CREATE TABLE IF NOT EXISTS offers (
        id           TEXT PRIMARY KEY,
        title        TEXT,
        price        REAL,
        discount     INTEGER,
        link         TEXT,
        original_link TEXT,
        image        TEXT,
        coupon       TEXT,
        category     TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS coupons (
        id            TEXT PRIMARY KEY,
        code          TEXT,
        description   TEXT,
        category      TEXT,
        discount_text TEXT,
        link          TEXT,
        discount      INTEGER,
        minimum       TEXT,
        max_discount  TEXT,
        is_active     INTEGER DEFAULT 1,
        source        TEXT,
        last_checked  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;

    this.db.exec(sql, (err) => {
      if (err) {
        logger.error('Erro ao inicializar tabelas:', err.message);
        return;
      }
      // Migrações para bancos existentes — ignoram erro se coluna já existe
      const migrations = [
        `ALTER TABLE offers ADD COLUMN category TEXT`,
        `ALTER TABLE offers ADD COLUMN original_link TEXT`,
        `ALTER TABLE coupons ADD COLUMN category TEXT`,
        `ALTER TABLE coupons ADD COLUMN discount_text TEXT`,
        `ALTER TABLE coupons ADD COLUMN link TEXT`,
        `ALTER TABLE coupons ADD COLUMN discount INTEGER`,
        `ALTER TABLE coupons ADD COLUMN minimum TEXT`,
        `ALTER TABLE coupons ADD COLUMN max_discount TEXT`,
        `ALTER TABLE coupons ADD COLUMN source TEXT`,
      ];
      migrations.forEach(sql => this.db.run(sql, () => {}));
    });
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // ─────────────────────────────────────────────
  // Ofertas
  // ─────────────────────────────────────────────

  async isOfferProcessed(id) {
    const row = await this.get('SELECT id FROM offers WHERE id = ?', [id]);
    return !!row;
  }

  // Deduplicação por URL original do produto (mais robusta que hash de preço)
  async isOfferUrlProcessed(originalLink) {
    if (!originalLink) return false;
    const row = await this.get('SELECT id FROM offers WHERE original_link = ?', [originalLink]);
    return !!row;
  }

  async saveOffer(offer) {
    const sql = `
      INSERT OR IGNORE INTO offers (id, title, price, discount, link, original_link, image, coupon, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await this.run(sql, [
      offer.id,
      offer.title,
      offer.price,
      offer.discount,
      offer.link,
      offer.originalLink || null,
      offer.image,
      offer.coupon || null,
      offer.category || null,
    ]);
    return result.changes > 0;
  }

  // ─────────────────────────────────────────────
  // Config
  // ─────────────────────────────────────────────

  async getConfig(key) {
    const row = await this.get('SELECT value FROM config WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  async setConfig(key, value) {
    return this.run(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`, [key, value]);
  }

  // ─────────────────────────────────────────────
  // Cupons
  // ─────────────────────────────────────────────

  async isCouponProcessed(id) {
    const row = await this.get('SELECT id FROM coupons WHERE id = ?', [id]);
    return !!row;
  }

  async saveCoupon(coupon) {
    const sql = `
      INSERT OR REPLACE INTO coupons (id, code, description, category, discount_text, link, discount, minimum, max_discount, is_active, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return this.run(sql, [
      coupon.id,
      coupon.code,
      coupon.description,
      coupon.category || null,
      coupon.discountText || null,
      coupon.link || null,
      coupon.discount || null,
      coupon.minimum || null,
      coupon.maxDiscount || null,
      coupon.isActive ? 1 : 0,
      coupon.source || null,
    ]);
  }

  async getActiveCoupons() {
    return this.all('SELECT * FROM coupons WHERE is_active = 1 ORDER BY last_checked DESC');
  }

  async updateCouponStatus(id, isActive) {
    return this.run(
      `UPDATE coupons SET is_active = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?`,
      [isActive ? 1 : 0, id]
    );
  }

  async deactivateAllCoupons() {
    return this.run(`UPDATE coupons SET is_active = 0`);
  }

  // Trava de segurança: cupom ativo que não é revalidado há muito tempo (fontes
  // fora do ar por dias seguidos, por ex.) é desativado mesmo sem confirmação de
  // expiração — evita ficar "travado" divulgando cupom morto indefinidamente.
  async deactivateStaleCoupons(maxAgeHours) {
    return this.run(
      `UPDATE coupons SET is_active = 0 WHERE is_active = 1 AND last_checked < datetime('now', '-' || ? || ' hours')`,
      [maxAgeHours]
    );
  }
}

module.exports = new Database();

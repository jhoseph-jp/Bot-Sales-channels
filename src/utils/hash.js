/**
 * Utilitário para geração de hash
 * @module utils/hash
 */

const crypto = require('crypto');

/**
 * Gera hash para uma oferta baseado em título, preço e vendedor
 * @param {string} title - Título do produto
 * @param {number} price - Preço
 * @param {number} sellerId - ID do vendedor
 * @returns {string} Hash SHA256
 */
function generateOfferHash(title, price, sellerId) {
  const data = `${title}|${price}|${sellerId}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Gera hash para um cupom
 * @param {string} code - Código do cupom
 * @returns {string} Hash SHA256
 */
function generateCouponHash(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

module.exports = {
  generateOfferHash,
  generateCouponHash,
};

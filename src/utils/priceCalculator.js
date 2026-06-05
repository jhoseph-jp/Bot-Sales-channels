/**
 * Módulo utilitário para cálculos de preço e desconto.
 * Garante que apenas descontos REAIS sejam reportados.
 */

class PriceCalculator {
  /**
   * Converte texto de preço do ML para número.
   * Exemplos: "1.685" -> 1685, "35" -> 35, "265,88" -> 265.88
   * @param {string} priceText - Texto do preço extraído do HTML
   * @param {string} centsText - Texto dos centavos (opcional)
   * @returns {number} Preço em formato numérico
   */
  static parsePrice(priceText, centsText = '') {
    if (!priceText) return 0;

    // Remove espaços e caracteres não numéricos (exceto ponto e vírgula)
    let cleaned = priceText.trim().replace(/[^\d.,]/g, '');

    // No ML Brasil, ponto é separador de milhar: "1.685" = 1685
    cleaned = cleaned.replace(/\./g, '');

    // Vírgula é separador decimal: "265,88" = 265.88
    cleaned = cleaned.replace(',', '.');

    let price = parseFloat(cleaned) || 0;

    // Adiciona centavos se fornecidos
    if (centsText) {
      const cents = parseInt(centsText.trim(), 10) || 0;
      price = price + (cents / 100);
    }

    return price;
  }

  /**
   * Calcula a porcentagem de desconto real entre dois preços.
   * @param {number} originalPrice - Preço original (antes do desconto)
   * @param {number} currentPrice - Preço atual (com desconto)
   * @returns {number} Porcentagem de desconto arredondada (0-100)
   */
  static calculateDiscount(originalPrice, currentPrice) {
    if (!originalPrice || !currentPrice) return 0;
    if (originalPrice <= 0 || currentPrice <= 0) return 0;
    if (currentPrice >= originalPrice) return 0;

    return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
  }

  /**
   * Extrai a porcentagem de desconto diretamente do texto do badge.
   * Exemplos: "57% OFF no Pix" -> 57, "35% OFF" -> 35
   * @param {string} badgeText - Texto do badge de desconto
   * @returns {number} Porcentagem de desconto
   */
  static extractDiscountFromBadge(badgeText) {
    if (!badgeText) return 0;
    const match = badgeText.match(/(\d+)%/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Formata preço para exibição no formato brasileiro.
   * @param {number} price - Preço numérico
   * @returns {string} Preço formatado (ex: "R$ 1.685,00")
   */
  static formatPrice(price) {
    if (!price || price <= 0) return 'R$ 0,00';
    return `R$ ${price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Valida se uma oferta tem desconto real e significativo.
   * @param {number} originalPrice - Preço original
   * @param {number} currentPrice - Preço atual
   * @param {number} minDiscount - Desconto mínimo aceitável (%)
   * @returns {boolean} true se a oferta é válida
   */
  static isValidOffer(originalPrice, currentPrice, minDiscount = 5) {
    if (!originalPrice || !currentPrice) return false;
    if (originalPrice <= currentPrice) return false;

    const discount = this.calculateDiscount(originalPrice, currentPrice);
    return discount >= minDiscount;
  }
}

module.exports = PriceCalculator;

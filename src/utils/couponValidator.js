/**
 * Módulo utilitário para validação de cupons do Mercado Livre.
 * 
 * REGRAS:
 * - NUNCA inventar ou gerar cupons
 * - Só incluir cupom na mensagem SE for extraído da página real
 * - Produto SEM cupom → enviar SEM cupom
 * - Produto COM cupom válido → enviar COM cupom
 */

const logger = require('./logger');

class CouponValidator {
  /**
   * Extrai o código do cupom de um texto do card de oferta.
   * Retorna null se não houver cupom válido.
   * @param {string} couponText - Texto extraído do elemento de cupom no card
   * @returns {string|null} Código do cupom ou null
   */
  static extractCouponCode(couponText) {
    if (!couponText || couponText.trim() === '') return null;

    const text = couponText.trim();

    // Padrões comuns de cupom no ML:
    // "Cupom de R$ 10", "10% OFF com cupom", "CUPOMXYZ"
    // Se contém "cupom" ou "Cupom", é um cupom real da página
    if (text.toLowerCase().includes('cupom')) {
      return text;
    }

    // Se é um código alfanumérico curto (ex: "MELIOFF10")
    if (/^[A-Z0-9]{4,20}$/i.test(text)) {
      return text;
    }

    return null;
  }

  /**
   * Verifica se o texto do card contém um cupom real.
   * @param {string} couponText - Texto do elemento de cupom
   * @returns {boolean} true se contém cupom válido
   */
  static hasCoupon(couponText) {
    return this.extractCouponCode(couponText) !== null;
  }

  /**
   * Formata o cupom para exibição na mensagem do Telegram.
   * @param {string} couponText - Texto do cupom
   * @returns {string} Cupom formatado para exibição
   */
  static formatCoupon(couponText) {
    const code = this.extractCouponCode(couponText);
    if (!code) return '';
    return code;
  }

  /**
   * Valida se um cupom deve ser incluído na mensagem.
   * REGRA: Só inclui se o cupom foi extraído diretamente da página do ML.
   * NUNCA inventa cupons.
   * @param {string} couponText - Texto do cupom extraído do card
   * @returns {boolean} true se o cupom deve ser incluído
   */
  static shouldIncludeCoupon(couponText) {
    if (!couponText || couponText.trim() === '') {
      return false;
    }

    const code = this.extractCouponCode(couponText);
    if (!code) {
      logger.debug(`Cupom ignorado (formato inválido): "${couponText}"`);
      return false;
    }

    return true;
  }
}

module.exports = CouponValidator;

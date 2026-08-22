/**
 * Testes do cálculo e formatação de preço.
 *
 * O canal anuncia "De X / Por Y / Z% OFF" — se este módulo erra, a mensagem mente
 * para o assinante. Cobre principalmente o formato brasileiro (ponto de milhar,
 * vírgula decimal), que é onde parsers costumam escorregar.
 */

const PriceCalculator = require('../src/utils/priceCalculator');

describe('parsePrice', () => {
  test.each([
    ['1.685', '', 1685],      // ponto é separador de milhar no BR
    ['265,88', '', 265.88],   // vírgula é decimal
    ['35', '', 35],
    ['1.299', '90', 1299.9],  // centavos vêm em elemento separado no HTML do ML
    ['R$ 49', '99', 49.99],
  ])('parsePrice(%p, %p) = %p', (texto, centavos, esperado) => {
    expect(PriceCalculator.parsePrice(texto, centavos)).toBeCloseTo(esperado, 2);
  });

  test.each([null, undefined, '', 'sem número'])('retorna 0 para %p', (entrada) => {
    expect(PriceCalculator.parsePrice(entrada)).toBe(0);
  });
});

describe('calculateDiscount', () => {
  test('calcula o percentual e arredonda', () => {
    expect(PriceCalculator.calculateDiscount(100, 75)).toBe(25);
    expect(PriceCalculator.calculateDiscount(24.78, 23.79)).toBe(4);
  });

  test('retorna 0 quando não há desconto real', () => {
    expect(PriceCalculator.calculateDiscount(100, 100)).toBe(0);
    expect(PriceCalculator.calculateDiscount(100, 120)).toBe(0);   // preço subiu
    expect(PriceCalculator.calculateDiscount(0, 50)).toBe(0);
    expect(PriceCalculator.calculateDiscount(100, 0)).toBe(0);
  });
});

describe('extractDiscountFromBadge', () => {
  test.each([
    ['57% OFF no Pix', 57],
    ['35% OFF', 35],
    ['sem percentual', 0],
    ['', 0],
  ])('extractDiscountFromBadge(%p) = %p', (texto, esperado) => {
    expect(PriceCalculator.extractDiscountFromBadge(texto)).toBe(esperado);
  });
});

describe('formatPrice', () => {
  test('formata no padrão brasileiro', () => {
    expect(PriceCalculator.formatPrice(1685)).toBe('R$ 1.685,00');
    expect(PriceCalculator.formatPrice(23.79)).toBe('R$ 23,79');
    expect(PriceCalculator.formatPrice(0.5)).toBe('R$ 0,50');
  });

  test('preço inválido vira R$ 0,00 em vez de NaN', () => {
    expect(PriceCalculator.formatPrice(0)).toBe('R$ 0,00');
    expect(PriceCalculator.formatPrice(null)).toBe('R$ 0,00');
    expect(PriceCalculator.formatPrice(undefined)).toBe('R$ 0,00');
  });
});

describe('isValidOffer', () => {
  test('exige desconto real acima do piso', () => {
    expect(PriceCalculator.isValidOffer(100, 80, 15)).toBe(true);   // 20%
    expect(PriceCalculator.isValidOffer(100, 90, 15)).toBe(false);  // 10%
    expect(PriceCalculator.isValidOffer(100, 100, 5)).toBe(false);
  });
});

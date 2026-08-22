/**
 * Testes da ordenação das candidatas do ciclo.
 *
 * Regressão: a versão anterior ordenava por categoryPriority e usava o desconto só
 * como desempate. Em 2026-08-22 isso publicou uma camiseta de 21% OFF antes de uma
 * calça de 57% OFF, porque a primeira vinha de categoria mais prioritária.
 */

const {
  pesoDaOferta, ordenarCandidatas, BONUS_POR_NIVEL, NIVEL_NEUTRO,
} = require('../src/utils/offerRanking');

const oferta = (discount, categoryPriority, title = 'x') => ({ discount, categoryPriority, title });

describe('pesoDaOferta', () => {
  test('sem categoria-fonte o peso é o próprio desconto', () => {
    expect(pesoDaOferta(oferta(40, undefined))).toBe(40);
    expect(pesoDaOferta(oferta(40, null))).toBe(40);
  });

  test('cada nível de prioridade vale BONUS_POR_NIVEL pontos', () => {
    expect(pesoDaOferta(oferta(0, 1))).toBe((NIVEL_NEUTRO - 1) * BONUS_POR_NIVEL); // 25
    expect(pesoDaOferta(oferta(0, 5))).toBe((NIVEL_NEUTRO - 5) * BONUS_POR_NIVEL); // 5
    expect(pesoDaOferta(oferta(0, NIVEL_NEUTRO))).toBe(0);
  });

  test('prioridade fora da faixa não vira bônus negativo', () => {
    expect(pesoDaOferta(oferta(30, 99))).toBe(30);
  });

  test.each([null, undefined, {}, { discount: 'abc' }])('não quebra com %p', (entrada) => {
    expect(() => pesoDaOferta(entrada)).not.toThrow();
    expect(Number.isFinite(pesoDaOferta(entrada))).toBe(true);
  });
});

describe('ordenarCandidatas — o incidente que motivou a mudança', () => {
  test('57% de prioridade menor passa na frente de 21% de prioridade 1', () => {
    const camiseta = oferta(21, 1, 'Camiseta adidas Feminino');   // 21 + 25 = 46
    const calca    = oferta(57, 3, 'Calça Alfaiataria Wid Leg');  // 57 + 15 = 72
    const [primeira] = ordenarCandidatas([camiseta, calca]);
    expect(primeira.title).toBe('Calça Alfaiataria Wid Leg');
  });

  test('mesmo sem categoria-fonte, desconto muito melhor vence a prioridade 1', () => {
    const moda    = oferta(21, 1);   // 46
    const beleza  = oferta(57, null); // 57
    expect(ordenarCandidatas([moda, beleza])[0]).toBe(beleza);
  });
});

describe('ordenarCandidatas — a moda continua com vantagem', () => {
  test('em disputa parelha, moda passa na frente de cozinha', () => {
    const moda    = oferta(30, 1);    // 55
    const cozinha = oferta(32, null); // 32
    expect(ordenarCandidatas([cozinha, moda])[0]).toBe(moda);
  });

  test('com desconto igual, vence a categoria mais prioritária', () => {
    const p1 = oferta(40, 1);
    const p5 = oferta(40, 5);
    const neutra = oferta(40, null);
    expect(ordenarCandidatas([neutra, p5, p1])).toEqual([p1, p5, neutra]);
  });

  test('a vantagem da moda tem teto: 25 pontos percentuais', () => {
    // 26 pontos acima: a de fora ganha. 24 acima: a moda ainda ganha.
    expect(ordenarCandidatas([oferta(10, 1), oferta(36, null)])[0].discount).toBe(36);
    expect(ordenarCandidatas([oferta(10, 1), oferta(34, null)])[0].discount).toBe(10);
  });
});

describe('ordenarCandidatas — contrato', () => {
  test('não muta o array de entrada', () => {
    const entrada = [oferta(10, null), oferta(90, null)];
    const copia = [...entrada];
    ordenarCandidatas(entrada);
    expect(entrada).toEqual(copia);
  });

  test('lida com lista vazia', () => {
    expect(ordenarCandidatas([])).toEqual([]);
  });

  test('ordena do maior peso para o menor', () => {
    const pesos = ordenarCandidatas([
      oferta(10, null), oferta(80, null), oferta(45, 2), oferta(20, 1),
    ]).map(pesoDaOferta);
    expect(pesos).toEqual([...pesos].sort((a, b) => b - a));
  });
});

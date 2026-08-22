/**
 * Testes da política de alerta.
 *
 * Um alerta operacional erra de duas formas opostas, e as duas terminam igual —
 * ignorado. Cedo/repetido demais vira ruído; tarde demais deixa o canal secar em
 * silêncio. Os testes cobrem as duas bordas.
 */

const {
  avaliarFalhaAfiliado, MIN_TENTATIVAS, PROPORCAO_FALHA, CARENCIA_MS,
} = require('../src/utils/alertPolicy');

const AGORA = Date.parse('2026-08-22T12:00:00Z');

describe('avaliarFalhaAfiliado — dispara', () => {
  test('todas as tentativas falharam', () => {
    const r = avaliarFalhaAfiliado({ tentativas: 10, falhas: 10 }, 0, AGORA);
    expect(r.alertar).toBe(true);
    expect(r.proporcao).toBe(1);
  });

  test('exatamente no limiar de proporção', () => {
    const tentativas = 10;
    const falhas = tentativas * PROPORCAO_FALHA;
    expect(avaliarFalhaAfiliado({ tentativas, falhas }, 0, AGORA).alertar).toBe(true);
  });

  test('dispara de novo depois da carência', () => {
    const antigo = AGORA - CARENCIA_MS - 1000;
    expect(avaliarFalhaAfiliado({ tentativas: 5, falhas: 5 }, antigo, AGORA).alertar).toBe(true);
  });
});

describe('avaliarFalhaAfiliado — não dispara', () => {
  test('amostra pequena, mesmo com 100% de falha', () => {
    // Uma ou duas falhas podem ser rede; não é sinal de sessão expirada
    const r = avaliarFalhaAfiliado({ tentativas: MIN_TENTATIVAS - 1, falhas: MIN_TENTATIVAS - 1 }, 0, AGORA);
    expect(r.alertar).toBe(false);
    expect(r.motivo).toBe('amostra pequena');
  });

  test('falhas esparsas dentro do normal', () => {
    const r = avaliarFalhaAfiliado({ tentativas: 10, falhas: 3 }, 0, AGORA);
    expect(r.alertar).toBe(false);
    expect(r.motivo).toBe('falhas dentro do normal');
  });

  test('em carência não repete o alerta', () => {
    const recente = AGORA - 60 * 60 * 1000;   // 1 h atrás
    const r = avaliarFalhaAfiliado({ tentativas: 10, falhas: 10 }, recente, AGORA);
    expect(r.alertar).toBe(false);
    expect(r.motivo).toBe('em carência');
  });

  test('ciclo sem nenhuma tentativa não alerta', () => {
    expect(avaliarFalhaAfiliado({ tentativas: 0, falhas: 0 }, 0, AGORA).alertar).toBe(false);
  });

  test('ciclo perfeito não alerta', () => {
    expect(avaliarFalhaAfiliado({ tentativas: 20, falhas: 0 }, 0, AGORA).alertar).toBe(false);
  });
});

describe('avaliarFalhaAfiliado — carência não vira silêncio permanente', () => {
  test('exatamente no fim da carência ainda segura, logo depois libera', () => {
    const noLimite = AGORA - CARENCIA_MS + 1;
    expect(avaliarFalhaAfiliado({ tentativas: 5, falhas: 5 }, noLimite, AGORA).alertar).toBe(false);

    const passou = AGORA - CARENCIA_MS - 1;
    expect(avaliarFalhaAfiliado({ tentativas: 5, falhas: 5 }, passou, AGORA).alertar).toBe(true);
  });
});

describe('avaliarFalhaAfiliado — entradas degeneradas', () => {
  test.each([null, undefined, {}, { tentativas: 'x', falhas: 'y' }])('não quebra com %p', (ciclo) => {
    expect(() => avaliarFalhaAfiliado(ciclo, 0, AGORA)).not.toThrow();
    expect(avaliarFalhaAfiliado(ciclo, 0, AGORA).alertar).toBe(false);
  });

  test.each([null, undefined, NaN, 'abc'])('último alerta inválido (%p) é tratado como nunca', (ultimo) => {
    expect(avaliarFalhaAfiliado({ tentativas: 5, falhas: 5 }, ultimo, AGORA).alertar).toBe(true);
  });
});

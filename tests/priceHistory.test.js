/**
 * Testes da regra do selo "menor preço".
 *
 * O risco aqui não é o bot quebrar — é ele mentir. Um selo de menor preço apoiado
 * em histórico curto é pior que selo nenhum, porque o assinante confia nele.
 * Estes testes existem sobretudo para garantir que o selo NÃO aparece.
 */

const {
  avaliarMenorPreco, textoMenorPreco,
  MIN_DIAS_RASTREADOS, MIN_OBSERVACOES, JANELA_DIAS,
} = require('../src/utils/priceHistory');

// Histórico saudável: rastreado o bastante e com observações suficientes
const stats = (over = {}) => ({ menor: 100, observacoes: 10, dias: 40, ...over });

describe('avaliarMenorPreco — concede o selo', () => {
  test('preço atual abaixo do mínimo observado', () => {
    expect(avaliarMenorPreco(stats({ menor: 100 }), 89.9)).toEqual({ dias: 40 });
  });

  test('preço atual empatando com o mínimo', () => {
    expect(avaliarMenorPreco(stats({ menor: 100 }), 100)).toEqual({ dias: 40 });
  });

  test('diferença de centavos não tira o selo', () => {
    expect(avaliarMenorPreco(stats({ menor: 100 }), 100.01)).not.toBeNull();
  });
});

describe('avaliarMenorPreco — nega o selo', () => {
  test('preço atual acima do mínimo', () => {
    expect(avaliarMenorPreco(stats({ menor: 100 }), 110)).toBeNull();
  });

  test('histórico curto demais, mesmo sendo o menor preço', () => {
    const recente = stats({ dias: MIN_DIAS_RASTREADOS - 1 });
    expect(avaliarMenorPreco(recente, 50)).toBeNull();
  });

  test('observações de menos, mesmo com dias suficientes', () => {
    const raso = stats({ observacoes: MIN_OBSERVACOES - 1 });
    expect(avaliarMenorPreco(raso, 50)).toBeNull();
  });

  test('produto visto pela primeira vez nunca ganha selo', () => {
    // O primeiro preço é trivialmente o menor já visto — o caso mais perigoso
    expect(avaliarMenorPreco({ menor: 80, observacoes: 1, dias: 0 }, 80)).toBeNull();
  });

  test.each([null, undefined, {}, { menor: null, observacoes: 9, dias: 30 }])(
    'estatística inutilizável (%p) não vira selo', (entrada) => {
      expect(avaliarMenorPreco(entrada, 50)).toBeNull();
    });

  test.each([0, -10, null, undefined, NaN, 'abc'])('preço atual inválido (%p)', (preco) => {
    expect(avaliarMenorPreco(stats(), preco)).toBeNull();
  });
});

describe('avaliarMenorPreco — nunca afirma mais do que observou', () => {
  test('reporta a janela real de acompanhamento, não uma fixa', () => {
    expect(avaliarMenorPreco(stats({ dias: 23 }), 50)).toEqual({ dias: 23 });
    expect(avaliarMenorPreco(stats({ dias: 61.7 }), 50)).toEqual({ dias: 61 });
  });

  test('limita à janela máxima mesmo com histórico mais antigo', () => {
    expect(avaliarMenorPreco(stats({ dias: 400 }), 50)).toEqual({ dias: JANELA_DIAS });
  });

  test('arredonda para baixo — 29,9 dias não vira "30 dias"', () => {
    expect(avaliarMenorPreco(stats({ dias: 29.9 }), 50).dias).toBe(29);
  });
});

describe('textoMenorPreco', () => {
  test('monta a frase com a janela real', () => {
    expect(textoMenorPreco({ dias: 23 })).toBe('Menor preço dos últimos 23 dias');
  });

  test.each([null, undefined])('sem selo devolve string vazia (%p)', (selo) => {
    expect(textoMenorPreco(selo)).toBe('');
  });
});

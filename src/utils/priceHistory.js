/**
 * Regra do selo "menor preço" — decide quando o canal pode afirmar isso.
 *
 * O selo só vale alguma coisa se for verdade. Um canal que carimba "menor preço"
 * em tudo vira ruído; um que carimba baseado em histórico curto está mentindo sem
 * saber. Por isso duas travas:
 *
 *   1. Exige histórico mínimo (dias rastreados e número de observações). Sem isso,
 *      todo produto novo apareceria como "menor preço" no primeiro dia — o preço
 *      inicial é trivialmente o menor já visto.
 *   2. Anuncia a JANELA REAL de observação, não uma fixa. Se o produto é acompanhado
 *      há 23 dias, o selo diz 23 dias — nunca "90 dias".
 *
 * O módulo é puro: recebe as estatísticas já lidas do banco e devolve a decisão.
 */

// Além disso o histórico não interessa (e é podado do banco)
const JANELA_DIAS = 90;

// Abaixo disso não há histórico suficiente para afirmar nada
const MIN_DIAS_RASTREADOS = 14;
const MIN_OBSERVACOES = 3;

// Diferença de centavos não desempata: preço igual ao mínimo ainda conta como "menor"
const TOLERANCIA = 0.01;

/**
 * @typedef {{ menor: number|null, observacoes: number, dias: number }} EstatisticaPreco
 */

/**
 * Decide se a oferta pode levar o selo de menor preço.
 *
 * @param {EstatisticaPreco|null} stats  estatísticas do histórico (db.getPriceStats)
 * @param {number} precoAtual
 * @returns {{ dias: number }|null}  null = sem selo
 */
function avaliarMenorPreco(stats, precoAtual) {
  const preco = Number(precoAtual);
  if (!Number.isFinite(preco) || preco <= 0) return null;
  if (!stats) return null;

  const menor = Number(stats.menor);
  const observacoes = Number(stats.observacoes) || 0;
  const dias = Number(stats.dias) || 0;

  if (!Number.isFinite(menor) || menor <= 0) return null;
  if (observacoes < MIN_OBSERVACOES) return null;
  if (dias < MIN_DIAS_RASTREADOS) return null;

  // Preço atual precisa empatar ou bater o mínimo já observado
  if (preco > menor + TOLERANCIA) return null;

  // Nunca afirma mais do que se observou de fato
  return { dias: Math.floor(Math.min(dias, JANELA_DIAS)) };
}

/**
 * Texto do selo, sem emoji — cada canal aplica o seu.
 * @param {{dias:number}|null} selo
 * @returns {string} vazio quando não há selo
 */
function textoMenorPreco(selo) {
  if (!selo) return '';
  return `Menor preço dos últimos ${selo.dias} dias`;
}

module.exports = {
  avaliarMenorPreco,
  textoMenorPreco,
  JANELA_DIAS,
  MIN_DIAS_RASTREADOS,
  MIN_OBSERVACOES,
};

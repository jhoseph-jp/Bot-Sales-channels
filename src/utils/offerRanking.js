/**
 * Ordenação das ofertas candidatas de um ciclo.
 *
 * O desconto manda; a categoria-fonte apenas empurra. A versão anterior ordenava por
 * `categoryPriority` primeiro e usava o desconto só como desempate dentro da mesma
 * categoria — o resultado, visto em produção, foi uma oferta de 21% OFF sair na frente
 * de uma de 57% OFF só porque veio de uma categoria mais prioritária. Num canal de
 * ofertas isso entrega o pior produto primeiro.
 *
 * O bônus é aditivo e em pontos percentuais, então dá para raciocinar direto:
 * com BONUS_POR_NIVEL = 5, uma peça de MLB1430 (prioridade 1) vale +25, ou seja,
 * ela só perde para algo de fora da moda que esteja 25 pontos percentuais acima.
 */

// Quanto cada nível de prioridade vale, em pontos percentuais de desconto
const BONUS_POR_NIVEL = 5;

// Ofertas sem categoria-fonte (beleza/joias/cozinha, vindas das abas de texto, e todas
// as do relâmpago) não recebem bônus — este é o nível neutro.
const NIVEL_NEUTRO = 6;

/**
 * Peso de ordenação de uma oferta. Maior = sai primeiro.
 * @param {{discount:number, categoryPriority?:number|null}} offer
 * @returns {number}
 */
function pesoDaOferta(offer) {
  const desconto = Number(offer?.discount) || 0;
  const prioridade = offer?.categoryPriority ?? NIVEL_NEUTRO;
  const nivel = Number.isFinite(prioridade) ? prioridade : NIVEL_NEUTRO;
  // Prioridade fora da faixa conhecida não vira bônus negativo
  const bonus = Math.max(0, NIVEL_NEUTRO - nivel) * BONUS_POR_NIVEL;
  return desconto + bonus;
}

/**
 * Ordena as candidatas do ciclo, da melhor para a pior. Não muta a entrada.
 * @param {Array} offers
 * @returns {Array}
 */
function ordenarCandidatas(offers) {
  return [...offers].sort((a, b) => pesoDaOferta(b) - pesoDaOferta(a));
}

module.exports = { pesoDaOferta, ordenarCandidatas, BONUS_POR_NIVEL, NIVEL_NEUTRO };

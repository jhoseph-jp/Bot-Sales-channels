/**
 * Filtra cupons fora do público-alvo do canal (mulheres — moda, acessórios,
 * eletrônicos, saúde e beleza). Fontes como cuponomia trazem cupons de
 * checkout genéricos do ML — alguns claramente voltados a outro público
 * (veículos, construção, pet, infantil) a julgar pelo código/descrição.
 *
 * Estratégia conservadora: só bloqueia quando há sinal explícito de uma
 * categoria fora do alvo. Cupons sem nenhum sinal de categoria (a maioria)
 * permanecem — são genéricos e válidos pra qualquer compra.
 */

// Termos verificados como substring direta no CÓDIGO (ex.: "MLVEICULO"),
// já que códigos são tokens colados em caixa alta, sem espaço entre palavras.
const BLOCKLIST_WORDS = [
  'veiculo', 'automovel', 'automotiv', 'autopeca', 'auto', 'pneu',
  'moto', 'motocicleta',
  'construcao', 'construir', 'ferragens', 'ferramenta',
  'agro', 'trator', 'fazenda',
  'petshop', 'racao', 'pet',
  'infantil', 'brinquedo', 'minions', 'kids',
];

function normalize(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function isRelevantForAudience(coupon) {
  const code = normalize(coupon.code);
  const prose = normalize(`${coupon.title || ''} ${coupon.description || ''}`);

  return !BLOCKLIST_WORDS.some(word => {
    if (code.includes(word)) return true;
    return new RegExp(`\\b${word}\\b`, 'i').test(prose);
  });
}

module.exports = { isRelevantForAudience };

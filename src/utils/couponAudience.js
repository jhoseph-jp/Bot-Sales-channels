/**
 * Filtra cupons fora do público-alvo do canal (mulheres — moda, acessórios,
 * beleza, cozinha).
 *
 * Existem dois tipos de cupom e eles NÃO podem ser tratados igual:
 *
 * 1. Cupom genérico de checkout (cuponomia, página /cupons do ML) — vale pra
 *    qualquer compra, inclusive as do nicho. Continua permissivo: só é barrado
 *    quando há sinal explícito de categoria fora do alvo.
 *
 * 2. Cupom atrelado a produto/vendedor (post de canal com link do produto e
 *    preço) — só vale naquele produto, então a utilidade dele é limitada pelo
 *    que o produto é. Aqui exige-se sinal POSITIVO de nicho, o mesmo critério
 *    que decide quais ofertas vão ao ar. Sem isso passava coisa como cupom de
 *    vendedor de furadeira (TBTSTOCK10), inútil para o público do canal.
 */

const { normalize, isHardBlocked, isFeminine } = require('./nicheFilter');

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

// Link que aponta pra UM produto específico — encurtador de afiliado (meli.la),
// URL de item (MLB-123456789) ou página de produto.
const PRODUCT_LINK_PATTERN = /meli\.la\/|mercadolivre\.com\.br\/.*MLB-?\d{6,}|\/p\/MLB\d+|produto\.mercadolivre/i;

// Cupom genérico de loja também costuma trazer link meli.la — mas ali o link é o
// RESGATE no app, não um produto ("APP - Cupom 10% OFF Mercado Livre, resgate:
// meli.la/xxx"). Sem essa exceção, cupom genérico bom era descartado junto.
const GENERIC_COUPON_MARKERS = /toda a loja|todas as lojas|resgate.{0,25}no app|app\s*-\s*cupom|cupons? rel[âa]mpago|em compras acima de|v[áa]lido para todo/i;

function hasProductContext(coupon) {
  const haystack = `${coupon.link || ''} ${coupon.description || ''} ${coupon.title || ''}`;
  if (!PRODUCT_LINK_PATTERN.test(haystack)) return false;
  return !GENERIC_COUPON_MARKERS.test(haystack);
}

function isRelevantForAudience(coupon) {
  const code = normalize(coupon.code);
  const prose = normalize(`${coupon.title || ''} ${coupon.description || ''}`);
  const fullText = `${coupon.title || ''} ${coupon.description || ''}`;

  // Camada 1 — blocklist do código/descrição (mesma de sempre)
  const blocked = BLOCKLIST_WORDS.some(word => {
    if (code.includes(word)) return true;
    return new RegExp(`\\b${word}\\b`, 'i').test(prose);
  });
  if (blocked) return false;

  // Camada 2 — hard block do nicho, agora o MESMO que as ofertas usam
  // (furadeira, automotivo, masculino, pet, suplemento...).
  if (isHardBlocked(fullText)) return false;

  // Camada 3 — cupom preso a um produto precisa que o produto seja do nicho.
  // Cupom genérico não passa por aqui: serve pra qualquer compra.
  if (hasProductContext(coupon) && !isFeminine(fullText)) return false;

  return true;
}

module.exports = { isRelevantForAudience, hasProductContext };

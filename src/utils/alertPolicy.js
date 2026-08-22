/**
 * Política de alerta — decide QUANDO avisar, sem virar spam nem silêncio.
 *
 * O caso que motivou: todo link do ML passa por automação do portal de afiliados com
 * sessão de navegador salva. Quando a sessão expira, o bot loga "Sem link afiliado
 * (próx. ciclo)" e pula todas as ofertas — o canal seca sem ninguém perceber. O log
 * existe, mas ninguém lê log de bot que está "funcionando".
 *
 * Duas tensões opostas para equilibrar:
 *   - Alertar cedo demais: uma falha isolada de rede vira alarme, e alarme frequente
 *     é ignorado. Por isso exige uma proporção alta de falhas num volume mínimo.
 *   - Alertar tarde/repetido demais: sem carência o mesmo alerta sai a cada ciclo,
 *     de 75 em 75 minutos, e vira ruído igualmente ignorado.
 *
 * Puro de propósito: recebe números e o instante do último alerta, devolve a decisão.
 */

// Abaixo disso a amostra é pequena demais para concluir qualquer coisa
const MIN_TENTATIVAS = 3;

// Proporção de falhas que caracteriza problema sistêmico, não azar pontual
const PROPORCAO_FALHA = 0.8;

// Silêncio entre dois alertas da mesma causa
const CARENCIA_MS = 6 * 60 * 60 * 1000;   // 6 h

/**
 * @param {{tentativas:number, falhas:number}} ciclo   contagem do ciclo que acabou
 * @param {number|null} ultimoAlerteMs                 timestamp do último alerta desta causa
 * @param {number} agoraMs
 * @returns {{alertar:boolean, motivo:string, proporcao:number}}
 */
function avaliarFalhaAfiliado(ciclo, ultimoAlerteMs, agoraMs = Date.now()) {
  const tentativas = Number(ciclo?.tentativas) || 0;
  const falhas = Number(ciclo?.falhas) || 0;
  const proporcao = tentativas > 0 ? falhas / tentativas : 0;

  if (tentativas < MIN_TENTATIVAS) {
    return { alertar: false, motivo: 'amostra pequena', proporcao };
  }
  if (proporcao < PROPORCAO_FALHA) {
    return { alertar: false, motivo: 'falhas dentro do normal', proporcao };
  }

  const ultimo = Number(ultimoAlerteMs) || 0;
  if (ultimo > 0 && agoraMs - ultimo < CARENCIA_MS) {
    return { alertar: false, motivo: 'em carência', proporcao };
  }

  return { alertar: true, motivo: 'falha sistêmica', proporcao };
}

module.exports = { avaliarFalhaAfiliado, MIN_TENTATIVAS, PROPORCAO_FALHA, CARENCIA_MS };

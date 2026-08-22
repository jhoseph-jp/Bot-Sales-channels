const { exec } = require('child_process');
const { settings } = require('./config/env');
const logger = require('./utils/logger');
const db = require('./repositories/database');
const mlService = require('./services/mercadoLivreService');
const shopeeService = require('./services/shopeeService');
const telegramService = require('./services/telegramService');
const couponListener = require('./services/couponListener');
const { isRelevantForAudience } = require('./utils/couponAudience');
const { isFeminine } = require('./utils/nicheFilter');
const { ordenarCandidatas } = require('./utils/offerRanking');
const { avaliarMenorPreco, JANELA_DIAS } = require('./utils/priceHistory');
const alertService = require('./services/alertService');
const { avaliarFalhaAfiliado } = require('./utils/alertPolicy');
const instagramService = require('./services/instagramService');
const whatsappService = require('./services/whatsappService');

// Comando de sync do SQLite com o EC2/VPS do website. Definido em WEBSITE_SYNC_CMD
// no .env. Vazio (padrão) = sync desligado — útil rodando local sem servidor do site.
const WEBSITE_SYNC_CMD = settings.websiteSyncCmd;

const OFFER_INTERVAL_MS  = 4500000;  // 75 min — ofertas do dia
const FLASH_INTERVAL_MS  =  600000;  // 10 min — relâmpago
const COUPON_INTERVAL_MS = 3600000;  // 60 min — cupons de canais Telegram
const SHOPEE_INTERVAL_MS = 4500000;  // 75 min — ofertas Shopee (nicho feminino)

// Lote de 5 a 7 por ciclo, sorteado a cada rodada, pra não sair sempre o mesmo número.
const MIN_PER_CYCLE = 5;
const MAX_PER_CYCLE = 7;
const MAX_FLASH_PER_CYCLE = 5;       // máx por ciclo relâmpago

// Espaçamento entre as ofertas de um mesmo lote. Sem isso o lote inteiro cai no grupo
// em poucos segundos (a fila dos services envia de 1,5s em 1,5s) e parece spam.
// Não vale pro relâmpago, que é tempo-sensível e sai assim que encontrado.
const SPACING_MIN_MS = 60000;        // 1 min
const SPACING_MAX_MS = 180000;       // 3 min

// Madrugada (00h-06h de Brasilia): a audiencia dorme, entao ofertas comuns saem em
// ritmo bem menor - de 75 min para 3 h, e lote de 2-3 em vez de 5-7. Na pratica cai de
// ~5 ciclos por noite para ~2. O relambago NAO entra nessa regra: e tempo-sensivel e
// segue no ciclo de 10 min. Cupons tambem seguem inalterados.
const QUIET_TZ          = 'America/Sao_Paulo';
const QUIET_START_HOUR  = 0;
const QUIET_END_HOUR    = 6;
const NIGHT_INTERVAL_MS = 10800000;  // 3 h
const NIGHT_MIN_PER_CYCLE = 2;
const NIGHT_MAX_PER_CYCLE = 3;

const randBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const spacingDelay = () => randBetween(SPACING_MIN_MS, SPACING_MAX_MS);

// A VPS roda em UTC (sem TZ no .env), entao Date#getHours() daria 21h-03h de Brasilia
// aqui — justamente o horario nobre. A hora tem que ser resolvida no fuso, explicitamente.
function horaBrasilia(d = new Date()) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: QUIET_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).split(':').map(Number);
  return { h, m };
}

const emMadrugada = () => {
  const { h } = horaBrasilia();
  return h >= QUIET_START_HOUR && h < QUIET_END_HOUR;
};

const msAteFimDaMadrugada = () => {
  const { h, m } = horaBrasilia();
  if (h >= QUIET_END_HOUR) return 0;
  return ((QUIET_END_HOUR - h) * 60 - m) * 60000;
};

const offersPerCycle = () => (emMadrugada()
  ? randBetween(NIGHT_MIN_PER_CYCLE, NIGHT_MAX_PER_CYCLE)
  : randBetween(MIN_PER_CYCLE, MAX_PER_CYCLE));

// Intervalo vigente agora — usado tanto na trava de restart (_faltaPara) quanto no reagendamento
const intervaloVigente = (intervaloNormal) => (emMadrugada() ? NIGHT_INTERVAL_MS : intervaloNormal);

// Na madrugada nao agenda alem das 06h: um ciclo iniciado 05h50 abriria um vazio de
// 3 h entrando pela manha. Volta a checar logo apos a janela e retoma o ritmo normal.
const proximoDelay = (intervaloNormal) => {
  if (!emMadrugada()) return intervaloNormal;
  return Math.min(NIGHT_INTERVAL_MS, msAteFimDaMadrugada() + 60000);
};

class BotApp {
  constructor() {
    this.isRunning = false;
  }

  async start() {
    try {
      await mlService.init();
      this.isRunning = true;

      this.runOfferCycle();
      this.runFlashCycle();
      this.runCouponCycle();
      this.runShopeeCycle();

      logger.info(`Bot iniciado. Ofertas ML e Shopee: ${MIN_PER_CYCLE}-${MAX_PER_CYCLE} a cada 75 min, espaçadas de 1-3 min | Relâmpago: 10 min (max ${MAX_FLASH_PER_CYCLE}, imediato) | Madrugada 00h-06h BRT: 1 lote de ${NIGHT_MIN_PER_CYCLE}-${NIGHT_MAX_PER_CYCLE} a cada 3 h (relampago segue normal) | Cupons: 60 min | Categorias (prioridade): Calçados/Roupas e Bolsas > Camisetas e Regatas > Calças > Tênis > Acessórios > beleza/joias/bijuteria/cozinha`);
    } catch (err) {
      logger.error('Erro fatal ao iniciar:', err.message);
      process.exit(1);
    }
  }

  // ─────────────────────────────────────────────
  // Ciclo Ofertas do Dia — 75 min, lote de 5-7 espaçadas de 1-3 min
  // ─────────────────────────────────────────────

  async runOfferCycle() {
    if (!this.isRunning) return;
    const espera = await this._faltaPara('last_offer_cycle', intervaloVigente(OFFER_INTERVAL_MS));
    if (espera > 0) {
      logger.info(`[Ofertas do Dia] Ciclo recente — próximo em ${Math.round(espera / 60000)} min.`);
      setTimeout(() => this.runOfferCycle(), espera);
      return;
    }
    try {
      await db.setConfig('last_offer_cycle', String(Date.now()));
      const podadas = await db.prunePriceHistory(180).catch(() => 0);
      if (podadas > 0) logger.info(`[Historico] ${podadas} registro(s) antigos podados.`);
      const offers = await mlService.getDailyOffers();
      const sent = await this._processOffers(offers, offersPerCycle(), false, true);
      logger.info(`[Ofertas do Dia] ${sent} novas enviadas.`);
      if (sent > 0) this._syncWebsite();
    } catch (err) {
      logger.error('[Ofertas do Dia] Erro:', err.message);
    } finally {
      setTimeout(() => this.runOfferCycle(), proximoDelay(OFFER_INTERVAL_MS));
    }
  }

  // ─────────────────────────────────────────────
  // Ciclo Relâmpago — 10 min, max 5, com timer. Sem espaçamento e sem trava de restart:
  // oferta relâmpago é tempo-sensível e deve sair assim que encontrada.
  // ─────────────────────────────────────────────

  async runFlashCycle() {
    if (!this.isRunning) return;
    try {
      const offers = await mlService.getFlashOffers();
      const sent = await this._processOffers(offers, MAX_FLASH_PER_CYCLE, true);
      logger.info(`[Relâmpago] ${sent} novas enviadas.`);
      if (sent > 0) this._syncWebsite();
    } catch (err) {
      logger.error('[Relâmpago] Erro:', err.message);
    } finally {
      setTimeout(() => this.runFlashCycle(), FLASH_INTERVAL_MS);
    }
  }

  // ─────────────────────────────────────────────
  // Ciclo Cupons — 60 min, via canais Telegram
  // ─────────────────────────────────────────────

  async runCouponCycle() {
    if (!this.isRunning) return;
    try {
      // Fonte única: canais do Telegram listados em COUPON_CHANNELS (.env).
      //
      // A cuponomia foi removida: trazia volume alto de cupom genérico de checkout do ML
      // sem nenhuma relação com o nicho feminino, e não havia como separar o que servia ao
      // canal (cupom genérico não tem produto nem categoria pra filtrar). A página /cupons
      // do ML também saiu — em 423 ciclos ela nunca devolveu um único código, só gastava
      // uma sessão do Playwright por hora.
      const listenerCoupons = await couponListener.getCoupons().catch(() => []);

      // store já vem do couponListener (ml ou shopee)
      const allCoupons = listenerCoupons.map(c => ({
        ...c,
        source: 'listener',
        discount: c.discount ?? null,
        minimum: c.minimum ?? null,
        limit: c.limit ?? null,
      }));

      // Sem segunda fonte não há cross-check de validade. Na prática já não havia: a
      // conferência do listener era contra a página do ML, que voltava sempre vazia e
      // caía na exceção "sem dado do ML: não bloqueia". O que garante a qualidade agora
      // é a extração exigir código anunciado explicitamente (ver couponListener.js) mais
      // o filtro de nicho, e o TTL abaixo como validade máxima.
      const newCoupons = [];
      const seenNow = new Set();
      let filtered = 0;
      let reavaliados = 0;
      for (const coupon of allCoupons) {
        seenNow.add(coupon.id);

        // Cupom já visto antes: em vez de pular pra sempre, reavalia contra o contexto
        // NOVO em que ele reapareceu. Código genérico do ML é anunciado junto de produtos
        // diferentes — visto primeiro numa furadeira ele era barrado e ficava queimado pra
        // sempre, mesmo voltando depois anunciado com um vestido.
        //
        // A description guardada diz em que contexto ele foi visto da última vez, então
        // ela mesma distingue os dois casos, sem precisar de coluna nova: se aquele
        // contexto REPROVA no filtro, o cupom foi barrado por nicho e merece nova chance;
        // se APROVA, é porque já foi publicado e não pode repetir no canal.
        const existing = await db.getCoupon(coupon.id);
        if (existing) {
          const foraDoNichoAntes = !isRelevantForAudience(existing);
          const passaAgora = isRelevantForAudience(coupon);
          if (!foraDoNichoAntes || !passaAgora) continue;
          reavaliados++;
        }

        // Fora do público-alvo (veículos, construção, pet, infantil...) — salva como
        // inativo pra registrar que foi visto; se reaparecer num contexto do nicho, o
        // bloco acima o reconsidera.
        if (!isRelevantForAudience(coupon)) {
          await db.saveCoupon({ ...coupon, discountText: coupon.discountText || '', isActive: false });
          filtered++;
          continue;
        }

        await db.saveCoupon({ ...coupon, discountText: coupon.discountText || '', isActive: true });
        newCoupons.push(coupon);
        logger.info(`${existing ? 'Cupom reavaliado e liberado' : 'Novo cupom'}: ${coupon.code}${coupon.discount ? ` (${coupon.discount}% OFF)` : coupon.discountText ? ` (${coupon.discountText})` : ''}`);
      }
      if (filtered > 0) logger.info(`[Cupons] ${filtered} filtrado(s) (fora do público-alvo).`);
      if (reavaliados > 0) logger.info(`[Cupons] ${reavaliados} liberado(s) na reavaliação (reapareceu em contexto do nicho).`);

      // Revalidação dos já ativos. O feed do canal é uma linha do tempo rolante: sumir do
      // scrape não quer dizer que expirou, só que a mensagem saiu da janela visível — por
      // isso NÃO se desativa por ausência. Quem ainda aparece tem o last_checked renovado
      // (segue vivo), e quem saiu do feed morre pelo TTL de 72h abaixo.
      const stillActive = await db.getActiveCoupons();
      let dropped = 0;
      let refreshed = 0;
      for (const c of stillActive) {
        // Reaplica o filtro de público-alvo nos que já estavam ativos: quando o filtro
        // fica mais estrito, cupom fora de escopo aprovado antes continuaria ativo (e
        // visível no site) pra sempre, porque o laço acima só olha o que veio no scrape.
        if (!isRelevantForAudience(c)) {
          await db.updateCouponStatus(c.id, false);
          dropped++;
          continue;
        }
        if (seenNow.has(c.id)) {
          await db.updateCouponStatus(c.id, true);   // renova last_checked, adiando o TTL
          refreshed++;
        }
      }
      if (dropped > 0) logger.info(`[Cupons] ${dropped} desativado(s) (fora do público-alvo pelo filtro atual).`);
      if (refreshed > 0) logger.info(`[Cupons] ${refreshed} renovado(s) (ainda no feed do canal).`);

      // Validade máxima: cupom que saiu do feed do canal (ou canal fora do ar) expira em
      // 72h sem renovação, em vez de ficar preso ativo pra sempre. Com fonte única, esse
      // TTL é o principal mecanismo de expiração.
      const stale = await db.deactivateStaleCoupons(72);
      if (stale.changes > 0) logger.info(`[Cupons] ${stale.changes} desativado(s) por TTL (72h sem renovação).`);

      if (newCoupons.length > 0) {
        // Envio separado por loja — um cupom Shopee jamais deve sair com marca/link do ML
        // (e vice-versa). A detecção de loja acontece na origem, em couponListener.js.
        const mlNew = newCoupons.filter(c => c.store !== 'shopee');
        const shopeeNew = newCoupons.filter(c => c.store === 'shopee');

        if (mlNew.length > 0) {
          const genericLink = await mlService.buildAffiliateLink('https://www.mercadolivre.com.br/ofertas')
            .catch(() => null) || 'https://www.mercadolivre.com.br/cupons';
          telegramService.enqueueCouponBatch(mlNew, genericLink, 'ml');
          whatsappService.enqueueCouponBatch(mlNew, genericLink, 'ml');
        }
        if (shopeeNew.length > 0) {
          telegramService.enqueueCouponBatch(shopeeNew, 'https://shopee.com.br', 'shopee');
          whatsappService.enqueueCouponBatch(shopeeNew, 'https://shopee.com.br', 'shopee');
        }
      }

      logger.info(`[Cupons] ${newCoupons.length} novo(s) enviado(s).`);
    } catch (err) {
      logger.error('[Cupons] Erro:', err.message);
    } finally {
      setTimeout(() => this.runCouponCycle(), COUPON_INTERVAL_MS);
    }
  }

  // ─────────────────────────────────────────────
  // Ciclo Shopee — 75 min, lote de 5-7 espaçadas de 1-3 min (API oficial de afiliados)
  // ─────────────────────────────────────────────

  async runShopeeCycle() {
    if (!this.isRunning) return;
    if (!shopeeService.isEnabled) {
      setTimeout(() => this.runShopeeCycle(), SHOPEE_INTERVAL_MS);
      return;
    }
    const espera = await this._faltaPara('last_shopee_cycle', intervaloVigente(SHOPEE_INTERVAL_MS));
    if (espera > 0) {
      logger.info(`[Shopee] Ciclo recente — próximo em ${Math.round(espera / 60000)} min.`);
      setTimeout(() => this.runShopeeCycle(), espera);
      return;
    }
    try {
      await db.setConfig('last_shopee_cycle', String(Date.now()));
      // Gira a faixa de páginas a cada ciclo: sem isso a busca relê sempre o mesmo topo
      // do catálogo e, esgotadas as ofertas dele, o ciclo só encontra duplicata.
      const block = Number(await db.getConfig('shopee_page_block')) || 0;
      await db.setConfig('shopee_page_block', String((block + 1) % shopeeService.pageBlocks));
      const products = await shopeeService.getNicheProducts({ block });
      const sent = await this._processShopeeOffers(products, offersPerCycle());
      logger.info(`[Shopee] ${sent} novas enviadas.`);
      if (sent > 0) this._syncWebsite();
    } catch (err) {
      logger.error('[Shopee] Erro:', err.message);
    } finally {
      setTimeout(() => this.runShopeeCycle(), proximoDelay(SHOPEE_INTERVAL_MS));
    }
  }

  // Shopee já entrega link de afiliado pronto (offerLink) e desconto calculado —
  // dispensa a checagem de gênero (keywords de busca já são femininas) e a
  // montagem de link afiliado que o fluxo do ML precisa.
  async _processShopeeOffers(offers, maxPerCycle) {
    await this._registrarPrecos(offers);

    const newOffers = [];
    let semDesconto = 0, foraDeNicho = 0, jaPublicadas = 0;
    for (const offer of offers) {
      // Mesmo piso de desconto do ML: sem isto o ciclo publicava ofertas de 1-3% OFF,
      // que queimam a credibilidade do canal.
      if (!offer.discount || offer.discount < settings.minDiscount) { semDesconto++; continue; }
      // As keywords de busca são femininas, mas os resultados derivam (buscar 'airfryer'
      // devolve cesto e resistência avulsos da Philips). Aplica o mesmo filtro de nicho
      // do ML — sem `fromFeminineCategory`, já que aqui não há categoria confiável.
      if (!isFeminine(offer.title)) { foraDeNicho++; continue; }
      const dup = await db.isOfferProcessed(offer.id);
      if (dup) { jaPublicadas++; continue; }
      newOffers.push(offer);
    }
    logger.info(`[Shopee] ${offers.length} coletadas | ${semDesconto} abaixo de ${settings.minDiscount}% | ${foraDeNicho} fora de nicho | ${jaPublicadas} já publicadas | ${newOffers.length} candidatas`);

    const candidates = newOffers.sort((a, b) => b.discount - a.discount).slice(0, maxPerCycle);

    let sent = 0;
    for (const offer of candidates) {
      const saved = await db.saveOffer(offer);
      if (!saved) continue;
      await this._anexarMenorPreco(offer);
      await telegramService.enqueueOffer(offer);
      instagramService.enqueueOffer(offer);
      whatsappService.enqueueOffer(offer);
      sent++;
      logger.info(`Nova oferta Shopee: ${offer.discount}% OFF | ${offer.title.substring(0, 50)}`);

      if (sent < maxPerCycle) {
        await new Promise(r => setTimeout(r, spacingDelay()));
      }
    }
    return sent;
  }

  // ─────────────────────────────────────────────
  // Processamento comum de ofertas
  // ─────────────────────────────────────────────

  async _processOffers(offers, maxPerCycle, fetchTimer, spreadSends = false) {
    // Registra o preco de TODA oferta vista, inclusive as ja publicadas antes: o valor
    // do historico esta justamente em acompanhar o produto conhecido ao longo do tempo.
    await this._registrarPrecos(offers);

    const newOffers = [];
    for (const offer of offers) {
      const dup = await db.isOfferProcessed(offer.id) || await db.isOfferUrlProcessed(offer.link);
      if (!dup) newOffers.push(offer);
    }

    if (newOffers.length === 0) return 0;

    // Ordena por desconto com bônus pela categoria-fonte (ver utils/offerRanking).
    // A versão anterior reservava metade das vagas pra moda e ordenava por categoria
    // antes do desconto — o que na prática reservava quase 100% das vagas, já que as 5
    // URLs de categoria cobrem quase todo o catálogo, e fez uma oferta de 21% sair na
    // frente de uma de 57%. Com o peso aditivo, moda segue na frente em disputa
    // parelha, mas um desconto muito melhor de outro nicho passa.
    // Mantém 3x o limite para compensar os descartes por gênero e por link de afiliado.
    const candidates = ordenarCandidatas(newOffers).slice(0, maxPerCycle * 3);

    let sent = 0;
    // Geracao de link de afiliado e o ponto unico de falha do fluxo do ML: depende de
    // uma sessao de navegador salva que expira em silencio. Contamos para alertar.
    let linkTentativas = 0, linkFalhas = 0;

    for (const offer of candidates) {
      if (sent >= maxPerCycle) break;

      // Verifica gênero na página do produto — descarta masculinos
      const isMasculine = await mlService.checkProductIsMasculine(offer.link);
      if (isMasculine) {
        logger.info(`Descartado (masculino): ${offer.title.substring(0, 60)}`);
        continue;
      }

      if (fetchTimer) {
        offer.timer = await mlService.getFlashTimer(offer.link).catch(() => null);
      }

      const originalLink = offer.link;
      linkTentativas++;
      const meluUrl = await mlService.buildAffiliateLink(offer.link);
      if (!meluUrl) {
        linkFalhas++;
        logger.warn(`Sem link afiliado (próx. ciclo): ${offer.title.substring(0, 50)}`);
        continue;
      }

      offer.originalLink = originalLink;
      offer.link = meluUrl;

      const saved = await db.saveOffer(offer);
      if (!saved) continue;
      await this._anexarMenorPreco(offer);
      await telegramService.enqueueOffer(offer);
      instagramService.enqueueOffer(offer);   // Caminho A: espelha as melhores no Instagram
      whatsappService.enqueueOffer(offer);    // Espelha no grupo do WhatsApp
      sent++;

      logger.info(`Nova oferta: ${offer.discount}% OFF | ${offer.category} | ${offer.title.substring(0, 50)}`);

      if (spreadSends && sent < maxPerCycle) {
        await new Promise(r => setTimeout(r, spacingDelay()));
      }
    }

    await this._checarSaudeDoAfiliado(linkTentativas, linkFalhas);
    return sent;
  }

  // Alerta quando a geracao de link de afiliado para de funcionar. Sem isto o canal
  // simplesmente seca: o bot segue "online", raspando e filtrando normalmente, mas
  // descartando toda oferta na ultima etapa.
  async _checarSaudeDoAfiliado(tentativas, falhas) {
    try {
      const CHAVE = 'afiliado_ml';
      const ultimo = await alertService.ultimoAlerta(CHAVE);
      const decisao = avaliarFalhaAfiliado({ tentativas, falhas }, ultimo);
      if (!decisao.alertar) return;

      const pct = Math.round(decisao.proporcao * 100);
      await alertService.enviar(CHAVE, 'Link de afiliado do ML falhando', [
        `Falharam <b>${falhas} de ${tentativas}</b> tentativas (${pct}%) no último ciclo.`,
        '',
        'Causa mais provável: a sessão salva do portal de afiliados expirou.',
        'Correção: rodar <code>npm run save-session</code> na VPS e reiniciar o bot.',
        '',
        'Enquanto isso o canal não publica ofertas do Mercado Livre.',
      ]);
    } catch (err) {
      logger.debug(`[Alerta] Falha ao avaliar saúde do afiliado: ${err.message}`);
    }
  }

  // Alimenta o historico de preco. recordPrice so grava quando o valor muda, entao
  // rodar isso sobre centenas de ofertas por ciclo custa leitura, nao escrita.
  async _registrarPrecos(offers) {
    let mudancas = 0;
    for (const offer of offers) {
      try {
        if (await db.recordPrice(offer.id, offer.price)) mudancas++;
      } catch (err) {
        logger.debug(`[Historico] Falha ao gravar preco de ${offer.id}: ${err.message}`);
      }
    }
    if (mudancas > 0) logger.info(`[Historico] ${mudancas} mudanca(s) de preco em ${offers.length} observadas.`);
  }

  // Anexa o selo de menor preco as ofertas que forem publicadas. Fica fora do
  // _registrarPrecos porque so vale a pena consultar para as que vao ao ar.
  async _anexarMenorPreco(offer) {
    try {
      const stats = await db.getPriceStats(offer.id, JANELA_DIAS);
      offer.menorPreco = avaliarMenorPreco(stats, offer.price);
      if (offer.menorPreco) {
        logger.info(`[Historico] Menor preco em ${offer.menorPreco.dias} dias: ${offer.title.substring(0, 45)}`);
      }
    } catch (err) {
      offer.menorPreco = null;
      logger.debug(`[Historico] Falha ao avaliar menor preco: ${err.message}`);
    }
  }

  // Quanto falta pro ciclo poder rodar de novo (0 = pode agora). O timestamp do último
  // ciclo fica na tabela config, então sobrevive a restart: sem isso todo `pm2 restart`
  // disparava um lote extra na hora — num dia de vários deploys o grupo levava rajada
  // atrás de rajada. Não se aplica ao relâmpago, que deve mesmo sair assim que achado.
  async _faltaPara(chave, intervalo) {
    const ultimo = parseInt(await db.getConfig(chave) || '0', 10);
    if (!ultimo) return 0;
    const decorrido = Date.now() - ultimo;
    return decorrido >= intervalo ? 0 : intervalo - decorrido;
  }

  _syncWebsite() {
    if (!WEBSITE_SYNC_CMD) return;   // sync desligado (rodando local sem servidor do site)
    exec(WEBSITE_SYNC_CMD, (err) => {
      if (err) logger.warn('[Sync] Falha ao sincronizar SQLite com website:', err.message);
      else logger.info('[Sync] SQLite sincronizado com o website.');
    });
  }

  stop() {
    this.isRunning = false;
    logger.info('Bot encerrando...');
  }
}

const app = new BotApp();
app.start();

process.on('SIGINT',  () => { app.stop(); process.exit(0); });
process.on('SIGTERM', () => { app.stop(); process.exit(0); });
process.on('uncaughtException',  (e) => { logger.error('Exceção:', e.message); process.exit(1); });
process.on('unhandledRejection', (r)  => { logger.error('Promise rejeitada:', r); });

#!/usr/bin/env node

/**
 * Bot profissional de ofertas do Mercado Livre para Telegram
 * Versão 2.0 - Refatorada para produção
 * @module index
 */

const cron = require('node-cron');
const logger = require('./utils/logger');
const config = require('./config/env');
const database = require('./repositories/database');
const telegramService = require('./services/telegramService');
const mercadoLivreService = require('./services/mercadoLivreService');

/**
 * Estado global do bot
 */
const state = {
  isRunning: false,
  metrics: {
    offersChecked: 0,
    offersSent: 0,
    couponsChecked: 0,
    couponsSent: 0,
    errors: 0,
  },
};

/**
 * Inicializa o bot
 */
async function init() {
  try {
    logger.info('🚀 Iniciando bot de ofertas', {
      environment: config.NODE_ENV,
      channel: config.TELEGRAM_CHANNEL_ID,
    });

    // Inicializar banco de dados
    database.init();

    // Inicializar Telegram
    telegramService.init();

    // Inicializar tarefas agendadas
    initSchedules();

    state.isRunning = true;
    logger.info('✅ Bot iniciado com sucesso');
  } catch (error) {
    logger.error('❌ Erro ao iniciar bot', error);
    process.exit(1);
  }
}

/**
 * Inicializa as tarefas agendadas
 */
function initSchedules() {
  logger.info('Configurando tarefas agendadas', {
    offersInterval: config.CHECK_OFFERS_INTERVAL,
    couponsInterval: config.CHECK_COUPONS_INTERVAL,
  });

  // Tarefa de monitoramento de ofertas
  cron.schedule(config.CHECK_OFFERS_INTERVAL, async () => {
    try {
      await monitorOffers();
    } catch (error) {
      logger.error('Erro na tarefa de monitoramento de ofertas', error);
      state.metrics.errors++;
    }
  });

  // Tarefa de monitoramento de cupons
  cron.schedule(config.CHECK_COUPONS_INTERVAL, async () => {
    try {
      await monitorCoupons();
    } catch (error) {
      logger.error('Erro na tarefa de monitoramento de cupons', error);
      state.metrics.errors++;
    }
  });

  logger.info('✅ Tarefas agendadas configuradas');
}

/**
 * Monitora ofertas do Mercado Livre
 */
async function monitorOffers() {
  try {
    logger.debug('Iniciando monitoramento de ofertas');
    state.metrics.offersChecked++;

    const offers = await mercadoLivreService.searchDiscountedOffers(config.SEARCH_QUERY, config.SEARCH_LIMIT);

    if (offers.length === 0) {
      logger.warn('Nenhuma oferta encontrada');
      return;
    }

    logger.info('Ofertas encontradas', { count: offers.length });

    for (const offer of offers) {
      // Verificar se já foi enviada
      if (database.offerExists(offer.hash)) {
        logger.debug('Oferta já foi enviada', { hash: offer.hash });
        continue;
      }

      // Enviar para Telegram
      const sent = await telegramService.sendOfferMessage(offer);

      if (sent) {
        // Adicionar ao histórico
        database.addOfferToHistory(offer);
        state.metrics.offersSent++;
        database.incrementMetric('offers_sent');
      } else {
        state.metrics.errors++;
        database.incrementMetric('errors_count');
      }
    }

    logger.info('Monitoramento de ofertas concluído', {
      checked: offers.length,
      sent: state.metrics.offersSent,
    });
  } catch (error) {
    logger.error('Erro ao monitorar ofertas', error);
    state.metrics.errors++;
  }
}

/**
 * Monitora cupons do Mercado Livre
 */
async function monitorCoupons() {
  try {
    logger.debug('Iniciando monitoramento de cupons');
    state.metrics.couponsChecked++;

    const coupons = await mercadoLivreService.getActiveCoupons();

    if (coupons.length === 0) {
      logger.warn('Nenhum cupom encontrado');
      return;
    }

    logger.info('Cupons encontrados', { count: coupons.length });

    for (const coupon of coupons) {
      // Verificar se já foi enviado
      if (database.couponExists(coupon.code)) {
        logger.debug('Cupom já foi enviado', { code: coupon.code });
        continue;
      }

      // Enviar para Telegram
      const sent = await telegramService.sendCouponMessage(coupon);

      if (sent) {
        // Adicionar ao histórico
        database.addCouponToHistory(coupon);
        state.metrics.couponsSent++;
        database.incrementMetric('coupons_sent');
      } else {
        state.metrics.errors++;
        database.incrementMetric('errors_count');
      }
    }

    logger.info('Monitoramento de cupons concluído', {
      checked: coupons.length,
      sent: state.metrics.couponsSent,
    });
  } catch (error) {
    logger.error('Erro ao monitorar cupons', error);
    state.metrics.errors++;
  }
}

/**
 * Exibe métricas do bot
 */
function showMetrics() {
  const metrics = database.getMetrics();
  logger.info('📊 Métricas do Bot', {
    ...state.metrics,
    ...metrics,
  });
}

/**
 * Trata sinais de encerramento
 */
function setupGracefulShutdown() {
  const signals = ['SIGINT', 'SIGTERM'];

  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.info(`📋 Recebido sinal ${signal}, encerrando gracefully...`);
      showMetrics();
      database.close();
      process.exit(0);
    });
  });
}

/**
 * Inicia o bot
 */
async function start() {
  try {
    await init();
    setupGracefulShutdown();

    // Executar uma verificação imediata
    await monitorOffers();
    await monitorCoupons();

    logger.info('🎯 Bot aguardando próximas tarefas agendadas...');
  } catch (error) {
    logger.error('Erro fatal ao iniciar bot', error);
    process.exit(1);
  }
}

// Iniciar o bot
start();

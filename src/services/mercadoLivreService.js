/**
 * Serviço de integração com Mercado Livre
 * @module services/mercadoLivreService
 */

const axios = require('axios');
const axiosRetry = require('axios-retry');
const logger = require('../utils/logger');
const { generateOfferHash } = require('../utils/hash');
const config = require('../config/env');

// Configurar retry automático
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
           (error.response && error.response.status >= 500);
  },
});

const ML_API_URL = 'https://api.mercadolibre.com';

/**
 * Cache em memória para evitar requisições repetidas
 */
const cache = {
  offers: new Map(),
  coupons: new Map(),
  ttl: 5 * 60 * 1000, // 5 minutos
};

/**
 * Busca ofertas do Mercado Livre via API oficial
 * @param {string} query - Termo de busca
 * @param {number} limit - Limite de resultados
 * @returns {Promise<Array>} Array de ofertas
 */
async function searchDiscountedOffers(query = 'eletrônicos', limit = 20) {
  try {
    logger.info('Buscando ofertas no Mercado Livre', { query, limit });

    // Verificar cache
    const cacheKey = `${query}:${limit}`;
    const cached = cache.offers.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cache.ttl) {
      logger.debug('Retornando ofertas do cache', { cacheKey });
      return cached.data;
    }

    // Construir headers com autenticação se disponível
    const headers = {};
    if (config.MERCADO_LIVRE_ACCESS_TOKEN) {
      headers['Authorization'] = `Bearer ${config.MERCADO_LIVRE_ACCESS_TOKEN}`;
    }

    // Chamar API oficial do Mercado Livre
    const url = `${ML_API_URL}/sites/MLB/search`;
    const response = await axios.get(url, {
      params: {
        q: query,
        sort: 'price_desc',
        limit: Math.min(limit, 50), // ML limita a 50
      },
      headers,
      timeout: 10000,
    });

    const offers = [];
    const results = response.data.results || [];

    for (const product of results) {
      try {
        const originalPrice = product.original_price || product.price;
        const price = product.price;
        const discountPercentage = originalPrice > 0
          ? Math.round(((originalPrice - price) / originalPrice) * 100)
          : 0;

        // Aplicar filtros
        if (discountPercentage < config.MIN_DISCOUNT) continue;
        if (price < config.MIN_PRICE || price > config.MAX_PRICE) continue;

        const hash = generateOfferHash(product.title, price, product.seller.id);
        const affiliateLink = generateAffiliateLink(product.permalink);

        offers.push({
          mlProductId: product.id,
          title: product.title,
          price,
          originalPrice,
          discountPercentage,
          link: product.permalink,
          affiliateLink,
          sellerId: product.seller.id,
          sellerName: product.seller.nickname || 'Desconhecido',
          hash,
          imageUrl: product.thumbnail,
        });

        if (offers.length >= limit) break;
      } catch (error) {
        logger.debug('Erro ao processar produto', error);
      }
    }

    // Armazenar em cache
    cache.offers.set(cacheKey, { data: offers, timestamp: Date.now() });

    logger.info('Ofertas encontradas', { count: offers.length });
    return offers;
  } catch (error) {
    logger.error('Erro ao buscar ofertas', error, { query });
    return [];
  }
}

/**
 * Gera link de afiliado
 * @param {string} productLink - Link do produto
 * @returns {string} Link com código de afiliado
 */
function generateAffiliateLink(productLink) {
  if (!productLink) return '';

  try {
    const url = new URL(productLink);
    url.searchParams.set('matt_tool', config.MERCADO_LIVRE_AFFILIATE_CODE);
    return url.toString();
  } catch (error) {
    logger.debug('Erro ao gerar link de afiliado', error);
    return productLink;
  }
}

/**
 * Busca cupons ativos via API do Mercado Livre
 * @returns {Promise<Array>} Array de cupons
 */
async function getActiveCoupons() {
  try {
    logger.info('Buscando cupons ativos');

    // Verificar cache
    const cached = cache.coupons.get('active');
    if (cached && Date.now() - cached.timestamp < cache.ttl) {
      logger.debug('Retornando cupons do cache');
      return cached.data;
    }

    // Se não houver token, retornar vazio
    if (!config.MERCADO_LIVRE_ACCESS_TOKEN) {
      logger.warn('Cupons não disponíveis sem access token válido');
      return [];
    }

    // Chamar API de cupons
    const url = `${ML_API_URL}/coupons`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${config.MERCADO_LIVRE_ACCESS_TOKEN}`,
      },
      timeout: 10000,
    });

    const coupons = [];
    const results = response.data.coupons || [];

    for (const coupon of results) {
      try {
        const endDate = new Date(coupon.end_date);
        const daysLeft = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));

        // Só incluir cupons ainda válidos
        if (daysLeft <= 0) continue;

        coupons.push({
          code: coupon.code,
          discountPercentage: coupon.discount_percentage || 0,
          discountValue: coupon.discount_value || 0,
          endDate: coupon.end_date,
          daysLeft,
        });
      } catch (error) {
        logger.debug('Erro ao processar cupom', error);
      }
    }

    // Armazenar em cache
    cache.coupons.set('active', { data: coupons, timestamp: Date.now() });

    logger.info('Cupons encontrados', { count: coupons.length });
    return coupons;
  } catch (error) {
    logger.error('Erro ao buscar cupons', error);
    // Nunca retornar cupons fictícios
    return [];
  }
}

/**
 * Limpa o cache
 */
function clearCache() {
  cache.offers.clear();
  cache.coupons.clear();
  logger.debug('Cache limpo');
}

module.exports = {
  searchDiscountedOffers,
  generateAffiliateLink,
  getActiveCoupons,
  clearCache,
};

const crypto = require('crypto');
const axios = require('axios');
const { shopee } = require('../config/env');
const logger = require('../utils/logger');

const GRAPHQL_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

// Palavras-chave de busca — reaproveita o nicho feminino já validado no ML.
// Ponto de partida enxuto; ajustar/expandir depois de ver resultados reais da API
// (a Shopee tem catálogo e categorização diferentes do ML).
const NICHE_KEYWORDS = [
  'vestido feminino', 'blusa feminina', 'conjunto feminino',
  'tênis feminino', 'sandália feminina', 'bolsa feminina',
  'maquiagem', 'skincare', 'perfume feminino',
  'chapinha', 'secador de cabelo',
  'panela', 'airfryer', 'organizador',
];

class ShopeeService {
  constructor() {
    this.appId = shopee.appId;
    this.secret = shopee.secret;

    if (!this.appId || !this.secret) {
      logger.warn('Shopee desativada: SHOPEE_APP_ID/SHOPEE_SECRET não configurados no .env.');
    }
  }

  get isEnabled() {
    return !!(this.appId && this.secret);
  }

  // ─────────────────────────────────────────────
  // Autenticação — SHA256(AppId + Timestamp + Payload + Secret)
  // ─────────────────────────────────────────────

  _authHeader(payload) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHash('sha256')
      .update(`${this.appId}${timestamp}${payload}${this.secret}`)
      .digest('hex');
    return `SHA256 Credential=${this.appId}, Timestamp=${timestamp}, Signature=${signature}`;
  }

  async _request(query, variables = {}) {
    if (!this.isEnabled) return null;

    const body = JSON.stringify({ query, variables });
    try {
      const response = await axios.post(GRAPHQL_URL, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: this._authHeader(body),
        },
        timeout: 15000,
      });

      if (response.data?.errors?.length) {
        const err = response.data.errors[0];
        // Código 10030 = rate limit — quem chamou decide se tenta de novo mais tarde
        logger.warn(`[Shopee] Erro GraphQL (${err.extensions?.code || '?'}): ${err.message}`);
        return null;
      }

      return response.data?.data || null;
    } catch (err) {
      logger.error(`[Shopee] Falha na requisição: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // Campanhas oficiais Shopee (sazonais, relâmpago) — equivalente a "ofertas do dia"
  // ─────────────────────────────────────────────

  async getOffers({ keyword = '', page = 1, limit = 20 } = {}) {
    const query = `
      query ShopeeOffers($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
        shopeeOfferV2(keyword: $keyword, sortType: $sortType, page: $page, limit: $limit) {
          nodes {
            commissionRate
            imageUrl
            offerLink
            originalLink
            offerName
            offerType
            categoryId
            periodStartTime
            periodEndTime
          }
          pageInfo { page limit hasNextPage }
        }
      }
    `;
    const data = await this._request(query, { keyword, sortType: 1, page, limit });
    const nodes = data?.shopeeOfferV2?.nodes || [];
    return nodes.map(n => this._mapCampaignOffer(n));
  }

  // ─────────────────────────────────────────────
  // Produtos por palavra-chave — equivalente ao scraping por categoria do ML
  // ─────────────────────────────────────────────

  async getProducts(keyword, { page = 1, limit = 20 } = {}) {
    const query = `
      query ShopeeProducts($keyword: String, $listType: Int, $sortType: Int, $page: Int, $limit: Int) {
        productOfferV2(keyword: $keyword, listType: $listType, sortType: $sortType, page: $page, limit: $limit) {
          nodes {
            itemId
            productName
            productLink
            offerLink
            imageUrl
            priceMin
            priceMax
            priceDiscountRate
            commissionRate
            commission
            shopName
            periodStartTime
            periodEndTime
          }
          pageInfo { page limit hasNextPage }
        }
      }
    `;
    // listType/sortType: valores conforme doc (1 = mais recente); ajustar após teste real
    const data = await this._request(query, { keyword, listType: 1, sortType: 5, page, limit });
    const nodes = data?.productOfferV2?.nodes || [];
    return nodes.map(n => this._mapProductOffer(n));
  }

  // Varre as keywords de nicho feminino e agrega, deduplicando por itemId
  async getNicheProducts() {
    const seen = new Set();
    const all = [];
    for (const keyword of NICHE_KEYWORDS) {
      const products = await this.getProducts(keyword).catch(() => []);
      for (const p of products) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        all.push(p);
      }
      await new Promise(r => setTimeout(r, 500)); // respeita rate limit entre buscas
    }
    return all;
  }

  // ─────────────────────────────────────────────
  // Link de afiliado — só necessário quando já não vier em offerLink
  // ─────────────────────────────────────────────

  async buildAffiliateLink(url, subIds = ['ofertadelas']) {
    const query = `
      mutation GenerateShortLink($input: ShortLinkInput!) {
        generateShortLink(input: $input) { shortLink }
      }
    `;
    const data = await this._request(query, { input: { originUrl: url, subIds } });
    return data?.generateShortLink?.shortLink || null;
  }

  // ─────────────────────────────────────────────
  // Mapeamento pro formato comum usado em _processOffers (index.js)
  // ─────────────────────────────────────────────

  _mapProductOffer(n) {
    const price = parseFloat(n.priceMin) || 0;
    const priceMax = parseFloat(n.priceMax) || price;
    const discount = Math.round(parseFloat(n.priceDiscountRate) || 0);
    return {
      id: `SHOPEE-${n.itemId}`,
      title: n.productName,
      price,
      originalPrice: priceMax > price ? priceMax : price,
      discount,
      link: n.offerLink || n.productLink,
      image: n.imageUrl,
      category: '',
      emoji: '🛍️',
      isFlash: false,
    };
  }

  _mapCampaignOffer(n) {
    return {
      id: `SHOPEE-CAMP-${crypto.createHash('md5').update(n.offerLink || n.offerName).digest('hex').substring(0, 12)}`,
      title: n.offerName,
      price: 0,
      originalPrice: 0,
      discount: 0,
      link: n.offerLink || n.originalLink,
      image: n.imageUrl,
      category: '',
      emoji: '🛍️',
      isFlash: n.offerType === 2,
    };
  }
}

module.exports = new ShopeeService();

const axios  = require('axios');
const logger = require('../utils/logger');
const { settings } = require('../config/env');

const IG_BASE     = 'https://graph.instagram.com/v21.0';
const IG_USER_ID  = settings.instagram && settings.instagram.userId;
const IG_TOKEN    = settings.instagram && settings.instagram.token;

// ── Parâmetros que você ajusta ────────────────────────────────
const MIN_DISCOUNT_TO_POST = 35;          // só vai pro IG oferta >= 35% OFF
const MAX_IG_POSTS_PER_DAY = 6;           // teto diário no feed (limite da API é 50, mas 6 é saudável)
const POST_SPACING_MS      = 120 * 1000;  // 2 min entre posts, pra não floodar o feed
// ──────────────────────────────────────────────────────────────

class InstagramService {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.postsToday = 0;
    this.dayKey = this._todayKey();
  }

  _todayKey() {
    return new Date().toISOString().slice(0, 10); // AAAA-MM-DD (UTC)
  }

  _rollDayIfNeeded() {
    const k = this._todayKey();
    if (k !== this.dayKey) {
      this.dayKey = k;
      this.postsToday = 0;
      logger.info('[IG] Novo dia — contador de posts zerado.');
    }
  }

  enqueueOffer(offer) {
    if (!IG_TOKEN || !IG_USER_ID) {
      logger.warn('[IG] Token ou User ID ausente no .env — espelhamento desativado.');
      return;
    }
    this._rollDayIfNeeded();

    const discount = Number(offer.discount) || 0;
    if (discount < MIN_DISCOUNT_TO_POST) return;

    if (this.postsToday >= MAX_IG_POSTS_PER_DAY) {
      logger.info(`[IG] Teto diário (${MAX_IG_POSTS_PER_DAY}) atingido. Pulando: ${(offer.title||'').slice(0,40)}`);
      return;
    }

    this.queue.push(offer);
    this._drain();
  }

  async _drain() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length) {
      this._rollDayIfNeeded();
      if (this.postsToday >= MAX_IG_POSTS_PER_DAY) { this.queue = []; break; }

      const offer = this.queue.shift();
      try {
        await this._publish(offer);
        this.postsToday++;
        logger.info(`[IG] Publicado (${this.postsToday}/${MAX_IG_POSTS_PER_DAY}): ${(offer.title||'').slice(0,50)}`);
        if (this.queue.length) await this._sleep(POST_SPACING_MS);
      } catch (err) {
        const msg = err.response && err.response.data && err.response.data.error
          ? err.response.data.error.message
          : err.message;
        logger.error(`[IG] Falha ao publicar "${(offer.title||'').slice(0,40)}": ${msg}`);
      }
    }

    this.processing = false;
  }

  async _publish(offer) {
    const imageUrl = this._imageUrl(offer);
    if (!imageUrl) throw new Error('sem imagem válida');

    const caption = this._buildCaption(offer);

    // Passo 1 — cria o container de mídia
    const create = await axios.post(`${IG_BASE}/${IG_USER_ID}/media`, null, {
      params: { image_url: imageUrl, caption, access_token: IG_TOKEN },
      timeout: 30000,
    });
    const creationId = create.data && create.data.id;
    if (!creationId) throw new Error('container sem id');

    // IG precisa baixar a imagem antes de publicar
    await this._sleep(4000);

    // Passo 2 — publica o container
    await axios.post(`${IG_BASE}/${IG_USER_ID}/media_publish`, null, {
      params: { creation_id: creationId, access_token: IG_TOKEN },
      timeout: 30000,
    });
  }

  _imageUrl(offer) {
    let url = offer.image || offer.imageUrl || offer.thumbnail || offer.picture || offer.pictureUrl;
    if (!url) return null;
    // ML thumb pequeno (ex.: -I.jpg) → pede versão grande (-O.jpg) e força https
    url = String(url).replace(/^http:\/\//, 'https://').replace(/-[A-Z]\.jpg/, '-O.jpg');
    return url;
  }

  _fmt(v) {
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toFixed(2).replace('.', ',');
  }

  _buildCaption(offer) {
    const price = offer.price || offer.newPrice || offer.salePrice;
    const old   = offer.originalPrice || offer.oldPrice || offer.fullPrice;

    const L = [];
    L.push(`🔥 ${offer.title}`);
    L.push('');
    // Só mostra o "De:" quando ele é de fato maior — evita "De R$ X / Por R$ X"
    if (old && old > price) L.push(`❌ De: R$ ${this._fmt(old)}`);
    if (price) L.push(`✅ Por: R$ ${this._fmt(price)}`);
    if (offer.discount) L.push(`📉 ${offer.discount}% OFF`);
    if (offer.timer)    L.push(`⏰ Oferta relâmpago — corre!`);
    L.push('');
    L.push('🛒 Pega a sua pelo link na BIO 👉 @ofertadelas.promo');
    L.push('🌐 ofertadelas.com.br');
    if (offer.link) { L.push(''); L.push(`🔗 ${offer.link}`); }
    L.push('');
    L.push(this._hashtags(offer.category));

    return L.join('\n').slice(0, 2200);
  }

  _hashtags(category) {
    const base = ['#promocao', '#oferta', '#desconto', '#achadinhos', '#promo', '#ofertadodia'];
    const byCat = {
      'moda':       ['#moda', '#modafeminina', '#look', '#estilo'],
      'calçados':   ['#calcados', '#sapatos', '#tenis', '#modafeminina'],
      'beleza':     ['#beleza', '#skincare', '#maquiagem', '#autocuidado'],
      'esportes':   ['#fitness', '#esportes', '#academia', '#treino'],
      'acessórios': ['#acessorios', '#bolsas', '#oculos', '#estilo'],
      'joias':      ['#joias', '#semijoias', '#acessorios', '#brincos'],
    };
    const extra = byCat[(category || '').toLowerCase()] || ['#modafeminina'];
    return [...base, ...extra].slice(0, 15).join(' ');
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Opcional: renova o token de longa duração (rode 1x/mês via cron)
  async refreshToken() {
    try {
      const res = await axios.get(`${IG_BASE.replace('/v21.0','')}/refresh_access_token`, {
        params: { grant_type: 'ig_refresh_token', access_token: IG_TOKEN },
        timeout: 20000,
      });
      logger.info(`[IG] Token renovado. Expira em ~${Math.round((res.data.expires_in||0)/86400)} dias.`);
      return res.data.access_token;
    } catch (err) {
      logger.error('[IG] Falha ao renovar token:', err.message);
      return null;
    }
  }
}

module.exports = new InstagramService();

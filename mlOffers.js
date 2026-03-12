const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const crypto = require('crypto');
const MLAuth = require('./mlAuth');

class MLOffers {
    constructor(configPath) {
        this.configPath = configPath;
        this.auth = new MLAuth(configPath);
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    generateUniqueId(title, price) {
        // Cria um hash único baseado no título e no preço para evitar duplicatas mesmo se o link mudar
        const data = `${title}-${price}`;
        return crypto.createHash('md5').update(data).digest('hex');
    }

    async getOffers() {
        const url = "https://www.mercadolivre.com.br/ofertas";
        const headers = { 'User-Agent': this.getRandomUserAgent() };

        try {
            const response = await axios.get(url, { headers, timeout: 10000 });
            const $ = cheerio.load(response.data);
            const offers = [];

            $('.poly-card').each((i, el) => {
                try {
                    const card = $(el);
                    
                    // Título e Link
                    const titleEl = card.find('a.poly-component__title');
                    const title = titleEl.text().trim();
                    let link = titleEl.attr('href');
                    if (link && link.includes('?')) link = link.split('?')[0];

                    // Preços
                    const currentPriceEl = card.find('.poly-price__current .andes-money-amount__fraction');
                    const currentPrice = parseFloat(currentPriceEl.text().replace('.', '')) || 0;

                    const oldPriceEl = card.find('.andes-money-amount--previous .andes-money-amount__fraction');
                    const originalPrice = parseFloat(oldPriceEl.text().replace('.', '')) || currentPrice;

                    const discountEl = card.find('.poly-price__discount, .andes-money-amount__discount');
                    let discountPercentage = parseInt(discountEl.text().replace(/[^0-9]/g, '')) || 0;

                    if (discountPercentage === 0 && originalPrice > currentPrice) {
                        discountPercentage = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
                    }

                    // Imagem
                    const imgEl = card.find('img[data-testid="picture"], img[is="n-img"], img.poly-component__picture').first();
                    let imageUrl = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('srcset');
                    if (imageUrl && imageUrl.includes(',')) {
                        imageUrl = imageUrl.split(',').pop().trim().split(' ')[0];
                    }
                    if (imageUrl && imageUrl.startsWith('//')) {
                        imageUrl = 'https:' + imageUrl;
                    }

                    // Cupons
                    let coupon = "";
                    const couponHighlight = card.find('.poly-component__highlight');
                    const highlightText = couponHighlight.text().trim();
                    
                    if (highlightText.toLowerCase().includes('cupom')) {
                        const match = highlightText.match(/(R\$\s*\d+|\d+%)(\s*OFF)?/i);
                        if (match) {
                            coupon = match[0].trim();
                        }
                    }

                    if (title && link && currentPrice > 0) {
                        // ID Único Blindado
                        const id = this.generateUniqueId(title, currentPrice);
                        
                        // Gera link de afiliado
                        const affiliateConfig = this.auth.config.affiliate;
                        const affiliateLink = `${link}?matt_tool=${affiliateConfig.matt_tool}&matt_word=${affiliateConfig.matt_word}&ref=${encodeURIComponent(affiliateConfig.ref)}&forceInApp=true`;

                        offers.push({
                            id,
                            title,
                            link: affiliateLink,
                            current_price: currentPrice,
                            original_price: originalPrice,
                            discount_percentage: discountPercentage,
                            image: imageUrl,
                            coupon: coupon
                        });
                    }
                } catch (e) {
                    console.error("Erro ao processar card:", e.message);
                }
            });

            return offers;
        } catch (error) {
            console.error("Erro ao buscar ofertas:", error.message);
            return [];
        }
    }
}

module.exports = MLOffers;

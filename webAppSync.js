const axios = require('axios');
const fs = require('fs-extra');

/**
 * Módulo para sincronizar ofertas com o web app (JP Promos)
 * Envia as ofertas para o backend tRPC para serem armazenadas no banco de dados
 */
class WebAppSync {
    constructor(configPath, webAppConfig = {}) {
        this.config = fs.readJsonSync(configPath);
        this.webAppUrl = webAppConfig.url || process.env.WEB_APP_URL || 'http://localhost:3000';
        this.apiKey = webAppConfig.apiKey || process.env.WEB_APP_API_KEY;
        this.enabled = webAppConfig.enabled !== false; // Ativado por padrão
        
        if (this.enabled) {
            console.log(`✅ Web App Sync ativado: ${this.webAppUrl}`);
        }
    }

    /**
     * Converte ofertas do formato do bot para o formato esperado pelo web app
     */
    formatOfferForWebApp(offer) {
        return {
            mlProductId: offer.id, // ID único do Mercado Livre (MD5 hash)
            title: offer.title,
            description: `Oferta com ${offer.discount_percentage}% de desconto`,
            imageUrl: offer.image,
            originalPrice: parseFloat(offer.original_price),
            currentPrice: parseFloat(offer.current_price),
            discountPercentage: offer.discount_percentage,
            productLink: offer.link.split('?')[0], // Remove parâmetros de afiliado
            affiliateLink: offer.link, // Link com parâmetros de afiliado
            category: 'Geral', // Categoria padrão - pode ser extraída do Mercado Livre depois
            coupon: offer.coupon || null,
        };
    }

    /**
     * Sincroniza ofertas com o web app via tRPC
     */
    async syncOffers(offers) {
        if (!this.enabled) {
            console.log('⏭️  Web App Sync desativado');
            return { success: false, reason: 'disabled' };
        }

        if (!offers || offers.length === 0) {
            console.log('⏭️  Nenhuma oferta para sincronizar');
            return { success: true, synced: 0 };
        }

        try {
            const formattedOffers = offers.map(offer => this.formatOfferForWebApp(offer));

            // Envia para o endpoint tRPC do web app
            const response = await axios.post(
                `${this.webAppUrl}/api/trpc/offers.sync`,
                {
                    json: formattedOffers,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
                    },
                    timeout: 10000,
                }
            );

            if (response.data && response.data.result && response.data.result.data) {
                const result = response.data.result.data;
                console.log(`✅ Sincronização bem-sucedida: ${result.synced}/${result.total} ofertas`);
                return { success: true, ...result };
            }

            console.warn('⚠️  Resposta inesperada do web app:', response.data);
            return { success: false, reason: 'unexpected_response' };

        } catch (error) {
            console.error(`❌ Erro ao sincronizar com web app: ${error.message}`);
            
            // Log detalhado para debugging
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Data:', error.response.data);
            }

            return { 
                success: false, 
                reason: 'sync_error',
                error: error.message 
            };
        }
    }

    /**
     * Sincroniza cupons de uma oferta
     */
    async syncCoupon(offerId, couponCode, couponValue) {
        if (!this.enabled || !couponCode) return;

        try {
            await axios.post(
                `${this.webAppUrl}/api/trpc/coupons.sync`,
                {
                    json: {
                        offerId,
                        code: couponCode,
                        discountValue: couponValue,
                        status: 'active',
                    },
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
                    },
                    timeout: 5000,
                }
            );
        } catch (error) {
            console.warn(`⚠️  Erro ao sincronizar cupom: ${error.message}`);
        }
    }

    /**
     * Verifica se o web app está disponível
     */
    async healthCheck() {
        if (!this.enabled) return false;

        try {
            const response = await axios.get(`${this.webAppUrl}/api/health`, { timeout: 5000 });
            return response.status === 200;
        } catch (error) {
            console.warn(`⚠️  Web app indisponível: ${error.message}`);
            return false;
        }
    }
}

module.exports = WebAppSync;

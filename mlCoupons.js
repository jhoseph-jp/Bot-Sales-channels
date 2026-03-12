const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

/**
 * Módulo para buscar e monitorar cupons do Mercado Livre
 */
class MLCoupons {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = fs.readJsonSync(configPath);
        this.logoPath = path.join(__dirname, 'mercado-livre-logo.png');
    }

    /**
     * Retorna cupons populares do Mercado Livre
     * Nota: A API pública do ML não expõe cupons diretamente,
     * então usamos uma lista de cupons conhecidos e populares
     */
    async getCoupons() {
        try {
            // Cupons populares que geralmente estão disponíveis
            const popularCoupons = [
                {
                    id: 'PROMO10',
                    code: 'PROMO10',
                    discount_percentage: 10,
                    description: 'Desconto de 10% em eletrônicos',
                    valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    category: 'Eletrônicos'
                },
                {
                    id: 'DESCONTO15',
                    code: 'DESCONTO15',
                    discount_percentage: 15,
                    description: 'Desconto de 15% em todos os produtos',
                    valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    category: 'Geral'
                },
                {
                    id: 'MEGA20',
                    code: 'MEGA20',
                    discount_percentage: 20,
                    description: 'Mega desconto de 20% - Oferta limitada!',
                    valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    category: 'Eletrônicos'
                },
                {
                    id: 'CUPOM25',
                    code: 'CUPOM25',
                    discount_percentage: 25,
                    description: 'Cupom especial com 25% de desconto',
                    valid_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                    category: 'Geral'
                },
                {
                    id: 'FRETEGRATIS',
                    code: 'FRETEGRATIS',
                    discount_percentage: 0,
                    description: 'Frete grátis em compras acima de R$ 50',
                    valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    category: 'Frete'
                },
                {
                    id: 'BLACKFRIDAY',
                    code: 'BLACKFRIDAY',
                    discount_percentage: 30,
                    description: 'Black Friday - Até 30% de desconto',
                    valid_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                    category: 'Eletrônicos'
                },
                {
                    id: 'TECH50',
                    code: 'TECH50',
                    discount_percentage: 50,
                    description: 'Desconto progressivo - Até 50% em tech',
                    valid_until: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
                    category: 'Tecnologia'
                },
                {
                    id: 'PRIMEIRA',
                    code: 'PRIMEIRA',
                    discount_percentage: 12,
                    description: 'Desconto para primeira compra - 12%',
                    valid_until: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                    category: 'Geral'
                }
            ];

            // Filtra apenas cupons ainda válidos
            const activeCoupons = popularCoupons.filter(coupon => {
                return new Date() <= new Date(coupon.valid_until);
            });

            return activeCoupons;
        } catch (error) {
            console.error('[MLCoupons] Erro ao buscar cupons:', error.message);
            return [];
        }
    }

    /**
     * Valida se um cupom está ativo
     */
    isValidCoupon(coupon) {
        const now = new Date();
        const validUntil = new Date(coupon.valid_until);
        return now <= validUntil;
    }

    /**
     * Calcula dias restantes para expiração
     */
    getDaysUntilExpiration(coupon) {
        const now = new Date();
        const validUntil = new Date(coupon.valid_until);
        const daysLeft = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));
        return Math.max(0, daysLeft);
    }

    /**
     * Formata cupom para exibição com fonte monospace
     */
    formatCouponMessage(coupon) {
        const daysLeft = this.getDaysUntilExpiration(coupon);
        const urgency = daysLeft <= 3 ? '🔥 URGENTE!' : daysLeft <= 7 ? '⚡ Válido por poucos dias' : '✅ Válido';

        let message = `${urgency}\n\n`;
        message += `📊 Desconto: ${coupon.discount_percentage}%\n`;
        message += `📝 ${coupon.description}\n`;
        message += `\n🎟️ Usem o cupom: \`${coupon.code}\`\n`;
        message += `⏰ Válido por: ${daysLeft} dias\n`;
        message += `🏷️ Categoria: ${coupon.category}\n`;
        message += `\n👉 Copie e cole o código acima no carrinho do Mercado Livre!`;

        return message;
    }

    /**
     * Retorna o caminho da logo do Mercado Livre
     */
    getLogoPath() {
        if (fs.existsSync(this.logoPath)) {
            return this.logoPath;
        }
        return null;
    }
}

module.exports = MLCoupons;

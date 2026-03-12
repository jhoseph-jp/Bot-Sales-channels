const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs-extra');

class MLTelegramBot {
    constructor(configPath, envConfig) {
        this.config = fs.readJsonSync(configPath);
        // Usa o token e chat_id do ambiente (DEV ou PROD)
        this.bot = new TelegramBot(envConfig.token, { polling: false });
        this.chatId = envConfig.chatId;
    }

    async shortenUrl(url) {
        try {
            const mlResponse = await axios.post('https://api.mercadolibre.com/short_urls', 
                { url: url },
                { 
                    headers: { 
                        'Authorization': `Bearer ${this.config.mercadolivre.access_token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000 
                }
            );
            if (mlResponse.data && mlResponse.data.short_url) {
                return mlResponse.data.short_url;
            }
        } catch (error) {
            // Fallback silencioso para TinyURL
        }

        try {
            const tinyResponse = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, { timeout: 5000 });
            return tinyResponse.data;
        } catch (error) {
            return url;
        }
    }

    formatMessage(offer, shortUrl) {
        let message = `🔥 *${offer.title}*\n\n`;
        
        if (offer.original_price > offer.current_price) {
            message += `❌ De: ~~R$ ${offer.original_price.toFixed(2).replace('.', ',')}~~\n`;
            message += `✅ *Por: R$ ${offer.current_price.toFixed(2).replace('.', ',')}*\n`;
            message += `📉 *Desconto: ${offer.discount_percentage}% OFF*\n`;
        } else {
            message += `✅ *Preço: R$ ${offer.current_price.toFixed(2).replace('.', ',')}*\n`;
        }

        if (offer.coupon) {
            message += `\n🎟️ *CUPOM:* \`${offer.coupon}\` (Aplicar no carrinho)\n`;
        }

        message += `\n🔗 *Link da Oferta:* ${shortUrl}\n`;

        return message;
    }

    async sendMessage(offer) {
        try {
            const shortUrl = await this.shortenUrl(offer.link);
            const message = this.formatMessage(offer, shortUrl);

            if (offer.image) {
                await this.bot.sendPhoto(this.chatId, offer.image, {
                    caption: message,
                    parse_mode: 'Markdown'
                });
            } else {
                await this.bot.sendMessage(this.chatId, message, {
                    parse_mode: 'Markdown'
                });
            }
            return true;
        } catch (error) {
            console.error(`Erro ao enviar para o Telegram: ${error.message}`);
            return false;
        }
    }

    /**
     * Envia mensagem de cupom com imagem para o Telegram
     */
    async sendCouponMessage(couponMessage, imagePath = null) {
        try {
            if (imagePath) {
                // Envia foto com caption
                await this.bot.sendPhoto(this.chatId, imagePath, {
                    caption: couponMessage,
                    parse_mode: 'Markdown'
                });
            } else {
                // Envia apenas texto
                await this.bot.sendMessage(this.chatId, couponMessage, {
                    parse_mode: 'Markdown'
                });
            }
            return true;
        } catch (error) {
            console.error(`Erro ao enviar cupom para o Telegram: ${error.message}`);
            return false;
        }
    }
}

module.exports = MLTelegramBot;

const path = require('path');
const fs = require('fs-extra');

// Carrega o ambiente baseado na variável de ambiente ou padrão para dev
const envFile = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
require('dotenv').config({ path: path.join(__dirname, envFile) });

const MLAuth = require('./mlAuth');
const MLOffers = require('./mlOffers');
const MLCoupons = require('./mlCoupons');
const MLTelegramBot = require('./telegramBot');
const WebAppSync = require('./webAppSync');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const HISTORY_PATH = path.join(__dirname, process.env.HISTORY_FILE || 'history.json');
const COUPONS_HISTORY_PATH = path.join(__dirname, process.env.COUPONS_HISTORY_FILE || 'coupons_history.json');

class Monitor {
    constructor() {
        console.log(`🚀 Iniciando em modo: ${process.env.NODE_ENV.toUpperCase()}`);
        console.log(`📢 Canal Alvo: ${process.env.TELEGRAM_CHAT_ID}`);
        console.log(`📂 Histórico: ${HISTORY_PATH}`);

        this.auth = new MLAuth(CONFIG_PATH);
        this.offers = new MLOffers(CONFIG_PATH);
        this.coupons = new MLCoupons(CONFIG_PATH);
        
        // Passa as configurações do ambiente para o bot
        this.bot = new MLTelegramBot(CONFIG_PATH, {
            token: process.env.TELEGRAM_TOKEN,
            chatId: process.env.TELEGRAM_CHAT_ID
        });

        // Sincronização com web app
        this.webAppSync = new WebAppSync(CONFIG_PATH, {
            url: process.env.WEB_APP_URL || 'http://localhost:3000',
            apiKey: process.env.WEB_APP_API_KEY,
            enabled: process.env.WEB_APP_SYNC_ENABLED !== 'false'
        });

        this.interval = parseInt(process.env.CHECK_INTERVAL) || 120000;
        this.couponCheckInterval = parseInt(process.env.COUPON_CHECK_INTERVAL) || 3600000; // 1 hora
        this.lastCouponsHash = null;
    }

    loadHistory() {
        try {
            if (fs.existsSync(HISTORY_PATH)) {
                const data = fs.readJsonSync(HISTORY_PATH);
                return new Set(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            console.error("Erro ao carregar histórico, resetando...", e.message);
        }
        return new Set();
    }

    saveHistory(historySet) {
        try {
            fs.writeJsonSync(HISTORY_PATH, Array.from(historySet), { spaces: 4 });
        } catch (e) {
            console.error("Erro ao salvar histórico:", e.message);
        }
    }

    loadCouponsHistory() {
        try {
            if (fs.existsSync(COUPONS_HISTORY_PATH)) {
                const data = fs.readJsonSync(COUPONS_HISTORY_PATH);
                return new Set(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            console.error("Erro ao carregar histórico de cupons, resetando...", e.message);
        }
        return new Set();
    }

    saveCouponsHistory(historySet) {
        try {
            fs.writeJsonSync(COUPONS_HISTORY_PATH, Array.from(historySet), { spaces: 4 });
        } catch (e) {
            console.error("Erro ao salvar histórico de cupons:", e.message);
        }
    }

    async run() {
        console.log(`[${new Date().toLocaleString()}] Verificando ofertas...`);
        
        let history = this.loadHistory();
        
        try {
            const allOffers = await this.offers.getOffers();
            console.log(`Encontradas ${allOffers.length} ofertas.`);

            let newOffersCount = 0;
            const newOffers = [];
            
            for (const offer of allOffers) {
                if (history.has(offer.id)) continue;

                const minDiscount = parseInt(process.env.MIN_DISCOUNT) || 0;
                if (offer.discount_percentage < minDiscount) continue;

                console.log(`Nova oferta: ${offer.title}`);
                const success = await this.bot.sendMessage(offer);
                
                if (success) {
                    history.add(offer.id);
                    this.saveHistory(history);
                    newOffers.push(offer);
                    newOffersCount++;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            // Sincroniza ofertas com o web app
            if (newOffers.length > 0) {
                console.log(`\n📡 Sincronizando ${newOffers.length} ofertas com o web app...`);
                const syncResult = await this.webAppSync.syncOffers(newOffers);
                if (!syncResult.success) {
                    console.warn(`⚠️  Falha na sincronizacao: ${syncResult.reason}`);
                }
            }

            if (newOffersCount === 0) {
                console.log("Nenhuma oferta nova.");
            } else {
                console.log(`${newOffersCount} novas ofertas enviadas e sincronizadas.`);
            }

        } catch (error) {
            console.error("Erro no ciclo:", error.message);
        }

        setTimeout(() => this.run(), this.interval);
    }

    /**
     * Monitora cupons ativos e envia para o Telegram
     */
    async monitorCoupons() {
        console.log(`\n[${new Date().toLocaleString()}] 🎟️  Verificando cupons...`);
        
        let couponsHistory = this.loadCouponsHistory();
        
        try {
            const activeCoupons = await this.coupons.getCoupons();
            console.log(`Encontrados ${activeCoupons.length} cupons ativos.`);

            let newCouponsCount = 0;
            
            for (const coupon of activeCoupons) {
                // Verifica se o cupom já foi enviado
                if (couponsHistory.has(coupon.id)) {
                    continue;
                }

                console.log(`Novo cupom: ${coupon.code}`);
                const message = this.coupons.formatCouponMessage(coupon);
                const logoPath = this.coupons.getLogoPath();
                const success = await this.bot.sendCouponMessage(message, logoPath);
                
                if (success) {
                    couponsHistory.add(coupon.id);
                    this.saveCouponsHistory(couponsHistory);
                    newCouponsCount++;
                    console.log(`✅ Cupom enviado: ${coupon.code}`);
                    
                    // Aguarda 1 segundo entre mensagens
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (newCouponsCount === 0) {
                console.log("Nenhum cupom novo.");
            } else {
                console.log(`${newCouponsCount} novos cupons enviados.`);
            }

        } catch (error) {
            console.error("Erro ao verificar cupons:", error.message);
        }

        setTimeout(() => this.monitorCoupons(), this.couponCheckInterval);
    }
}

const monitor = new Monitor();
monitor.run();
monitor.monitorCoupons();

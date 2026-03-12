const axios = require('axios');
const cheerio = require('cheerio');

async function inspect() {
    const url = "https://www.mercadolivre.com.br/ofertas";
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };

    try {
        const response = await axios.get(url, { headers });
        const $ = cheerio.load(response.data);
        
        const cards = $('.poly-card');
        console.log(`Total de cards: ${cards.length}`);
        
        cards.each((i, el) => {
            const card = $(el);
            const title = card.find('a.poly-component__title').text().trim();
            
            // Busca por selos de cupom
            const couponEl = card.find('.poly-coupon, .poly-component__coupon, [class*="coupon"]');
            const couponText = couponEl.text().trim();
            
            if (couponText) {
                console.log(`\n--- Card ${i+1}: ${title.substring(0, 40)}... ---`);
                console.log(`  Cupom Encontrado: ${couponText}`);
                console.log(`  HTML do Cupom: ${couponEl.parent().html().substring(0, 200)}`);
            }
        });
    } catch (error) {
        console.error("Erro:", error.message);
    }
}

inspect();

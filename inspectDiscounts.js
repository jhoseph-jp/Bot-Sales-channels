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
        
        cards.slice(0, 10).each((i, el) => {
            const card = $(el);
            const title = card.find('a.poly-component__title').text().trim();
            
            // Preço Anterior
            const prevPriceEl = card.find('.andes-money-amount--previous .andes-money-amount__fraction');
            const prevPrice = prevPriceEl.text().replace('.', '') || "N/A";
            
            // Preço Atual
            const currPriceEl = card.find('.poly-price__current .andes-money-amount__fraction');
            const currPrice = currPriceEl.text().replace('.', '') || "N/A";
            
            // Desconto Visual
            const discountEl = card.find('.poly-price__discount, .andes-money-amount__discount');
            const discountText = discountEl.text().trim() || "NÃO ENCONTRADO";
            
            console.log(`\n--- Card ${i+1}: ${title.substring(0, 40)}... ---`);
            console.log(`  Anterior: ${prevPrice}`);
            console.log(`  Atual: ${currPrice}`);
            console.log(`  Desconto Visual: ${discountText}`);
            
            if (prevPrice !== "N/A" && currPrice !== "N/A") {
                const p1 = parseFloat(prevPrice);
                const p2 = parseFloat(currPrice);
                const calc = Math.round(((p1 - p2) / p1) * 100);
                console.log(`  Cálculo Manual: ${calc}% OFF`);
            }
        });
    } catch (error) {
        console.error("Erro:", error.message);
    }
}

inspect();

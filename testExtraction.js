const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
    const url = "https://www.mercadolivre.com.br/ofertas";
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };

    try {
        const response = await axios.get(url, { headers });
        const $ = cheerio.load(response.data);
        
        const cards = $('.poly-card');
        console.log(`Total de cards encontrados: ${cards.length}`);
        
        cards.slice(0, 3).each((i, el) => {
            const card = $(el);
            const title = card.find('.poly-component__title a').text().trim();
            const img = card.find('img[data-testid="picture"]').attr('src') || card.find('img').attr('src');
            console.log(`Card ${i+1}: ${title}`);
            console.log(`  Imagem: ${img ? img.substring(0, 50) : 'NÃO ENCONTRADA'}`);
        });
    } catch (error) {
        console.error("Erro:", error.message);
    }
}

test();

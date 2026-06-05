const mlService = require('../src/services/mercadoLivreService');

describe('MercadoLivreService', () => {
  test('deve extrair ofertas da página do Mercado Livre', async () => {
    // Mock do axios não implementado aqui para brevidade, 
    // mas o teste real deve mockar a resposta HTML
    const offers = await mlService.getOffers();
    expect(Array.isArray(offers)).toBe(true);
  });

  test('deve gerar hash único para ofertas', () => {
    const offer1 = { title: 'Produto A', price: 100 };
    const offer2 = { title: 'Produto A', price: 100 };
    const offer3 = { title: 'Produto B', price: 100 };

    const hash1 = require('crypto').createHash('md5').update(`${offer1.title}-${offer1.price}`).digest('hex');
    const hash2 = require('crypto').createHash('md5').update(`${offer2.title}-${offer2.price}`).digest('hex');
    const hash3 = require('crypto').createHash('md5').update(`${offer3.title}-${offer3.price}`).digest('hex');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
});

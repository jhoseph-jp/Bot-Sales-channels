/**
 * Testes do mapeamento de oferta da Shopee.
 *
 * Regressão principal: priceMin/priceMax da API são a FAIXA de preço entre as
 * variações do produto (cor/tamanho), ambos já com desconto — priceMax não é o
 * preço "de". Usá-lo como originalPrice publicou no canal, em 2026-08-21,
 * "De R$ 23,79 / Por R$ 23,79 / 4% OFF".
 */

const shopeeService = require('../src/services/shopeeService');

const produto = (over = {}) => ({
  itemId: 1,
  productName: 'Produto de Teste',
  priceMin: '100.00',
  priceMax: '100.00',
  priceDiscountRate: '20',
  offerLink: 'https://s.shopee.com.br/abc',
  imageUrl: 'https://img/1.jpg',
  ...over,
});

describe('_mapProductOffer — preço original', () => {
  test('reconstrói o "de" a partir do priceDiscountRate', () => {
    const o = shopeeService._mapProductOffer(produto({ priceMin: '80.00', priceDiscountRate: '20' }));
    expect(o.price).toBe(80);
    expect(o.originalPrice).toBe(100);
    expect(o.discount).toBe(20);
  });

  test('o caso do espelho: sem variação, "de" deixa de ser igual ao "por"', () => {
    const o = shopeeService._mapProductOffer(produto({
      productName: 'Espelho em Formato Elegante',
      priceMin: '23.79', priceMax: '23.79', priceDiscountRate: '4',
    }));
    expect(o.price).toBe(23.79);
    expect(o.originalPrice).toBe(24.78);
    expect(o.originalPrice).toBeGreaterThan(o.price);
  });

  test('ignora priceMax, que é o teto das variações e não o preço antes do desconto', () => {
    const o = shopeeService._mapProductOffer(produto({
      priceMin: '39.90', priceMax: '89.90', priceDiscountRate: '50',
    }));
    expect(o.originalPrice).toBe(79.8);   // 39,90 / 0,5 — e não 89,90
  });
});

describe('_mapProductOffer — desconto degenerado', () => {
  test('sem desconto, "de" iguala "por" e a oferta é zerada', () => {
    const o = shopeeService._mapProductOffer(produto({ priceDiscountRate: '0', priceMax: '150.00' }));
    expect(o.originalPrice).toBe(o.price);
    expect(o.discount).toBe(0);
  });

  test('taxa de 100% não gera divisão por zero', () => {
    const o = shopeeService._mapProductOffer(produto({ priceDiscountRate: '100' }));
    expect(Number.isFinite(o.originalPrice)).toBe(true);
    expect(o.discount).toBe(0);
  });

  test.each([null, undefined, '', 'abc'])('taxa inválida (%p) vira desconto 0', (taxa) => {
    const o = shopeeService._mapProductOffer(produto({ priceDiscountRate: taxa }));
    expect(o.discount).toBe(0);
    expect(o.originalPrice).toBe(o.price);
  });
});

describe('_mapProductOffer — formato comum', () => {
  test('marca a loja e prefixa o id', () => {
    const o = shopeeService._mapProductOffer(produto({ itemId: 987 }));
    expect(o.store).toBe('shopee');
    expect(o.id).toBe('SHOPEE-987');
  });

  test('prefere offerLink (afiliado) ao productLink', () => {
    const o = shopeeService._mapProductOffer(produto({
      offerLink: 'https://s.shopee.com.br/afiliado',
      productLink: 'https://shopee.com.br/produto',
    }));
    expect(o.link).toBe('https://s.shopee.com.br/afiliado');
  });

  test('cai para productLink quando não há link de afiliado', () => {
    const o = shopeeService._mapProductOffer(produto({
      offerLink: null,
      productLink: 'https://shopee.com.br/produto',
    }));
    expect(o.link).toBe('https://shopee.com.br/produto');
  });
});

describe('getNicheProducts — paginação e rotação de bloco', () => {
  // A regressão que motivou: só a página 1 era lida, o pool vinha idêntico todo ciclo e,
  // publicadas as ofertas dele, a Shopee sumiu do canal por horas.
  const paginar = () => {
    const chamadas = [];
    shopeeService.getProductsPage = jest.fn(async (keyword, { page }) => {
      chamadas.push({ keyword, page });
      if (page > 8) return { products: [], hasNextPage: false };   // catálogo com 8 páginas
      return {
        products: [{ id: `SHOPEE-${keyword}-${page}` }],
        hasNextPage: page < 8,
      };
    });
    return chamadas;
  };

  // O espaçamento anti-rate-limit entre requisições soma dezenas de segundos reais —
  // timers falsos deixam a varredura inteira rodar instantaneamente.
  const varrer = async (opts) => {
    jest.useFakeTimers();
    try {
      const promessa = shopeeService.getNicheProducts(opts);
      await jest.runAllTimersAsync();
      return await promessa;
    } finally {
      jest.useRealTimers();
    }
  };

  afterEach(() => { delete shopeeService.getProductsPage; });

  test('varre mais de uma página por keyword e deduplica por id', async () => {
    const chamadas = paginar();
    const produtos = await varrer({ block: 0 });

    const paginasDaPrimeira = chamadas.filter(c => c.keyword === chamadas[0].keyword);
    expect(paginasDaPrimeira.map(c => c.page)).toEqual([1, 2, 3]);
    expect(new Set(produtos.map(p => p.id)).size).toBe(produtos.length);
    expect(produtos.length).toBeGreaterThan(chamadas.length / 2);
  });

  test('bloco seguinte lê páginas novas, não o mesmo topo do catálogo', async () => {
    const chamadas = paginar();
    await varrer({ block: 1 });
    expect(chamadas.filter(c => c.keyword === chamadas[0].keyword).map(c => c.page)).toEqual([4, 5, 6]);
  });

  test('keyword sem páginas suficientes cai de volta na página 1', async () => {
    const chamadas = paginar();
    const produtos = await varrer({ block: 3 });   // páginas 10-12
    expect(chamadas.some(c => c.page === 1)).toBe(true);
    expect(produtos.length).toBeGreaterThan(0);
  });
});

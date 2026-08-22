/**
 * Testes do filtro de nicho — o coração da regra de negócio do canal.
 *
 * Este módulo decide o que vai ao ar. Quando ele erra, o erro é público: em
 * 2026-08-21/22 uma "Regata Machão Oversized Unissex" e dois óculos masculinos
 * foram publicados no canal. Cada incidente vira um caso aqui para não repetir.
 */

const { isFeminine, isHardBlocked } = require('../src/utils/nicheFilter');

describe('isHardBlocked', () => {
  test.each([
    'Barbeador Elétrico Philips Masculino',
    'Whey Protein Concentrado 900g',
    'Furadeira de Impacto 650W',
    'Ração Premium para Gatos Adultos',
    'Pneu Aro 15 Michelin',
  ])('bloqueia fora do público-alvo: %s', (titulo) => {
    expect(isHardBlocked(titulo)).toBe(true);
  });

  test('não bloqueia produto legítimo do nicho', () => {
    expect(isHardBlocked('Vestido Longo Floral Feminino')).toBe(false);
  });
});

describe('isFeminine — regressões de incidentes reais', () => {
  // Publicados por engano quando as categorias neutras do ML (MLB1430, MLB31447...)
  // eram marcadas como _fromFeminineCategory, o que pulava o filtro por keyword.
  test.each([
    ['Regata Machão Oversized Unissex Zion Casual Academia', 'regata machão unissex'],
    ['Óculos De Sol Oakley Holbrook Preto Fosco Preta Quadrado', 'óculos masculino sem qualificador'],
    ['Óculos de sol polarizados Ray-Ban RB4179 Large', 'óculos sem qualificador'],
    ['Kit 3 Camisetas Algodão Premium Branco Preto Cinza', 'kit de camisetas genérico'],
    ['Kit 5 Camisetas Dry Tech Modal Fit Moda Veronz', 'kit de camisetas genérico'],
    ['Kit De 3 T-shirts Oversized Intense Cléa Store', 't-shirts sem gênero'],
  ])('descarta %s (%s)', (titulo) => {
    expect(isFeminine(titulo)).toBe(false);
  });

  // Peças de reposição de airfryer: 'airfryer' é keyword legítima de cozinha, então
  // os títulos passavam pelo filtro. Chegaram ao canal via busca da Shopee.
  test.each([
    'Conjunto motor e resistência Fritadeira Airfryer Philips',
    'Cesta Fritadeira Philips Walita Original RI9225 RI9220',
    'Cuba Suporte da cesta da Fritadeira Airfryer Philips',
    'Cesta Cesto Fritadeira Airfryer Philips Walita RI9270',
    'Suporte cesta RI9225 Ri9217 RI9220 Original Philips',
  ])('descarta peça de reposição: %s', (titulo) => {
    expect(isFeminine(titulo)).toBe(false);
  });

  test('mas o eletrodoméstico inteiro continua passando', () => {
    expect(isFeminine('Airfryer Mondial 4L Fritadeira Elétrica sem Óleo')).toBe(true);
    expect(isFeminine('Jogo de Panelas Antiaderente 5 Peças')).toBe(true);
  });
});

describe('isFeminine — o que precisa continuar passando', () => {
  test.each([
    'Vestido Festa Curto Tule Feminino Com Top e Bojo',
    'Blusa Feminina Borboleta Glorious Minimalista',
    'Camiseta Feminina Gola Careca Workout Essentials adidas',
    'Calça Alfaiataria Feminina Wid Leg Pantalona Social',
    'Tênis Feminino Response 2 adidas Icepur',
    'Chapinha Prancha Alisadora Titanium',
    'Progressiva Definitiva Sem Formol 1L',
  ])('aceita %s', (titulo) => {
    expect(isFeminine(titulo)).toBe(true);
  });

  // Regressão: com o filtro por keyword valendo, tratamento capilar descrito pelo
  // problema ("Cabelo Ressecado") e não pelo termo técnico ("máscara capilar")
  // estava sendo descartado.
  test('aceita tratamento capilar descrito pelo problema', () => {
    expect(isFeminine('Mascara Hidratação 60 Segundos Cabelo Ressecado')).toBe(true);
  });
});

describe('isFeminine — acessórios dependem do qualificador de gênero', () => {
  test.each([
    ['Óculos Para Grau Oval Saint Germain Feminino Siena', true],
    ['Óculos De Sol Oakley Holbrook Preto Fosco', false],
    ['Cinto Feminino Couro Fivela Dourada', true],
    ['Cinto de Couro Masculino Social', false],
    ['Relógio Feminino Dourado Analógico', true],
  ])('%s -> %s', (titulo, esperado) => {
    expect(isFeminine(titulo)).toBe(esperado);
  });

  test('acessório inequivocamente feminino dispensa qualificador', () => {
    expect(isFeminine('Tiara de Pérolas para Noiva')).toBe(true);
    expect(isFeminine('Bolsa Tiracolo Pequena Alça Ajustável')).toBe(true);
  });
});

describe('isFeminine — flag de categoria confiável', () => {
  test('fromFeminineCategory pula o filtro por keyword', () => {
    const titulo = 'Produto Sem Nenhuma Keyword Do Nicho';
    expect(isFeminine(titulo)).toBe(false);
    expect(isFeminine(titulo, true)).toBe(true);
  });

  test('mas o hard block continua valendo mesmo com a flag', () => {
    expect(isFeminine('Barbeador Elétrico Masculino', true)).toBe(false);
  });
});

describe('isFeminine — entradas degeneradas', () => {
  test.each([null, undefined, '', '   '])('não quebra com %p', (titulo) => {
    expect(() => isFeminine(titulo)).not.toThrow();
    expect(isFeminine(titulo)).toBe(false);
  });
});

describe('isHardBlocked — termos de palavra inteira', () => {
  // 'ração' casava por substring dentro de "coração"/"decoração" depois do normalize()
  // tirar o acento, derrubando moda feminina legítima como se fosse comida de pet.
  test.each([
    ['Blusa T-shirt Cruz Coração Confortável 100% Algodão', true],
    ['Vestido Feminino Estampa Coração', true],
    ['Camiseta Feminina Coração de Algodão', true],
    ['Ração Golden Cães Adultos 15kg', false],
    ['Rações Premium Gatos Castrados', false],
    ['Porta Chaves Mdf Decorativo Para Decoração', false],
  ])('%s -> %s', (titulo, esperado) => {
    expect(isFeminine(titulo)).toBe(esperado);
  });
});

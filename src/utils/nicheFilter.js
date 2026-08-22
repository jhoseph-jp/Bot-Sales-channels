/**
 * Classificação de nicho feminino — fonte única da verdade.
 *
 * Estava embutido no mercadoLivreService.js e só valia para OFERTAS; o caminho de
 * CUPONS usava uma blocklist própria e bem menor (couponAudience.js), o que deixava
 * passar cupom de produto claramente fora do escopo — ex.: cupom de vendedor de
 * furadeira, sendo que 'furadeira'/'parafusadeira' já estavam bloqueadas aqui para
 * ofertas desde sempre. Com o módulo compartilhado, oferta e cupom aplicam o mesmo
 * critério e não voltam a divergir.
 */

function normalize(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// Hard block — descartado independente de qualquer coisa, inclusive se vier de categoria feminina
const HARD_EXCLUSIONS = [
  // ── Aparelhos de barba / higiene masculina ──
  'barbeador', 'aparador de barba', 'aparelho de barbear', 'one blade', 'oneblade',
  'lâmina de barbear', 'lâmina de barba', 'creme de barbear', 'gel de barbear',
  'espuma de barbear', 'navalha', 'gilete', 'gillette', 'barbeador elétrico',
  'aparador de pelos masculino', 'cortador de barba', 'barba e bigode',
  // ── Médico / hospitalar / inalação ──
  'inalador', 'nebulizador', 'aerocâmara', 'espaçador inalador',
  'seringa', 'cadeira de rodas', 'andador', 'muleta', 'cateter', 'ostomia',
  'sonda', 'curativo médico', 'estetoscópio', 'aparelho auditivo',
  'oxímetro', 'monitor de pressão', 'aparelho de pressão', 'glicosímetro',
  'desfibrilador', 'esfigmomanômetro', 'tensiômetro',
  // ── Suplementos / nutrição esportiva ──
  'suplemento', 'whey protein', 'creatina', 'bcaa', 'hipercalórico',
  'proteína em pó', 'albumina', 'termogênico', 'pré-treino', 'pré treino',
  'ganho de massa', 'massa muscular',
  // ── Iluminação fotográfica / estúdio ──
  'para fotografia', 'ring light', 'anel de luz', 'iluminador fotográfico',
  'softbox', 'estúdio fotográfico', 'fundo infinito', 'rebatedor foto',
  // ── Industrial / agrícola ──
  'industrial', 'agrícola', 'trator', 'motor elétrico', 'bomba d\'água',
  'compressor', 'parafuso industrial', 'gerador',
  // ── Automóvel / limpeza automotiva ──
  'pneu', 'amortecedor', 'óleo motor', 'filtro de ar automotivo', 'para-choque',
  'alternador', 'vela de ignição',
  'lavagem de carro', 'lavagem automotiva', 'lavagem caminhão', 'lavagem ônibus',
  'shampoo automotivo', 'cera automotiva', 'desengraxante', 'pretinho automotivo',
  // ── Veterinário / pet ──
  'veterinário', 'veterinária', 'para cão', 'para gato', 'ração',
  'antipulgas', 'coleira antipulgas',
  // ── Bebê / fraldas ──
  'fralda descartável', 'fralda adulto', 'chupeta', 'mamadeira', 'berço',
  // ── Masculino ──
  'masculino', 'masculina', 'para homem', 'para ele', 'homem adulto', 'menino',
  'machão', 'machao', 'barba', 'cueca',
  // ── Ferramentas / informática ──
  'furadeira', 'parafusadeira', 'esmerilhadeira', 'serra elétrica',
  'teclado gamer', 'mouse gamer', 'placa de vídeo', 'processador', 'memória ram',
  // ── Outdoor / camping / esporte masculino ──
  'barraca de camping', 'barraca camping', 'saco de dormir', 'fogareiro',
  'lanterna', 'canivete', 'machado', 'bússola', 'cantil de alumínio',
  'colchonete camping', 'kit camping', 'equipamento de pesca', 'vara de pesca',
  'isca de pesca', 'molinete de pesca',
  // ── Elétrica / hidráulica ──
  'disjuntor', 'cabo elétrico', 'mangueira', 'registro hidráulico', 'torneira',
  // ── Automotivo adicional ──
  'kit suspensão', 'embreagem', 'radiador automotivo', 'bateria automotiva',
  // ── Peças de reposição de eletrodoméstico ──
  // A busca por 'airfryer'/'panela' na Shopee traz muito cesto, cuba e resistência
  // avulsos da Philips Walita. O termo 'airfryer' aparece no título, então o filtro
  // de cozinha os aprovava — é preciso bloqueá-los explicitamente.
  'reposição', 'reposicao', 'peça de reposição',
  'cesta fritadeira', 'cesto fritadeira', 'cesta da fritadeira', 'cesto da fritadeira',
  'cesta airfryer', 'cesto airfryer', 'cesta air fryer', 'cesto air fryer',
  'suporte da cesta', 'suporte cesta', 'cuba suporte', 'suporte para cesta',
  'motor e resistência', 'resistência fritadeira', 'resistência da fritadeira',
  'grelha fritadeira', 'grelha da fritadeira', 'tampa da panela avulsa',
];

// Nicho 1 — Roupas (máxima prioridade)
// "blusa" sozinha é quase sempre feminino no ML — HARD_EXCLUSIONS bloqueia "masculina"
const CLOTHES_KEYWORDS = [
  // Itens inequivocamente femininos
  'vestido', 'saia', 'sutiã', 'calcinha', 'lingerie', 'camisola', 'biquíni', 'maiô',
  'legging', 'cropped', 'body feminino',
  // Roupa íntima e modeladores
  'kit calcinha', 'kit lingerie', 'conjunto lingerie', 'baby doll',
  'soutien', 'meia-calça', 'meia calça', 'meia arrastão', 'meia fina feminina',
  'cinta modeladora', 'modelador feminino', 'short modelador',
  'calça modeladora', 'body modelador',
  'macacão feminino', 'conjunto feminino', 'moletom feminino',
  'short feminino', 'camiseta feminina', 'regata feminina',
  'jaqueta feminina', 'casaco feminino', 'pijama feminino',
  // Standalone — seguro porque HARD_EXCLUSIONS bloqueia "masculin*"
  'blusa',        // blusa manga, blusa estampada, blusa de crochê...
  'camiseta ',    // camiseta (espaço evita "camisetão")
  'conjuntinho',  // termo muito feminino no mercado BR
  // Calças femininas
  'calça mom', 'calça flare', 'calça palazzo', 'calça wide leg',
  'calça skinny feminina', 'calça clochard', 'calça jogger feminina',
  'calça social feminina', 'calça jeans feminina', 'calça legging',
  // Camisas e blusas femininas
  'camisa feminina', 'camisa social feminina', 'camisa cropped',
  // Acessórios de roupa
  'kimono feminino', 'cardigan feminino', 'blazer feminino', 'colete feminino',
  // Standalone adicionais — termos inequivocamente femininos no mercado BR
  // ('saia'/'cropped' já cobrem variações como "saia jeans"/"cropped tricot" por substring)
  'macaquinho', 'colete jeans feminino', 'calça skinny cintura alta',
];

// Nicho 2 — Calçados
const SHOES_KEYWORDS = [
  'scarpin', 'rasteirinha', 'sapatilha', 'salto agulha', 'salto fino',
  'sandália feminina', 'tênis feminino', 'bota feminina', 'sapato feminino',
  'espadrille', 'tamanco feminino', 'ankle boot feminino', 'plataforma feminina',
  // Tênis de caminhada / casual (muito buscado)
  'tênis de caminhada', 'tênis slip on', 'tênis casual feminino',
  'tênis chunky', 'tênis dad shoe',
];

// Nicho 3 — Beleza
const BEAUTY_KEYWORDS = [
  'maquiagem', 'batom', 'rímel', 'delineador', 'blush', 'paleta de sombra',
  'iluminador', 'contorno facial', 'base de maquiagem', 'gloss labial',
  'lápis labial', 'primer maquiagem', 'corretivo maquiagem',
  'perfume feminino', 'colônia feminina', 'eau de parfum', 'body splash feminino',
  // Cabelo
  'shampoo', 'condicionador', 'máscara capilar', 'sérum capilar',
  'óleo capilar', 'leave-in', 'ampola capilar', 'ampola de tratamento',
  'creme de pentear', 'finalizador capilar', 'spray capilar',
  'kit cabelo', 'tratamento capilar',
  // Tratamento capilar descrito pelo problema, não pelo termo técnico — títulos como
  // "Mascara Hidratação 60 Segundos Cabelo Ressecado" não casavam com 'máscara capilar'
  'hidratação capilar', 'cabelo ressecado', 'cabelo danificado', 'umectação',
  'reconstrução capilar', 'cronograma capilar', 'botox capilar', 'progressiva',
  'matizador', 'tonalizante', 'coloração de cabelo',
  // Skincare / rosto
  'sérum facial', 'hidratante facial', 'protetor solar facial', 'skincare',
  'retinol', 'vitamina c facial', 'niacinamida', 'ácido hialurônico',
  'tônico facial', 'esfoliante facial', 'máscara facial',
  'água micelar', 'demaquilante', 'sabonete facial', 'gel de limpeza facial',
  'protetor solar', 'bb cream', 'cc cream', 'kit skincare',
  // Corpo
  'loção corporal', 'creme corporal', 'hidratante corporal',
  'esfoliante corporal', 'creme para mãos', 'manteiga corporal',
  'autobronzeador', 'óleo corporal',
  // Maquiagem adicional
  'pó compacto', 'pó translúcido', 'paleta de cores', 'kit maquiagem',
  'sombra para olhos', 'blush em pó',
  // Unhas
  'esmalte', 'gel de unhas', 'nail art',
];

// Nicho 4 — Eletrônicos femininos
const HAIR_ELECTRONICS = [
  'chapinha', 'babyliss', 'prancha de cabelo', 'prancha alisadora', 'alisador de cabelo',
  'modelador de cachos', 'ondulador de cabelo', 'difusor para cabelo', 'secador de cabelo',
];

// Nicho 5 — Cozinha e utilidades domésticas
const KITCHEN_KEYWORDS = [
  // Panelas e recipientes
  'panela', 'frigideira', 'wok', 'caçarola', 'assadeira', 'forma de bolo',
  'cuscuzeira', 'chaleira', 'bule', 'jogo de panelas', 'kit panelas',
  // Eletrodomésticos de cozinha
  'airfryer', 'air fryer', 'fritadeira elétrica', 'panela elétrica',
  'panela de pressão elétrica', 'liquidificador', 'mixer de mão',
  'processador de alimentos', 'batedeira', 'sanduicheira', 'grill elétrico',
  'cafeteira', 'máquina de café', 'torradeira',
  // Utensílios
  'escorredor de massa', 'tábua de corte', 'faqueiro', 'conjunto de facas',
  'kit cozinha', 'utensílios de cozinha', 'espátula de cozinha', 'concha de cozinha',
  'jogo de talheres', 'porta tempero', 'porta-tempero',
  // Louças e copos
  'jogo de xícaras', 'jogo americano', 'porta-copo', 'garrafa térmica',
  'marmita', 'pote hermético', 'conjunto de potes', 'tigela de cozinha',
  'saladeira', 'fruteira',
  // Organização de cozinha
  'organizador de cozinha', 'suporte para panela', 'escorredor de louça',
  'lixeira de cozinha',
];

// Nicho 6 — Unisex liberados
const UNISEX_ALLOWED = [
  'toalha', 'lençol', 'edredom', 'fronha', 'jogo de cama', 'colcha', 'cobertor',
  'porta-jóias', 'organizador de guarda-roupa', 'espelho camarim',
  // Acessórios de cabelo/moda sem ambiguidade de gênero no mercado BR
  'tiara', 'presilha de cabelo', 'xuxinha', 'scrunchie', 'lenço de cabelo',
  'bolsa tiracolo', 'bolsa transversal', 'clutch', 'necessaire',
];

// Palavras ambíguas que precisam de qualificador de gênero
const REQUIRES_QUALIFIER = [
  'blusa', 'calça', 'short', 'regata', 'top ', 'macacão', 'conjunto', 'pijama',
  'sapato', 'sandália', 'bota', 'tênis', 'tamanco',
  'bolsa', 'carteira', 'mochila', 'pochete',
  // Acessórios de moda (MLB1451). Sem estes, o filtro por keyword derruba a categoria
  // inteira — inclusive "Óculos Para Grau Oval Feminino", que traz o qualificador mas
  // nao tinha termo ambiguo em que se apoiar.
  'óculos', 'cinto', 'relógio', 'chapéu', 'boné', 'lenço', 'echarpe',
  'cachecol', 'luva', 'bandana',
  'perfume', 'colônia', 'body splash', 'secador', 'prancha',
  'pulseira', 'anel', 'colar', 'brinco', 'hidratante', 'creme',
];

const GENDER_QUALIFIERS = ['feminino', 'feminina', 'mulher', 'senhora', 'para ela', 'para mulher'];

function isHardBlocked(title) {
  const t = normalize(title);
  return HARD_EXCLUSIONS.some(ex => t.includes(normalize(ex)));
}

function isFeminine(title, fromFeminineCategory = false) {
  if (isHardBlocked(title)) return false;

  const t = normalize(title);

  // Vindo de categoria feminina do ML → só valida o hard block
  if (fromFeminineCategory) return true;

  // Nicho 1-4: keywords específicas
  if (CLOTHES_KEYWORDS.some(kw => t.includes(normalize(kw)))) return true;
  if (SHOES_KEYWORDS.some(kw => t.includes(normalize(kw)))) return true;
  if (BEAUTY_KEYWORDS.some(kw => t.includes(normalize(kw)))) return true;
  if (HAIR_ELECTRONICS.some(kw => t.includes(normalize(kw)))) return true;

  // Nicho 5: cozinha
  if (KITCHEN_KEYWORDS.some(kw => t.includes(normalize(kw)))) return true;

  // Nicho 6: unisex
  if (UNISEX_ALLOWED.some(kw => t.includes(normalize(kw)))) return true;

  // Ambíguas com qualificador
  const hasQualifier = GENDER_QUALIFIERS.some(q => t.includes(normalize(q)));
  if (hasQualifier && REQUIRES_QUALIFIER.some(kw => t.includes(normalize(kw)))) return true;

  return false;
}

module.exports = {
  normalize,
  isHardBlocked,
  isFeminine,
  HARD_EXCLUSIONS,
  // Listas usadas também na rotulagem de categoria (getCategoryInfo, em mercadoLivreService)
  HAIR_ELECTRONICS,
  SHOES_KEYWORDS,
  CLOTHES_KEYWORDS,
  KITCHEN_KEYWORDS,
};

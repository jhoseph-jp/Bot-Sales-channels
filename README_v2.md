# 🤖 Bot de Ofertas do Mercado Livre v2.0

Bot profissional Node.js para monitorar e divulgar ofertas do Mercado Livre no Telegram com cupons, sistema de afiliados e métricas.

## ✨ Características

- ✅ **Monitoramento automático** de ofertas com filtros avançados
- ✅ **Cupons ativos** do Mercado Livre
- ✅ **Sistema de afiliados** integrado
- ✅ **Rate limit** para evitar bloqueio do Telegram
- ✅ **Banco de dados SQLite** com histórico de ofertas/cupons
- ✅ **Anti-duplicação** com hash SHA256
- ✅ **Cache em memória** para performance
- ✅ **Logs profissionais** com Winston
- ✅ **Tratamento robusto** de erros com retry automático
- ✅ **Scheduler** confiável com node-cron
- ✅ **Métricas** de monitoramento
- ✅ **Docker** para fácil deployment
- ✅ **Validação** de variáveis de ambiente

## 🚀 Instalação

### Pré-requisitos

- Node.js >= 16.0.0
- npm ou yarn

### Passos

1. **Clone ou extraia o projeto**
   ```bash
   cd ml-bot-node
   ```

2. **Instale as dependências**
   ```bash
   npm install
   ```

3. **Configure as variáveis de ambiente**
   ```bash
   # Para desenvolvimento
   cp .env.dev .env.dev
   
   # Para produção
   cp .env.prod .env.prod
   ```

4. **Edite o arquivo `.env.dev` ou `.env.prod`** com suas credenciais

## ⚙️ Configuração

### Variáveis de Ambiente Obrigatórias

```env
# Telegram
TELEGRAM_BOT_TOKEN=seu_token_aqui
TELEGRAM_CHANNEL_ID=seu_channel_id_aqui

# Mercado Livre
MERCADO_LIVRE_AFFILIATE_CODE=seu_codigo_afiliado
```

### Variáveis de Ambiente Opcionais

```env
# Filtros de ofertas
MIN_DISCOUNT=10                          # Desconto mínimo em %
MIN_PRICE=0                              # Preço mínimo
MAX_PRICE=999999                         # Preço máximo
REQUIRE_FREE_SHIPPING=false              # Exigir frete grátis
REQUIRE_FULL_STOCK=false                 # Exigir estoque completo

# Scheduler (formato cron)
CHECK_OFFERS_INTERVAL=*/2 * * * *        # A cada 2 minutos
CHECK_COUPONS_INTERVAL=0 * * * *         # A cada 1 hora

# Rate Limit
TELEGRAM_RATE_LIMIT_DELAY=1000           # Delay entre mensagens (ms)

# Logs
LOG_LEVEL=info                           # Nível de log
LOG_FILE=logs/app.log                    # Arquivo de log

# Banco de dados
DATABASE_PATH=data/bot.db                # Caminho do SQLite
```

## 🏃 Execução

### Desenvolvimento

```bash
npm run dev
```

### Produção

```bash
npm run prod
```

### Com Docker

```bash
# Build da imagem
docker build -t ml-bot .

# Executar container
docker run -d \
  -e TELEGRAM_BOT_TOKEN=seu_token \
  -e TELEGRAM_CHANNEL_ID=seu_channel \
  -e MERCADO_LIVRE_AFFILIATE_CODE=seu_codigo \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/data:/app/data \
  ml-bot
```

## 📊 Estrutura do Projeto

```
ml-bot-node/
├── src/
│   ├── config/
│   │   └── env.js              # Validação de variáveis de ambiente
│   ├── repositories/
│   │   └── database.js         # Repositório SQLite
│   ├── services/
│   │   ├── mercadoLivreService.js  # Integração com ML
│   │   └── telegramService.js      # Integração com Telegram
│   ├── utils/
│   │   ├── logger.js           # Sistema de logs
│   │   └── hash.js             # Geração de hash
│   └── index.js                # Arquivo principal
├── logs/                       # Arquivos de log
├── data/                       # Banco de dados SQLite
├── Dockerfile                  # Containerização
├── package.json
├── .env.dev                    # Variáveis de desenvolvimento
├── .env.prod                   # Variáveis de produção
└── README_v2.md
```

## 📚 Arquitetura

### Camadas

1. **Config** - Validação e carregamento de variáveis de ambiente
2. **Services** - Lógica de negócio (Mercado Livre, Telegram)
3. **Repositories** - Acesso a dados (SQLite)
4. **Utils** - Utilitários (logs, hash, etc)

### Fluxo

```
Scheduler (node-cron)
    ↓
monitorOffers() / monitorCoupons()
    ↓
mercadoLivreService.searchDiscountedOffers()
    ↓
database.offerExists() (verificar duplicata)
    ↓
telegramService.sendOfferMessage()
    ↓
database.addOfferToHistory() (salvar histórico)
```

## 🔒 Segurança

- ✅ Validação de variáveis de ambiente ao iniciar
- ✅ Tratamento robusto de erros
- ✅ Rate limit para evitar bloqueio
- ✅ Hash SHA256 para anti-duplicação
- ✅ Retry automático com backoff exponencial
- ✅ Logs de auditoria

## 📈 Métricas

O bot coleta as seguintes métricas:

- Total de ofertas verificadas
- Total de ofertas enviadas
- Total de cupons verificados
- Total de cupons enviados
- Total de erros

Acesse as métricas no banco de dados:

```bash
sqlite3 data/bot.db "SELECT * FROM metrics;"
```

## 🐛 Troubleshooting

### Bot não inicia

1. Verifique se todas as variáveis obrigatórias estão configuradas
2. Verifique os logs: `tail -f logs/app.log`
3. Teste a conexão com Telegram: `curl -X GET https://api.telegram.org/bot<TOKEN>/getMe`

### Nenhuma oferta é enviada

1. Verifique se o `MIN_DISCOUNT` não está muito alto
2. Verifique se o `TELEGRAM_CHANNEL_ID` está correto
3. Verifique os logs para erros

### Ofertas duplicadas

1. Limpe o histórico: `rm data/bot.db`
2. Reinicie o bot

## 📝 Logs

Os logs são salvos em `logs/app.log` com os seguintes níveis:

- `info` - Informações gerais
- `warn` - Avisos
- `error` - Erros
- `debug` - Informações de debug (apenas em desenvolvimento)

## 🤝 Contribuindo

Para contribuir com melhorias:

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

ISC

## 📞 Suporte

Para suporte, abra uma issue no repositório ou entre em contato com o desenvolvedor.

---

**Desenvolvido com ❤️ para JP Promos**

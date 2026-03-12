# Mercado Livre Offers Bot (Node.js Version) 🚀

Este é um bot de automação de alta performance desenvolvido em Node.js para monitorar ofertas do Mercado Livre e enviá-las automaticamente para um canal do Telegram com links de afiliado.

## ✨ Funcionalidades

- **Monitoramento Turbo**: Verificação a cada 2 minutos para capturar ofertas relâmpago.
- **Web Scraping Inteligente**: Contorna bloqueios da API oficial usando extração direta.
- **Monetização Automática**: Converte todos os links para o seu rastreio de afiliado.
- **Visual Premium**: Envia fotos dos produtos, preços formatados e cupons de desconto.
- **Links Curtos**: Encurtamento automático via TinyURL para mensagens mais limpas.
- **Controle de Duplicatas**: Nunca envia a mesma oferta duas vezes.

## 🛠️ Instalação

1. Certifique-se de ter o **Node.js** instalado (v16 ou superior).
2. Extraia os arquivos do projeto.
3. No terminal, dentro da pasta do projeto, instale as dependências:
   ```bash
   npm install
   ```

## ⚙️ Configuração

Edite o arquivo `config.json` com suas credenciais:

```json
{
    "ml": {
        "client_id": "SEU_CLIENT_ID",
        "client_secret": "SEU_CLIENT_SECRET",
        "access_token": "SEU_ACCESS_TOKEN",
        "refresh_token": "SEU_REFRESH_TOKEN"
    },
    "telegram": {
        "token": "TOKEN_DO_BOT",
        "chat_id": "ID_DO_CANAL",
        "channel_name": "NOME_DO_CANAL"
    },
    "affiliate": {
        "matt_tool": "79633859",
        "matt_word": "jhosephpereiradasilva",
        "ref": "..."
    },
    "filters": {
        "min_discount_percentage": 0
    }
}
```

## 🚀 Como Executar

Para iniciar o bot:
```bash
node index.js
```

## 📂 Estrutura do Projeto

- `index.js`: Orquestrador principal e loop de monitoramento.
- `mlAuth.js`: Gerenciamento de autenticação e renovação de tokens.
- `mlOffers.js`: Lógica de extração de ofertas e imagens.
- `telegramBot.js`: Integração com o Telegram e encurtamento de links.
- `config.json`: Configurações e credenciais.
- `history.json`: Armazena o histórico de ofertas já enviadas.

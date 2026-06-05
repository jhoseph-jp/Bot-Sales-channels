# 🚀 Bot Profissional de Ofertas do Mercado Livre para Telegram (v2.0)

Este projeto é uma refatoração completa de um bot de monitoramento de ofertas do Mercado Livre, projetado para ser robusto, escalável e pronto para produção em VPS Linux (Hostinger).

## 🎯 Funcionalidades Principais

- **Arquitetura Modular**: Separação clara de responsabilidades (`/src/services`, `/src/repositories`, `/src/config`, `/src/utils`).
- **Tratamento Global de Erros**: Sistema de logs profissional com `pino` e tratamento de exceções em todas as camadas.
- **Segurança Reforçada**: Validação rigorosa de variáveis de ambiente com `Joi` e refresh automático de tokens do Mercado Livre.
- **Controle de Duplicação**: Histórico persistente em **SQLite** para evitar o reenvio de ofertas.
- **Escalabilidade com Filas**: Uso de **BullMQ + Redis** para gerenciar o envio de mensagens e respeitar os limites de taxa (rate limits) do Telegram.
- **Pronto para Produção**: Configurado para rodar com **PM2** e suporte a múltiplos ambientes (`.env.dev`, `.env.prod`).

## 📁 Estrutura do Projeto

```text
ml-bot-pro/
├── src/
│   ├── config/          # Configurações e validação de ambiente
│   ├── controllers/     # Lógica de controle (opcional para expansão)
│   ├── services/        # Integrações externas (Telegram, Mercado Livre)
│   ├── repositories/    # Persistência de dados (SQLite)
│   ├── utils/           # Utilitários (Logger, Hash)
│   └── index.js         # Ponto de entrada da aplicação
├── tests/               # Testes automatizados (Jest)
├── data/                # Banco de dados SQLite (ignorado no git)
├── logs/                # Arquivos de log (ignorado no git)
├── .env.example         # Exemplo de configuração de ambiente
├── .gitignore           # Regras de exclusão para o git
├── package.json         # Dependências e scripts
└── README.md            # Documentação do projeto
```

## 🔧 Pré-requisitos

- **Node.js**: v18 ou superior.
- **Redis**: Necessário para o funcionamento das filas (BullMQ).
- **SQLite3**: Pré-instalado com o pacote `sqlite3`.

## 🚀 Como Rodar Localmente

1. **Instale as dependências**:
   ```bash
   npm install
   ```

2. **Configure o ambiente**:
   Copie o arquivo `.env.example` para `.env.dev`:
   ```bash
   cp .env.example .env.dev
   ```
   Preencha as variáveis no arquivo `.env.dev` com suas credenciais.

3. **Inicie o Redis** (se não estiver rodando):
   ```bash
   redis-server
   ```

4. **Rode em modo de desenvolvimento**:
   ```bash
   npm run dev
   ```

## 🌐 Como Rodar em Produção (VPS Hostinger)

1. **Instale o PM2 globalmente**:
   ```bash
   sudo npm install -g pm2
   ```

2. **Configure o ambiente de produção**:
   Crie o arquivo `.env.prod` com as credenciais reais de produção.

3. **Inicie a aplicação com PM2**:
   ```bash
   pm2 start src/index.js --name "ml-bot-pro" --env production
   ```

4. **Monitore os logs**:
   ```bash
   pm2 logs ml-bot-pro
   ```

## 🔐 Variáveis de Ambiente Necessárias

| Variável | Descrição |
| :--- | :--- |
| `TELEGRAM_TOKEN` | Token do seu bot criado no @BotFather |
| `TELEGRAM_CHAT_ID` | ID do canal ou grupo para envio das ofertas |
| `ML_CLIENT_ID` | Client ID da sua aplicação no Mercado Livre |
| `ML_CLIENT_SECRET` | Client Secret da sua aplicação no Mercado Livre |
| `ML_REFRESH_TOKEN` | Refresh Token inicial para gerar o Access Token |
| `REDIS_HOST` | Host do servidor Redis (padrão: 127.0.0.1) |
| `REDIS_PORT` | Porta do servidor Redis (padrão: 6379) |

## 🧪 Testes

Para rodar os testes automatizados:
```bash
npm test
```

---
**Desenvolvido por Manus AI** - Especialista em Automação e Backend.

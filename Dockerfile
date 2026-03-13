# Dockerfile para bot de ofertas do Mercado Livre

FROM node:18-alpine

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código-fonte
COPY src/ ./src/
COPY .env.prod ./.env.prod

# Criar diretórios necessários
RUN mkdir -p logs data

# Definir variáveis de ambiente
ENV NODE_ENV=production

# Executar o bot
CMD ["node", "src/index.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('OK')" || exit 1

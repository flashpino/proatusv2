# Backend — CPD Monitor v2 (API Node/Express)
# Build context no EasyPanel deve ser a pasta `backend/`.
FROM node:20-alpine

WORKDIR /app

# Instala só dependências de produção (cacheável)
COPY package*.json ./
RUN npm install --omit=dev

# Código da aplicação
COPY . .

# Roda como usuário sem privilégios; pré-cria diretórios graváveis
# (logs do Winston e firmware OTA — monte volume em /app/firmware)
RUN mkdir -p logs firmware && chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3001

# Healthcheck real: /health verifica MySQL + conexão MQTT (503 se degradado)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/health" || exit 1

CMD ["node", "src/index.js"]

# Backend — CPD Monitor v2 (API Node/Express)
# Build context no EasyPanel deve ser a pasta `backend/`.
FROM node:20-alpine

WORKDIR /app

# Instala só dependências de produção (cacheável)
COPY package*.json ./
RUN npm install --omit=dev

# Código da aplicação
COPY . .

ENV NODE_ENV=production
# Porta padrão do backend (ajuste via env PORT se necessário)
EXPOSE 3001

CMD ["node", "src/index.js"]

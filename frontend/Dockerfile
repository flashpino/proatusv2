# Frontend — CPD Monitor v2 (SPA Vite servido por Nginx)
# Build context no EasyPanel deve ser a pasta `frontend/`.

# --- Etapa 1: build do bundle Vite ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# --- Etapa 2: Nginx servindo os estáticos + proxy /api ---
FROM nginx:alpine

# Template processado por envsubst no boot (substitui ${BACKEND_URL}).
# A imagem oficial do nginx processa /etc/nginx/templates/*.template automaticamente.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

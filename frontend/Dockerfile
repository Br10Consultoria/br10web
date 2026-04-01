FROM node:22-alpine AS builder

WORKDIR /app

# Copiar arquivos de dependências
COPY package.json ./

# Instalar dependências com npm (não requer lockfile)
RUN npm install --legacy-peer-deps

# Copiar código e fazer build
COPY . .
RUN npm run build

# ─── Produção ────────────────────────────────────────────────────────────────
FROM nginx:alpine

LABEL maintainer="BR10 Consultoria <ti@br10consultoria.com.br>"

# Copiar build
COPY --from=builder /app/dist /usr/share/nginx/html

# Configuração do Nginx para SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

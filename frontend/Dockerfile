FROM node:22-alpine AS builder

WORKDIR /app

# Instalar pnpm
RUN npm install -g pnpm

# Copiar arquivos de dependências
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# Copiar código e fazer build
COPY . .
RUN pnpm run build

# ─── Produção ────────────────────────────────────────────────────────────────
FROM nginx:alpine

LABEL maintainer="BR10 Consultoria <ti@br10consultoria.com.br>"

# Copiar build
COPY --from=builder /app/dist /usr/share/nginx/html

# Configuração do Nginx para SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

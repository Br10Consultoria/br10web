#!/bin/bash
# ─── BR10 NetManager - Ativar SSL (Let's Encrypt) ────────────────────────────
# Usa modo webroot: o Nginx continua rodando durante a validação
# Execute: sudo bash scripts/enable-ssl.sh

set -euo pipefail

DOMAIN="br10web.br10consultoria.com.br"
EMAIL="ti@br10consultoria.com.br"
APP_DIR="/opt/br10web"
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
WEBROOT_DIR="$APP_DIR/nginx/certbot"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SSL] $1${NC}"; }
warn() { echo -e "${YELLOW}[WARN] $1${NC}"; }
error(){ echo -e "${RED}[ERROR] $1${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && error "Execute como root: sudo bash scripts/enable-ssl.sh"

cd "$APP_DIR"

# ─── Instalar Certbot se necessário ──────────────────────────────────────────
if ! command -v certbot &>/dev/null; then
    log "Instalando Certbot..."
    apt-get update -qq
    apt-get install -y -qq certbot
fi

# ─── Criar diretório webroot ──────────────────────────────────────────────────
log "Preparando diretório webroot para validação ACME..."
mkdir -p "$WEBROOT_DIR/.well-known/acme-challenge"
chmod -R 755 "$WEBROOT_DIR"

# Garantir que o volume está mapeado no docker-compose
# O nginx.conf já serve /.well-known/acme-challenge/ a partir de /var/www/certbot
# O docker-compose mapeia ./nginx/certbot:/var/www/certbot

# Recarregar nginx para garantir que está servindo o webroot
log "Recarregando Nginx..."
docker exec br10_nginx nginx -s reload 2>/dev/null || true
sleep 2

# ─── Testar acesso ao desafio ACME ───────────────────────────────────────────
log "Testando acesso ao desafio ACME via HTTP..."
TEST_FILE="$WEBROOT_DIR/.well-known/acme-challenge/test-$(date +%s)"
echo "ok" > "$TEST_FILE"
sleep 1

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    "http://$DOMAIN/.well-known/acme-challenge/$(basename $TEST_FILE)" 2>/dev/null || echo "000")
rm -f "$TEST_FILE"

if [ "$HTTP_CODE" = "200" ]; then
    log "Desafio ACME acessível (HTTP 200). Prosseguindo..."
else
    warn "Desafio ACME retornou HTTP $HTTP_CODE (esperado 200)."
    warn "Isso pode indicar que o DNS não aponta para este servidor ou o Nginx não está servindo o webroot."
    warn "Continuar mesmo assim? [s/N]"
    read -r CONFIRM
    [[ ! "$CONFIRM" =~ ^[sS]$ ]] && error "Abortado pelo usuário."
fi

# ─── Obter certificado SSL via webroot ───────────────────────────────────────
if [ ! -f "$CERT_PATH" ]; then
    log "Obtendo certificado SSL para $DOMAIN (modo webroot)..."
    certbot certonly \
        --webroot \
        --webroot-path "$WEBROOT_DIR" \
        --non-interactive \
        --agree-tos \
        --no-eff-email \
        --email "$EMAIL" \
        -d "$DOMAIN" \
        && log "Certificado SSL obtido com sucesso!" \
        || error "Falha ao obter certificado. Verifique se o DNS aponta para este servidor."
else
    log "Certificado SSL já existe para $DOMAIN."
fi

# ─── Ativar configuração HTTPS no Nginx ──────────────────────────────────────
log "Ativando configuração HTTPS no Nginx..."

CONF_DIR="$APP_DIR/nginx/conf.d"

# Substituir configuração HTTP por redirect + HTTPS
cat > "$CONF_DIR/br10web.conf" << NGINX_HTTP
# Redirect HTTP -> HTTPS
server {
    listen 80;
    server_name $DOMAIN _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
NGINX_HTTP

# Criar/ativar configuração HTTPS
cat > "$CONF_DIR/br10web-ssl.conf" << NGINX_HTTPS
server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location = /api/v1/auth/login {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /api/v1/terminal/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 60s;
    }

    location /health {
        proxy_pass http://backend;
        access_log off;
    }

    location /uploads/ {
        proxy_pass http://backend;
        proxy_set_header Host \$host;
        expires 7d;
        add_header Cache-Control "public";
    }

    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
    }
}
NGINX_HTTPS

# Montar o certificado no container nginx (via docker-compose volume)
# Restartar nginx para carregar nova configuração com SSL
log "Reiniciando Nginx com SSL..."
docker compose restart nginx
sleep 5

# Verificar se o Nginx subiu corretamente
if docker exec br10_nginx nginx -t 2>/dev/null; then
    log "═══════════════════════════════════════════════════"
    log "SSL ativado com sucesso!"
    log "Acesse: https://$DOMAIN"
    log "═══════════════════════════════════════════════════"
else
    error "Nginx falhou ao carregar a configuração SSL. Verifique os logs: docker compose logs nginx"
fi

# ─── Configurar renovação automática ─────────────────────────────────────────
log "Configurando renovação automática do certificado..."
cat > /etc/cron.d/certbot-br10 << CRON
# Renovação automática do certificado Let's Encrypt - BR10 NetManager
0 3 * * * root certbot renew --webroot --webroot-path $WEBROOT_DIR --quiet && docker exec br10_nginx nginx -s reload
CRON
chmod 644 /etc/cron.d/certbot-br10
log "Renovação automática configurada (diariamente às 03:00)."

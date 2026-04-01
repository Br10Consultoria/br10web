#!/bin/bash
# ─── BR10 NetManager - Ativar SSL (Let's Encrypt) ────────────────────────────
# Execute APÓS o certificado ser emitido: sudo bash scripts/enable-ssl.sh

set -euo pipefail

DOMAIN="br10web.br10consultoria.com.br"
EMAIL="ti@br10consultoria.com.br"
APP_DIR="/opt/br10web"
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SSL] $1${NC}"; }
warn() { echo -e "${YELLOW}[WARN] $1${NC}"; }
error(){ echo -e "${RED}[ERROR] $1${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && error "Execute como root: sudo bash scripts/enable-ssl.sh"

cd "$APP_DIR"

# ─── Obter certificado SSL ───────────────────────────────────────────────────
if [ ! -f "$CERT_PATH" ]; then
    log "Obtendo certificado SSL para $DOMAIN..."

    # Parar o Nginx temporariamente para liberar a porta 80
    docker compose stop nginx 2>/dev/null || docker-compose stop nginx 2>/dev/null || true
    sleep 2

    certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        -d "$DOMAIN" \
        --preferred-challenges http \
        && log "Certificado SSL obtido!" \
        || error "Falha ao obter certificado. Verifique se o DNS aponta para este servidor."
else
    log "Certificado SSL já existe para $DOMAIN."
fi

# ─── Ativar configuração HTTPS ───────────────────────────────────────────────
log "Ativando configuração HTTPS no Nginx..."

CONF_DIR="$APP_DIR/nginx/conf.d"

# Desativar configuração HTTP pura
if [ -f "$CONF_DIR/br10web.conf" ]; then
    mv "$CONF_DIR/br10web.conf" "$CONF_DIR/br10web.conf.http-backup"
    log "Configuração HTTP movida para backup."
fi

# Ativar configuração HTTPS
if [ -f "$CONF_DIR/br10web-ssl.conf.disabled" ]; then
    cp "$CONF_DIR/br10web-ssl.conf.disabled" "$CONF_DIR/br10web.conf"
    log "Configuração HTTPS ativada."
else
    error "Arquivo br10web-ssl.conf.disabled não encontrado!"
fi

# ─── Reiniciar Nginx ─────────────────────────────────────────────────────────
log "Reiniciando Nginx com SSL..."
docker compose restart nginx 2>/dev/null || docker-compose restart nginx 2>/dev/null

sleep 5

log "═══════════════════════════════════════════════════"
log "SSL ativado com sucesso!"
log "Acesse: https://$DOMAIN"
log "═══════════════════════════════════════════════════"

# Configurar renovação automática
echo "0 12 * * * root certbot renew --quiet && docker compose -f $APP_DIR/docker-compose.yml restart nginx" \
    > /etc/cron.d/certbot-br10
log "Renovação automática configurada."

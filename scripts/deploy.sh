#!/bin/bash
# ─── BR10 Network Manager - Script de Deploy/Atualização ─────────────────────
set -euo pipefail

APP_DIR="/opt/br10web"
BACKUP_BEFORE_DEPLOY="${BACKUP_BEFORE_DEPLOY:-true}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')] $1${NC}"; }
warn() { echo -e "${YELLOW}[WARN] $1${NC}"; }
error() { echo -e "${RED}[ERROR] $1${NC}"; exit 1; }

cd "$APP_DIR" || error "Diretório $APP_DIR não encontrado"

log "Iniciando deploy..."

# Backup antes do deploy
if [ "$BACKUP_BEFORE_DEPLOY" = "true" ]; then
    log "Criando backup antes do deploy..."
    docker-compose exec -T backend curl -s -X POST http://localhost:8000/api/v1/backup/create \
        -H "X-API-Key: $(grep BACKUP_API_KEY .env | cut -d'=' -f2)" || warn "Backup falhou, continuando..."
fi

# Pull das últimas alterações
log "Atualizando código..."
git pull origin main

# Rebuild e restart
log "Reconstruindo imagens..."
docker-compose build --no-cache backend frontend

log "Reiniciando serviços..."
docker-compose up -d --force-recreate backend frontend

# Aguardar health check
log "Verificando saúde dos serviços..."
sleep 15
if docker-compose ps | grep -q "unhealthy"; then
    error "Serviços com problemas! Verifique: docker-compose logs"
fi

log "Deploy concluído com sucesso!"
docker-compose ps

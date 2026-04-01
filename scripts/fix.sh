#!/bin/bash
# ─── BR10 NetManager - Script de Diagnóstico e Correção Rápida ───────────────
# Uso: sudo bash scripts/fix.sh
# Resolve: porta 80/443 em uso, containers parados, backend sem banco

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[FIX] $1${NC}"; }
warn() { echo -e "${YELLOW}[WARN] $1${NC}"; }
info() { echo -e "${BLUE}[INFO] $1${NC}"; }

[[ $EUID -ne 0 ]] && echo "Execute como root: sudo bash scripts/fix.sh" && exit 1

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

log "═══════════════════════════════════════════════════"
log "   BR10 NetManager - Diagnóstico e Correção"
log "═══════════════════════════════════════════════════"

# ─── 1. Diagnóstico de portas ────────────────────────────────────────────────
info "Verificando portas 80 e 443..."
for PORT in 80 443; do
    PROCS=$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -v "Netid" || true)
    if [ -n "$PROCS" ]; then
        warn "Porta $PORT em uso:"
        echo "$PROCS"
    else
        log "Porta $PORT livre."
    fi
done

# ─── 2. Parar TODOS os serviços que usam porta 80/443 ───────────────────────
log "Liberando portas 80 e 443..."

# Parar serviços conhecidos
for SVC in apache2 apache nginx lighttpd httpd caddy haproxy; do
    if systemctl is-active --quiet "$SVC" 2>/dev/null; then
        warn "Parando serviço: $SVC"
        systemctl stop "$SVC" 2>/dev/null || true
        systemctl disable "$SVC" 2>/dev/null || true
    fi
done

# Matar processos por porta usando fuser (mais confiável que lsof no Debian)
for PORT in 80 443; do
    if command -v fuser &>/dev/null; then
        fuser -k "${PORT}/tcp" 2>/dev/null || true
    elif command -v lsof &>/dev/null; then
        for PID in $(lsof -ti :"$PORT" 2>/dev/null || true); do
            PROC=$(ps -p "$PID" -o comm= 2>/dev/null || echo "?")
            warn "Matando processo $PROC (PID $PID) na porta $PORT"
            kill -9 "$PID" 2>/dev/null || true
        done
    fi
done

sleep 2

# Verificar se as portas foram liberadas
for PORT in 80 443; do
    if ss -tlnp "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
        warn "Porta $PORT ainda em uso após tentativa de liberação!"
        ss -tlnp "sport = :$PORT" 2>/dev/null
    else
        log "Porta $PORT liberada com sucesso."
    fi
done

# ─── 3. Verificar se .env existe ────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
    warn "Arquivo .env não encontrado! Gerando a partir do .env.example..."
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"

    SECRET_KEY=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+' | head -c 24)
    REDIS_PASSWORD=$(openssl rand -base64 16 | tr -d '=/+' | head -c 16)
    BACKUP_API_KEY=$(openssl rand -hex 16)

    sed -i "s/CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32/$SECRET_KEY/"    "$APP_DIR/.env"
    sed -i "s/CHANGE_ME_STRONG_PASSWORD_HERE/$DB_PASSWORD/"                 "$APP_DIR/.env"
    sed -i "s/CHANGE_ME_REDIS_PASSWORD/$REDIS_PASSWORD/"                    "$APP_DIR/.env"
    sed -i "s/CHANGE_ME_BACKUP_API_KEY/$BACKUP_API_KEY/"                    "$APP_DIR/.env"

    log "Arquivo .env gerado."
    info "DB_PASSWORD:    $DB_PASSWORD"
    info "REDIS_PASSWORD: $REDIS_PASSWORD"
else
    log "Arquivo .env encontrado."
fi

# ─── 4. Derrubar containers antigos ─────────────────────────────────────────
log "Derrubando containers antigos..."
docker compose down --remove-orphans 2>/dev/null || docker-compose down --remove-orphans 2>/dev/null || true

# ─── 5. Subir containers ────────────────────────────────────────────────────
log "Subindo containers..."
DC_CMD="docker compose"
command -v docker-compose &>/dev/null && DC_CMD="docker-compose"
docker compose version &>/dev/null 2>&1 && DC_CMD="docker compose"

$DC_CMD up -d --build

log "Aguardando inicialização (60s)..."
sleep 60

# ─── 6. Verificar status ─────────────────────────────────────────────────────
log "Status dos containers:"
$DC_CMD ps

log "Logs do backend (últimas 30 linhas):"
$DC_CMD logs --tail=30 backend

log "═══════════════════════════════════════════════════"
log "Acesse: http://br10web.br10consultoria.com.br"
log "Usuário: admin | Senha: Admin@BR10!"
log "═══════════════════════════════════════════════════"

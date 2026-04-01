#!/bin/bash
# ─── BR10 NetManager - Script de Reset do Banco de Dados ──────────────────────
# Resolve o problema de "password authentication failed" quando o volume
# do PostgreSQL foi criado com credenciais diferentes do .env atual.
# USO: sudo bash scripts/reset-db.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()    { echo -e "${GREEN}[reset-db]${NC} $1"; }
warn()   { echo -e "${YELLOW}[reset-db]${NC} $1"; }
error()  { echo -e "${RED}[reset-db]${NC} $1"; }
info()   { echo -e "${BLUE}[reset-db]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

log "=== BR10 NetManager - Reset de Credenciais do Banco ==="
echo ""

# ─── Verificar se .env existe ────────────────────────────────────────────────
if [ ! -f ".env" ]; then
    error "Arquivo .env não encontrado em $PROJECT_DIR"
    error "Execute primeiro: sudo bash scripts/install.sh"
    exit 1
fi

# ─── Carregar variáveis do .env ──────────────────────────────────────────────
source .env 2>/dev/null || true
DB_USER="${DB_USER:-br10user}"
DB_NAME="${DB_NAME:-br10netmanager}"
DB_PASSWORD="${DB_PASSWORD:-}"

if [ -z "$DB_PASSWORD" ]; then
    error "DB_PASSWORD não definido no .env"
    exit 1
fi

log "Usuário do banco: $DB_USER"
log "Nome do banco: $DB_NAME"
echo ""

warn "ATENÇÃO: Este script irá:"
warn "  1. Parar todos os containers"
warn "  2. REMOVER o volume do PostgreSQL (dados serão perdidos)"
warn "  3. Recriar o banco com as credenciais corretas do .env"
warn "  4. Subir todos os containers novamente"
echo ""
warn "Se você tem dados importantes, faça backup antes de continuar!"
echo ""
read -p "Deseja continuar? (s/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[sS]$ ]]; then
    info "Operação cancelada."
    exit 0
fi

echo ""

# ─── Parar containers ────────────────────────────────────────────────────────
log "Parando todos os containers..."
docker compose down --remove-orphans 2>/dev/null || true

# ─── Remover volume do PostgreSQL ────────────────────────────────────────────
log "Removendo volume do PostgreSQL..."
VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep -E "br10web_postgres_data|br10_postgres" | head -1)
if [ -n "$VOLUME_NAME" ]; then
    docker volume rm "$VOLUME_NAME" 2>/dev/null && log "Volume '$VOLUME_NAME' removido." || warn "Não foi possível remover o volume."
else
    warn "Volume do PostgreSQL não encontrado (pode já ter sido removido)."
fi

# ─── Subir apenas o banco primeiro ──────────────────────────────────────────
log "Iniciando banco de dados com as novas credenciais..."
docker compose up -d db

log "Aguardando banco de dados inicializar (30s)..."
sleep 10

MAX=20
RETRY=0
until docker compose exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX ]; then
        error "Banco não respondeu após ${MAX} tentativas."
        docker compose logs db
        exit 1
    fi
    echo -n "."
    sleep 3
done
echo ""
log "Banco de dados pronto!"

# ─── Subir todos os containers ──────────────────────────────────────────────
log "Subindo todos os containers..."
docker compose up -d

log "Aguardando backend inicializar (60s)..."
sleep 60

# ─── Verificar status ────────────────────────────────────────────────────────
echo ""
log "=== Status dos Containers ==="
docker compose ps

echo ""
log "=== Últimas linhas do log do backend ==="
docker compose logs --tail=15 backend

echo ""
log "=== Reset concluído! ==="
log "Acesse: http://br10web.br10consultoria.com.br"
log "Usuário: admin"
log "Senha:   Admin@BR10!"

#!/bin/bash
# ============================================================================
# BR10 NetManager — Script de Diagnóstico de Sessão/Autenticação
# ============================================================================
# Uso: bash diagnostico-sessao.sh [diretorio-do-projeto]
# Exemplo: bash diagnostico-sessao.sh /opt/br10web
#
# O script coleta logs dos containers, verifica variáveis de ambiente críticas
# e exibe os eventos de autenticação mais recentes.
# ============================================================================

PROJECT_DIR="${1:-/opt/br10web}"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
REPORT="/tmp/br10_diag_${TIMESTAMP}.txt"

RED='\033[0;31m'
YEL='\033[1;33m'
GRN='\033[0;32m'
BLU='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLU}[INFO]${NC} $*" | tee -a "$REPORT"; }
warn() { echo -e "${YEL}[WARN]${NC} $*" | tee -a "$REPORT"; }
err()  { echo -e "${RED}[ERRO]${NC} $*" | tee -a "$REPORT"; }
ok()   { echo -e "${GRN}[ OK ]${NC} $*" | tee -a "$REPORT"; }

echo "============================================================" | tee "$REPORT"
echo " BR10 NetManager — Diagnóstico de Sessão/Autenticação"       | tee -a "$REPORT"
echo " Data: $(date)"                                               | tee -a "$REPORT"
echo "============================================================" | tee -a "$REPORT"

# ── 1. Status dos containers ──────────────────────────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 1. STATUS DOS CONTAINERS ==="
cd "$PROJECT_DIR" 2>/dev/null || { err "Diretório $PROJECT_DIR não encontrado"; exit 1; }

docker compose ps 2>&1 | tee -a "$REPORT"

# Verificar se backend está rodando
if docker compose ps backend 2>/dev/null | grep -q "running\|Up"; then
    ok "Container 'backend' está rodando"
else
    err "Container 'backend' NÃO está rodando — isso explica o problema de login!"
fi

# ── 2. Verificar SECRET_KEY ───────────────────────────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 2. VERIFICAÇÃO DO SECRET_KEY ==="

# Verificar se SECRET_KEY está definida no .env
if [ -f "$PROJECT_DIR/.env" ]; then
    if grep -q "^SECRET_KEY=" "$PROJECT_DIR/.env"; then
        SECRET_LEN=$(grep "^SECRET_KEY=" "$PROJECT_DIR/.env" | cut -d'=' -f2 | tr -d '"' | wc -c)
        if [ "$SECRET_LEN" -gt 20 ]; then
            ok "SECRET_KEY definida no .env (${SECRET_LEN} caracteres)"
        else
            warn "SECRET_KEY muito curta (${SECRET_LEN} chars) — pode causar tokens inválidos"
        fi
    else
        err "SECRET_KEY NÃO está definida no .env!"
        err "Sem SECRET_KEY fixa, o Python gera uma nova a cada restart do container."
        err "Isso invalida TODOS os tokens existentes quando o container reinicia."
        err "SOLUÇÃO: Adicionar ao .env:"
        err "  SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')"
    fi
else
    warn "Arquivo .env não encontrado em $PROJECT_DIR"
fi

# Verificar SECRET_KEY no container em execução
log "SECRET_KEY no container (primeiros 10 chars):"
docker compose exec -T backend sh -c \
    'python3 -c "from app.core.config import settings; print(settings.SECRET_KEY[:10] + \"...\")"' \
    2>&1 | tee -a "$REPORT"

# ── 3. Verificar tempos de expiração dos tokens ───────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 3. CONFIGURAÇÃO DE TOKENS ==="

docker compose exec -T backend sh -c '
python3 -c "
from app.core.config import settings
print(f\"ACCESS_TOKEN_EXPIRE_MINUTES : {settings.ACCESS_TOKEN_EXPIRE_MINUTES} min ({settings.ACCESS_TOKEN_EXPIRE_MINUTES/60:.1f}h)\")
print(f\"REFRESH_TOKEN_EXPIRE_DAYS   : {settings.REFRESH_TOKEN_EXPIRE_DAYS} dias\")
print(f\"MAX_LOGIN_ATTEMPTS          : {settings.MAX_LOGIN_ATTEMPTS}\")
print(f\"LOCKOUT_DURATION_MINUTES    : {settings.LOCKOUT_DURATION_MINUTES} min\")
"
' 2>&1 | tee -a "$REPORT"

# ── 4. Logs de autenticação recentes ─────────────────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 4. LOGS DO BACKEND (últimas 200 linhas) ==="
docker compose logs --tail=200 backend 2>&1 | tee -a "$REPORT"

# ── 5. Filtrar eventos de autenticação nos logs ───────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 5. EVENTOS DE AUTENTICAÇÃO (filtrado) ==="

echo "--- Erros de token/JWT:" | tee -a "$REPORT"
docker compose logs --tail=500 backend 2>&1 | \
    grep -iE "token|jwt|401|auth|session|refresh|expire|invalid|decode" | \
    tail -50 | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "--- Erros críticos (ERROR/CRITICAL):" | tee -a "$REPORT"
docker compose logs --tail=500 backend 2>&1 | \
    grep -iE "ERROR|CRITICAL|Exception|Traceback" | \
    tail -30 | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "--- Reinicializações do container:" | tee -a "$REPORT"
docker compose logs --tail=500 backend 2>&1 | \
    grep -iE "startup|shutdown|started|uvicorn|Application" | \
    tail -20 | tee -a "$REPORT"

# ── 6. Verificar banco de dados ───────────────────────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 6. ÚLTIMOS EVENTOS DE AUDITORIA NO BANCO ==="

docker compose exec -T backend sh -c '
python3 -c "
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def check():
    async with AsyncSessionLocal() as db:
        result = await db.execute(text(\"\"\"
            SELECT action, status, description, ip_address, created_at
            FROM audit_logs
            WHERE action IN (
                '"'"'login'"'"', '"'"'login_failed'"'"', '"'"'logout'"'"',
                '"'"'token_refresh_failed'"'"', '"'"'session_expired'"'"',
                '"'"'frontend_error'"'"'
            )
            ORDER BY created_at DESC
            LIMIT 30
        \"\"\"))
        rows = result.fetchall()
        if not rows:
            print(\"Nenhum evento de autenticação encontrado na auditoria.\")
        for r in rows:
            print(f\"{r.created_at} | {r.action:30s} | {r.status:10s} | {r.ip_address:15s} | {str(r.description)[:60]}\")

asyncio.run(check())
"
' 2>&1 | tee -a "$REPORT"

# ── 7. Verificar usuários bloqueados ─────────────────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 7. USUÁRIOS BLOQUEADOS ==="

docker compose exec -T backend sh -c '
python3 -c "
import asyncio
from datetime import datetime
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def check():
    async with AsyncSessionLocal() as db:
        result = await db.execute(text(\"\"\"
            SELECT username, failed_login_attempts, locked_until, last_login, is_active
            FROM users
            ORDER BY username
        \"\"\"))
        rows = result.fetchall()
        print(f\"{'Usuario':<20} {'Tentativas':<12} {'Bloqueado até':<25} {'Ativo':<6} {'Último login'}\")
        print(\"-\" * 90)
        for r in rows:
            locked = str(r.locked_until) if r.locked_until else \"Não\"
            now = datetime.utcnow()
            if r.locked_until and r.locked_until > now:
                locked = f\"*** {r.locked_until} *** BLOQUEADO\".upper()
            print(f\"{r.username:<20} {r.failed_login_attempts:<12} {locked:<25} {str(r.is_active):<6} {str(r.last_login)}\")

asyncio.run(check())
"
' 2>&1 | tee -a "$REPORT"

# ── 8. Testar endpoint de login ───────────────────────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 8. TESTE DE CONECTIVIDADE DO BACKEND ==="

# Verificar se o backend responde
if curl -sf "http://localhost:8000/api/v1/health" > /dev/null 2>&1; then
    ok "Backend respondendo em http://localhost:8000"
elif curl -sf "http://localhost:8000/docs" > /dev/null 2>&1; then
    ok "Backend respondendo (sem /health, mas /docs OK)"
else
    err "Backend NÃO está respondendo em localhost:8000"
    log "Tentando via container..."
    docker compose exec -T backend curl -sf http://localhost:8000/docs > /dev/null 2>&1 && \
        ok "Backend responde internamente" || \
        err "Backend não responde nem internamente"
fi

# ── 9. Verificar nginx/proxy ──────────────────────────────────────────────────
echo "" | tee -a "$REPORT"
log "=== 9. CONFIGURAÇÃO DE PROXY/NGINX ==="

if docker compose ps nginx 2>/dev/null | grep -q "running\|Up"; then
    log "Logs do nginx (últimas 20 linhas):"
    docker compose logs --tail=20 nginx 2>&1 | tee -a "$REPORT"
fi

# ── 10. Resumo e recomendações ────────────────────────────────────────────────
echo "" | tee -a "$REPORT"
echo "============================================================" | tee -a "$REPORT"
echo " RESUMO DO DIAGNÓSTICO"                                        | tee -a "$REPORT"
echo "============================================================" | tee -a "$REPORT"

# Verificar SECRET_KEY novamente para resumo
if [ -f "$PROJECT_DIR/.env" ] && grep -q "^SECRET_KEY=" "$PROJECT_DIR/.env"; then
    ok "SECRET_KEY: Definida no .env (tokens persistem entre restarts)"
else
    err "SECRET_KEY: NÃO DEFINIDA — CAUSA MAIS PROVÁVEL DO PROBLEMA!"
    echo "" | tee -a "$REPORT"
    echo "  Para corrigir, execute:" | tee -a "$REPORT"
    echo "" | tee -a "$REPORT"
    echo "  echo \"SECRET_KEY=\$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')\" >> $PROJECT_DIR/.env" | tee -a "$REPORT"
    echo "  cd $PROJECT_DIR && docker compose up -d --build backend" | tee -a "$REPORT"
fi

echo "" | tee -a "$REPORT"
log "Relatório salvo em: $REPORT"
echo ""
echo -e "${GRN}Para compartilhar o relatório:${NC} cat $REPORT"

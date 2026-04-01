#!/bin/sh
# ─── BR10 NetManager - Backend Entrypoint ─────────────────────────────────────
set -e

echo "[entrypoint] Iniciando BR10 NetManager Backend..."

# ─── Extrair credenciais do banco da DATABASE_URL ────────────────────────────
# Formato: postgresql+asyncpg://user:pass@host:port/dbname
DB_URL="${DATABASE_URL:-}"
DB_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
DB_PORT=$(echo "$DB_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_USER=$(echo "$DB_URL" | sed -E 's|.*://([^:]+):.*|\1|')
DB_NAME=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')

# Fallback para valores padrão
DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-br10user}"
DB_NAME="${DB_NAME:-br10netmanager}"

echo "[entrypoint] Conectando em: $DB_HOST:$DB_PORT/$DB_NAME como $DB_USER"

# ─── Aguardar o banco de dados ficar disponível ──────────────────────────────
echo "[entrypoint] Aguardando banco de dados..."
MAX_RETRIES=40
RETRY=0

until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t 3 > /dev/null 2>&1; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "[entrypoint] ERRO: Banco de dados nao respondeu apos ${MAX_RETRIES} tentativas."
        exit 1
    fi
    echo "[entrypoint] Banco nao disponivel. Tentativa $RETRY/$MAX_RETRIES. Aguardando 3s..."
    sleep 3
done

echo "[entrypoint] Banco de dados disponivel!"

# ─── Executar migrations do Alembic ─────────────────────────────────────────
echo "[entrypoint] Executando migrations..."
cd /app

if alembic upgrade head 2>&1; then
    echo "[entrypoint] Migrations aplicadas com sucesso."
else
    echo "[entrypoint] Alembic falhou. Usando create_all como fallback..."
    python3 -c "
import asyncio
from app.core.database import engine
from app.models.base import Base
import app.models.user
import app.models.device
import app.models.vpn
import app.models.audit

async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print('[entrypoint] Tabelas criadas via create_all.')

asyncio.run(create_tables())
" && echo "[entrypoint] Fallback create_all concluido." || echo "[entrypoint] Aviso: create_all tambem falhou, tentando continuar..."
fi

# ─── Criar usuário admin padrão (se não existir) ─────────────────────────────
echo "[entrypoint] Verificando usuario admin..."
python3 -c "
import asyncio
import sys

async def create_admin():
    try:
        from app.core.database import AsyncSessionLocal
        from app.models.user import User, UserRole
        from app.core.security import hash_password
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.username == 'admin'))
            existing = result.scalar_one_or_none()
            if existing:
                print('[entrypoint] Usuario admin ja existe.')
                return
            admin = User(
                username='admin',
                email='admin@br10consultoria.com.br',
                full_name='Administrador BR10',
                hashed_password=hash_password('Admin@BR10!'),
                role=UserRole.ADMIN,
                is_active=True,
                is_verified=True,
                totp_enabled=False,
            )
            db.add(admin)
            await db.commit()
            print('[entrypoint] Usuario admin criado: admin / Admin@BR10!')
    except Exception as e:
        print(f'[entrypoint] Aviso ao criar admin: {e}', file=sys.stderr)

asyncio.run(create_admin())
" 2>&1 || echo "[entrypoint] Aviso: nao foi possivel verificar/criar admin agora."

# ─── Iniciar o servidor FastAPI ──────────────────────────────────────────────
echo "[entrypoint] Iniciando servidor FastAPI na porta 8000..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 2 \
    --proxy-headers \
    --forwarded-allow-ips='*' \
    --log-level info

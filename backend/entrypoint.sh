#!/bin/sh
# ─── BR10 NetManager - Backend Entrypoint ─────────────────────────────────────
set -e

echo "[entrypoint] Iniciando BR10 NetManager Backend..."

# ─── Extrair credenciais do banco da DATABASE_URL ────────────────────────────
DB_URL="${DATABASE_URL:-}"
DB_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
DB_PORT=$(echo "$DB_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_USER=$(echo "$DB_URL" | sed -E 's|.*://([^:]+):.*|\1|')
DB_NAME=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')

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

# ─── Criar tabelas com create_all (idempotente) ──────────────────────────────
echo "[entrypoint] Criando/verificando tabelas do banco de dados..."
python3 << 'PYEOF'
import asyncio
import sys

async def init_database():
    try:
        from sqlalchemy.ext.asyncio import create_async_engine
        from sqlalchemy import text
        import os

        db_url = os.environ.get("DATABASE_URL", "")

        # Importar todos os modelos para registrar no metadata
        from app.models.base import Base
        import app.models.user
        import app.models.device
        import app.models.vpn
        import app.models.audit

        engine = create_async_engine(db_url, echo=False)

        async with engine.begin() as conn:
            # Criar ENUMs manualmente com IF NOT EXISTS para evitar duplicatas
            enums_sql = [
                "DO $$ BEGIN CREATE TYPE userrole AS ENUM ('ADMIN', 'TECHNICIAN', 'VIEWER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
                "DO $$ BEGIN CREATE TYPE vpntype AS ENUM ('L2TP', 'PPTP', 'OPENVPN', 'IPSEC', 'WIREGUARD', 'GRE', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
                "DO $$ BEGIN CREATE TYPE vpnstatus AS ENUM ('ACTIVE', 'INACTIVE', 'CONNECTING', 'ERROR', 'DISABLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
                "DO $$ BEGIN CREATE TYPE auditaction AS ENUM ('LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'DEVICE_CREATE', 'DEVICE_UPDATE', 'DEVICE_DELETE', 'DEVICE_VIEW', 'CREDENTIAL_CREATE', 'CREDENTIAL_UPDATE', 'CREDENTIAL_DELETE', 'VPN_CREATE', 'VPN_UPDATE', 'VPN_DELETE', 'ROUTE_CREATE', 'ROUTE_UPDATE', 'ROUTE_DELETE', 'BACKUP_CREATE', 'BACKUP_RESTORE', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'TERMINAL_CONNECT', 'TERMINAL_DISCONNECT', 'SETTINGS_UPDATE', '2FA_ENABLE', '2FA_DISABLE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
            ]
            for sql in enums_sql:
                await conn.execute(text(sql))

            # Criar tabelas (checkfirst=True nao recria se ja existem)
            await conn.run_sync(Base.metadata.create_all, checkfirst=True)

        await engine.dispose()
        print("[entrypoint] Tabelas criadas/verificadas com sucesso.")
        return True

    except Exception as e:
        print(f"[entrypoint] ERRO ao criar tabelas: {e}", file=sys.stderr)
        return False

result = asyncio.run(init_database())
sys.exit(0 if result else 1)
PYEOF

echo "[entrypoint] Banco de dados inicializado!"

# ─── Criar usuário admin padrão (se não existir) ─────────────────────────────
echo "[entrypoint] Verificando usuario admin..."
python3 << 'PYEOF'
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
PYEOF

# ─── Criar diretórios VPN (garantir permissões corretas em runtime) ──────────
echo "[entrypoint] Preparando diretórios VPN..."
VPN_BASE="${VPN_BASE_DIR:-/app/vpn}"
mkdir -p \
    "${VPN_BASE}/xl2tpd" \
    "${VPN_BASE}/ppp/peers" \
    "${VPN_BASE}/run" \
    "${VPN_BASE}/log"
chmod -R 755 "${VPN_BASE}" 2>/dev/null || true
echo "[entrypoint] Diretórios VPN prontos em ${VPN_BASE}"

echo "[entrypoint] Iniciando servidor FastAPI na porta 8000..."
# Usar 1 worker para evitar scheduler duplicado (FastAPI async é eficiente com 1 worker)
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 1 \
    --proxy-headers \
    --forwarded-allow-ips='*' \
    --log-level info

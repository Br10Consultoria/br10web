#!/bin/sh
# ─── BR10 NetManager - Backend Entrypoint ─────────────────────────────────────
set -e

echo "[entrypoint] Iniciando BR10 NetManager Backend..."

# ─── Aguardar o banco de dados ficar disponível ──────────────────────────────
echo "[entrypoint] Aguardando banco de dados..."
MAX_RETRIES=30
RETRY=0

until python3 -c "
import asyncio, asyncpg, os, sys
async def check():
    url = os.environ.get('DATABASE_URL', '')
    # Converter URL asyncpg para formato nativo
    url = url.replace('postgresql+asyncpg://', 'postgresql://')
    try:
        conn = await asyncpg.connect(url, timeout=5)
        await conn.close()
        print('DB OK')
    except Exception as e:
        print(f'DB not ready: {e}', file=sys.stderr)
        sys.exit(1)
asyncio.run(check())
" 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "[entrypoint] ERRO: Banco de dados não respondeu após ${MAX_RETRIES} tentativas."
        exit 1
    fi
    echo "[entrypoint] Banco de dados não disponível. Tentativa $RETRY/$MAX_RETRIES. Aguardando 3s..."
    sleep 3
done

echo "[entrypoint] Banco de dados disponível!"

# ─── Executar migrations do Alembic ─────────────────────────────────────────
echo "[entrypoint] Executando migrations do banco de dados..."
cd /app

# Tentar alembic upgrade head; se falhar, usar create_all como fallback
if alembic upgrade head 2>&1; then
    echo "[entrypoint] Migrations aplicadas com sucesso."
else
    echo "[entrypoint] Alembic falhou. Usando create_all como fallback..."
    python3 -c "
import asyncio
from app.core.database import init_db
asyncio.run(init_db())
print('[entrypoint] Tabelas criadas via create_all.')
"
fi

# ─── Criar usuário admin padrão (se não existir) ─────────────────────────────
echo "[entrypoint] Verificando usuário admin..."
python3 -c "
import asyncio
import os
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
                print('[entrypoint] Usuário admin já existe.')
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
            print('[entrypoint] Usuário admin criado: admin / Admin@BR10!')
    except Exception as e:
        print(f'[entrypoint] Aviso ao criar admin: {e}', file=sys.stderr)

asyncio.run(create_admin())
" 2>&1 || echo "[entrypoint] Aviso: não foi possível verificar/criar admin agora."

# ─── Iniciar o servidor FastAPI ──────────────────────────────────────────────
echo "[entrypoint] Iniciando servidor FastAPI..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 2 \
    --proxy-headers \
    --forwarded-allow-ips='*' \
    --log-level info

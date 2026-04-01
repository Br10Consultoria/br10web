#!/bin/bash
# =============================================
# BR10 NetManager - Database Init Script
# Inicializa o banco de dados PostgreSQL
# =============================================

set -euo pipefail

DB_NAME="${DB_NAME:-br10netmanager}"
DB_USER="${DB_USER:-br10user}"
DB_PASSWORD="${DB_PASSWORD:-br10password}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

echo "=== Inicializando banco de dados BR10 NetManager ==="

# Criar usuário e banco
sudo -u postgres psql <<EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
        CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
        RAISE NOTICE 'Usuário ${DB_USER} criado';
    ELSE
        ALTER ROLE ${DB_USER} PASSWORD '${DB_PASSWORD}';
        RAISE NOTICE 'Senha do usuário ${DB_USER} atualizada';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec

GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
EOF

echo "Banco de dados inicializado: ${DB_NAME}"
echo "Usuário: ${DB_USER}"
echo ""
echo "Para criar as tabelas, execute:"
echo "  cd /app && python3 -c 'import asyncio; from app.core.database import init_db; asyncio.run(init_db())'"

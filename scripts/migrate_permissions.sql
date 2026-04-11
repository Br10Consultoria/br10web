-- ─── Migração: Sistema de Permissões Granulares ───────────────────────────────
-- Cria as tabelas user_permissions e user_client_scopes no banco existente.
-- Este script é idempotente — pode ser executado múltiplas vezes sem erro.

BEGIN;

-- ─── Tabela de permissões por módulo ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module      VARCHAR(50) NOT NULL,
    access_level VARCHAR(20) NOT NULL DEFAULT 'view',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_permission_module UNIQUE (user_id, module)
);

CREATE INDEX IF NOT EXISTS ix_user_permissions_user_id ON user_permissions(user_id);

-- ─── Tabela de escopo de clientes por usuário ─────────────────────────────────
CREATE TABLE IF NOT EXISTS user_client_scopes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_client_scope UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS ix_user_client_scopes_user_id ON user_client_scopes(user_id);

COMMIT;

-- Verificação
SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) AS columns
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('user_permissions', 'user_client_scopes')
ORDER BY table_name;

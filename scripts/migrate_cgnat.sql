-- ─── BR10 NetManager — Migração CGNAT ────────────────────────────────────────
-- Script idempotente: pode ser executado múltiplas vezes sem erro
-- Executar com:
--   docker exec -i br10_db psql -U br10user -d br10netmanager < scripts/migrate_cgnat.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Criar tabela cgnat_configs se não existir
CREATE TABLE IF NOT EXISTS cgnat_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    private_network VARCHAR(50) NOT NULL,
    private_prefix_len INTEGER NOT NULL,
    public_prefix VARCHAR(50) NOT NULL,
    clients_per_ip INTEGER NOT NULL,
    sequential_chain INTEGER DEFAULT 0,
    use_blackhole BOOLEAN DEFAULT TRUE,
    use_fasttrack BOOLEAN DEFAULT TRUE,
    protocol VARCHAR(10) DEFAULT 'tcp_udp',
    ros_version VARCHAR(5) DEFAULT '6',
    total_private_ips INTEGER,
    total_public_ips INTEGER,
    ports_per_client INTEGER,
    total_chains INTEGER,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Adicionar coluna client_id se não existir (para bancos que já tinham a tabela sem ela)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cgnat_configs' AND column_name = 'client_id'
    ) THEN
        ALTER TABLE cgnat_configs
            ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
        RAISE NOTICE 'Coluna client_id adicionada a cgnat_configs';
    ELSE
        RAISE NOTICE 'Coluna client_id já existe em cgnat_configs';
    END IF;
END $$;

-- 3. Criar tabela cgnat_mappings se não existir
CREATE TABLE IF NOT EXISTS cgnat_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES cgnat_configs(id) ON DELETE CASCADE,
    private_ip VARCHAR(45) NOT NULL,
    private_subnet VARCHAR(50),
    public_ip VARCHAR(45) NOT NULL,
    port_start INTEGER NOT NULL,
    port_end INTEGER NOT NULL,
    chain_index INTEGER NOT NULL,
    chain_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cgnat_mapping_config_private UNIQUE (config_id, private_ip)
);

-- 4. Criar índices se não existirem
CREATE INDEX IF NOT EXISTS ix_cgnat_configs_name ON cgnat_configs (name);
CREATE INDEX IF NOT EXISTS ix_cgnat_configs_public_prefix ON cgnat_configs (public_prefix);
CREATE INDEX IF NOT EXISTS ix_cgnat_configs_client_id ON cgnat_configs (client_id);
CREATE INDEX IF NOT EXISTS ix_cgnat_mappings_config_private ON cgnat_mappings (config_id, private_ip);
CREATE INDEX IF NOT EXISTS ix_cgnat_mappings_private_ip ON cgnat_mappings (private_ip);
CREATE INDEX IF NOT EXISTS ix_cgnat_mappings_public_ip ON cgnat_mappings (public_ip);

COMMIT;

-- Verificação final
SELECT
    table_name,
    (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) AS col_count
FROM information_schema.tables t
WHERE table_name IN ('cgnat_configs', 'cgnat_mappings')
  AND table_schema = 'public';

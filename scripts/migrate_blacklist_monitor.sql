-- BR10 NetManager - Migração: Monitoramento de Blacklist / Reputação IP
-- Criado em: 2025-04-15
-- Descrição: Cria tabelas para monitoramento de blacklist via MxToolbox

-- 1. Chaves de API de serviços externos
CREATE TABLE IF NOT EXISTS system_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service VARCHAR(50) NOT NULL UNIQUE,
    label VARCHAR(200),
    api_key_encrypted TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_system_api_keys_service ON system_api_keys(service);

-- 2. Monitores de blacklist
CREATE TABLE IF NOT EXISTS blacklist_monitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    target VARCHAR(255) NOT NULL,
    target_type VARCHAR(20) NOT NULL DEFAULT 'ip',
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_name VARCHAR(255),
    last_status VARCHAR(20),
    last_checked_at TIMESTAMPTZ,
    last_listed_count INTEGER DEFAULT 0,
    last_checked_count INTEGER DEFAULT 0,
    last_blacklists JSONB,
    last_error TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    alert_on_listed BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_blacklist_monitors_target ON blacklist_monitors(target);
CREATE INDEX IF NOT EXISTS ix_blacklist_monitors_client ON blacklist_monitors(client_id);
CREATE INDEX IF NOT EXISTS ix_blacklist_monitors_active ON blacklist_monitors(active);

-- 3. Histórico de verificações
CREATE TABLE IF NOT EXISTS blacklist_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monitor_id UUID REFERENCES blacklist_monitors(id) ON DELETE CASCADE,
    target VARCHAR(255) NOT NULL,
    target_type VARCHAR(20) NOT NULL DEFAULT 'ip',
    status VARCHAR(20) NOT NULL,
    listed_count INTEGER DEFAULT 0,
    checked_count INTEGER DEFAULT 0,
    blacklists_found JSONB,
    all_results JSONB,
    error_message TEXT,
    trigger_type VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    triggered_by UUID,
    duration_ms INTEGER,
    api_used VARCHAR(50) DEFAULT 'mxtoolbox',
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_blacklist_checks_monitor_checked ON blacklist_checks(monitor_id, checked_at);
CREATE INDEX IF NOT EXISTS ix_blacklist_checks_target ON blacklist_checks(target);

-- Inserir registro padrão para MxToolbox (sem chave — usuário deve configurar)
INSERT INTO system_api_keys (service, label, is_active, notes)
VALUES ('mxtoolbox', 'MxToolbox API Key', TRUE, 'Obtenha sua chave em https://mxtoolbox.com/api/')
ON CONFLICT (service) DO NOTHING;

RAISE NOTICE 'Migração blacklist_monitor concluída com sucesso.';

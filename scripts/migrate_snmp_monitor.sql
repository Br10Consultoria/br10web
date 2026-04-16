-- =============================================================================
-- Migração: Módulo de Monitoramento SNMP + Gestão NETCONF/SSH
-- Tabelas: snmp_targets, snmp_metrics, snmp_alerts, snmp_netconf_logs
-- =============================================================================

BEGIN;

-- ─── snmp_targets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snmp_targets (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id            UUID REFERENCES devices(id) ON DELETE CASCADE,
    name                 VARCHAR(150) NOT NULL,
    host                 VARCHAR(255) NOT NULL,
    port                 INTEGER NOT NULL DEFAULT 161,
    snmp_version         VARCHAR(10) NOT NULL DEFAULT 'v2c',
    community_encrypted  TEXT,
    snmp_user            VARCHAR(100),
    auth_protocol        VARCHAR(20),
    auth_key_encrypted   TEXT,
    priv_protocol        VARCHAR(20),
    priv_key_encrypted   TEXT,
    poll_interval        INTEGER NOT NULL DEFAULT 300,
    active               BOOLEAN NOT NULL DEFAULT TRUE,
    collect_interfaces   BOOLEAN NOT NULL DEFAULT TRUE,
    collect_bgp          BOOLEAN NOT NULL DEFAULT TRUE,
    collect_cpu          BOOLEAN NOT NULL DEFAULT TRUE,
    collect_memory       BOOLEAN NOT NULL DEFAULT TRUE,
    cpu_threshold        FLOAT,
    memory_threshold     FLOAT,
    last_polled_at       TEXT,
    last_status          VARCHAR(20),
    last_error           TEXT,
    sys_name             VARCHAR(255),
    sys_descr            TEXT,
    sys_contact          VARCHAR(255),
    sys_location         VARCHAR(255),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_snmp_target_host_port UNIQUE (host, port)
);

CREATE INDEX IF NOT EXISTS ix_snmp_targets_device_id ON snmp_targets(device_id);
CREATE INDEX IF NOT EXISTS ix_snmp_targets_active    ON snmp_targets(active);

-- ─── snmp_metrics ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snmp_metrics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id   UUID NOT NULL REFERENCES snmp_targets(id) ON DELETE CASCADE,
    metric_type VARCHAR(30) NOT NULL,
    object_id   VARCHAR(255),
    object_name VARCHAR(255),
    value_float FLOAT,
    value_int   BIGINT,
    value_str   VARCHAR(255),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_snmp_metrics_target_type_time
    ON snmp_metrics(target_id, metric_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_snmp_metrics_target_object_time
    ON snmp_metrics(target_id, object_id, created_at DESC);

-- Política de retenção: manter apenas 30 dias de métricas
-- (executar periodicamente via cron ou agendador)
-- DELETE FROM snmp_metrics WHERE created_at < NOW() - INTERVAL '30 days';

-- ─── snmp_alerts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snmp_alerts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id    UUID NOT NULL REFERENCES snmp_targets(id) ON DELETE CASCADE,
    severity     VARCHAR(20) NOT NULL,
    metric_type  VARCHAR(30) NOT NULL,
    object_id    VARCHAR(255),
    object_name  VARCHAR(255),
    message      TEXT NOT NULL,
    value        FLOAT,
    threshold    FLOAT,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    resolved     BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at  TEXT,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_snmp_alerts_target_resolved
    ON snmp_alerts(target_id, resolved);
CREATE INDEX IF NOT EXISTS ix_snmp_alerts_unresolved
    ON snmp_alerts(resolved, created_at DESC) WHERE resolved = FALSE;

-- ─── snmp_netconf_logs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snmp_netconf_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id   UUID NOT NULL REFERENCES snmp_targets(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action_type VARCHAR(30) NOT NULL,
    object_id   VARCHAR(255),
    object_name VARCHAR(255),
    parameters  JSONB,
    status      VARCHAR(20) NOT NULL,
    output      TEXT,
    error       TEXT,
    duration_ms INTEGER,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_snmp_netconf_logs_target_time
    ON snmp_netconf_logs(target_id, created_at DESC);

COMMIT;

-- Verificação
DO $$
BEGIN
    RAISE NOTICE 'Migração SNMP concluída: snmp_targets, snmp_metrics, snmp_alerts, snmp_netconf_logs';
END $$;

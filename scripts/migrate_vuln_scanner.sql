-- ============================================================
-- BR10 NetManager - Migração: Scanner de Vulnerabilidades
-- Execute: docker exec -i br10_db psql -U br10user -d br10netmanager -f /scripts/migrate_vuln_scanner.sql
-- ============================================================

-- Tipos ENUM
DO $$ BEGIN
    CREATE TYPE scannertype AS ENUM ('nmap', 'openvas');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE scanstatus AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE findingseverity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela de varreduras
CREATE TABLE IF NOT EXISTS vuln_scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    target          VARCHAR(500) NOT NULL,
    scanner         scannertype NOT NULL DEFAULT 'nmap',
    status          scanstatus NOT NULL DEFAULT 'pending',
    scan_options    JSONB,
    hosts_up        INTEGER,
    hosts_down      INTEGER,
    total_findings  INTEGER DEFAULT 0,
    raw_output      TEXT,
    error_msg       TEXT,
    duration_s      FLOAT,
    started_by      VARCHAR(200),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_vuln_scans_status     ON vuln_scans(status);
CREATE INDEX IF NOT EXISTS ix_vuln_scans_scanner    ON vuln_scans(scanner);
CREATE INDEX IF NOT EXISTS ix_vuln_scans_created_at ON vuln_scans(created_at);

-- Tabela de findings
CREATE TABLE IF NOT EXISTS vuln_findings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id          UUID NOT NULL REFERENCES vuln_scans(id) ON DELETE CASCADE,
    host             VARCHAR(100) NOT NULL,
    hostname         VARCHAR(300),
    port             INTEGER,
    protocol         VARCHAR(10),
    service          VARCHAR(100),
    service_version  VARCHAR(300),
    port_state       VARCHAR(20),
    vuln_id          VARCHAR(100),
    title            VARCHAR(500),
    description      TEXT,
    severity         findingseverity DEFAULT 'info',
    cvss_score       FLOAT,
    solution         TEXT,
    extra            JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_vuln_findings_scan_id  ON vuln_findings(scan_id);
CREATE INDEX IF NOT EXISTS ix_vuln_findings_host     ON vuln_findings(host);
CREATE INDEX IF NOT EXISTS ix_vuln_findings_severity ON vuln_findings(severity);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vuln_scans_updated_at    ON vuln_scans;
DROP TRIGGER IF EXISTS trg_vuln_findings_updated_at ON vuln_findings;

CREATE TRIGGER trg_vuln_scans_updated_at
    BEFORE UPDATE ON vuln_scans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vuln_findings_updated_at
    BEFORE UPDATE ON vuln_findings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

SELECT 'Migração vuln_scanner concluída com sucesso!' AS resultado;

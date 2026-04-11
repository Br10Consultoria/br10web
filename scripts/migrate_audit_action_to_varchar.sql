-- ============================================================================
-- BR10 NetManager - Migração: auditaction ENUM → VARCHAR(100)
-- ============================================================================
-- Objetivo: Converter a coluna audit_logs.action de ENUM nativo para VARCHAR.
--
-- Por que: ENUM nativo do PostgreSQL exige ALTER TYPE a cada novo valor,
-- operação que não pode ser feita dentro de transação. VARCHAR com validação
-- na aplicação é o padrão para sistemas de auditoria extensíveis.
--
-- Dados: Os registros existentes são PRESERVADOS — o CAST de auditaction
-- para VARCHAR é nativo e sem perda de dados.
--
-- Como executar no servidor:
--   docker exec -i br10_db psql -U br10user -d br10netmanager < scripts/migrate_audit_action_to_varchar.sql
--
-- ============================================================================

BEGIN;

-- 1. Converter a coluna action de auditaction ENUM para VARCHAR(100)
--    USING faz o cast automático — todos os valores existentes são preservados
ALTER TABLE audit_logs
    ALTER COLUMN action TYPE VARCHAR(100)
    USING action::VARCHAR;

-- 2. Normalizar registros legados com valores MAIÚSCULO para minúsculo
--    (registros criados antes da padronização)
UPDATE audit_logs SET action = LOWER(action)
WHERE action != LOWER(action);

-- 3. Remover o ENUM auditaction do banco (não é mais necessário)
--    CASCADE remove dependências automaticamente
DROP TYPE IF EXISTS auditaction CASCADE;

-- 4. Garantir que o índice na coluna action ainda existe
--    (o ALTER TABLE pode invalidar índices em alguns casos)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'audit_logs'
        AND indexname = 'ix_audit_logs_action'
    ) THEN
        CREATE INDEX ix_audit_logs_action ON audit_logs (action);
    END IF;
END $$;

COMMIT;

-- Verificação final
SELECT
    column_name,
    data_type,
    character_maximum_length
FROM information_schema.columns
WHERE table_name = 'audit_logs'
AND column_name = 'action';

-- Deve retornar:
--  column_name | data_type         | character_maximum_length
-- -------------+-------------------+--------------------------
--  action      | character varying | 100

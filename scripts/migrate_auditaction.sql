-- migrate_auditaction.sql
-- Migração das ações RPKI na coluna audit_logs.action
--
-- NOTA: A coluna `action` foi convertida de ENUM nativo para VARCHAR(100)
-- pela migração migrate_audit_action_to_varchar.sql. Por isso, este script
-- NÃO precisa mais adicionar valores ao tipo ENUM (que não existe mais).
--
-- A coluna VARCHAR aceita qualquer string, portanto os novos valores RPKI
-- já funcionam automaticamente sem nenhuma alteração de schema.

-- Verificação informativa: confirmar que a coluna é VARCHAR
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'audit_logs'
      AND column_name = 'action'
      AND data_type = 'character varying'
  ) THEN
    RAISE NOTICE 'OK: audit_logs.action é VARCHAR — nenhuma alteração necessária.';
  ELSE
    RAISE NOTICE 'AVISO: audit_logs.action não é VARCHAR. Verifique se migrate_audit_action_to_varchar.sql foi executado.';
  END IF;
END $$;

-- Verificação final: mostrar tipo atual da coluna
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'audit_logs' AND column_name = 'action';

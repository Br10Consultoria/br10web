-- =============================================================================
-- Migração: Alterar coluna value_int de INTEGER para BIGINT na tabela snmp_metrics
-- Motivo: Contadores SNMP 64-bit (ifHCInOctets, ifHCOutOctets) excedem o limite
--         de INTEGER (2.147.483.647), causando erro "value out of int32 range".
-- =============================================================================

BEGIN;

-- Alterar tipo da coluna value_int de INTEGER para BIGINT
-- BIGINT suporta até 9.223.372.036.854.775.807 (suficiente para contadores 64-bit)
ALTER TABLE snmp_metrics
    ALTER COLUMN value_int TYPE BIGINT;

COMMIT;

DO $$
BEGIN
    RAISE NOTICE 'Migração concluída: snmp_metrics.value_int alterado de INTEGER para BIGINT';
END $$;

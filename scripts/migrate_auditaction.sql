-- ============================================================
-- BR10 NetManager — Migração do ENUM auditaction
-- Execute este script diretamente no banco PostgreSQL para
-- adicionar os novos valores sem recriar o container.
--
-- Uso:
--   docker exec -i br10_db psql -U br10user -d br10db < scripts/migrate_auditaction.sql
-- ============================================================

-- Autenticação / Sessão
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'login' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'login';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'logout' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'logout';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'login_failed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'login_failed';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'password_changed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'password_changed';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = '2fa_enabled' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE '2fa_enabled';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = '2fa_disabled' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE '2fa_disabled';
  END IF;
END $$;

-- Dispositivos
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'device_created' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'device_created';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'device_updated' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'device_updated';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'device_deleted' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'device_deleted';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'device_connected' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'device_connected';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'device_disconnected' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'device_disconnected';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'device_connection_failed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'device_connection_failed';
  END IF;
END $$;

-- Terminal
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'terminal_session_started' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'terminal_session_started';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'terminal_session_ended' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'terminal_session_ended';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'terminal_command' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'terminal_command';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'terminal_connection_failed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'terminal_connection_failed';
  END IF;
END $$;

-- Comandos / Automação
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'command_executed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'command_executed';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'command_failed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'command_failed';
  END IF;
END $$;

-- VPN
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'vpn_created' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'vpn_created';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'vpn_updated' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'vpn_updated';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'vpn_deleted' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'vpn_deleted';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'vpn_connected' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'vpn_connected';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'vpn_disconnected' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'vpn_disconnected';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'vpn_connection_failed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'vpn_connection_failed';
  END IF;
END $$;

-- Rotas
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'route_created' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'route_created';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'route_updated' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'route_updated';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'route_deleted' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'route_deleted';
  END IF;
END $$;

-- Backup
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'backup_created' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'backup_created';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'backup_restored' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'backup_restored';
  END IF;
END $$;

-- Playbooks
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'playbook_created' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'playbook_created';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'playbook_updated' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'playbook_updated';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'playbook_deleted' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'playbook_deleted';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'playbook_executed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'playbook_executed';
  END IF;
END $$;

-- Backup de Dispositivos (Agendamentos)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'backup_schedule_created' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'backup_schedule_created';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'backup_schedule_updated' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'backup_schedule_updated';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'backup_schedule_deleted' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'backup_schedule_deleted';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'backup_schedule_executed' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'backup_schedule_executed';
  END IF;
END $$;

-- Usuários
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'user_created' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'user_created';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'user_updated' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'user_updated';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'user_deleted' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'user_deleted';
  END IF;
END $$;

-- Exportação / Importação
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'export_data' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'export_data';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'import_data' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'import_data';
  END IF;
END $$;

-- Monitor RPKI
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'rpki_monitor_created' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'rpki_monitor_created';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'rpki_monitor_updated' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'rpki_monitor_updated';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'rpki_monitor_deleted' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'rpki_monitor_deleted';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'rpki_monitor_checked' AND enumtypid = 'auditaction'::regtype) THEN
    ALTER TYPE auditaction ADD VALUE 'rpki_monitor_checked';
  END IF;
END $$;

-- Verificação final
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'auditaction'::regtype ORDER BY enumsortorder;

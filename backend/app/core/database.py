"""
BR10 NetManager - Database Configuration
Configuração assíncrona do PostgreSQL com SQLAlchemy.
"""
import json
import uuid
import logging
from datetime import datetime
from enum import Enum
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from typing import AsyncGenerator

from app.core.config import settings


class _UUIDEncoder(json.JSONEncoder):
    """Encoder JSON que converte UUID, Enum e datetime para tipos serializáveis."""
    def default(self, obj):
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, Enum):
            return obj.value
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


def _json_serializer(obj):
    return json.dumps(obj, cls=_UUIDEncoder)


def _json_deserializer(s):
    return json.loads(s)

logger = logging.getLogger(__name__)

# Async engine para operações da API
async_engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=20,
    max_overflow=40,
    pool_pre_ping=True,
    pool_recycle=3600,
    json_serializer=_json_serializer,
    json_deserializer=_json_deserializer,
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

# Sync engine para Alembic migrations
sync_engine = create_engine(
    settings.DATABASE_URL_SYNC,
    echo=settings.DEBUG,
    pool_pre_ping=True,
)

SyncSessionLocal = sessionmaker(
    bind=sync_engine,
    autoflush=False,
    autocommit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency para injeção de sessão do banco de dados."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def _run_migrations(conn):
    """Executa migrations incrementais de forma segura (idempotente via IF NOT EXISTS)."""
    migrations = [
        # Colunas de cliente e vendor na tabela devices
        "ALTER TABLE devices ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL",
        "ALTER TABLE devices ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL",
        "ALTER TABLE devices ADD COLUMN IF NOT EXISTS vendor_model_id UUID REFERENCES vendor_models(id) ON DELETE SET NULL",
        # Índices para performance
        "CREATE INDEX IF NOT EXISTS ix_devices_client_id ON devices(client_id)",
        "CREATE INDEX IF NOT EXISTS ix_devices_vendor_id ON devices(vendor_id)",
        "CREATE INDEX IF NOT EXISTS ix_devices_vendor_model_id ON devices(vendor_model_id)",
        # ── Converter colunas ENUM nativas para VARCHAR (compatibilidade native_enum=False) ──
        # O SQLAlchemy com native_enum=False armazena como VARCHAR, mas o banco pode ter
        # criado as colunas como tipo ENUM nativo. Convertemos preservando os valores.
        "ALTER TABLE playbooks ALTER COLUMN status TYPE VARCHAR(50) USING status::text",
        "ALTER TABLE playbook_steps ALTER COLUMN step_type TYPE VARCHAR(50) USING step_type::text",
        "ALTER TABLE playbook_executions ALTER COLUMN status TYPE VARCHAR(50) USING status::text",
        "ALTER TABLE ai_provider_configs ALTER COLUMN provider TYPE VARCHAR(50) USING provider::text",
        "ALTER TABLE ai_analyses ALTER COLUMN status TYPE VARCHAR(50) USING status::text",
        # ── Audit logs: adicionar colunas faltantes para auditoria completa ──
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_values JSONB",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_values JSONB",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS error_message TEXT",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS extra_data JSONB",
        # Índices adicionais para audit_logs
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_status ON audit_logs(status)",
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_device_id ON audit_logs(device_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_resource_type ON audit_logs(resource_type)",
        # Garantir FK de audit_logs.device_id para devices
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='audit_logs_device_id_fkey' AND table_name='audit_logs') THEN ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL; END IF; END $$",
    ]
    for sql in migrations:
        try:
            await conn.execute(text(sql))
            logger.info(f"Migration executada: {sql[:60]}...")
        except Exception as e:
            logger.warning(f"Migration ignorada (pode já existir): {e}")


async def init_db():
    """Inicializa o banco de dados criando todas as tabelas e executando migrations."""
    from app.models import Base
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migration: adicionar colunas de client/vendor se não existirem
        await _run_migrations(conn)

"""
BR10 NetManager - Database Configuration
Configuração assíncrona do PostgreSQL com SQLAlchemy.
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from typing import AsyncGenerator

from app.core.config import settings

logger = logging.getLogger(__name__)

# Async engine para operações da API
async_engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=20,
    max_overflow=40,
    pool_pre_ping=True,
    pool_recycle=3600,
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

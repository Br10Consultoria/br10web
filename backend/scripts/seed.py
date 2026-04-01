"""
Script de inicialização do banco de dados com usuário admin padrão.
Execute: python scripts/seed.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
import uuid

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.base import Base
from app.models.user import User
from app.models.device import Device


async def seed():
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        # Verificar se admin já existe
        result = await session.execute(select(User).where(User.username == "admin"))
        existing_admin = result.scalar_one_or_none()
        
        if not existing_admin:
            admin = User(
                id=uuid.uuid4(),
                username="admin",
                email="admin@br10consultoria.com.br",
                full_name="Administrador BR10",
                hashed_password=get_password_hash("Admin@BR10!"),
                role="admin",
                is_active=True,
                is_superuser=True,
                totp_enabled=False,
            )
            session.add(admin)
            await session.commit()
            print("✅ Usuário admin criado com sucesso!")
            print("   Usuário: admin")
            print("   Senha: Admin@BR10!")
            print("   ⚠️  ALTERE A SENHA IMEDIATAMENTE APÓS O PRIMEIRO LOGIN!")
        else:
            print("ℹ️  Usuário admin já existe, pulando...")
    
    await engine.dispose()
    print("✅ Banco de dados inicializado!")


if __name__ == "__main__":
    asyncio.run(seed())

#!/usr/bin/env python3
"""
BR10 NetManager - Create Admin User Script
Cria o usuário administrador inicial do sistema.
"""
import asyncio
import sys
import os

# Adicionar o diretório do backend ao path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

async def create_admin():
    from app.core.database import AsyncSessionLocal, init_db
    from app.core.security import hash_password
    from app.models.user import User, UserRole
    from sqlalchemy import select

    print("=== BR10 NetManager - Criação de Admin ===")

    # Inicializar banco
    await init_db()

    username = input("Username [admin]: ").strip() or "admin"
    email = input("Email [admin@br10consultoria.com.br]: ").strip() or "admin@br10consultoria.com.br"
    full_name = input("Nome completo [Administrador BR10]: ").strip() or "Administrador BR10"

    import getpass
    while True:
        password = getpass.getpass("Senha (min 8 chars, maiúscula, número, especial): ")
        confirm = getpass.getpass("Confirmar senha: ")
        if password != confirm:
            print("Senhas não coincidem. Tente novamente.")
            continue
        if len(password) < 8:
            print("Senha muito curta. Mínimo 8 caracteres.")
            continue
        break

    async with AsyncSessionLocal() as db:
        # Verificar se já existe
        existing = await db.scalar(select(User).where(User.username == username))
        if existing:
            print(f"Usuário '{username}' já existe!")
            update = input("Deseja atualizar a senha? [s/N]: ").strip().lower()
            if update == 's':
                existing.hashed_password = hash_password(password)
                await db.commit()
                print(f"Senha do usuário '{username}' atualizada com sucesso!")
            return

        admin = User(
            username=username,
            email=email,
            full_name=full_name,
            hashed_password=hash_password(password),
            role=UserRole.ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add(admin)
        await db.commit()
        await db.refresh(admin)

    print(f"\n✓ Administrador criado com sucesso!")
    print(f"  Username: {username}")
    print(f"  Email: {email}")
    print(f"  Role: ADMIN")
    print(f"\nAcesse o sistema em: https://br10web.br10consultoria.com.br")
    print("Recomendamos ativar o 2FA após o primeiro login.")


if __name__ == "__main__":
    asyncio.run(create_admin())

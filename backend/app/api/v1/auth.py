"""
BR10 NetManager - Authentication API
Endpoints de autenticação com suporte a 2FA.
"""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.core.security import (
    verify_password, hash_password, create_access_token, create_refresh_token,
    decode_token, generate_totp_secret, get_totp_uri, generate_qr_code_base64,
    verify_totp
)
from app.core.config import settings
from app.models.user import User, UserSession
from app.models.audit import AuditLog, AuditAction
from app.schemas.auth import (
    LoginRequest, LoginResponse, TwoFASetupResponse, TwoFAVerifyRequest,
    RefreshTokenRequest, ChangePasswordRequest, UserCreate, UserUpdate, UserResponse
)

router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency para obter usuário autenticado do JWT."""
    token = credentials.credentials
    payload = decode_token(token)

    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado ou inativo",
        )

    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency que exige role de administrador."""
    if current_user.role.value != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a administradores",
        )
    return current_user


async def require_technician(current_user: User = Depends(get_current_user)) -> User:
    """Dependency que exige role de técnico ou admin."""
    if current_user.role.value not in ("admin", "technician"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a técnicos e administradores",
        )
    return current_user


# Alias para compatibilidade com imports existentes
async def require_technician_or_admin(current_user: User = Depends(get_current_user)) -> User:
    """Alias de require_technician: exige role de técnico ou admin."""
    return await require_technician(current_user)


def require_role(current_user: User = Depends(get_current_user)) -> User:
    """Dependency genérica: qualquer usuário autenticado e ativo."""
    return current_user


@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    login_data: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Login com suporte a 2FA."""
    client_ip = request.client.host if request.client else "unknown"

    # Buscar usuário
    result = await db.execute(
        select(User).where(User.username == login_data.username)
    )
    user = result.scalar_one_or_none()

    # Verificar bloqueio
    if user and user.locked_until and user.locked_until > datetime.utcnow():
        remaining = (user.locked_until - datetime.utcnow()).seconds // 60
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Conta bloqueada. Tente novamente em {remaining} minutos.",
        )

    # Verificar credenciais
    if not user or not verify_password(login_data.password, user.hashed_password):
        if user:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.MAX_LOGIN_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(
                    minutes=settings.LOCKOUT_DURATION_MINUTES
                )
            await db.commit()

        # Log de falha
        await db.execute(
            AuditLog.__table__.insert().values(
                action=AuditAction.LOGIN_FAILED,
                description=f"Tentativa de login falhou para: {login_data.username}",
                ip_address=client_ip,
                status="failure",
            )
        )
        await db.commit()

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Conta desativada. Entre em contato com o administrador.",
        )

    # Verificar 2FA se habilitado
    if user.totp_enabled:
        if not login_data.totp_code:
            return LoginResponse(
                access_token="",
                refresh_token="",
                token_type="bearer",
                expires_in=0,
                user_id=str(user.id),
                username=user.username,
                role=user.role.value,
                requires_2fa=True,
            )
        if not verify_totp(user.totp_secret, login_data.totp_code):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Código 2FA inválido",
            )

    # Login bem-sucedido
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login = datetime.utcnow()
    user.last_login_ip = client_ip

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims={"role": user.role.value, "username": user.username},
    )
    refresh_token = create_refresh_token(subject=str(user.id))

    # Log de login bem-sucedido
    await db.execute(
        AuditLog.__table__.insert().values(
            user_id=user.id,
            action=AuditAction.LOGIN,
            description=f"Login bem-sucedido: {user.username}",
            ip_address=client_ip,
            status="success",
        )
    )

    await db.commit()

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=str(user.id),
        username=user.username,
        role=user.role.value,
        requires_2fa=False,
        two_fa_setup_required=not user.totp_enabled,
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    data: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Renova access token usando refresh token."""
    payload = decode_token(data.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token inválido ou expirado",
        )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário não encontrado")

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims={"role": user.role.value, "username": user.username},
    )
    new_refresh_token = create_refresh_token(subject=str(user.id))

    return LoginResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=str(user.id),
        username=user.username,
        role=user.role.value,
    )


@router.post("/2fa/setup", response_model=TwoFASetupResponse)
async def setup_2fa(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Configura 2FA para o usuário atual."""
    secret = generate_totp_secret()
    uri = get_totp_uri(secret, current_user.username)
    qr_code = generate_qr_code_base64(uri)

    # Armazena segredo temporariamente (não ativa ainda)
    current_user.totp_secret = secret
    await db.commit()

    return TwoFASetupResponse(
        secret=secret,
        qr_code_base64=qr_code,
        provisioning_uri=uri,
    )


@router.post("/2fa/verify")
async def verify_2fa(
    data: TwoFAVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verifica e ativa 2FA após escanear QR Code."""
    if not current_user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configure o 2FA primeiro usando /2fa/setup",
        )

    if not verify_totp(current_user.totp_secret, data.totp_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código 2FA inválido. Verifique o horário do seu dispositivo.",
        )

    current_user.totp_enabled = True
    await db.commit()

    return {"message": "2FA ativado com sucesso!", "totp_enabled": True}


@router.post("/2fa/disable")
async def disable_2fa(
    data: TwoFAVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Desativa 2FA após confirmação."""
    if not current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA não está ativado")

    if not verify_totp(current_user.totp_secret, data.totp_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Código 2FA inválido")

    current_user.totp_enabled = False
    current_user.totp_secret = None
    await db.commit()

    return {"message": "2FA desativado com sucesso"}


@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Altera senha do usuário autenticado."""
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Senha atual incorreta")

    current_user.hashed_password = hash_password(data.new_password)
    current_user.password_changed_at = datetime.utcnow()

    # Log de auditoria
    await db.execute(
        AuditLog.__table__.insert().values(
            user_id=current_user.id,
            action=AuditAction.PASSWORD_CHANGED,
            description=f"Senha alterada pelo usuário: {current_user.username}",
            status="success",
        )
    )
    await db.commit()

    return {"message": "Senha alterada com sucesso"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Retorna dados do usuário autenticado."""
    return current_user


@router.post("/users", response_model=UserResponse)
async def create_user(
    data: UserCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria novo usuário (somente admin)."""
    # Verificar duplicatas
    result = await db.execute(
        select(User).where(
            (User.username == data.username) | (User.email == data.email)
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username ou email já cadastrado",
        )

    from app.models.user import UserRole
    user = User(
        username=data.username,
        email=data.email,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        role=UserRole(data.role),
        phone=data.phone,
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()

    # Log de auditoria
    await db.execute(
        AuditLog.__table__.insert().values(
            user_id=current_user.id,
            action=AuditAction.USER_CREATED,
            description=f"Usuário criado: {user.username} ({user.role.value})",
            new_values={"username": user.username, "email": user.email, "role": user.role.value},
            status="success",
        )
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista todos os usuários (somente admin)."""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return result.scalars().all()


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    data: UserUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza usuário (somente admin)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado")

    old_values = {"email": user.email, "full_name": user.full_name, "role": user.role.value if hasattr(user.role, 'value') else user.role}
    for field, value in data.dict(exclude_none=True).items():
        setattr(user, field, value)

    # Log de auditoria
    await db.execute(
        AuditLog.__table__.insert().values(
            user_id=current_user.id,
            action=AuditAction.USER_UPDATED,
            description=f"Usuário atualizado: {user.username}",
            old_values=old_values,
            new_values=data.dict(exclude_none=True),
            status="success",
        )
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove usuário (somente admin)."""
    if str(current_user.id) == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Não é possível remover seu próprio usuário")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado")

    await db.delete(user)
    await db.commit()
    return {"message": "Usuário removido com sucesso"}

"""
BR10 NetManager — Gerenciamento de Usuários com Permissões Granulares

Endpoints:
  GET    /users                    — listar usuários (admin)
  POST   /users                    — criar usuário com permissões (admin)
  GET    /users/{id}               — detalhar usuário (admin)
  PUT    /users/{id}               — atualizar usuário e permissões (admin)
  DELETE /users/{id}               — remover usuário (admin)
  PUT    /users/{id}/permissions   — atualizar permissões (admin)
  PUT    /users/{id}/client-scopes — atualizar escopos de cliente (admin)
  POST   /users/{id}/reset-2fa    — resetar 2FA do usuário (admin)
  GET    /users/me/permissions     — permissões do usuário autenticado
  GET    /modules                  — listar módulos disponíveis
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel, EmailStr, validator
import re

from app.core.database import get_db
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.permissions import UserPermission, UserClientScope, MODULES, ACCESS_LEVELS
from app.models.client import Client
from app.models.audit import AuditAction
from app.core.audit_helper import log_audit
from app.api.v1.auth import get_current_user, require_admin

router = APIRouter(prefix="/users", tags=["Users"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PermissionItem(BaseModel):
    module: str
    access_level: str  # view | execute | edit | manage

    @validator("module")
    def validate_module(cls, v):
        if v not in MODULES:
            raise ValueError(f"Módulo inválido: {v}. Válidos: {MODULES}")
        return v

    @validator("access_level")
    def validate_level(cls, v):
        if v not in ACCESS_LEVELS:
            raise ValueError(f"Nível inválido: {v}. Válidos: {ACCESS_LEVELS}")
        return v


class UserCreateRequest(BaseModel):
    username: str
    email: EmailStr
    full_name: str
    password: str
    role: str = "viewer"
    phone: Optional[str] = None
    is_full_access: bool = False  # True = admin com acesso total
    permissions: List[PermissionItem] = []
    client_scope_ids: List[str] = []  # vazio = acesso a todos os clientes

    @validator("username")
    def validate_username(cls, v):
        if not re.match(r"^[a-zA-Z0-9_.-]{3,50}$", v):
            raise ValueError("Username deve ter 3-50 caracteres alfanuméricos, _, . ou -")
        return v.lower()

    @validator("password")
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError("Senha deve ter pelo menos 8 caracteres")
        return v

    @validator("role")
    def validate_role(cls, v):
        valid = [r.value for r in UserRole]
        if v not in valid:
            raise ValueError(f"Role inválido. Válidos: {valid}")
        return v


class UserUpdateRequest(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None
    is_full_access: Optional[bool] = None
    permissions: Optional[List[PermissionItem]] = None
    client_scope_ids: Optional[List[str]] = None


class PermissionsUpdateRequest(BaseModel):
    permissions: List[PermissionItem]
    is_full_access: bool = False


class ClientScopesUpdateRequest(BaseModel):
    client_scope_ids: List[str]  # vazio = acesso a todos


class UserDetailResponse(BaseModel):
    id: str
    username: str
    email: str
    full_name: str
    role: str
    phone: Optional[str]
    is_active: bool
    is_verified: bool
    totp_enabled: bool
    last_login: Optional[str]
    last_login_ip: Optional[str]
    created_at: str
    is_full_access: bool
    permissions: List[PermissionItem]
    client_scope_ids: List[str]
    client_scope_names: List[str]

    class Config:
        from_attributes = True


# ─── Helper: serializar usuário com permissões ────────────────────────────────

async def _user_to_detail(user: User, db: AsyncSession) -> dict:
    """Serializa usuário com permissões e escopos de cliente."""
    # Permissões
    perms = [
        {"module": p.module, "access_level": p.access_level}
        for p in (user.permissions or [])
    ]

    # Escopos de cliente
    scope_ids = [str(s.client_id) for s in (user.client_scopes or [])]

    # Nomes dos clientes
    scope_names = []
    if scope_ids:
        result = await db.execute(
            select(Client.id, Client.name).where(Client.id.in_(scope_ids))
        )
        scope_names = [row.name for row in result.fetchall()]

    # is_full_access = admin ou role admin
    is_full = user.role.value == "admin"

    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
        "phone": user.phone,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "totp_enabled": user.totp_enabled,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "last_login_ip": user.last_login_ip,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "is_full_access": is_full,
        "permissions": perms,
        "client_scope_ids": scope_ids,
        "client_scope_names": scope_names,
    }


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/modules")
async def list_modules(_: User = Depends(require_admin)):
    """Lista todos os módulos disponíveis com seus níveis de acesso."""
    return {
        "modules": MODULES,
        "access_levels": ACCESS_LEVELS,
        "module_labels": {
            "clients":       "Clientes / Fornecedores",
            "devices":       "Dispositivos",
            "device_backup": "Backup de Dispositivos",
            "terminal":      "Terminal SSH/Telnet",
            "rpki_monitor":  "Monitor RPKI",
            "cgnat":         "Gerador CGNAT",
            "vpn":           "VPN L2TP",
            "playbooks":     "Automação / Playbooks",
            "ai_analysis":   "Análise com IA",
            "backup":        "Backup do Sistema",
            "audit":         "Log de Auditoria",
            "users":         "Gerenciamento de Usuários",
        },
        "level_labels": {
            "view":    "Visualizar",
            "execute": "Executar",
            "edit":    "Editar",
            "manage":  "Gerenciar (total)",
        },
    }


@router.get("")
async def list_users(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista todos os usuários com suas permissões."""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [await _user_to_detail(u, db) for u in users]


@router.get("/me/permissions")
async def get_my_permissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna as permissões do usuário autenticado."""
    detail = await _user_to_detail(current_user, db)
    return {
        "is_full_access": detail["is_full_access"],
        "permissions": detail["permissions"],
        "client_scope_ids": detail["client_scope_ids"],
    }


@router.get("/{user_id}")
async def get_user(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Detalha um usuário com permissões e escopos."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return await _user_to_detail(user, db)


@router.post("", status_code=201)
async def create_user(
    data: UserCreateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria usuário com permissões granulares e escopo de clientes."""
    # Verificar duplicatas
    result = await db.execute(
        select(User).where(
            (User.username == data.username) | (User.email == data.email)
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username ou email já cadastrado")

    # Determinar role
    role = UserRole.ADMIN if data.is_full_access else UserRole(data.role)

    user = User(
        username=data.username,
        email=data.email,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        role=role,
        phone=data.phone,
        is_active=True,
        is_verified=True,
        totp_enabled=False,  # Usuário configura no primeiro login
    )
    db.add(user)
    await db.flush()  # Gera o UUID

    # Salvar permissões (apenas se não for full access)
    if not data.is_full_access:
        for perm in data.permissions:
            db.add(UserPermission(
                user_id=user.id,
                module=perm.module,
                access_level=perm.access_level,
            ))

    # Salvar escopos de cliente
    for client_id in data.client_scope_ids:
        # Verificar se cliente existe
        c_result = await db.execute(select(Client).where(Client.id == client_id))
        if c_result.scalar_one_or_none():
            db.add(UserClientScope(user_id=user.id, client_id=client_id))

    await db.commit()
    await db.refresh(user)

    await log_audit(
        db,
        action=AuditAction.USER_CREATED,
        user_id=current_user.id,
        description=f"Usuário criado: {user.username} (role={role.value}, permissões={len(data.permissions)})",
        new_values={
            "username": user.username,
            "email": user.email,
            "role": role.value,
            "is_full_access": data.is_full_access,
            "modules": [p.module for p in data.permissions],
        },
        status="success",
    )

    return await _user_to_detail(user, db)


@router.put("/{user_id}")
async def update_user(
    user_id: str,
    data: UserUpdateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza usuário, permissões e escopos."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Proteger o próprio usuário de se desativar ou rebaixar
    if str(user.id) == str(current_user.id):
        if data.is_active is False:
            raise HTTPException(status_code=400, detail="Não é possível desativar seu próprio usuário")

    old_role = user.role.value

    # Atualizar campos básicos
    if data.email is not None:
        user.email = data.email
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.phone is not None:
        user.phone = data.phone
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.role is not None:
        user.role = UserRole(data.role)
    if data.is_full_access is True:
        user.role = UserRole.ADMIN
    elif data.is_full_access is False and user.role == UserRole.ADMIN and data.role:
        user.role = UserRole(data.role)

    # Atualizar permissões se fornecidas
    if data.permissions is not None:
        await db.execute(
            delete(UserPermission).where(UserPermission.user_id == user.id)
        )
        for perm in data.permissions:
            db.add(UserPermission(
                user_id=user.id,
                module=perm.module,
                access_level=perm.access_level,
            ))

    # Atualizar escopos de cliente se fornecidos
    if data.client_scope_ids is not None:
        await db.execute(
            delete(UserClientScope).where(UserClientScope.user_id == user.id)
        )
        for client_id in data.client_scope_ids:
            c_result = await db.execute(select(Client).where(Client.id == client_id))
            if c_result.scalar_one_or_none():
                db.add(UserClientScope(user_id=user.id, client_id=client_id))

    await db.commit()
    await db.refresh(user)

    await log_audit(
        db,
        action=AuditAction.USER_UPDATED,
        user_id=current_user.id,
        description=f"Usuário atualizado: {user.username}",
        old_values={"role": old_role},
        new_values=data.dict(exclude_none=True),
        status="success",
    )

    return await _user_to_detail(user, db)


@router.put("/{user_id}/permissions")
async def update_permissions(
    user_id: str,
    data: PermissionsUpdateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza apenas as permissões de módulo de um usuário."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Se full access, promover para admin
    if data.is_full_access:
        user.role = UserRole.ADMIN
        await db.execute(
            delete(UserPermission).where(UserPermission.user_id == user.id)
        )
    else:
        # Rebaixar se era admin por full_access
        if user.role == UserRole.ADMIN:
            user.role = UserRole.TECHNICIAN

        await db.execute(
            delete(UserPermission).where(UserPermission.user_id == user.id)
        )
        for perm in data.permissions:
            db.add(UserPermission(
                user_id=user.id,
                module=perm.module,
                access_level=perm.access_level,
            ))

    await db.commit()
    await db.refresh(user)

    await log_audit(
        db,
        action=AuditAction.USER_UPDATED,
        user_id=current_user.id,
        description=f"Permissões atualizadas: {user.username} ({len(data.permissions)} módulos)",
        status="success",
    )

    return await _user_to_detail(user, db)


@router.put("/{user_id}/client-scopes")
async def update_client_scopes(
    user_id: str,
    data: ClientScopesUpdateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza os escopos de cliente de um usuário. Lista vazia = acesso a todos."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    await db.execute(
        delete(UserClientScope).where(UserClientScope.user_id == user.id)
    )

    for client_id in data.client_scope_ids:
        c_result = await db.execute(select(Client).where(Client.id == client_id))
        if c_result.scalar_one_or_none():
            db.add(UserClientScope(user_id=user.id, client_id=client_id))

    await db.commit()
    await db.refresh(user)

    scope_label = f"{len(data.client_scope_ids)} cliente(s)" if data.client_scope_ids else "todos os clientes"
    await log_audit(
        db,
        action=AuditAction.USER_UPDATED,
        user_id=current_user.id,
        description=f"Escopo de clientes atualizado: {user.username} → {scope_label}",
        status="success",
    )

    return await _user_to_detail(user, db)


@router.post("/{user_id}/reset-2fa")
async def reset_2fa(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reseta o 2FA de um usuário, obrigando-o a configurar novamente no próximo login."""
    if str(current_user.id) == user_id:
        raise HTTPException(status_code=400, detail="Use /auth/2fa/disable para resetar seu próprio 2FA")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.totp_enabled = False
    user.totp_secret = None
    await db.commit()

    await log_audit(
        db,
        action=AuditAction.USER_UPDATED,
        user_id=current_user.id,
        description=f"2FA resetado pelo admin para: {user.username}",
        status="success",
    )

    return {"message": f"2FA de {user.username} resetado. O usuário deverá configurar novamente no próximo login."}


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove usuário."""
    if str(current_user.id) == user_id:
        raise HTTPException(status_code=400, detail="Não é possível remover seu próprio usuário")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    username = user.username
    await db.delete(user)
    await db.commit()

    await log_audit(
        db,
        action=AuditAction.USER_DELETED,
        user_id=current_user.id,
        description=f"Usuário removido: {username}",
        status="success",
    )

    return {"message": f"Usuário {username} removido com sucesso"}

"""
BR10 NetManager — Middleware de Autorização por Permissões Granulares

Uso nos endpoints:
    from app.core.permissions import require_permission, filter_by_client_scope

    # Exigir permissão de execução no módulo 'devices':
    @router.post("/devices/{id}/backup")
    async def run_backup(
        current_user: User = Depends(require_permission("devices", "execute")),
        ...
    ):

    # Filtrar query por escopo de cliente:
    query = filter_by_client_scope(select(Device), current_user, Device.client_id)
"""
from typing import Optional, List
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User, UserRole
from app.models.permissions import UserPermission, UserClientScope, ACCESS_LEVELS
from app.api.v1.auth import get_current_user
from app.core.database import get_db


def _has_level(user_level: str, required_level: str) -> bool:
    """Verifica se user_level >= required_level na hierarquia."""
    try:
        return ACCESS_LEVELS.index(user_level) >= ACCESS_LEVELS.index(required_level)
    except ValueError:
        return False


def require_permission(module: str, required_level: str = "view"):
    """
    Dependency factory que verifica se o usuário tem permissão no módulo.

    Admins (role=admin) têm acesso total a tudo.
    Outros usuários precisam de um registro em user_permissions.
    """
    async def _check(
        current_user: User = Depends(get_current_user),
    ) -> User:
        # Admin tem acesso total
        if current_user.role == UserRole.ADMIN:
            return current_user

        # Verificar permissão no módulo
        perm = next(
            (p for p in (current_user.permissions or []) if p.module == module),
            None
        )

        if not perm:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado ao módulo '{module}'",
            )

        if not _has_level(perm.access_level, required_level):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permissão insuficiente no módulo '{module}'. "
                       f"Requerido: '{required_level}', seu nível: '{perm.access_level}'",
            )

        return current_user

    return _check


def get_client_scope_ids(user: User) -> Optional[List[str]]:
    """
    Retorna lista de client_ids permitidos para o usuário.
    Retorna None se o usuário tem acesso a todos os clientes.
    """
    # Admin sempre tem acesso total
    if user.role == UserRole.ADMIN:
        return None

    scopes = user.client_scopes or []
    if not scopes:
        # Sem restrição de escopo = acesso a todos
        return None

    return [str(s.client_id) for s in scopes]


def apply_client_scope(query, user: User, client_id_column):
    """
    Aplica filtro de escopo de cliente a uma query SQLAlchemy.

    Uso:
        query = apply_client_scope(select(Device), current_user, Device.client_id)
    """
    scope_ids = get_client_scope_ids(user)
    if scope_ids is not None:
        query = query.where(client_id_column.in_(scope_ids))
    return query


def check_client_access(user: User, client_id: Optional[str]) -> bool:
    """
    Verifica se o usuário tem acesso a um cliente específico.
    Retorna True se tem acesso, False caso contrário.
    """
    if user.role == UserRole.ADMIN:
        return True

    scope_ids = get_client_scope_ids(user)
    if scope_ids is None:
        return True  # Sem restrição

    return str(client_id) in scope_ids if client_id else True

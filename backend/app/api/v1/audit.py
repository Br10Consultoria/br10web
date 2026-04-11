"""
BR10 NetManager - API de Log de Auditoria
Fornece acesso completo aos logs de auditoria com filtros avançados.
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import joinedload
import logging

from app.core.database import get_db
from app.models.audit import AuditLog, AuditAction
from app.models.user import User
from app.models.device import Device
from app.api.v1.auth import require_admin

router = APIRouter(prefix="/audit", tags=["Audit"])
logger = logging.getLogger(__name__)


@router.get("")
async def list_audit_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None, description="Busca em descrição, IP, usuário, dispositivo"),
    action: Optional[str] = Query(None, description="Filtrar por ação específica"),
    status: Optional[str] = Query(None, description="Filtrar por status: success, failure, warning"),
    user_id: Optional[str] = Query(None, description="Filtrar por ID de usuário"),
    device_id: Optional[str] = Query(None, description="Filtrar por ID de dispositivo"),
    resource_type: Optional[str] = Query(None, description="Filtrar por tipo de recurso"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Listar logs de auditoria com paginação e filtros avançados.
    Requer role admin.
    """
    query = (
        select(AuditLog)
        .options(
            joinedload(AuditLog.user),
            joinedload(AuditLog.device),
        )
        .order_by(AuditLog.created_at.desc())
    )
    count_query = select(func.count(AuditLog.id))

    # Filtro de busca textual (descrição, IP, resource_id, username via join)
    if search:
        search_filter = or_(
            AuditLog.description.ilike(f"%{search}%"),
            AuditLog.ip_address.ilike(f"%{search}%"),
            AuditLog.resource_type.ilike(f"%{search}%"),
            AuditLog.resource_id.ilike(f"%{search}%"),
            AuditLog.error_message.ilike(f"%{search}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # Filtro por ação — case-insensitive para compatibilidade com registros antigos (MAIÚSCULO)
    if action:
        action_upper = action.upper()
        action_lower = action.lower()
        action_filter = or_(
            AuditLog.action == action,
            AuditLog.action == action_upper,
            AuditLog.action == action_lower,
        )
        query = query.where(action_filter)
        count_query = count_query.where(action_filter)

    # Filtro por status
    if status:
        query = query.where(AuditLog.status == status)
        count_query = count_query.where(AuditLog.status == status)

    # Filtro por usuário
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
        count_query = count_query.where(AuditLog.user_id == user_id)

    # Filtro por dispositivo
    if device_id:
        query = query.where(AuditLog.device_id == device_id)
        count_query = count_query.where(AuditLog.device_id == device_id)

    # Filtro por tipo de recurso
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)
        count_query = count_query.where(AuditLog.resource_type == resource_type)

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)
    result = await db.execute(query)
    logs = result.unique().scalars().all()

    return {
        "items": [
            {
                "id": str(log.id),
                "user_id": str(log.user_id) if log.user_id else None,
                "username": log.user.username if log.user else None,
                "device_id": str(log.device_id) if log.device_id else None,
                "device_name": log.device.name if log.device else None,
                "device_ip": log.device.management_ip if log.device else None,
                "action": str(log.action.value) if hasattr(log.action, "value") else str(log.action),
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "description": log.description,
                "ip_address": log.ip_address,
                "user_agent": log.user_agent,
                "status": log.status,
                "error_message": log.error_message,
                "old_values": log.old_values,
                "new_values": log.new_values,
                "extra_data": log.extra_data,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total else 0,
    }


@router.get("/actions")
async def list_audit_actions(
    current_user: User = Depends(require_admin),
):
    """Listar todas as ações de auditoria disponíveis."""
    return {"actions": [a.value for a in AuditAction]}


@router.get("/summary")
async def audit_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Retorna um resumo dos últimos 24h de auditoria:
    - Total de eventos por categoria
    - Total de falhas
    - Últimos erros críticos
    """
    from sqlalchemy import text
    from datetime import datetime, timedelta, timezone

    since = datetime.now(timezone.utc) - timedelta(hours=24)

    # Contagem por status nas últimas 24h
    status_counts = await db.execute(
        select(AuditLog.status, func.count(AuditLog.id))
        .where(AuditLog.created_at >= since)
        .group_by(AuditLog.status)
    )
    by_status = {row[0]: row[1] for row in status_counts.all()}

    # Contagem por ação nas últimas 24h
    action_counts = await db.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.created_at >= since)
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(10)
    )
    by_action = [
        {"action": row[0].value if hasattr(row[0], "value") else str(row[0]), "count": row[1]}
        for row in action_counts.all()
    ]

    # Últimas falhas (últimas 10)
    failures_result = await db.execute(
        select(AuditLog)
        .options(joinedload(AuditLog.user), joinedload(AuditLog.device))
        .where(AuditLog.status == "failure")
        .order_by(AuditLog.created_at.desc())
        .limit(10)
    )
    failures = failures_result.unique().scalars().all()

    return {
        "period_hours": 24,
        "by_status": by_status,
        "top_actions": by_action,
        "recent_failures": [
            {
                "id": str(log.id),
                "action": str(log.action.value) if hasattr(log.action, "value") else str(log.action),
                "description": log.description,
                "error_message": log.error_message,
                "username": log.user.username if log.user else None,
                "device_name": log.device.name if log.device else None,
                "ip_address": log.ip_address,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in failures
        ],
    }

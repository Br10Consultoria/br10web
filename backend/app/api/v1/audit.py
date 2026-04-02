"""
BR10 NetManager - API de Log de Auditoria
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.models.audit import AuditLog, AuditAction
from app.models.user import User
from app.models.device import Device
from app.api.v1.auth import require_admin

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("")
async def list_audit_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Listar logs de auditoria com paginação e filtros. Requer role admin."""
    query = (
        select(AuditLog)
        .options(
            joinedload(AuditLog.user),
            joinedload(AuditLog.device),
        )
        .order_by(AuditLog.created_at.desc())
    )
    count_query = select(func.count(AuditLog.id))

    if search:
        search_filter = or_(
            AuditLog.description.ilike(f"%{search}%"),
            AuditLog.ip_address.ilike(f"%{search}%"),
            AuditLog.resource_type.ilike(f"%{search}%"),
            AuditLog.resource_id.ilike(f"%{search}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    if action:
        query = query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)

    if status:
        query = query.where(AuditLog.status == status)
        count_query = count_query.where(AuditLog.status == status)

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
                "action": log.action.value if hasattr(log.action, "value") else str(log.action),
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "description": log.description,
                "ip_address": log.ip_address,
                "user_agent": log.user_agent,
                "status": log.status,
                "error_message": log.error_message,
                "old_values": log.old_values,
                "new_values": log.new_values,
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

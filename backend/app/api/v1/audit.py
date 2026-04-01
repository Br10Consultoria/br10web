"""
API de Log de Auditoria
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.user import User
from app.api.v1.auth import get_current_user, require_role

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def list_audit_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "technician"])),
):
    """Listar logs de auditoria com paginação e filtros."""
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    count_query = select(func.count(AuditLog.id))

    if search:
        search_filter = or_(
            AuditLog.username.ilike(f"%{search}%"),
            AuditLog.action.ilike(f"%{search}%"),
            AuditLog.ip_address.ilike(f"%{search}%"),
            AuditLog.description.ilike(f"%{search}%"),
            AuditLog.device_name.ilike(f"%{search}%"),
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
    logs = result.scalars().all()

    return {
        "items": [
            {
                "id": str(log.id),
                "user_id": str(log.user_id) if log.user_id else None,
                "username": log.username,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "device_id": str(log.device_id) if log.device_id else None,
                "device_name": log.device_name,
                "ip_address": log.ip_address,
                "status": log.status,
                "description": log.description,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }

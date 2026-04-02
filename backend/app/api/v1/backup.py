"""
BR10 NetManager - Backup API
Endpoints para gerenciamento de backups.
"""
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.models.user import User
from app.models.audit import AuditLog, AuditAction
from app.api.v1.auth import get_current_user, require_admin
from app.services.backup import backup_service

router = APIRouter(prefix="/backup", tags=["Backup"])


@router.get("")
async def list_backups(
    current_user: User = Depends(require_admin),
):
    """Lista todos os backups disponíveis."""
    return backup_service.list_backups()


@router.post("/create")
async def create_backup(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria backup manual do banco de dados."""
    result = backup_service.create_database_backup("manual")
    if not result:
        # Log de falha
        db.add(AuditLog(
            user_id=current_user.id,
            action=AuditAction.BACKUP_CREATED,
            description="Falha ao criar backup manual",
            ip_address=request.client.host if request.client else None,
            status="failure",
            error_message="Falha ao criar backup. Verifique os logs do servidor.",
        ))
        await db.commit()
        raise HTTPException(
            status_code=500,
            detail="Falha ao criar backup. Verifique os logs do servidor."
        )

    # Log de sucesso
    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.BACKUP_CREATED,
        description=f"Backup manual criado: {result.get('filename', 'backup')}",
        ip_address=request.client.host if request.client else None,
        status="success",
        extra_data=result,
    ))
    await db.commit()

    return {
        "message": "Backup criado com sucesso",
        "backup": result,
    }


@router.get("/download/{filename}")
async def download_backup(
    filename: str,
    request: Request,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Download de um arquivo de backup."""
    backup_path = os.path.join(settings.BACKUP_DIR, filename)

    if not os.path.exists(backup_path):
        raise HTTPException(status_code=404, detail="Arquivo de backup não encontrado")

    # Log de download
    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.EXPORT_DATA,
        description=f"Download de backup: {filename}",
        ip_address=request.client.host if request.client else None,
        status="success",
    ))
    await db.commit()

    return FileResponse(
        path=backup_path,
        filename=filename,
        media_type="application/gzip",
    )


@router.post("/restore/{filename}")
async def restore_backup(
    filename: str,
    request: Request,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Restaura um backup do banco de dados."""
    success = backup_service.restore_backup(filename)
    if not success:
        db.add(AuditLog(
            user_id=current_user.id,
            action=AuditAction.BACKUP_RESTORED,
            description=f"Falha ao restaurar backup: {filename}",
            ip_address=request.client.host if request.client else None,
            status="failure",
            error_message="Falha ao restaurar backup. Verifique os logs.",
        ))
        await db.commit()
        raise HTTPException(
            status_code=500,
            detail="Falha ao restaurar backup. Verifique os logs."
        )

    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.BACKUP_RESTORED,
        description=f"Backup restaurado: {filename}",
        ip_address=request.client.host if request.client else None,
        status="success",
    ))
    await db.commit()

    return {"message": f"Backup {filename} restaurado com sucesso"}


@router.delete("/{filename}")
async def delete_backup(
    filename: str,
    request: Request,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove um arquivo de backup."""
    backup_path = os.path.join(settings.BACKUP_DIR, filename)

    if not os.path.exists(backup_path):
        raise HTTPException(status_code=404, detail="Arquivo de backup não encontrado")

    os.remove(backup_path)

    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.EXPORT_DATA,
        description=f"Backup removido: {filename}",
        ip_address=request.client.host if request.client else None,
        status="success",
    ))
    await db.commit()

    return {"message": f"Backup {filename} removido com sucesso"}


@router.post("/cleanup")
async def cleanup_old_backups(
    retention_days: int = 30,
    current_user: User = Depends(require_admin),
):
    """Remove backups mais antigos que o período de retenção."""
    removed = backup_service.cleanup_old_backups(retention_days)
    return {
        "message": f"{removed} backup(s) antigo(s) removido(s)",
        "retention_days": retention_days,
    }

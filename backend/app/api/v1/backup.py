"""
BR10 NetManager - Backup API
Endpoints para gerenciamento de backups.
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
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
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_admin),
):
    """Cria backup manual do banco de dados."""
    result = backup_service.create_database_backup("manual")
    if not result:
        raise HTTPException(
            status_code=500,
            detail="Falha ao criar backup. Verifique os logs do servidor."
        )
    return {
        "message": "Backup criado com sucesso",
        "backup": result,
    }


@router.get("/download/{filename}")
async def download_backup(
    filename: str,
    current_user: User = Depends(require_admin),
):
    """Download de um arquivo de backup."""
    import os
    from app.core.config import settings
    backup_path = os.path.join(settings.BACKUP_DIR, filename)

    if not os.path.exists(backup_path):
        raise HTTPException(status_code=404, detail="Arquivo de backup não encontrado")

    return FileResponse(
        path=backup_path,
        filename=filename,
        media_type="application/gzip",
    )


@router.post("/restore/{filename}")
async def restore_backup(
    filename: str,
    current_user: User = Depends(require_admin),
):
    """Restaura um backup do banco de dados."""
    success = backup_service.restore_backup(filename)
    if not success:
        raise HTTPException(
            status_code=500,
            detail="Falha ao restaurar backup. Verifique os logs."
        )
    return {"message": f"Backup {filename} restaurado com sucesso"}


@router.delete("/{filename}")
async def delete_backup(
    filename: str,
    current_user: User = Depends(require_admin),
):
    """Remove um arquivo de backup."""
    import os
    from app.core.config import settings
    backup_path = os.path.join(settings.BACKUP_DIR, filename)

    if not os.path.exists(backup_path):
        raise HTTPException(status_code=404, detail="Arquivo de backup não encontrado")

    os.remove(backup_path)
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

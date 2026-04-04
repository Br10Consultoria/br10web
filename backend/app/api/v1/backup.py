"""
BR10 NetManager - Backup API
Endpoints para gerenciamento de backups do banco de dados.

Autenticação suportada:
  - JWT Bearer token (usuário admin logado via interface)
  - X-API-Key header  (backup agendado automático via docker-compose)
"""
import os
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.config import settings
from app.models.user import User, UserRole
from app.models.audit import AuditLog, AuditAction
from app.api.v1.auth import require_admin
from app.services.backup import backup_service

router = APIRouter(prefix="/backup", tags=["Backup"])


# ─── Autenticação flexível para o endpoint /create ────────────────────────────

async def _auth_backup_create(
    request: Request,
    x_api_key: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """
    Aceita:
    1. X-API-Key header  → backup agendado (retorna None como user)
    2. JWT Bearer token  → usuário admin na interface (retorna User)
    """
    if x_api_key is not None:
        configured = settings.BACKUP_API_KEY
        if configured and x_api_key == configured:
            return None
        raise HTTPException(status_code=401, detail="X-API-Key inválida")

    # JWT fallback
    from app.core.security import verify_token
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Autenticação necessária")
    token = auth_header.split(" ", 1)[1]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
    result = await db.execute(select(User).where(User.id == payload.get("sub")))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return user


@router.get("")
async def list_backups(
    current_user: User = Depends(require_admin),
):
    """Lista todos os backups disponíveis."""
    return backup_service.list_backups()


@router.post("/create")
async def create_backup(
    request: Request,
    db: AsyncSession = Depends(get_db),
    auth_user: User | None = Depends(_auth_backup_create),
):
    """
    Cria backup completo do banco de dados PostgreSQL.
    Aceita autenticação via JWT (admin) ou X-API-Key (backup agendado).
    """
    is_scheduled = auth_user is None
    backup_type = "scheduled" if is_scheduled else "manual"

    result = backup_service.create_database_backup(backup_type)

    if not result:
        if not is_scheduled:
            db.add(AuditLog(
                user_id=auth_user.id,
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

    if not is_scheduled:
        db.add(AuditLog(
            user_id=auth_user.id,
            action=AuditAction.BACKUP_CREATED,
            description=f"Backup manual criado: {result.get('filename', 'backup')}",
            ip_address=request.client.host if request.client else None,
            status="success",
            extra_data=result,
        ))
        await db.commit()
    else:
        # Backup agendado: limpar arquivos antigos automaticamente
        backup_service.cleanup_old_backups()

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

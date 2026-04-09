"""
BR10 NetManager - API de Backup de Dispositivos

Endpoints:
  GET    /device-backup/schedules              — listar agendamentos
  POST   /device-backup/schedules              — criar agendamento
  GET    /device-backup/schedules/{id}         — detalhe de um agendamento
  PUT    /device-backup/schedules/{id}         — atualizar agendamento
  DELETE /device-backup/schedules/{id}         — remover agendamento
  POST   /device-backup/schedules/{id}/run     — executar manualmente
  POST   /device-backup/schedules/{id}/toggle  — ativar/pausar
  GET    /device-backup/executions             — histórico geral
  GET    /device-backup/schedules/{id}/executions — histórico de um schedule
  GET    /device-backup/executions/{id}        — detalhe de uma execução
  POST   /device-backup/test-telegram          — testar notificação Telegram
  GET    /device-backup/summary                — resumo para o dashboard
"""
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.backup_schedule import BackupSchedule, BackupExecution, BackupScheduleStatus, BackupRunStatus
from app.models.device import Device
from app.models.playbook import Playbook
from app.models.audit import AuditLog, AuditAction
from app.services.device_backup import run_backup_schedule, test_telegram

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/device-backup", tags=["Device Backup"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ScheduleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    playbook_id: Optional[str] = None          # UUID como string
    device_ids: List[str] = []                 # Lista de UUIDs como strings
    cron_expression: str = "0 22 * * *"
    timezone: str = "America/Bahia"
    status: str = "active"
    variables_override: Dict[str, Any] = {}
    telegram_enabled: bool = False
    telegram_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    telegram_on_error: bool = True
    telegram_on_success: bool = True
    retention_days: int = 30


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    playbook_id: Optional[str] = None          # UUID como string
    device_ids: Optional[List[str]] = None     # Lista de UUIDs como strings
    cron_expression: Optional[str] = None
    timezone: Optional[str] = None
    status: Optional[str] = None
    variables_override: Optional[Dict[str, Any]] = None
    telegram_enabled: Optional[bool] = None
    telegram_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    telegram_on_error: Optional[bool] = None
    telegram_on_success: Optional[bool] = None
    retention_days: Optional[int] = None


class TelegramTestRequest(BaseModel):
    token: str
    chat_id: str


def _uuid_str(v) -> Optional[str]:
    """Converte UUID ou string para string, retorna None se None."""
    if v is None:
        return None
    return str(v)


def _schedule_to_dict(s: BackupSchedule) -> Dict:
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "playbook_id": _uuid_str(s.playbook_id),
        "playbook_name": s.playbook_name,
        "device_ids": [_uuid_str(d) for d in (s.device_ids or [])],
        "device_names": s.device_names or [],
        "cron_expression": s.cron_expression,
        "timezone": s.timezone,
        "status": s.status.value if hasattr(s.status, "value") else s.status,
        "variables_override": s.variables_override or {},
        "telegram_enabled": s.telegram_enabled,
        "telegram_token": ("*" * 10 + s.telegram_token[-4:]) if s.telegram_token else None,
        "telegram_chat_id": s.telegram_chat_id,
        "telegram_on_error": s.telegram_on_error,
        "telegram_on_success": s.telegram_on_success,
        "retention_days": s.retention_days,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
        "next_run_at": s.next_run_at.isoformat() if s.next_run_at else None,
        "last_status": s.last_status.value if s.last_status and hasattr(s.last_status, "value") else s.last_status,
    }


def _execution_to_dict(e: BackupExecution) -> Dict:
    return {
        "id": e.id,
        "schedule_id": e.schedule_id,
        "triggered_by": _uuid_str(e.triggered_by),
        "triggered_by_name": e.triggered_by_name,
        "trigger_type": e.trigger_type,
        "status": e.status.value if hasattr(e.status, "value") else e.status,
        "started_at": e.started_at.isoformat() if e.started_at else None,
        "finished_at": e.finished_at.isoformat() if e.finished_at else None,
        "duration_ms": e.duration_ms,
        "device_results": e.device_results or [],
        "total_devices": e.total_devices,
        "success_count": e.success_count,
        "failure_count": e.failure_count,
        "error_message": e.error_message,
        "telegram_sent": e.telegram_sent,
        "telegram_error": e.telegram_error,
    }


async def _update_device_names(schedule: BackupSchedule, db: AsyncSession):
    """Atualiza o cache de nomes dos dispositivos no schedule."""
    if not schedule.device_ids:
        schedule.device_names = []
        return
    # device_ids são strings UUID — converter para UUID para a query
    try:
        uuid_ids = [UUID(str(d)) for d in schedule.device_ids]
    except Exception:
        uuid_ids = schedule.device_ids
    res = await db.execute(
        select(Device.id, Device.name).where(Device.id.in_(uuid_ids))
    )
    id_to_name = {str(r.id): r.name for r in res}
    schedule.device_names = [id_to_name.get(str(did), f"ID:{did}") for did in schedule.device_ids]


async def _reload_scheduler(schedule):
    """Notifica o APScheduler para recarregar os jobs de backup."""
    try:
        from app.core.scheduler import reload_backup_jobs
        await reload_backup_jobs()
    except Exception as e:
        logger.warning(f"Não foi possível recarregar o scheduler: {e}")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/schedules")
async def list_schedules(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista todos os agendamentos de backup."""
    result = await db.execute(
        select(BackupSchedule).order_by(BackupSchedule.created_at.desc())
    )
    schedules = result.scalars().all()
    return [_schedule_to_dict(s) for s in schedules]


@router.post("/schedules")
async def create_schedule(
    body: ScheduleCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cria um novo agendamento de backup."""
    # Validar playbook (UUID como string)
    playbook_name = None
    playbook_uuid = None
    if body.playbook_id:
        try:
            playbook_uuid = UUID(str(body.playbook_id))
        except ValueError:
            raise HTTPException(status_code=400, detail="playbook_id inválido")
        pb_res = await db.execute(select(Playbook).where(Playbook.id == playbook_uuid))
        pb = pb_res.scalar_one_or_none()
        if not pb:
            raise HTTPException(status_code=404, detail="Playbook não encontrado")
        playbook_name = pb.name

    # device_ids como lista de strings UUID
    device_ids_str = [str(d) for d in body.device_ids]

    schedule = BackupSchedule(
        name=body.name,
        description=body.description,
        playbook_id=playbook_uuid,
        playbook_name=playbook_name,
        device_ids=device_ids_str,
        cron_expression=body.cron_expression,
        timezone=body.timezone,
        status=body.status,
        variables_override=body.variables_override,
        telegram_enabled=body.telegram_enabled,
        telegram_token=body.telegram_token,
        telegram_chat_id=body.telegram_chat_id,
        telegram_on_error=body.telegram_on_error,
        telegram_on_success=body.telegram_on_success,
        retention_days=body.retention_days,
        created_by=current_user.id,
    )
    await _update_device_names(schedule, db)
    db.add(schedule)
    await db.flush()

    # Auditoria
    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.CREATE,
        resource_type="backup_schedule",
        resource_id=str(schedule.id),
        description=f"Agendamento de backup criado: {schedule.name}",
        ip_address=request.client.host if request.client else None,
        status="success",
    ))
    await db.commit()
    await db.refresh(schedule)
    await _reload_scheduler(schedule)
    return _schedule_to_dict(schedule)


@router.get("/schedules/{schedule_id}")
async def get_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(BackupSchedule).where(BackupSchedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    return _schedule_to_dict(schedule)


@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: int,
    body: ScheduleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(BackupSchedule).where(BackupSchedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")

    if body.name is not None:           schedule.name = body.name
    if body.description is not None:    schedule.description = body.description
    if body.cron_expression is not None: schedule.cron_expression = body.cron_expression
    if body.timezone is not None:       schedule.timezone = body.timezone
    if body.status is not None:         schedule.status = body.status
    if body.variables_override is not None: schedule.variables_override = body.variables_override
    if body.telegram_enabled is not None:   schedule.telegram_enabled = body.telegram_enabled
    if body.telegram_on_error is not None:  schedule.telegram_on_error = body.telegram_on_error
    if body.telegram_on_success is not None: schedule.telegram_on_success = body.telegram_on_success
    if body.retention_days is not None:     schedule.retention_days = body.retention_days
    if body.telegram_chat_id is not None:   schedule.telegram_chat_id = body.telegram_chat_id
    # Token: só atualiza se não for mascarado
    if body.telegram_token and not body.telegram_token.startswith("*"):
        schedule.telegram_token = body.telegram_token

    if body.playbook_id is not None:
        try:
            playbook_uuid = UUID(str(body.playbook_id)) if body.playbook_id else None
        except ValueError:
            raise HTTPException(status_code=400, detail="playbook_id inválido")
        schedule.playbook_id = playbook_uuid
        if playbook_uuid:
            pb_res = await db.execute(select(Playbook).where(Playbook.id == playbook_uuid))
            pb = pb_res.scalar_one_or_none()
            schedule.playbook_name = pb.name if pb else None
        else:
            schedule.playbook_name = None

    if body.device_ids is not None:
        schedule.device_ids = [str(d) for d in body.device_ids]
        await _update_device_names(schedule, db)

    schedule.updated_at = datetime.utcnow()

    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.UPDATE,
        resource_type="backup_schedule",
        resource_id=str(schedule_id),
        description=f"Agendamento de backup atualizado: {schedule.name}",
        ip_address=request.client.host if request.client else None,
        status="success",
    ))
    await db.commit()
    await db.refresh(schedule)
    await _reload_scheduler(schedule)
    return _schedule_to_dict(schedule)


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(BackupSchedule).where(BackupSchedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")

    name = schedule.name
    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.DELETE,
        resource_type="backup_schedule",
        resource_id=str(schedule_id),
        description=f"Agendamento de backup removido: {name}",
        ip_address=request.client.host if request.client else None,
        status="success",
    ))
    await db.delete(schedule)
    await db.commit()
    await _reload_scheduler(None)
    return {"message": f"Agendamento '{name}' removido com sucesso"}


@router.post("/schedules/{schedule_id}/run")
async def run_schedule_now(
    schedule_id: int,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Executa um agendamento de backup imediatamente (em background)."""
    result = await db.execute(select(BackupSchedule).where(BackupSchedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")

    # Criar execução pendente
    execution = BackupExecution(
        schedule_id=schedule_id,
        triggered_by=current_user.id,
        triggered_by_name=current_user.full_name or current_user.username,
        trigger_type="manual",
        status=BackupRunStatus.PENDING,
        total_devices=len(schedule.device_ids or []),
    )
    db.add(execution)
    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.EXECUTE,
        resource_type="backup_schedule",
        resource_id=str(schedule_id),
        description=f"Backup manual iniciado: {schedule.name}",
        ip_address=request.client.host if request.client else None,
        status="success",
    ))
    await db.commit()
    await db.refresh(execution)

    # Executar em background
    async def _run():
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as bg_db:
            try:
                await run_backup_schedule(
                    schedule_id=schedule_id,
                    db=bg_db,
                    triggered_by_id=current_user.id,
                    triggered_by_name=current_user.full_name or current_user.username,
                    trigger_type="manual",
                )
            except Exception as exc:
                logger.exception(f"Erro no backup manual do schedule {schedule_id}: {exc}")

    background_tasks.add_task(_run)

    return {
        "message": f"Backup '{schedule.name}' iniciado em background",
        "execution_id": execution.id,
    }


@router.post("/schedules/{schedule_id}/toggle")
async def toggle_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ativa ou pausa um agendamento."""
    result = await db.execute(select(BackupSchedule).where(BackupSchedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")

    if schedule.status == BackupScheduleStatus.ACTIVE:
        schedule.status = BackupScheduleStatus.PAUSED
        new_status = "paused"
    else:
        schedule.status = BackupScheduleStatus.ACTIVE
        new_status = "active"

    schedule.updated_at = datetime.utcnow()
    await db.commit()
    await _reload_scheduler(schedule)
    return {"status": new_status, "message": f"Agendamento {'ativado' if new_status == 'active' else 'pausado'}"}


@router.get("/executions")
async def list_executions(
    limit: int = 50,
    offset: int = 0,
    schedule_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista histórico de execuções de backup."""
    q = select(BackupExecution).order_by(desc(BackupExecution.started_at))
    if schedule_id:
        q = q.where(BackupExecution.schedule_id == schedule_id)
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    executions = result.scalars().all()

    # Buscar nomes dos schedules
    schedule_ids = list({e.schedule_id for e in executions})
    if schedule_ids:
        names_res = await db.execute(
            select(BackupSchedule.id, BackupSchedule.name).where(BackupSchedule.id.in_(schedule_ids))
        )
        id_to_name = {r.id: r.name for r in names_res}
    else:
        id_to_name = {}

    result_list = []
    for e in executions:
        d = _execution_to_dict(e)
        d["schedule_name"] = id_to_name.get(e.schedule_id, "?")
        result_list.append(d)

    return result_list


@router.get("/schedules/{schedule_id}/executions")
async def list_schedule_executions(
    schedule_id: int,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(BackupExecution)
        .where(BackupExecution.schedule_id == schedule_id)
        .order_by(desc(BackupExecution.started_at))
        .limit(limit)
    )
    executions = result.scalars().all()
    return [_execution_to_dict(e) for e in executions]


@router.get("/executions/{execution_id}")
async def get_execution(
    execution_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(BackupExecution).where(BackupExecution.id == execution_id)
    )
    execution = result.scalar_one_or_none()
    if not execution:
        raise HTTPException(status_code=404, detail="Execução não encontrada")

    d = _execution_to_dict(execution)
    # Adicionar nome do schedule
    sched_res = await db.execute(
        select(BackupSchedule.name).where(BackupSchedule.id == execution.schedule_id)
    )
    sched_name = sched_res.scalar_one_or_none()
    d["schedule_name"] = sched_name or "?"
    return d


@router.post("/test-telegram")
async def test_telegram_notification(
    body: TelegramTestRequest,
    current_user: User = Depends(get_current_user),
):
    """Envia uma mensagem de teste para validar a configuração do Telegram."""
    ok, err = await test_telegram(body.token, body.chat_id)
    if ok:
        return {"success": True, "message": "Mensagem de teste enviada com sucesso!"}
    raise HTTPException(status_code=400, detail=f"Erro ao enviar mensagem: {err}")


@router.get("/summary")
async def get_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resumo para o dashboard de backup."""
    # Total de schedules por status
    schedules_res = await db.execute(select(BackupSchedule))
    schedules = schedules_res.scalars().all()

    active_count = sum(1 for s in schedules if s.status == BackupScheduleStatus.ACTIVE)
    paused_count = sum(1 for s in schedules if s.status == BackupScheduleStatus.PAUSED)

    # Últimas 10 execuções
    exec_res = await db.execute(
        select(BackupExecution)
        .order_by(desc(BackupExecution.started_at))
        .limit(10)
    )
    recent_executions = exec_res.scalars().all()

    # Contagem de status nas últimas 24h
    from datetime import timedelta
    since = datetime.utcnow() - timedelta(hours=24)
    exec_24h_res = await db.execute(
        select(BackupExecution).where(BackupExecution.started_at >= since)
    )
    exec_24h = exec_24h_res.scalars().all()

    success_24h = sum(1 for e in exec_24h if e.status == BackupRunStatus.SUCCESS)
    failure_24h = sum(1 for e in exec_24h if e.status in (BackupRunStatus.FAILURE, BackupRunStatus.PARTIAL))

    # Último backup bem-sucedido
    last_success_res = await db.execute(
        select(BackupExecution)
        .where(BackupExecution.status == BackupRunStatus.SUCCESS)
        .order_by(desc(BackupExecution.finished_at))
        .limit(1)
    )
    last_success = last_success_res.scalar_one_or_none()

    return {
        "total_schedules": len(schedules),
        "active_schedules": active_count,
        "paused_schedules": paused_count,
        "success_24h": success_24h,
        "failure_24h": failure_24h,
        "last_success_at": last_success.finished_at.isoformat() if last_success and last_success.finished_at else None,
        "recent_executions": [_execution_to_dict(e) for e in recent_executions],
    }

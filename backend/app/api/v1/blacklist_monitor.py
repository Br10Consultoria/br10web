"""
BR10 NetManager - API de Monitoramento de Blacklist / Reputação IP

Endpoints:
  GET    /blacklist/monitors                  — listar monitores
  POST   /blacklist/monitors                  — criar monitor
  PUT    /blacklist/monitors/{id}             — atualizar monitor
  DELETE /blacklist/monitors/{id}             — remover monitor
  POST   /blacklist/monitors/{id}/check       — verificar agora (manual)
  GET    /blacklist/monitors/{id}/history     — histórico de verificações
  POST   /blacklist/check                     — consulta manual (sem cadastrar)
  GET    /blacklist/summary                   — resumo para o dashboard
  POST   /blacklist/check-all                 — verificar todos agora (admin)

  GET    /blacklist/api-keys                  — listar chaves de API configuradas
  POST   /blacklist/api-keys                  — salvar/atualizar chave de API
  POST   /blacklist/api-keys/{service}/test   — testar chave de API
"""
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.blacklist_monitor import BlacklistMonitor, BlacklistCheck, SystemApiKey
from app.models.audit import AuditAction
from app.core.audit_helper import log_audit
from app.core.security import encrypt_field, decrypt_field
from app.services.mxtoolbox_service import MxToolboxService, get_mxtoolbox_service_from_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/blacklist", tags=["Blacklist Monitor"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class MonitorCreate(BaseModel):
    name: str
    description: Optional[str] = None
    target: str
    target_type: str = "ip"   # ip | domain | asn
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    active: bool = True
    alert_on_listed: bool = True


class MonitorUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    target: Optional[str] = None
    target_type: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    active: Optional[bool] = None
    alert_on_listed: Optional[bool] = None


class ManualCheckRequest(BaseModel):
    target: str
    target_type: str = "ip"


class ApiKeySave(BaseModel):
    service: str       # "mxtoolbox"
    api_key: str
    label: Optional[str] = None
    notes: Optional[str] = None


# ─── Serialização ─────────────────────────────────────────────────────────────

def _monitor_to_dict(m: BlacklistMonitor) -> Dict:
    return {
        "id": str(m.id),
        "name": m.name,
        "description": m.description,
        "target": m.target,
        "target_type": m.target_type,
        "client_id": str(m.client_id) if m.client_id else None,
        "client_name": m.client_name,
        "last_status": m.last_status,
        "last_checked_at": m.last_checked_at.isoformat() if m.last_checked_at else None,
        "last_listed_count": m.last_listed_count or 0,
        "last_checked_count": m.last_checked_count or 0,
        "last_blacklists": m.last_blacklists or [],
        "last_error": m.last_error,
        "active": m.active,
        "alert_on_listed": m.alert_on_listed,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _check_to_dict(c: BlacklistCheck) -> Dict:
    return {
        "id": str(c.id),
        "monitor_id": str(c.monitor_id) if c.monitor_id else None,
        "target": c.target,
        "target_type": c.target_type,
        "status": c.status,
        "listed_count": c.listed_count or 0,
        "checked_count": c.checked_count or 0,
        "blacklists_found": c.blacklists_found or [],
        "all_results": c.all_results or [],
        "error_message": c.error_message,
        "trigger_type": c.trigger_type,
        "duration_ms": c.duration_ms,
        "api_used": c.api_used,
        "checked_at": c.checked_at.isoformat() if c.checked_at else None,
    }


# ─── Função central de verificação ────────────────────────────────────────────

async def _do_blacklist_check(
    target: str,
    target_type: str,
    monitor: Optional[BlacklistMonitor],
    db: AsyncSession,
    trigger_type: str = "manual",
    triggered_by: Optional[UUID] = None,
) -> BlacklistCheck:
    """
    Executa a verificação de blacklist via MxToolbox e salva o resultado no banco.
    """
    service = await get_mxtoolbox_service_from_db(db)

    if not service:
        # Sem API Key configurada — registrar erro
        check = BlacklistCheck(
            monitor_id=monitor.id if monitor else None,
            target=target,
            target_type=target_type,
            status="error",
            listed_count=0,
            checked_count=0,
            blacklists_found=[],
            all_results=[],
            error_message="Chave de API do MxToolbox não configurada. Acesse Configurações → Chaves de API.",
            trigger_type=trigger_type,
            triggered_by=triggered_by,
            api_used="mxtoolbox",
        )
        db.add(check)
        await db.flush()

        if monitor:
            monitor.last_status = "error"
            monitor.last_checked_at = datetime.now(timezone.utc)
            monitor.last_error = check.error_message

        await db.commit()
        return check

    result = await service.blacklist_check(target)

    check = BlacklistCheck(
        monitor_id=monitor.id if monitor else None,
        target=target,
        target_type=target_type,
        status=result["status"],
        listed_count=result.get("listed_count", 0),
        checked_count=result.get("checked_count", 0),
        blacklists_found=result.get("blacklists_found", []),
        all_results=result.get("all_results", []),
        error_message=result.get("error"),
        trigger_type=trigger_type,
        triggered_by=triggered_by,
        duration_ms=result.get("duration_ms"),
        api_used="mxtoolbox",
    )
    db.add(check)
    await db.flush()

    # Atualizar estado do monitor
    if monitor:
        monitor.last_status = result["status"]
        monitor.last_checked_at = datetime.now(timezone.utc)
        monitor.last_listed_count = result.get("listed_count", 0)
        monitor.last_checked_count = result.get("checked_count", 0)
        monitor.last_blacklists = result.get("blacklists_found", [])
        monitor.last_error = result.get("error")

    await db.commit()
    return check


# ─── Endpoints de Monitores ───────────────────────────────────────────────────

@router.get("/monitors")
async def list_monitors(
    client_id: Optional[str] = Query(None),
    active_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista todos os monitores de blacklist cadastrados."""
    q = select(BlacklistMonitor)
    if client_id:
        q = q.where(BlacklistMonitor.client_id == client_id)
    if active_only:
        q = q.where(BlacklistMonitor.active == True)  # noqa: E712
    q = q.order_by(BlacklistMonitor.created_at.desc())

    result = await db.execute(q)
    monitors = result.scalars().all()
    return [_monitor_to_dict(m) for m in monitors]


@router.post("/monitors")
async def create_monitor(
    req: MonitorCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cadastra um novo alvo para monitoramento de blacklist."""
    monitor = BlacklistMonitor(
        name=req.name,
        description=req.description,
        target=req.target.strip(),
        target_type=req.target_type,
        client_id=req.client_id,
        client_name=req.client_name,
        active=req.active,
        alert_on_listed=req.alert_on_listed,
        created_by=current_user.id,
    )
    db.add(monitor)
    await db.commit()
    await db.refresh(monitor)

    await log_audit(
        db,
        action=AuditAction.CREATE,
        user_id=current_user.id,
        resource_type="blacklist_monitor",
        resource_id=str(monitor.id),
        description=f"Monitor de blacklist criado: {monitor.name} ({monitor.target})",
        status="success",
    )

    return _monitor_to_dict(monitor)


@router.put("/monitors/{monitor_id}")
async def update_monitor(
    monitor_id: str,
    req: MonitorUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Atualiza um monitor de blacklist."""
    result = await db.execute(select(BlacklistMonitor).where(BlacklistMonitor.id == monitor_id))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado.")

    for field, value in req.model_dump(exclude_none=True).items():
        setattr(monitor, field, value)

    await db.commit()
    return _monitor_to_dict(monitor)


@router.delete("/monitors/{monitor_id}")
async def delete_monitor(
    monitor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove um monitor de blacklist."""
    result = await db.execute(select(BlacklistMonitor).where(BlacklistMonitor.id == monitor_id))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado.")

    await db.delete(monitor)
    await db.commit()
    return {"ok": True}


@router.post("/monitors/{monitor_id}/check")
async def check_monitor_now(
    monitor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Executa uma verificação manual imediata de um monitor."""
    result = await db.execute(select(BlacklistMonitor).where(BlacklistMonitor.id == monitor_id))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado.")

    check = await _do_blacklist_check(
        target=monitor.target,
        target_type=monitor.target_type,
        monitor=monitor,
        db=db,
        trigger_type="manual",
        triggered_by=current_user.id,
    )
    return _check_to_dict(check)


@router.get("/monitors/{monitor_id}/history")
async def get_monitor_history(
    monitor_id: str,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna o histórico de verificações de um monitor."""
    result = await db.execute(
        select(BlacklistCheck)
        .where(BlacklistCheck.monitor_id == monitor_id)
        .order_by(desc(BlacklistCheck.checked_at))
        .limit(limit)
    )
    checks = result.scalars().all()
    return [_check_to_dict(c) for c in checks]


# ─── Consulta Manual ──────────────────────────────────────────────────────────

@router.post("/check")
async def manual_check(
    req: ManualCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Executa uma consulta de blacklist manual (sem cadastrar monitor).
    Ideal para verificações pontuais de IPs, domínios ou ASNs.
    """
    check = await _do_blacklist_check(
        target=req.target.strip(),
        target_type=req.target_type,
        monitor=None,
        db=db,
        trigger_type="manual",
        triggered_by=current_user.id,
    )
    return _check_to_dict(check)


# ─── Verificação em Massa ──────────────────────────────────────────────────────

@router.post("/check-all")
async def check_all_monitors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verifica todos os monitores ativos imediatamente (uso administrativo)."""
    result = await db.execute(
        select(BlacklistMonitor).where(BlacklistMonitor.active == True)  # noqa: E712
    )
    monitors = result.scalars().all()

    if not monitors:
        return {"message": "Nenhum monitor ativo encontrado.", "checked": 0}

    results = []
    for monitor in monitors:
        try:
            check = await _do_blacklist_check(
                target=monitor.target,
                target_type=monitor.target_type,
                monitor=monitor,
                db=db,
                trigger_type="manual",
                triggered_by=current_user.id,
            )
            results.append({
                "monitor_id": str(monitor.id),
                "name": monitor.name,
                "target": monitor.target,
                "status": check.status,
                "listed_count": check.listed_count,
            })
        except Exception as e:
            results.append({
                "monitor_id": str(monitor.id),
                "name": monitor.name,
                "target": monitor.target,
                "status": "error",
                "error": str(e),
            })

    return {"checked": len(results), "results": results}


# ─── Resumo / Dashboard ───────────────────────────────────────────────────────

@router.get("/summary")
async def get_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna resumo para o dashboard: total, listados, limpos, erros."""
    result = await db.execute(select(BlacklistMonitor).where(BlacklistMonitor.active == True))  # noqa: E712
    monitors = result.scalars().all()

    total = len(monitors)
    listed = sum(1 for m in monitors if m.last_status == "listed")
    clean = sum(1 for m in monitors if m.last_status == "clean")
    errors = sum(1 for m in monitors if m.last_status in ("error", None))
    never_checked = sum(1 for m in monitors if m.last_checked_at is None)

    # Última verificação
    last_check_result = await db.execute(
        select(BlacklistCheck.checked_at)
        .order_by(desc(BlacklistCheck.checked_at))
        .limit(1)
    )
    last_check_row = last_check_result.scalar_one_or_none()

    # API Key configurada?
    key_result = await db.execute(
        select(SystemApiKey).where(SystemApiKey.service == "mxtoolbox", SystemApiKey.is_active == True)
    )
    api_key_configured = key_result.scalar_one_or_none() is not None

    return {
        "total_monitors": total,
        "listed": listed,
        "clean": clean,
        "errors": errors,
        "never_checked": never_checked,
        "last_check_at": last_check_row.isoformat() if last_check_row else None,
        "api_key_configured": api_key_configured,
    }


# ─── Gerenciamento de Chaves de API ───────────────────────────────────────────

@router.get("/api-keys")
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista as chaves de API configuradas (sem revelar o valor)."""
    result = await db.execute(select(SystemApiKey).order_by(SystemApiKey.service))
    keys = result.scalars().all()
    return [
        {
            "id": str(k.id),
            "service": k.service,
            "label": k.label,
            "is_active": k.is_active,
            "has_key": bool(k.api_key_encrypted),
            "notes": k.notes,
            "updated_at": k.updated_at.isoformat() if k.updated_at else None,
        }
        for k in keys
    ]


@router.post("/api-keys")
async def save_api_key(
    req: ApiKeySave,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Salva ou atualiza uma chave de API de serviço externo."""
    # Verificar se já existe
    result = await db.execute(
        select(SystemApiKey).where(SystemApiKey.service == req.service)
    )
    key_obj = result.scalar_one_or_none()

    encrypted = encrypt_field(req.api_key)

    if key_obj:
        key_obj.api_key_encrypted = encrypted
        key_obj.label = req.label or key_obj.label
        key_obj.notes = req.notes or key_obj.notes
        key_obj.is_active = True
        key_obj.updated_by = current_user.id
    else:
        key_obj = SystemApiKey(
            service=req.service,
            label=req.label or f"{req.service.title()} API Key",
            api_key_encrypted=encrypted,
            notes=req.notes,
            is_active=True,
            updated_by=current_user.id,
        )
        db.add(key_obj)

    await db.commit()

    await log_audit(
        db,
        action=AuditAction.UPDATE,
        user_id=current_user.id,
        resource_type="system_api_key",
        resource_id=req.service,
        description=f"Chave de API atualizada: {req.service}",
        status="success",
    )

    return {"ok": True, "service": req.service}


@router.post("/api-keys/{service}/test")
async def test_api_key(
    service: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Testa se a chave de API configurada é válida."""
    if service == "mxtoolbox":
        svc = await get_mxtoolbox_service_from_db(db)
        if not svc:
            return {"valid": False, "error": "Chave não configurada."}
        return await svc.test_api_key()
    else:
        raise HTTPException(status_code=400, detail=f"Serviço '{service}' não suportado.")


# ─── Endpoint para verificar IPs de um ASN (RPKI → Blacklist) ─────────────────

@router.get("/asn/{asn}/ips")
async def get_asn_ips_for_blacklist(
    asn: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retorna os prefixos IPv4 anunciados por um ASN (via RIPE Stat).
    Útil para selecionar IPs/prefixos para monitoramento de blacklist.
    """
    import httpx as _httpx
    try:
        url = f"https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS{asn}&family=4"
        async with _httpx.AsyncClient(timeout=_httpx.Timeout(20.0)) as client:
            resp = await client.get(url)

        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Erro ao consultar RIPE Stat.")

        data = resp.json()
        prefixes = data.get("data", {}).get("prefixes", [])
        return {
            "asn": asn,
            "prefixes": [
                {"prefix": p.get("prefix"), "timelines": p.get("timelines", [])}
                for p in prefixes
            ],
            "total": len(prefixes),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

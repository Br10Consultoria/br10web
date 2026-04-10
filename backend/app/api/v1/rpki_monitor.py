"""
BR10 NetManager - API de Monitoramento RPKI

Endpoints:
  GET    /rpki-monitor/monitors              — listar monitores
  POST   /rpki-monitor/monitors              — criar monitor
  GET    /rpki-monitor/monitors/{id}         — detalhe de um monitor
  PUT    /rpki-monitor/monitors/{id}         — atualizar monitor
  DELETE /rpki-monitor/monitors/{id}         — remover monitor
  POST   /rpki-monitor/monitors/{id}/check   — verificar agora (manual)
  GET    /rpki-monitor/monitors/{id}/history — histórico de verificações
  GET    /rpki-monitor/summary               — resumo para o dashboard
  POST   /rpki-monitor/check-all             — verificar todos agora (admin)
"""
import asyncio
import ipaddress
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.rpki_monitor import RpkiMonitor, RpkiCheck

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rpki-monitor", tags=["RPKI Monitor"])

TIMEOUT = httpx.Timeout(15.0)


# ─── Schemas ──────────────────────────────────────────────────────────────────

class MonitorCreate(BaseModel):
    name: str
    description: Optional[str] = None
    asn: Optional[int] = None
    prefix: str
    active: bool = True
    alert_on_invalid: bool = True
    alert_on_not_found: bool = False

    @field_validator("prefix")
    @classmethod
    def validate_prefix(cls, v: str) -> str:
        try:
            net = ipaddress.ip_network(v.strip(), strict=False)
            return str(net)
        except ValueError:
            raise ValueError(f"Prefixo inválido: {v}")

    @field_validator("asn")
    @classmethod
    def validate_asn(cls, v):
        if v is not None and (v < 1 or v > 4294967295):
            raise ValueError("ASN deve estar entre 1 e 4294967295")
        return v


class MonitorUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    asn: Optional[int] = None
    prefix: Optional[str] = None
    active: Optional[bool] = None
    alert_on_invalid: Optional[bool] = None
    alert_on_not_found: Optional[bool] = None

    @field_validator("prefix")
    @classmethod
    def validate_prefix(cls, v):
        if v is None:
            return v
        try:
            net = ipaddress.ip_network(v.strip(), strict=False)
            return str(net)
        except ValueError:
            raise ValueError(f"Prefixo inválido: {v}")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _monitor_to_dict(m: RpkiMonitor) -> Dict:
    return {
        "id": str(m.id),
        "name": m.name,
        "description": m.description,
        "asn": m.asn,
        "prefix": m.prefix,
        "last_status": m.last_status,
        "last_checked_at": m.last_checked_at.isoformat() if m.last_checked_at else None,
        "last_roas": m.last_roas or [],
        "last_origin_asns": m.last_origin_asns or [],
        "last_country": m.last_country,
        "last_rir": m.last_rir,
        "last_error": m.last_error,
        "active": m.active,
        "alert_on_invalid": m.alert_on_invalid,
        "alert_on_not_found": m.alert_on_not_found,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


def _check_to_dict(c: RpkiCheck) -> Dict:
    return {
        "id": str(c.id),
        "monitor_id": str(c.monitor_id),
        "status": c.status,
        "prefix_checked": c.prefix_checked,
        "asn_used": c.asn_used,
        "roas": c.roas or [],
        "origin_asns": c.origin_asns or [],
        "country": c.country,
        "rir": c.rir,
        "sources_checked": c.sources_checked or [],
        "error_message": c.error_message,
        "trigger_type": c.trigger_type,
        "duration_ms": c.duration_ms,
        "checked_at": c.checked_at.isoformat() if c.checked_at else None,
    }


async def _do_rpki_check(prefix: str, asn: Optional[int] = None) -> Dict[str, Any]:
    """
    Executa a validação RPKI de um prefixo.
    Reutiliza a lógica do endpoint /network-tools/rpki.
    """
    network = ipaddress.ip_network(prefix, strict=False)
    prefix_str = str(network)

    results: Dict[str, Any] = {
        "prefix": prefix_str,
        "ip_version": network.version,
        "rpki_status": "unknown",
        "roas": [],
        "origin_asns": [],
        "country": None,
        "rir": None,
        "sources_checked": [],
        "errors": [],
    }

    origin_asn = asn

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # 1. RIPE Stat — prefix-overview (ASN de origem)
        if not origin_asn:
            try:
                ripe_url = f"https://stat.ripe.net/data/prefix-overview/data.json?resource={prefix_str}"
                resp = await client.get(ripe_url)
                if resp.status_code == 200:
                    data = resp.json().get("data", {})
                    asns = data.get("asns", [])
                    if asns:
                        results["origin_asns"] = [a.get("asn") for a in asns if a.get("asn")]
                        origin_asn = results["origin_asns"][0]
                    results["sources_checked"].append("RIPE prefix-overview")
            except Exception as e:
                results["errors"].append(f"RIPE prefix-overview: {str(e)}")

        # 2. RIPE Stat — rpki-validation (fonte primária)
        try:
            if origin_asn:
                ripe_url = (
                    f"https://stat.ripe.net/data/rpki-validation/data.json"
                    f"?resource=AS{origin_asn}&prefix={prefix_str}"
                )
            else:
                ripe_url = (
                    f"https://stat.ripe.net/data/rpki-validation/data.json"
                    f"?resource={prefix_str}"
                )
            resp = await client.get(ripe_url)
            if resp.status_code == 200:
                ripe_json = resp.json()
                if ripe_json.get("status") != "ok":
                    results["errors"].append(
                        f"RIPE rpki-validation: {ripe_json.get('messages', [['', 'Erro desconhecido']])[0][1]}"
                    )
                else:
                    ripe_data = ripe_json.get("data", {})
                    validating_roas = ripe_data.get("validating_roas", [])
                    status_list = [r.get("validity") for r in validating_roas if r.get("validity")]
                    status_map = {
                        "valid": "valid", "invalid": "invalid",
                        "not-found": "not-found", "unknown": "unknown",
                    }
                    if status_list:
                        if "valid" in status_list:
                            results["rpki_status"] = "valid"
                        elif "invalid" in status_list:
                            results["rpki_status"] = "invalid"
                        else:
                            first = status_list[0].lower()
                            results["rpki_status"] = status_map.get(first, "not-found")
                    else:
                        results["rpki_status"] = "not-found"

                    results["roas"] = [
                        {
                            "asn": roa.get("origin"),
                            "prefix": roa.get("prefix"),
                            "max_length": roa.get("max_length"),
                            "validity": roa.get("validity"),
                        }
                        for roa in validating_roas
                    ]
                    results["sources_checked"].append("RIPE rpki-validation")
        except Exception as e:
            results["errors"].append(f"RIPE rpki-validation: {str(e)}")

        # 3. Cloudflare RPKI (fallback)
        if results["rpki_status"] == "unknown" and origin_asn:
            try:
                cf_url = f"https://rpki.cloudflare.com/api/v1/validity/{origin_asn}/{prefix_str}"
                resp = await client.get(cf_url)
                if resp.status_code == 200:
                    cf_data = resp.json()
                    state = cf_data.get("status", {}).get("state", "unknown").lower()
                    status_map = {"valid": "valid", "invalid": "invalid", "unknown": "not-found"}
                    results["rpki_status"] = status_map.get(state, "not-found")
                    results["roas"] = [
                        {
                            "asn": roa.get("asn"),
                            "prefix": roa.get("prefix"),
                            "max_length": roa.get("max_length"),
                            "validity": state,
                        }
                        for roa in cf_data.get("status", {}).get("roas", [])
                    ]
                    results["sources_checked"].append("Cloudflare RPKI")
            except Exception as e:
                results["errors"].append(f"Cloudflare RPKI: {str(e)}")

        # 4. Geolocalização e RIR
        try:
            geo_url = f"https://stat.ripe.net/data/geoloc/data.json?resource={prefix_str}"
            resp = await client.get(geo_url)
            if resp.status_code == 200:
                geo_data = resp.json().get("data", {})
                locations = geo_data.get("locations", [])
                if locations:
                    results["country"] = locations[0].get("country")
        except Exception:
            pass

        try:
            rir_url = f"https://stat.ripe.net/data/rir/data.json?resource={prefix_str}"
            resp = await client.get(rir_url)
            if resp.status_code == 200:
                rir_data = resp.json().get("data", {})
                rirs = rir_data.get("rirs", [])
                if rirs:
                    results["rir"] = rirs[0].get("rir")
        except Exception:
            pass

    return results


async def _check_monitor(monitor: RpkiMonitor, db: AsyncSession, trigger_type: str = "scheduled", triggered_by=None) -> RpkiCheck:
    """Executa verificação RPKI de um monitor e salva o resultado."""
    start = time.time()
    error_msg = None
    result = {}

    try:
        result = await _do_rpki_check(monitor.prefix, monitor.asn)
        status = result.get("rpki_status", "unknown")
    except Exception as e:
        status = "error"
        error_msg = str(e)
        logger.error(f"[RPKI Monitor] Erro ao verificar {monitor.prefix}: {e}")

    duration_ms = int((time.time() - start) * 1000)

    # Salvar verificação no histórico
    check = RpkiCheck(
        monitor_id=monitor.id,
        status=status,
        prefix_checked=monitor.prefix,
        asn_used=result.get("origin_asns", [monitor.asn])[0] if result.get("origin_asns") else monitor.asn,
        roas=result.get("roas", []),
        origin_asns=result.get("origin_asns", []),
        country=result.get("country"),
        rir=result.get("rir"),
        sources_checked=result.get("sources_checked", []),
        error_message=error_msg or ("; ".join(result.get("errors", [])) if result.get("errors") else None),
        trigger_type=trigger_type,
        triggered_by=triggered_by,
        duration_ms=duration_ms,
    )
    db.add(check)

    # Atualizar o monitor com o último status
    monitor.last_status = status
    monitor.last_checked_at = datetime.now(timezone.utc)
    monitor.last_roas = result.get("roas", [])
    monitor.last_origin_asns = result.get("origin_asns", [])
    monitor.last_country = result.get("country")
    monitor.last_rir = result.get("rir")
    monitor.last_error = error_msg

    await db.commit()
    await db.refresh(check)
    return check


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/summary")
async def get_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resumo para o dashboard: totais por status."""
    result = await db.execute(select(RpkiMonitor).where(RpkiMonitor.active == True))
    monitors = result.scalars().all()

    counts = {"valid": 0, "invalid": 0, "not-found": 0, "unknown": 0, "error": 0, "never": 0}
    for m in monitors:
        if m.last_status is None:
            counts["never"] += 1
        elif m.last_status in counts:
            counts[m.last_status] += 1
        else:
            counts["unknown"] += 1

    return {
        "total": len(monitors),
        "active": len(monitors),
        "counts": counts,
        "last_check": max(
            (m.last_checked_at for m in monitors if m.last_checked_at),
            default=None
        ),
    }


@router.get("/monitors")
async def list_monitors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista todos os monitores RPKI."""
    result = await db.execute(
        select(RpkiMonitor).order_by(RpkiMonitor.created_at.desc())
    )
    monitors = result.scalars().all()
    return [_monitor_to_dict(m) for m in monitors]


@router.post("/monitors", status_code=201)
async def create_monitor(
    body: MonitorCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cria um novo monitor RPKI."""
    monitor = RpkiMonitor(
        name=body.name,
        description=body.description,
        asn=body.asn,
        prefix=body.prefix,
        active=body.active,
        alert_on_invalid=body.alert_on_invalid,
        alert_on_not_found=body.alert_on_not_found,
        created_by=current_user.id,
    )
    db.add(monitor)
    await db.commit()
    await db.refresh(monitor)
    return _monitor_to_dict(monitor)


@router.get("/monitors/{monitor_id}")
async def get_monitor(
    monitor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(RpkiMonitor).where(RpkiMonitor.id == UUID(monitor_id)))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado")
    return _monitor_to_dict(monitor)


@router.put("/monitors/{monitor_id}")
async def update_monitor(
    monitor_id: str,
    body: MonitorUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(RpkiMonitor).where(RpkiMonitor.id == UUID(monitor_id)))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado")

    if body.name is not None:              monitor.name = body.name
    if body.description is not None:       monitor.description = body.description
    if body.asn is not None:               monitor.asn = body.asn
    if body.prefix is not None:            monitor.prefix = body.prefix
    if body.active is not None:            monitor.active = body.active
    if body.alert_on_invalid is not None:  monitor.alert_on_invalid = body.alert_on_invalid
    if body.alert_on_not_found is not None: monitor.alert_on_not_found = body.alert_on_not_found

    await db.commit()
    await db.refresh(monitor)
    return _monitor_to_dict(monitor)


@router.delete("/monitors/{monitor_id}")
async def delete_monitor(
    monitor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(RpkiMonitor).where(RpkiMonitor.id == UUID(monitor_id)))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado")
    await db.delete(monitor)
    await db.commit()
    return {"message": f"Monitor '{monitor.name}' removido com sucesso"}


@router.post("/monitors/{monitor_id}/check")
async def check_monitor_now(
    monitor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Executa verificação RPKI imediata de um monitor."""
    result = await db.execute(select(RpkiMonitor).where(RpkiMonitor.id == UUID(monitor_id)))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado")

    check = await _check_monitor(monitor, db, trigger_type="manual", triggered_by=current_user.id)
    return {
        "monitor": _monitor_to_dict(monitor),
        "check": _check_to_dict(check),
    }


@router.get("/monitors/{monitor_id}/history")
async def get_monitor_history(
    monitor_id: str,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna o histórico de verificações de um monitor."""
    result = await db.execute(select(RpkiMonitor).where(RpkiMonitor.id == UUID(monitor_id)))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado")

    checks_result = await db.execute(
        select(RpkiCheck)
        .where(RpkiCheck.monitor_id == UUID(monitor_id))
        .order_by(desc(RpkiCheck.checked_at))
        .limit(limit)
    )
    checks = checks_result.scalars().all()
    return {
        "monitor": _monitor_to_dict(monitor),
        "history": [_check_to_dict(c) for c in checks],
    }


@router.post("/check-all")
async def check_all_monitors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verifica todos os monitores ativos imediatamente."""
    result = await db.execute(
        select(RpkiMonitor).where(RpkiMonitor.active == True)
    )
    monitors = result.scalars().all()

    if not monitors:
        return {"message": "Nenhum monitor ativo encontrado", "checked": 0}

    results = []
    for monitor in monitors:
        try:
            check = await _check_monitor(monitor, db, trigger_type="manual", triggered_by=current_user.id)
            results.append({
                "monitor_id": str(monitor.id),
                "name": monitor.name,
                "prefix": monitor.prefix,
                "status": check.status,
            })
        except Exception as e:
            results.append({
                "monitor_id": str(monitor.id),
                "name": monitor.name,
                "prefix": monitor.prefix,
                "status": "error",
                "error": str(e),
            })

    return {
        "message": f"{len(monitors)} monitor(es) verificado(s)",
        "checked": len(monitors),
        "results": results,
    }

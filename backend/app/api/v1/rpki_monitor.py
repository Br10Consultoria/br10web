"""
BR10 NetManager - API de Monitoramento RPKI

Endpoints:
  GET    /rpki-monitor/monitors                    — listar monitores
  POST   /rpki-monitor/monitors                    — criar monitor
  GET    /rpki-monitor/monitors/{id}               — detalhe de um monitor
  PUT    /rpki-monitor/monitors/{id}               — atualizar monitor
  DELETE /rpki-monitor/monitors/{id}               — remover monitor
  POST   /rpki-monitor/monitors/{id}/check         — verificar agora (manual, hierárquico)
  GET    /rpki-monitor/monitors/{id}/history       — histórico de verificações
  GET    /rpki-monitor/monitors/{id}/ipv6-prefixes — prefixos IPv6 descobertos no ASN
  GET    /rpki-monitor/summary                     — resumo para o dashboard
  POST   /rpki-monitor/check-all                   — verificar todos agora (admin)
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
from app.models.audit import AuditAction
from app.core.audit_helper import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rpki-monitor", tags=["RPKI Monitor"])

TIMEOUT = httpx.Timeout(20.0)


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


# ─── Helpers de serialização (lê campos antes de qualquer commit) ─────────────

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
        # Campos extras da validação hierárquica (presentes apenas em checks manuais)
        "hierarchical": c.roas[0].get("_hierarchical") if (c.roas and isinstance(c.roas[0], dict) and "_hierarchical" in c.roas[0]) else None,
    }


# ─── Validação RPKI de um único prefixo ───────────────────────────────────────

async def _do_rpki_check(prefix: str, asn: Optional[int] = None) -> Dict[str, Any]:
    """
    Executa a validação RPKI de um prefixo via RIPE Stat + Cloudflare.
    Retorna dict com: prefix, ip_version, rpki_status, roas, origin_asns,
    country, rir, sources_checked, errors.
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


# ─── Validação hierárquica de prefixos ────────────────────────────────────────

def _generate_sub_prefixes(parent_prefix: str, target_prefixlen: int) -> List[str]:
    """
    Gera sub-blocos de comprimento target_prefixlen contidos em parent_prefix.
    Limita a 32 sub-blocos para evitar explosão combinatória e sobrecarga na API RIPE.
    """
    try:
        net = ipaddress.ip_network(parent_prefix, strict=False)
        if target_prefixlen <= net.prefixlen:
            return []
        # Calcular quantos sub-blocos seriam gerados
        diff = target_prefixlen - net.prefixlen
        total = 2 ** diff
        if total > 32:
            # Muitos sub-blocos: retornar vazio para evitar sobrecarga
            # (ex: /40 → /48 geraria 256 sub-blocos)
            logger.warning(
                f"[RPKI] Ignorando expansão {parent_prefix} → /{target_prefixlen}: "
                f"{total} sub-blocos excede limite de 32"
            )
            return []
        subnets = list(net.subnets(new_prefix=target_prefixlen))
        return [str(s) for s in subnets[:32]]
    except Exception:
        return []


async def _do_hierarchical_check(prefix: str, asn: Optional[int] = None) -> Dict[str, Any]:
    """
    Executa validação RPKI hierárquica:
      1. Bloco completo (ex: /20 ou /22)
      2. Sub-blocos /23 contidos no bloco
      3. Sub-blocos /24 contidos no bloco
    Retorna resultado consolidado com breakdown por nível.
    """
    network = ipaddress.ip_network(prefix, strict=False)
    prefixlen = network.prefixlen
    is_ipv6 = network.version == 6

    # Determinar os níveis a verificar baseado no prefixlen
    # IPv4: bloco principal → /23 (se < /23) → /24 (se < /24)
    # IPv6: bloco principal → /33 (se < /33) → /40 (se < /40)
    # NOTA: Não expandimos para /48 em IPv6 pois um /40 já gera 256 sub-blocos /48,
    # o que causaria centenas de requisições desnecessárias ao RIPE Stat.
    # O limite de 32 sub-blocos em _generate_sub_prefixes também protege contra isso.
    if is_ipv6:
        sub_levels = []
        if prefixlen < 33:
            sub_levels.append(33)  # ex: /32 → verifica /33 (2 sub-blocos)
        if prefixlen < 40:
            sub_levels.append(40)  # ex: /32 → verifica /40 (256 sub-blocos, bloqueado pelo limite)
                                   # ex: /33 → verifica /40 (128 sub-blocos, bloqueado pelo limite)
                                   # ex: /35 → verifica /40 (32 sub-blocos, permitido)
    else:
        sub_levels = []
        if prefixlen < 23:
            sub_levels.append(23)
        if prefixlen < 24:
            sub_levels.append(24)

    # Verificar o bloco principal
    main_result = await _do_rpki_check(prefix, asn)

    # Descobrir ASN de origem (para reutilizar nas sub-verificações)
    effective_asn = asn or (main_result.get("origin_asns") or [None])[0]

    # Verificar sub-blocos em paralelo (máx 32 por nível para não sobrecarregar)
    levels_results: Dict[str, Any] = {}
    for target_len in sub_levels:
        sub_prefixes = _generate_sub_prefixes(prefix, target_len)
        if not sub_prefixes:
            continue

        # Verificar em paralelo com semáforo para limitar concorrência
        sem = asyncio.Semaphore(8)

        async def _check_one(pfx: str) -> Dict:
            async with sem:
                try:
                    r = await _do_rpki_check(pfx, effective_asn)
                    return {"prefix": pfx, "status": r["rpki_status"], "roas": r["roas"]}
                except Exception as e:
                    return {"prefix": pfx, "status": "error", "error": str(e)}

        sub_results = await asyncio.gather(*[_check_one(p) for p in sub_prefixes])

        # Consolidar status do nível
        statuses = [r["status"] for r in sub_results]
        if "invalid" in statuses:
            level_status = "invalid"
        elif "valid" in statuses:
            level_status = "valid"
        elif "not-found" in statuses:
            level_status = "not-found"
        else:
            level_status = "unknown"

        levels_results[f"/{target_len}"] = {
            "status": level_status,
            "total": len(sub_results),
            "valid": statuses.count("valid"),
            "invalid": statuses.count("invalid"),
            "not_found": statuses.count("not-found"),
            "unknown": statuses.count("unknown"),
            "error": statuses.count("error"),
            "prefixes": sub_results,
        }

    # Status consolidado geral
    all_statuses = [main_result["rpki_status"]] + [v["status"] for v in levels_results.values()]
    if "invalid" in all_statuses:
        consolidated_status = "invalid"
    elif "valid" in all_statuses:
        consolidated_status = "valid"
    elif "not-found" in all_statuses:
        consolidated_status = "not-found"
    else:
        consolidated_status = "unknown"

    return {
        "prefix": str(network),
        "asn": effective_asn,
        "consolidated_status": consolidated_status,
        "main_block": {
            "prefix": main_result["prefix"],
            "status": main_result["rpki_status"],
            "roas": main_result["roas"],
            "origin_asns": main_result["origin_asns"],
            "country": main_result["country"],
            "rir": main_result["rir"],
            "sources_checked": main_result["sources_checked"],
            "errors": main_result["errors"],
        },
        "sub_levels": levels_results,
    }


# ─── Descoberta de prefixos IPv6 do ASN ───────────────────────────────────────

async def _discover_ipv6_prefixes(asn: int) -> Dict[str, Any]:
    """
    Descobre prefixos IPv6 anunciados por um ASN via RIPE Stat announced-prefixes.
    Retorna lista de prefixos IPv6 com status RPKI.
    """
    discovered: List[Dict] = []
    errors: List[str] = []

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            url = f"https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS{asn}"
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                prefixes_raw = data.get("prefixes", [])
                for entry in prefixes_raw:
                    pfx = entry.get("prefix", "")
                    if not pfx:
                        continue
                    try:
                        net = ipaddress.ip_network(pfx, strict=False)
                        if net.version == 6:
                            discovered.append({
                                "prefix": str(net),
                                "prefixlen": net.prefixlen,
                                "timelines": entry.get("timelines", []),
                            })
                    except Exception:
                        continue
            else:
                errors.append(f"RIPE announced-prefixes: HTTP {resp.status_code}")
        except Exception as e:
            errors.append(f"RIPE announced-prefixes: {str(e)}")

    # Ordenar por prefixlen (blocos maiores primeiro)
    discovered.sort(key=lambda x: x["prefixlen"])

    return {
        "asn": asn,
        "ipv6_prefixes": discovered,
        "total": len(discovered),
        "errors": errors,
    }


# ─── _check_monitor: salva resultado no banco ─────────────────────────────────

async def _check_monitor(
    monitor: RpkiMonitor,
    db: AsyncSession,
    trigger_type: str = "scheduled",
    triggered_by=None,
    hierarchical: bool = False,
) -> RpkiCheck:
    """
    Executa verificação RPKI de um monitor e salva o resultado.
    Se hierarchical=True, executa validação hierárquica completa.
    Retorna o objeto RpkiCheck persistido.
    IMPORTANTE: captura todos os campos do monitor ANTES de qualquer commit
    para evitar MissingGreenlet por lazy-load após expiração.
    """
    # Capturar campos do monitor antes de qualquer commit
    monitor_id = monitor.id
    monitor_prefix = monitor.prefix
    monitor_asn = monitor.asn
    monitor_prev_status = monitor.last_status  # salvar antes de sobrescrever para alerta de mudança
    monitor_name = getattr(monitor, 'name', monitor_prefix)
    monitor_alert_on_invalid = getattr(monitor, 'alert_on_invalid', True)

    start = time.time()
    error_msg = None
    result = {}
    hierarchical_data = None

    try:
        if hierarchical:
            hierarchical_data = await _do_hierarchical_check(monitor_prefix, monitor_asn)
            status = hierarchical_data["consolidated_status"]
            # Usar dados do bloco principal para os campos padrão
            main = hierarchical_data["main_block"]
            result = {
                "rpki_status": status,
                "roas": main["roas"],
                "origin_asns": main["origin_asns"],
                "country": main["country"],
                "rir": main["rir"],
                "sources_checked": main["sources_checked"],
                "errors": main["errors"],
            }
        else:
            result = await _do_rpki_check(monitor_prefix, monitor_asn)
            status = result.get("rpki_status", "unknown")
    except Exception as e:
        status = "error"
        error_msg = str(e)
        logger.error(f"[RPKI Monitor] Erro ao verificar {monitor_prefix}: {e}")

    duration_ms = int((time.time() - start) * 1000)

    # Preparar ROAs para salvar (incluir dados hierárquicos se disponíveis)
    roas_to_save = result.get("roas", [])
    if hierarchical_data:
        # Adicionar marcador com dados hierárquicos no primeiro elemento
        roas_to_save = [{"_hierarchical": hierarchical_data}] + roas_to_save

    # Salvar verificação no histórico
    check = RpkiCheck(
        monitor_id=monitor_id,
        status=status,
        prefix_checked=monitor_prefix,
        asn_used=result.get("origin_asns", [monitor_asn])[0] if result.get("origin_asns") else monitor_asn,
        roas=roas_to_save,
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

    # Auto-salvar ASN descoberto nos ROAs se o monitor não tinha ASN
    discovered_asn = None
    if not monitor_asn:
        origin_asns = result.get("origin_asns", [])
        if origin_asns:
            discovered_asn = origin_asns[0]
            monitor.asn = discovered_asn
            logger.info(f"[RPKI Monitor] ASN {discovered_asn} descoberto automaticamente para {monitor_prefix}")

    # Atualizar o monitor com o último status
    monitor.last_status = status
    monitor.last_checked_at = datetime.now(timezone.utc)
    monitor.last_roas = result.get("roas", [])
    monitor.last_origin_asns = result.get("origin_asns", [])
    monitor.last_country = result.get("country")
    monitor.last_rir = result.get("rir")
    monitor.last_error = error_msg

    await db.commit()

    # Capturar campos do check ANTES do refresh para evitar MissingGreenlet
    check_id = check.id
    check_status = check.status
    check_prefix = check.prefix_checked
    check_asn = check.asn_used
    check_roas = check.roas
    check_origin_asns = check.origin_asns
    check_country = check.country
    check_rir = check.rir
    check_sources = check.sources_checked
    check_error = check.error_message
    check_trigger = check.trigger_type
    check_triggered_by = check.triggered_by
    check_duration = check.duration_ms
    check_checked_at = check.checked_at

    # Capturar campos do monitor atualizados
    monitor_last_status = monitor.last_status
    monitor_last_checked_at = monitor.last_checked_at
    monitor_last_roas = monitor.last_roas
    monitor_last_origin_asns = monitor.last_origin_asns
    monitor_last_country = monitor.last_country
    monitor_last_rir = monitor.last_rir
    monitor_last_error = monitor.last_error

    try:
        await db.refresh(check)
        await db.refresh(monitor)
    except Exception:
        pass

    # ── Alertas Telegram RPKI (após commit, sem bloquear o retorno) ────────────
    try:
        from app.services.telegram_notify import notify_rpki_invalid, notify_rpki_status_change
        if status == "invalid" and monitor_alert_on_invalid:
            await notify_rpki_invalid(
                db=db,
                prefix=monitor_prefix,
                asn=monitor_asn,
                monitor_name=monitor_name,
                previous_status=monitor_prev_status,
            )
        elif (monitor_prev_status and monitor_prev_status != status
              and monitor_prev_status not in (None, "never", "unknown")):
            await notify_rpki_status_change(
                db=db,
                prefix=monitor_prefix,
                old_status=monitor_prev_status,
                new_status=status,
                asn=monitor_asn,
                monitor_name=monitor_name,
            )
    except Exception as _tg_err:
        logger.warning(f"[RPKI] Falha ao enviar alerta Telegram: {_tg_err}")

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

    # Capturar dict antes de qualquer operação adicional
    monitor_dict = _monitor_to_dict(monitor)

    # Auditoria
    await log_audit(
        db,
        action=AuditAction.RPKI_MONITOR_CREATED,
        user_id=current_user.id,
        resource_type="rpki_monitor",
        resource_id=str(monitor.id),
        description=f"Monitor RPKI criado: {monitor.name} ({monitor.prefix})",
        status="success",
    )

    return monitor_dict


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

    # Capturar dict antes de qualquer operação adicional
    monitor_dict = _monitor_to_dict(monitor)

    # Auditoria
    await log_audit(
        db,
        action=AuditAction.RPKI_MONITOR_UPDATED,
        user_id=current_user.id,
        resource_type="rpki_monitor",
        resource_id=str(monitor.id),
        description=f"Monitor RPKI atualizado: {monitor.name} ({monitor.prefix})",
        status="success",
    )

    return monitor_dict


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
    monitor_name = monitor.name
    monitor_prefix = monitor.prefix
    monitor_id_str = str(monitor.id)
    await db.delete(monitor)
    await db.commit()

    # Auditoria
    await log_audit(
        db,
        action=AuditAction.RPKI_MONITOR_DELETED,
        user_id=current_user.id,
        resource_type="rpki_monitor",
        resource_id=monitor_id_str,
        description=f"Monitor RPKI removido: {monitor_name} ({monitor_prefix})",
        status="success",
    )

    return {"message": f"Monitor '{monitor_name}' removido com sucesso"}


@router.post("/monitors/{monitor_id}/check")
async def check_monitor_now(
    monitor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Executa verificação RPKI hierárquica imediata de um monitor.

    A validação ocorre em 3 níveis:
      1. Bloco completo cadastrado (ex: /20 ou /22)
      2. Sub-blocos /23 contidos no bloco (IPv4) ou /33 (IPv6)
      3. Sub-blocos /24 contidos no bloco (IPv4) ou /40 (IPv6)

    O status consolidado é o pior status encontrado em qualquer nível.
    """
    result = await db.execute(select(RpkiMonitor).where(RpkiMonitor.id == UUID(monitor_id)))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado")

    # Capturar dados do monitor antes do check (evita MissingGreenlet)
    monitor_name = monitor.name
    monitor_prefix = monitor.prefix
    monitor_id_str = str(monitor.id)

    check = await _check_monitor(
        monitor, db,
        trigger_type="manual",
        triggered_by=current_user.id,
        hierarchical=True,
    )

    # Capturar dict do check antes da auditoria
    check_dict = _check_to_dict(check)

    # Auditoria
    status_label = check_dict.get("status") or "unknown"
    await log_audit(
        db,
        action=AuditAction.RPKI_MONITOR_CHECKED,
        user_id=current_user.id,
        resource_type="rpki_monitor",
        resource_id=monitor_id_str,
        description=f"Verificação RPKI hierárquica: {monitor_name} ({monitor_prefix}) → {status_label}",
        status="success" if status_label not in ("error",) else "failure",
    )

    # Reconstruir monitor_dict com dados frescos (evita MissingGreenlet na serialização)
    try:
        fresh = await db.execute(select(RpkiMonitor).where(RpkiMonitor.id == UUID(monitor_id_str)))
        fresh_monitor = fresh.scalar_one_or_none()
        monitor_dict = _monitor_to_dict(fresh_monitor) if fresh_monitor else {"id": monitor_id_str}
    except Exception:
        monitor_dict = {"id": monitor_id_str, "prefix": monitor_prefix}

    # Verificar prefixos IPv6 automaticamente se o monitor tem ASN
    ipv6_results = None
    effective_asn = monitor_dict.get("asn")
    if effective_asn:
        try:
            ipv6_data = await _discover_ipv6_prefixes(effective_asn)
            ipv6_prefixes = ipv6_data.get("ipv6_prefixes", [])
            if ipv6_prefixes:
                # Verificar RPKI dos prefixos IPv6 principais (até 5 blocos maiores)
                top_prefixes = ipv6_prefixes[:5]
                ipv6_checks = []
                for pfx_entry in top_prefixes:
                    try:
                        r = await _do_rpki_check(pfx_entry["prefix"], effective_asn)
                        ipv6_checks.append({
                            "prefix": pfx_entry["prefix"],
                            "status": r["rpki_status"],
                            "roas": r["roas"],
                        })
                    except Exception:
                        ipv6_checks.append({"prefix": pfx_entry["prefix"], "status": "error", "roas": []})
                ipv6_results = {
                    "asn": effective_asn,
                    "total_announced": len(ipv6_prefixes),
                    "checked": ipv6_checks,
                }
        except Exception as e:
            logger.warning(f"[RPKI] IPv6 auto-check falhou para AS{effective_asn}: {e}")

    return {
        "monitor": monitor_dict,
        "check": check_dict,
        "ipv6": ipv6_results,
    }


@router.get("/monitors/{monitor_id}/ipv6-prefixes")
async def get_ipv6_prefixes(
    monitor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Descobre e lista os prefixos IPv6 anunciados pelo ASN do monitor via RIPE Stat.
    Útil para identificar blocos IPv6 disponíveis para validação RPKI manual.

    Retorna prefixos ordenados por tamanho (blocos maiores primeiro).
    Inclui /32, /33, /40 e demais comprimentos anunciados.
    """
    result = await db.execute(select(RpkiMonitor).where(RpkiMonitor.id == UUID(monitor_id)))
    monitor = result.scalar_one_or_none()
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor não encontrado")

    if not monitor.asn:
        raise HTTPException(
            status_code=400,
            detail="Este monitor não tem ASN configurado. Configure o ASN para descobrir prefixos IPv6."
        )

    asn = monitor.asn
    ipv6_data = await _discover_ipv6_prefixes(asn)

    return {
        "monitor_id": monitor_id,
        "monitor_name": monitor.name,
        "asn": asn,
        "ipv6_prefixes": ipv6_data["ipv6_prefixes"],
        "total": ipv6_data["total"],
        "errors": ipv6_data["errors"],
        "note": "Use estes prefixos para criar monitores RPKI IPv6 ou validar manualmente.",
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

    monitor_dict = _monitor_to_dict(monitor)

    checks_result = await db.execute(
        select(RpkiCheck)
        .where(RpkiCheck.monitor_id == UUID(monitor_id))
        .order_by(desc(RpkiCheck.checked_at))
        .limit(limit)
    )
    checks = checks_result.scalars().all()
    return {
        "monitor": monitor_dict,
        "history": [_check_to_dict(c) for c in checks],
    }


@router.post("/check-all")
async def check_all_monitors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verifica todos os monitores ativos imediatamente (verificação simples, sem hierarquia)."""
    result = await db.execute(
        select(RpkiMonitor).where(RpkiMonitor.active == True)
    )
    monitors = result.scalars().all()

    if not monitors:
        return {"message": "Nenhum monitor ativo encontrado", "checked": 0}

    results = []
    for monitor in monitors:
        try:
            check = await _check_monitor(
                monitor, db,
                trigger_type="manual",
                triggered_by=current_user.id,
                hierarchical=False,
            )
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

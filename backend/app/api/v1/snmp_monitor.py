"""
API REST para Monitoramento SNMP e Gestão NETCONF/SSH de roteadores Huawei.

Endpoints:
  GET    /snmp/targets              - listar targets
  POST   /snmp/targets              - criar target
  GET    /snmp/targets/{id}         - detalhe do target
  PUT    /snmp/targets/{id}         - atualizar target
  DELETE /snmp/targets/{id}         - remover target
  POST   /snmp/targets/{id}/poll    - forçar poll imediato
  GET    /snmp/targets/{id}/metrics - histórico de métricas
  GET    /snmp/targets/{id}/interfaces - interfaces atuais
  GET    /snmp/targets/{id}/bgp     - sessões BGP atuais
  GET    /snmp/targets/{id}/alerts  - alertas do target
  POST   /snmp/targets/{id}/alerts/{alert_id}/ack - reconhecer alerta
  GET    /snmp/summary              - resumo geral
  POST   /snmp/targets/{id}/action  - executar ação de gestão (NETCONF/SSH)
  GET    /snmp/targets/{id}/action-log - histórico de ações
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, desc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import encrypt_field, decrypt_field
from app.models.snmp_monitor import SnmpTarget, SnmpMetric, SnmpAlert, NetconfActionLog
from app.models.device import DeviceCredential
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.services import snmp_service, netconf_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/snmp", tags=["SNMP Monitor"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class SnmpTargetCreate(BaseModel):
    name:                str = Field(..., min_length=1, max_length=150)
    host:                str = Field(..., min_length=1, max_length=255)
    port:                int = Field(default=161, ge=1, le=65535)
    snmp_version:        str = Field(default="v2c")
    community:           str = Field(default="public", description="Community string (será criptografada)")
    poll_interval:       int = Field(default=300, ge=60, le=3600)
    active:              bool = True
    collect_interfaces:  bool = True
    collect_bgp:         bool = True
    collect_cpu:         bool = True
    collect_memory:      bool = True
    cpu_threshold:       Optional[float] = Field(default=None, ge=0, le=100)
    memory_threshold:    Optional[float] = Field(default=None, ge=0, le=100)
    device_id:           Optional[str] = None


class SnmpTargetUpdate(BaseModel):
    name:               Optional[str] = None
    host:               Optional[str] = None
    port:               Optional[int] = None
    community:          Optional[str] = None
    poll_interval:      Optional[int] = None
    active:             Optional[bool] = None
    collect_interfaces: Optional[bool] = None
    collect_bgp:        Optional[bool] = None
    collect_cpu:        Optional[bool] = None
    collect_memory:     Optional[bool] = None
    cpu_threshold:      Optional[float] = None
    memory_threshold:   Optional[float] = None


class NetconfAction(BaseModel):
    action_type:  str = Field(..., description="if_enable|if_disable|bgp_enable|bgp_disable|bgp_create|bgp_remove")
    object_id:    str = Field(..., description="Nome da interface ou IP do peer BGP")
    object_name:  Optional[str] = None
    # Para ações BGP
    local_asn:    Optional[int] = None
    remote_asn:   Optional[int] = None
    description:  Optional[str] = None
    # Credenciais SSH (se não cadastradas no dispositivo)
    ssh_username: Optional[str] = None
    ssh_password: Optional[str] = None
    ssh_port:     int = 22


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _target_to_dict(t: SnmpTarget, include_community: bool = False) -> dict:
    return {
        "id":                str(t.id),
        "name":              t.name,
        "host":              t.host,
        "port":              t.port,
        "snmp_version":      t.snmp_version,
        "poll_interval":     t.poll_interval,
        "active":            t.active,
        "collect_interfaces": t.collect_interfaces,
        "collect_bgp":       t.collect_bgp,
        "collect_cpu":       t.collect_cpu,
        "collect_memory":    t.collect_memory,
        "cpu_threshold":     t.cpu_threshold,
        "memory_threshold":  t.memory_threshold,
        "last_polled_at":    t.last_polled_at,
        "last_status":       t.last_status,
        "last_error":        t.last_error,
        "sys_name":          t.sys_name,
        "sys_descr":         t.sys_descr,
        "sys_contact":       t.sys_contact,
        "sys_location":      t.sys_location,
        "device_id":         str(t.device_id) if t.device_id else None,
        "created_at":        t.created_at.isoformat() if t.created_at else None,
    }


async def _get_target_or_404(target_id: str, db: AsyncSession) -> SnmpTarget:
    result = await db.execute(select(SnmpTarget).where(SnmpTarget.id == UUID(target_id)))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Target SNMP não encontrado")
    return target


async def _get_ssh_credentials(target: SnmpTarget, action: NetconfAction, db: AsyncSession) -> tuple[str, str]:
    """Obtém credenciais SSH: da ação, ou do dispositivo cadastrado."""
    if action.ssh_username and action.ssh_password:
        return action.ssh_username, action.ssh_password

    if target.device_id:
        result = await db.execute(
            select(DeviceCredential).where(
                and_(
                    DeviceCredential.device_id == target.device_id,
                    DeviceCredential.credential_type == "ssh",
                    DeviceCredential.is_active == True,
                )
            )
        )
        cred = result.scalar_one_or_none()
        if cred and cred.username and cred.password_encrypted:
            return cred.username, decrypt_field(cred.password_encrypted)

    raise HTTPException(
        status_code=400,
        detail="Credenciais SSH não encontradas. Informe ssh_username e ssh_password ou cadastre credenciais SSH no dispositivo."
    )


# ─── Endpoints: Targets ───────────────────────────────────────────────────────

@router.get("/targets")
async def list_targets(
    device_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(SnmpTarget).order_by(SnmpTarget.name)
    if device_id:
        query = query.where(SnmpTarget.device_id == UUID(device_id))
    result = await db.execute(query)
    targets = result.scalars().all()
    return [_target_to_dict(t) for t in targets]


@router.post("/targets", status_code=status.HTTP_201_CREATED)
async def create_target(
    data: SnmpTargetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verifica duplicata
    existing = await db.execute(
        select(SnmpTarget).where(
            and_(SnmpTarget.host == data.host, SnmpTarget.port == data.port)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Já existe um target para {data.host}:{data.port}")

    target = SnmpTarget(
        name=data.name,
        host=data.host,
        port=data.port,
        snmp_version=data.snmp_version,
        community_encrypted=encrypt_field(data.community),
        poll_interval=data.poll_interval,
        active=data.active,
        collect_interfaces=data.collect_interfaces,
        collect_bgp=data.collect_bgp,
        collect_cpu=data.collect_cpu,
        collect_memory=data.collect_memory,
        cpu_threshold=data.cpu_threshold,
        memory_threshold=data.memory_threshold,
        device_id=UUID(data.device_id) if data.device_id else None,
    )
    db.add(target)
    await db.commit()
    await db.refresh(target)
    logger.info(f"SNMP target criado: {target.name} ({target.host})")
    return _target_to_dict(target)


@router.get("/targets/{target_id}")
async def get_target(
    target_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = await _get_target_or_404(target_id, db)
    return _target_to_dict(target)


@router.put("/targets/{target_id}")
async def update_target(
    target_id: str,
    data: SnmpTargetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = await _get_target_or_404(target_id, db)
    update_data = data.model_dump(exclude_unset=True)
    if "community" in update_data:
        target.community_encrypted = encrypt_field(update_data.pop("community"))
    for key, value in update_data.items():
        setattr(target, key, value)
    target.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(target)
    return _target_to_dict(target)


@router.delete("/targets/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_target(
    target_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = await _get_target_or_404(target_id, db)
    await db.delete(target)
    await db.commit()


# ─── Endpoints: Poll ──────────────────────────────────────────────────────────

@router.post("/targets/{target_id}/poll")
async def poll_now(
    target_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Força um poll SNMP imediato e salva as métricas."""
    target = await _get_target_or_404(target_id, db)
    if not target.active:
        raise HTTPException(status_code=400, detail="Target está inativo")

    community = decrypt_field(target.community_encrypted) if target.community_encrypted else "public"

    poll_result = await snmp_service.poll_target(
        host=target.host,
        community=community,
        port=target.port,
        collect_interfaces_flag=target.collect_interfaces,
        collect_bgp_flag=target.collect_bgp,
        collect_cpu_flag=target.collect_cpu,
        collect_memory_flag=target.collect_memory,
    )

    # Atualiza metadados do target
    target.last_polled_at = poll_result["polled_at"]
    target.last_status = "ok" if poll_result["success"] else "error"
    target.last_error = poll_result.get("error")

    if poll_result["success"] and poll_result.get("system"):
        sys_info = poll_result["system"]
        if sys_info.get("sys_name"):
            target.sys_name = sys_info["sys_name"]
        if sys_info.get("sys_descr"):
            target.sys_descr = sys_info["sys_descr"]
        if sys_info.get("sys_contact"):
            target.sys_contact = sys_info["sys_contact"]
        if sys_info.get("sys_location"):
            target.sys_location = sys_info["sys_location"]

    # Salva métricas no banco
    metrics_to_add = []

    if poll_result.get("cpu") is not None:
        metrics_to_add.append(SnmpMetric(
            target_id=target.id,
            metric_type="cpu_usage",
            value_float=poll_result["cpu"],
        ))

    mem = poll_result.get("memory", {})
    if mem.get("usage_pct") is not None:
        metrics_to_add.append(SnmpMetric(
            target_id=target.id,
            metric_type="memory_usage",
            value_float=mem["usage_pct"],
        ))
    if mem.get("used_mb") is not None:
        metrics_to_add.append(SnmpMetric(
            target_id=target.id,
            metric_type="memory_used_mb",
            value_float=mem["used_mb"],
        ))
    if mem.get("total_mb") is not None:
        metrics_to_add.append(SnmpMetric(
            target_id=target.id,
            metric_type="memory_total_mb",
            value_float=mem["total_mb"],
        ))

    sys_info = poll_result.get("system", {})
    if sys_info.get("uptime_seconds") is not None:
        metrics_to_add.append(SnmpMetric(
            target_id=target.id,
            metric_type="uptime_seconds",
            value_int=sys_info["uptime_seconds"],
        ))

    for iface in poll_result.get("interfaces", []):
        metrics_to_add.append(SnmpMetric(
            target_id=target.id,
            metric_type="if_oper_status",
            object_id=iface["index"],
            object_name=iface["name"],
            value_int=iface["oper_status"],
        ))
        if iface["in_octets"] > 0:
            metrics_to_add.append(SnmpMetric(
                target_id=target.id,
                metric_type="if_in_bps",
                object_id=iface["index"],
                object_name=iface["name"],
                value_int=iface["in_octets"],
            ))
        if iface["out_octets"] > 0:
            metrics_to_add.append(SnmpMetric(
                target_id=target.id,
                metric_type="if_out_bps",
                object_id=iface["index"],
                object_name=iface["name"],
                value_int=iface["out_octets"],
            ))

    for peer in poll_result.get("bgp", []):
        metrics_to_add.append(SnmpMetric(
            target_id=target.id,
            metric_type="bgp_peer_state",
            object_id=peer["peer_ip"],
            object_name=f"AS{peer['remote_as']}",
            value_int=peer["state"],
            value_str=peer["state_name"],
        ))

    # Verifica thresholds e gera alertas
    if poll_result.get("cpu") is not None and target.cpu_threshold:
        if poll_result["cpu"] >= target.cpu_threshold:
            alert = SnmpAlert(
                target_id=target.id,
                severity="critical" if poll_result["cpu"] >= 90 else "warning",
                metric_type="cpu_usage",
                message=f"CPU em {poll_result['cpu']:.1f}% (threshold: {target.cpu_threshold}%)",
                value=poll_result["cpu"],
                threshold=target.cpu_threshold,
            )
            db.add(alert)

    if mem.get("usage_pct") is not None and target.memory_threshold:
        if mem["usage_pct"] >= target.memory_threshold:
            alert = SnmpAlert(
                target_id=target.id,
                severity="critical" if mem["usage_pct"] >= 90 else "warning",
                metric_type="memory_usage",
                message=f"Memória em {mem['usage_pct']:.1f}% (threshold: {target.memory_threshold}%)",
                value=mem["usage_pct"],
                threshold=target.memory_threshold,
            )
            db.add(alert)

    for metric in metrics_to_add:
        db.add(metric)

    await db.commit()
    await db.refresh(target)

    return {
        "target": _target_to_dict(target),
        "poll_result": poll_result,
        "metrics_saved": len(metrics_to_add),
    }


# ─── Endpoints: Métricas ──────────────────────────────────────────────────────

@router.get("/targets/{target_id}/metrics")
async def get_metrics(
    target_id: str,
    metric_type: Optional[str] = Query(None),
    object_id: Optional[str] = Query(None),
    hours: int = Query(default=24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna histórico de métricas das últimas N horas."""
    target = await _get_target_or_404(target_id, db)
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    filters = [
        SnmpMetric.target_id == target.id,
        SnmpMetric.created_at >= since,
    ]
    if metric_type:
        filters.append(SnmpMetric.metric_type == metric_type)
    if object_id:
        filters.append(SnmpMetric.object_id == object_id)

    result = await db.execute(
        select(SnmpMetric)
        .where(and_(*filters))
        .order_by(SnmpMetric.created_at.asc())
        .limit(5000)
    )
    metrics = result.scalars().all()

    return [
        {
            "id":          str(m.id),
            "metric_type": m.metric_type,
            "object_id":   m.object_id,
            "object_name": m.object_name,
            "value_float": m.value_float,
            "value_int":   m.value_int,
            "value_str":   m.value_str,
            "timestamp":   m.created_at.isoformat() if m.created_at else None,
        }
        for m in metrics
    ]


@router.get("/targets/{target_id}/interfaces")
async def get_interfaces(
    target_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna o último status de cada interface com tráfego e erros (último poll)."""
    target = await _get_target_or_404(target_id, db)

    # Pega o último valor de status por interface
    result = await db.execute(
        select(SnmpMetric)
        .where(
            and_(
                SnmpMetric.target_id == target.id,
                SnmpMetric.metric_type == "if_oper_status",
            )
        )
        .order_by(SnmpMetric.object_id, SnmpMetric.created_at.desc())
    )
    all_metrics = result.scalars().all()

    # Deduplica por object_id (pega o mais recente)
    seen = set()
    iface_map: dict = {}
    for m in all_metrics:
        if m.object_id not in seen:
            seen.add(m.object_id)
            iface_map[m.object_id] = {
                "index":       m.object_id,
                "name":        m.object_name,
                "oper_status": m.value_int,
                "is_up":       m.value_int == 1,
                "last_seen":   m.created_at.isoformat() if m.created_at else None,
                "in_bps":      None,
                "out_bps":     None,
                "in_errors":   None,
                "out_errors":  None,
            }

    # Busca tráfego (in/out bps) mais recente por interface
    for metric_type, field in [
        ("if_in_bps", "in_bps"),
        ("if_out_bps", "out_bps"),
        ("if_in_errors", "in_errors"),
        ("if_out_errors", "out_errors"),
    ]:
        traffic_result = await db.execute(
            select(SnmpMetric)
            .where(
                and_(
                    SnmpMetric.target_id == target.id,
                    SnmpMetric.metric_type == metric_type,
                )
            )
            .order_by(SnmpMetric.object_id, SnmpMetric.created_at.desc())
        )
        traffic_metrics = traffic_result.scalars().all()
        seen_traffic: set = set()
        for m in traffic_metrics:
            if m.object_id and m.object_id not in seen_traffic:
                seen_traffic.add(m.object_id)
                if m.object_id in iface_map:
                    iface_map[m.object_id][field] = m.value_int

    # Busca uptime do target (mais recente)
    uptime_result = await db.execute(
        select(SnmpMetric)
        .where(
            and_(
                SnmpMetric.target_id == target.id,
                SnmpMetric.metric_type == "uptime_seconds",
            )
        )
        .order_by(SnmpMetric.created_at.desc())
        .limit(1)
    )
    uptime_metric = uptime_result.scalar_one_or_none()

    # Busca CPU e memória mais recentes
    cpu_result = await db.execute(
        select(SnmpMetric)
        .where(and_(SnmpMetric.target_id == target.id, SnmpMetric.metric_type == "cpu_usage"))
        .order_by(SnmpMetric.created_at.desc()).limit(1)
    )
    cpu_metric = cpu_result.scalar_one_or_none()

    mem_result = await db.execute(
        select(SnmpMetric)
        .where(and_(SnmpMetric.target_id == target.id, SnmpMetric.metric_type == "memory_usage"))
        .order_by(SnmpMetric.created_at.desc()).limit(1)
    )
    mem_metric = mem_result.scalar_one_or_none()

    return {
        "interfaces": list(iface_map.values()),
        "uptime_seconds": uptime_metric.value_int if uptime_metric else None,
        "cpu_pct": cpu_metric.value_float if cpu_metric else None,
        "mem_pct": mem_metric.value_float if mem_metric else None,
        "sys_name": target.sys_name,
        "sys_descr": target.sys_descr,
        "sys_location": target.sys_location,
        "sys_contact": target.sys_contact,
    }


@router.get("/targets/{target_id}/bgp")
async def get_bgp_sessions(
    target_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna o último estado de cada sessão BGP."""
    target = await _get_target_or_404(target_id, db)

    result = await db.execute(
        select(SnmpMetric)
        .where(
            and_(
                SnmpMetric.target_id == target.id,
                SnmpMetric.metric_type == "bgp_peer_state",
            )
        )
        .order_by(SnmpMetric.object_id, SnmpMetric.created_at.desc())
    )
    all_metrics = result.scalars().all()

    seen = set()
    sessions = []
    for m in all_metrics:
        if m.object_id not in seen:
            seen.add(m.object_id)
            sessions.append({
                "peer_ip":       m.object_id,
                "remote_as_str": m.object_name,
                "state":         m.value_int,
                "state_name":    m.value_str or "unknown",
                "is_established": m.value_int == 6,
                "last_seen":     m.created_at.isoformat() if m.created_at else None,
            })

    return sessions


# ─── Endpoints: Alertas ───────────────────────────────────────────────────────

@router.get("/targets/{target_id}/alerts")
async def get_alerts(
    target_id: str,
    resolved: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = await _get_target_or_404(target_id, db)
    result = await db.execute(
        select(SnmpAlert)
        .where(
            and_(
                SnmpAlert.target_id == target.id,
                SnmpAlert.resolved == resolved,
            )
        )
        .order_by(SnmpAlert.created_at.desc())
        .limit(100)
    )
    alerts = result.scalars().all()
    return [
        {
            "id":           str(a.id),
            "severity":     a.severity,
            "metric_type":  a.metric_type,
            "object_name":  a.object_name,
            "message":      a.message,
            "value":        a.value,
            "threshold":    a.threshold,
            "acknowledged": a.acknowledged,
            "resolved":     a.resolved,
            "created_at":   a.created_at.isoformat() if a.created_at else None,
        }
        for a in alerts
    ]


@router.post("/targets/{target_id}/alerts/{alert_id}/ack")
async def acknowledge_alert(
    target_id: str,
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SnmpAlert).where(SnmpAlert.id == UUID(alert_id))
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta não encontrado")
    alert.acknowledged = True
    alert.resolved = True
    alert.resolved_at = datetime.now(timezone.utc).isoformat()
    await db.commit()
    return {"message": "Alerta reconhecido"}


# ─── Endpoints: Gestão NETCONF/SSH ────────────────────────────────────────────

@router.post("/targets/{target_id}/action")
async def execute_action(
    target_id: str,
    action: NetconfAction,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Executa uma ação de gestão (ativar/desativar interface ou sessão BGP)."""
    target = await _get_target_or_404(target_id, db)
    ssh_user, ssh_pass = await _get_ssh_credentials(target, action, db)

    result = None
    action_type = action.action_type.lower()

    if action_type == "if_enable":
        result = await netconf_service.interface_enable(
            target.host, ssh_user, ssh_pass, action.object_id, action.ssh_port
        )
    elif action_type == "if_disable":
        result = await netconf_service.interface_disable(
            target.host, ssh_user, ssh_pass, action.object_id, action.ssh_port
        )
    elif action_type == "bgp_enable":
        if not action.local_asn:
            raise HTTPException(status_code=400, detail="local_asn é obrigatório para ações BGP")
        result = await netconf_service.bgp_peer_enable(
            target.host, ssh_user, ssh_pass, action.local_asn, action.object_id, action.ssh_port
        )
    elif action_type == "bgp_disable":
        if not action.local_asn:
            raise HTTPException(status_code=400, detail="local_asn é obrigatório para ações BGP")
        result = await netconf_service.bgp_peer_disable(
            target.host, ssh_user, ssh_pass, action.local_asn, action.object_id, action.ssh_port
        )
    elif action_type == "bgp_create":
        if not action.local_asn or not action.remote_asn:
            raise HTTPException(status_code=400, detail="local_asn e remote_asn são obrigatórios para criar peer BGP")
        result = await netconf_service.bgp_peer_create(
            target.host, ssh_user, ssh_pass, action.local_asn, action.object_id,
            action.remote_asn, action.description or "", action.ssh_port
        )
    elif action_type == "bgp_remove":
        if not action.local_asn:
            raise HTTPException(status_code=400, detail="local_asn é obrigatório para remover peer BGP")
        result = await netconf_service.bgp_peer_remove(
            target.host, ssh_user, ssh_pass, action.local_asn, action.object_id, action.ssh_port
        )
    else:
        raise HTTPException(status_code=400, detail=f"Tipo de ação desconhecido: {action_type}")

    # Salva no log de auditoria
    log_entry = NetconfActionLog(
        target_id=target.id,
        user_id=current_user.id,
        action_type=action_type,
        object_id=action.object_id,
        object_name=action.object_name,
        parameters={
            "local_asn":  action.local_asn,
            "remote_asn": action.remote_asn,
            "description": action.description,
        },
        status="success" if result.get("success") else "error",
        output=result.get("output"),
        error=result.get("error"),
        duration_ms=result.get("duration_ms"),
    )
    db.add(log_entry)
    await db.commit()

    if not result.get("success"):
        raise HTTPException(
            status_code=500,
            detail=f"Ação falhou: {result.get('error', 'Erro desconhecido')}"
        )

    return {
        "success":     True,
        "action_type": action_type,
        "object_id":   action.object_id,
        "output":      result.get("output"),
        "duration_ms": result.get("duration_ms"),
    }


@router.get("/targets/{target_id}/action-log")
async def get_action_log(
    target_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = await _get_target_or_404(target_id, db)
    result = await db.execute(
        select(NetconfActionLog)
        .where(NetconfActionLog.target_id == target.id)
        .order_by(NetconfActionLog.created_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()
    return [
        {
            "id":          str(l.id),
            "action_type": l.action_type,
            "object_id":   l.object_id,
            "object_name": l.object_name,
            "status":      l.status,
            "output":      l.output,
            "error":       l.error,
            "duration_ms": l.duration_ms,
            "user_id":     str(l.user_id) if l.user_id else None,
            "created_at":  l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


# ─── Endpoint: Resumo geral ───────────────────────────────────────────────────

@router.get("/summary")
async def get_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total_result = await db.execute(select(func.count()).select_from(SnmpTarget))
    total = total_result.scalar() or 0

    active_result = await db.execute(
        select(func.count()).select_from(SnmpTarget).where(SnmpTarget.active == True)
    )
    active = active_result.scalar() or 0

    ok_result = await db.execute(
        select(func.count()).select_from(SnmpTarget).where(SnmpTarget.last_status == "ok")
    )
    ok_count = ok_result.scalar() or 0

    error_result = await db.execute(
        select(func.count()).select_from(SnmpTarget).where(SnmpTarget.last_status == "error")
    )
    error_count = error_result.scalar() or 0

    never_result = await db.execute(
        select(func.count()).select_from(SnmpTarget).where(SnmpTarget.last_polled_at == None)
    )
    never_polled = never_result.scalar() or 0

    open_alerts_result = await db.execute(
        select(func.count()).select_from(SnmpAlert).where(SnmpAlert.resolved == False)
    )
    open_alerts = open_alerts_result.scalar() or 0

    return {
        "total_targets":  total,
        "active_targets": active,
        "ok":             ok_count,
        "error":          error_count,
        "never_polled":   never_polled,
        "open_alerts":    open_alerts,
    }


# ─── PPPoE Query ──────────────────────────────────────────────────────────────

class PppoeQueryRequest(BaseModel):
    """
    Consulta PPPoE em um roteador Huawei via SSH.
    - interface: nome da subinterface (ex: GigabitEthernet0/1/8.1305)
    - username: login do cliente (opcional — se informado, faz consulta por usuário)
    - slot: slot do roteador (padrão 0)
    """
    interface: Optional[str] = None
    username: Optional[str] = None
    slot: int = 0


@router.post("/targets/{target_id}/pppoe-query")
async def pppoe_query(
    target_id: UUID,
    body: PppoeQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Executa consultas PPPoE em roteador Huawei via SSH interativo.

    Modos de consulta:
    - interface + sem username → total de sessões PPPoE na subinterface (count)
    - interface + sem username (list) → lista todas as sessões PPPoE online na subinterface
    - username → consulta detalhada por login do cliente (verbose)

    Requer que o target SNMP tenha um dispositivo vinculado (device_id) com
    credenciais SSH configuradas.
    """
    from app.models.device import Device
    from app.services.command_runner import CommandRunner
    import asyncio

    # Buscar target SNMP
    result = await db.execute(select(SnmpTarget).where(SnmpTarget.id == target_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Target SNMP não encontrado.")

    if not target.device_id:
        raise HTTPException(
            status_code=400,
            detail="Este target SNMP não tem dispositivo vinculado. "
                   "Edite o target e selecione o dispositivo correspondente."
        )

    # Buscar dispositivo vinculado
    dev_result = await db.execute(select(Device).where(Device.id == target.device_id))
    device = dev_result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Dispositivo vinculado não encontrado.")

    if not device.username:
        raise HTTPException(status_code=400, detail="Dispositivo sem usuário SSH configurado.")

    # Descriptografar credenciais
    try:
        password = decrypt_field(device.password_encrypted) if device.password_encrypted else ""
    except Exception:
        password = ""

    try:
        private_key = decrypt_field(device.ssh_private_key_encrypted) if device.ssh_private_key_encrypted else None
    except Exception:
        private_key = None

    if not password and not private_key:
        raise HTTPException(
            status_code=400,
            detail="Dispositivo sem senha ou chave SSH configurada."
        )

    protocol = device.primary_protocol.value if hasattr(device.primary_protocol, "value") else "ssh"
    port = device.ssh_port if protocol == "ssh" else device.telnet_port

    # Montar comandos conforme o modo de consulta
    if body.username:
        # Consulta por username (verbose)
        commands = [f"display access-user username {body.username.strip()} verbose"]
        query_type = "username"
        query_label = f"Usuário: {body.username.strip()}"
    elif body.interface:
        # Converter nome da interface para formato abreviado usado no filtro Huawei
        # Ex: GigabitEthernet0/1/8.1305 → GE0/1/8.1305
        iface = body.interface.strip()
        iface_short = (
            iface.replace("GigabitEthernet", "GE")
                 .replace("gigabitethernet", "GE")
                 .replace("Ethernet", "Eth")
                 .replace("ethernet", "Eth")
        )
        slot = body.slot
        commands = [
            f"display access-user slot {slot} | include {iface_short} | exclude PPPoE | count",
            f"display access-user slot {slot} | include {iface_short} | exclude PPPoE",
        ]
        query_type = "interface"
        query_label = f"Interface: {iface}"
    else:
        raise HTTPException(
            status_code=400,
            detail="Informe 'interface' ou 'username' para a consulta PPPoE."
        )

    # Executar via SSH interativo (Huawei VRP requer modo interativo)
    runner = CommandRunner(
        host=device.management_ip,
        port=port or 22,
        username=device.username,
        password=password,
        protocol=protocol,
        timeout=30,
        private_key=private_key,
    )

    import re

    def _clean(text: str) -> str:
        ansi = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        text = ansi.sub('', text)
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    import logging as _logging
    _pppoe_logger = _logging.getLogger(__name__)

    _pppoe_logger.info(
        "[PPPoE] Iniciando consulta %s em %s (%s:%s) — %s",
        query_type, device.name, device.management_ip, port, query_label
    )

    results = []
    for cmd in commands:
        try:
            success, output, duration_ms = await runner.run(cmd, interactive=(protocol == "ssh"))
            if not success:
                _pppoe_logger.error(
                    "[PPPoE] Comando falhou em %s (%s) — cmd=%r output=%r",
                    device.management_ip, protocol, cmd, output[:300]
                )
            else:
                _pppoe_logger.info(
                    "[PPPoE] Comando OK em %s — %dms, %d chars de saída",
                    device.management_ip, duration_ms, len(output)
                )
            results.append({
                "command": cmd,
                "output": _clean(output),
                "success": success,
                "duration_ms": duration_ms,
            })
        except Exception as e:
            _pppoe_logger.error(
                "[PPPoE] Exceção ao executar comando em %s — %s",
                device.management_ip, e, exc_info=True
            )
            results.append({
                "command": cmd,
                "output": "",
                "success": False,
                "duration_ms": 0,
                "error": str(e),
            })

    # ── Pós-processamento dos resultados ─────────────────────────────────────
    # Extrair 'Total lines: N' do resultado count
    total_count: Optional[int] = None
    users: list[dict] = []

    for r in results:
        raw = r.get("output", "")
        cmd = r.get("command", "")

        # Resultado do comando count: extrair apenas o número de 'Total lines: N'
        if "| count" in cmd:
            m = re.search(r'Total lines:\s*(\d+)', raw, re.IGNORECASE)
            if m:
                total_count = int(m.group(1))
                r["total_count"] = total_count
                r["output_summary"] = str(total_count)  # saída limpa para o frontend

        # Resultado do comando de listagem: parsear linhas em estrutura de tabela
        # Formato Huawei: ID  username  interface  IP  MAC
        # Ex: "  6   edmarrocha   GE0/1/9.220   100.64.69.225   e04b-a698-0781"
        elif "| count" not in cmd and query_type == "interface":
            parsed_users = []
            for line in raw.splitlines():
                line = line.strip()
                # Ignorar linhas de cabeçalho, info e separadores
                if not line:
                    continue
                if line.startswith("Info:") or line.startswith("----") or line.startswith("User") or line.startswith("Total"):
                    continue
                # Linha de dados: começa com número (ID de sessão)
                parts = line.split()
                if len(parts) >= 4 and parts[0].isdigit():
                    parsed_users.append({
                        "session_id": parts[0],
                        "username":   parts[1] if len(parts) > 1 else "",
                        "interface":  parts[2] if len(parts) > 2 else "",
                        "ip":         parts[3] if len(parts) > 3 else "",
                        "mac":        parts[4] if len(parts) > 4 else "",
                    })
            if parsed_users:
                users = parsed_users
                r["users"] = parsed_users
                r["user_count"] = len(parsed_users)

    return {
        "target_id": str(target_id),
        "target_name": target.name,
        "device_name": device.name,
        "device_ip": device.management_ip,
        "query_type": query_type,
        "query_label": query_label,
        "total_count": total_count,
        "users": users,
        "results": results,
    }

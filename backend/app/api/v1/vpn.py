"""
BR10 NetManager - VPN API
Gerenciamento de VPN L2TP e rotas estáticas.
Inclui auditoria completa: criação, atualização, exclusão, conexão, desconexão e erros.
"""
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import logging

from app.core.database import get_db
from app.core.security import encrypt_field, decrypt_field
from app.models.vpn import VpnConfig, StaticRoute, VpnStatus
from app.models.user import User
from app.models.audit import AuditAction
from app.core.audit_helper import log_audit
from app.api.v1.auth import get_current_user, require_technician
from app.schemas.vpn import (
    VpnConfigCreate, VpnConfigUpdate, VpnConfigResponse,
    StaticRouteCreate, StaticRouteUpdate, StaticRouteResponse
)
from app.services.vpn_l2tp import build_manager_from_vpn

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/devices/{device_id}/vpn", tags=["VPN"])
routes_router = APIRouter(prefix="/devices/{device_id}/routes", tags=["Static Routes"])


# ─── Helper: carregar VPN com rotas ──────────────────────────────────────────
async def _load_vpn(db: AsyncSession, vpn_id: str, device_id: str) -> Optional[VpnConfig]:
    """Carrega VpnConfig com static_routes via selectinload para evitar DetachedInstanceError."""
    result = await db.execute(
        select(VpnConfig)
        .where(VpnConfig.id == vpn_id, VpnConfig.device_id == device_id)
        .options(selectinload(VpnConfig.static_routes))
    )
    return result.scalar_one_or_none()


async def _write_audit(
    db: AsyncSession,
    action: AuditAction,
    description: str,
    audit_status: str = "success",
    user_id=None,
    device_id=None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    error_message: Optional[str] = None,
    extra_data: Optional[dict] = None,
    resource_type: str = "vpn",
    resource_id: Optional[str] = None,
):
    """Wrapper para log_audit centralizado."""
    await log_audit(
        db,
        action=action,
        description=description,
        status=audit_status,
        user_id=user_id,
        device_id=device_id,
        ip_address=ip_address,
        user_agent=user_agent,
        error_message=error_message,
        extra_data=extra_data,
        resource_type=resource_type,
        resource_id=resource_id,
    )


def _get_request_ip(request: Request) -> Optional[str]:
    """Extrai IP do cliente da requisição."""
    try:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else None
    except Exception:
        return None


# ─── VPN Configs ─────────────────────────────────────────────────────────────
@router.get("", response_model=List[VpnConfigResponse])
async def list_vpn_configs(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista todas as configurações VPN de um dispositivo."""
    result = await db.execute(
        select(VpnConfig)
        .where(VpnConfig.device_id == device_id)
        .options(selectinload(VpnConfig.static_routes))
    )
    return result.scalars().all()


@router.post("", response_model=VpnConfigResponse, status_code=201)
async def create_vpn_config(
    device_id: str,
    data: VpnConfigCreate,
    request: Request,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    """Cria nova configuração VPN L2TP para o dispositivo."""
    vpn_data = data.dict(exclude={"password", "preshared_key", "static_routes"})
    vpn = VpnConfig(device_id=device_id, **vpn_data)

    if data.password:
        vpn.password_encrypted = encrypt_field(data.password)
    if data.preshared_key:
        vpn.preshared_key_encrypted = encrypt_field(data.preshared_key)

    db.add(vpn)
    await db.flush()

    # Criar rotas estáticas associadas
    for route_data in (data.static_routes or []):
        route = StaticRoute(
            device_id=device_id,
            vpn_config_id=vpn.id,
            **route_data.dict()
        )
        db.add(route)

    await db.commit()

    # Recarregar com selectinload para evitar DetachedInstanceError na serialização
    vpn = await _load_vpn(db, str(vpn.id), device_id)

    # Auditoria
    await _write_audit(
        db,
        action=AuditAction.VPN_CREATED,
        description=f"VPN '{vpn.name}' criada no dispositivo {device_id} por {current_user.username}",
        user_id=current_user.id,
        device_id=device_id,
        ip_address=_get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
        resource_id=str(vpn.id),
        extra_data={"vpn_name": vpn.name, "server_ip": vpn.server_ip},
    )

    return vpn


@router.get("/{vpn_id}", response_model=VpnConfigResponse)
async def get_vpn_config(
    device_id: str,
    vpn_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vpn = await _load_vpn(db, vpn_id, device_id)
    if not vpn:
        raise HTTPException(status_code=404, detail="Configuração VPN não encontrada")
    return vpn


@router.put("/{vpn_id}", response_model=VpnConfigResponse)
async def update_vpn_config(
    device_id: str,
    vpn_id: str,
    data: VpnConfigUpdate,
    request: Request,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza configuração VPN."""
    result = await db.execute(
        select(VpnConfig).where(VpnConfig.id == vpn_id, VpnConfig.device_id == device_id)
    )
    vpn = result.scalar_one_or_none()
    if not vpn:
        raise HTTPException(status_code=404, detail="Configuração VPN não encontrada")

    update_data = data.dict(exclude_none=True, exclude={"password", "preshared_key"})
    for field, value in update_data.items():
        setattr(vpn, field, value)

    if data.password:
        vpn.password_encrypted = encrypt_field(data.password)
    if data.preshared_key:
        vpn.preshared_key_encrypted = encrypt_field(data.preshared_key)

    await db.commit()

    # Recarregar com selectinload para evitar DetachedInstanceError
    vpn = await _load_vpn(db, vpn_id, device_id)

    # Auditoria
    await _write_audit(
        db,
        action=AuditAction.VPN_UPDATED,
        description=f"VPN '{vpn.name}' atualizada no dispositivo {device_id} por {current_user.username}",
        user_id=current_user.id,
        device_id=device_id,
        ip_address=_get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
        resource_id=vpn_id,
        extra_data={"vpn_name": vpn.name, "fields_updated": list(update_data.keys())},
    )

    return vpn


@router.delete("/{vpn_id}", status_code=204)
async def delete_vpn_config(
    device_id: str,
    vpn_id: str,
    request: Request,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    """Remove configuração VPN e rotas associadas."""
    result = await db.execute(
        select(VpnConfig).where(VpnConfig.id == vpn_id, VpnConfig.device_id == device_id)
    )
    vpn = result.scalar_one_or_none()
    if not vpn:
        raise HTTPException(status_code=404, detail="Configuração VPN não encontrada")

    vpn_name = vpn.name
    await db.delete(vpn)
    await db.commit()

    # Auditoria
    await _write_audit(
        db,
        action=AuditAction.VPN_DELETED,
        description=f"VPN '{vpn_name}' removida do dispositivo {device_id} por {current_user.username}",
        user_id=current_user.id,
        device_id=device_id,
        ip_address=_get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
        resource_id=vpn_id,
        extra_data={"vpn_name": vpn_name},
    )


# ─── VPN Connect / Disconnect ─────────────────────────────────────────────────

@router.post("/{vpn_id}/connect", response_model=VpnConfigResponse)
async def connect_vpn(
    device_id: str,
    vpn_id: str,
    request: Request,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    """
    Conecta a VPN L2TP: gera configurações, inicia xl2tpd e disca para o servidor.
    Aguarda a interface PPP subir (timeout: 30s).
    """
    vpn = await _load_vpn(db, vpn_id, device_id)
    if not vpn:
        raise HTTPException(status_code=404, detail="Configuração VPN não encontrada")

    if vpn.status == VpnStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="VPN já está conectada")

    client_ip = _get_request_ip(request)
    user_agent = request.headers.get("user-agent")

    # Descriptografar credenciais
    password = ""
    preshared_key = None
    try:
        if vpn.password_encrypted:
            password = decrypt_field(vpn.password_encrypted)
        if vpn.preshared_key_encrypted:
            preshared_key = decrypt_field(vpn.preshared_key_encrypted)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao descriptografar credenciais: {str(e)}")

    # Atualizar status para CONNECTING
    vpn.status = VpnStatus.CONNECTING
    vpn.last_error = None
    await db.commit()

    # Executar conexão
    manager = build_manager_from_vpn(vpn, password, preshared_key)
    success, message = await manager.connect()

    if success:
        status_info = manager.get_status()
        vpn.status = VpnStatus.ACTIVE
        vpn.connected_at = datetime.now(timezone.utc)
        vpn.last_error = None
        # Salvar interface PPP no tunnel_ip se disponível
        if status_info.get("local_ip"):
            vpn.tunnel_ip = status_info["local_ip"]
        logger.info(f"VPN {vpn.name} conectada com sucesso: {message}")

        # Auditoria: conexão bem-sucedida
        await _write_audit(
            db,
            action=AuditAction.VPN_CONNECTED,
            description=(
                f"VPN '{vpn.name}' conectada ao servidor {vpn.server_ip} "
                f"por {current_user.username}"
            ),
            user_id=current_user.id,
            device_id=device_id,
            ip_address=client_ip,
            user_agent=user_agent,
            resource_id=vpn_id,
            extra_data={
                "vpn_name": vpn.name,
                "server_ip": vpn.server_ip,
                "tunnel_ip": vpn.tunnel_ip,
                "message": message,
            },
        )
    else:
        vpn.status = VpnStatus.ERROR
        vpn.last_error = message
        logger.error(f"VPN {vpn.name} falhou ao conectar: {message}")

        # Auditoria: falha na conexão VPN
        await _write_audit(
            db,
            action=AuditAction.VPN_CONNECTION_FAILED,
            description=(
                f"Falha ao conectar VPN '{vpn.name}' ao servidor {vpn.server_ip} "
                f"por {current_user.username}"
            ),
            audit_status="failure",
            user_id=current_user.id,
            device_id=device_id,
            ip_address=client_ip,
            user_agent=user_agent,
            error_message=message,
            resource_id=vpn_id,
            extra_data={
                "vpn_name": vpn.name,
                "server_ip": vpn.server_ip,
                "error": message,
            },
        )

    await db.commit()
    vpn = await _load_vpn(db, vpn_id, device_id)

    if not success:
        raise HTTPException(status_code=502, detail=message)

    return vpn


@router.post("/{vpn_id}/disconnect", response_model=VpnConfigResponse)
async def disconnect_vpn(
    device_id: str,
    vpn_id: str,
    request: Request,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    """Desconecta a VPN L2TP."""
    vpn = await _load_vpn(db, vpn_id, device_id)
    if not vpn:
        raise HTTPException(status_code=404, detail="Configuração VPN não encontrada")

    client_ip = _get_request_ip(request)
    user_agent = request.headers.get("user-agent")
    vpn_name = vpn.name
    server_ip = vpn.server_ip

    # Descriptografar credenciais para construir o manager
    password = ""
    try:
        if vpn.password_encrypted:
            password = decrypt_field(vpn.password_encrypted)
    except Exception:
        pass

    manager = build_manager_from_vpn(vpn, password)
    success, message = await manager.disconnect()

    vpn.status = VpnStatus.INACTIVE
    vpn.connected_at = None
    vpn.tunnel_ip = None
    if not success:
        vpn.last_error = message
    await db.commit()

    # Auditoria: desconexão
    await _write_audit(
        db,
        action=AuditAction.VPN_DISCONNECTED,
        description=(
            f"VPN '{vpn_name}' desconectada do servidor {server_ip} "
            f"por {current_user.username}"
        ),
        audit_status="success" if success else "warning",
        user_id=current_user.id,
        device_id=device_id,
        ip_address=client_ip,
        user_agent=user_agent,
        resource_id=vpn_id,
        error_message=message if not success else None,
        extra_data={
            "vpn_name": vpn_name,
            "server_ip": server_ip,
            "disconnect_message": message,
        },
    )

    vpn = await _load_vpn(db, vpn_id, device_id)
    return vpn


@router.get("/{vpn_id}/status")
async def get_vpn_status(
    device_id: str,
    vpn_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Retorna o status atual da conexão VPN (verifica a interface PPP no sistema).
    Sincroniza o status no banco se houver divergência.
    """
    vpn = await _load_vpn(db, vpn_id, device_id)
    if not vpn:
        raise HTTPException(status_code=404, detail="Configuração VPN não encontrada")

    password = ""
    try:
        if vpn.password_encrypted:
            password = decrypt_field(vpn.password_encrypted)
    except Exception:
        pass

    manager = build_manager_from_vpn(vpn, password)
    status_info = manager.get_status()

    # Sincronizar status no banco se houver divergência
    is_connected = status_info["connected"]
    db_active = vpn.status == VpnStatus.ACTIVE

    if is_connected and not db_active:
        vpn.status = VpnStatus.ACTIVE
        await db.commit()
    elif not is_connected and db_active:
        vpn.status = VpnStatus.INACTIVE
        await db.commit()

    return {
        "vpn_id": str(vpn.id),
        "name": vpn.name,
        "status": vpn.status.value,
        "connected": is_connected,
        "interface": status_info.get("interface"),
        "local_ip": status_info.get("local_ip"),
        "xl2tpd_running": status_info.get("xl2tpd_running"),
        "last_error": vpn.last_error,
        "connected_at": vpn.connected_at.isoformat() if vpn.connected_at else None,
    }


# ─── Static Routes ────────────────────────────────────────────────────────────

@routes_router.get("", response_model=List[StaticRouteResponse])
async def list_routes(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StaticRoute).where(StaticRoute.device_id == device_id)
    )
    return result.scalars().all()


@routes_router.post("", response_model=StaticRouteResponse, status_code=201)
async def create_route(
    device_id: str,
    data: StaticRouteCreate,
    request: Request,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    route = StaticRoute(device_id=device_id, **data.dict())
    db.add(route)
    await db.commit()
    await db.refresh(route)

    # Auditoria
    await _write_audit(
        db,
        action=AuditAction.ROUTE_CREATED,
        description=(
            f"Rota estática {data.destination_network} "
            f"via {data.next_hop} criada no dispositivo {device_id} "
            f"por {current_user.username}"
        ),
        user_id=current_user.id,
        device_id=device_id,
        ip_address=_get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
        resource_type="route",
        resource_id=str(route.id),
        extra_data={
            "destination_network": data.destination_network,
            "next_hop": data.next_hop,
        },
    )

    return route


@routes_router.get("/{route_id}", response_model=StaticRouteResponse)
async def get_route(
    device_id: str,
    route_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StaticRoute).where(StaticRoute.id == route_id, StaticRoute.device_id == device_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Rota não encontrada")
    return route


@routes_router.put("/{route_id}", response_model=StaticRouteResponse)
async def update_route(
    device_id: str,
    route_id: str,
    data: StaticRouteUpdate,
    request: Request,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StaticRoute).where(StaticRoute.id == route_id, StaticRoute.device_id == device_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Rota não encontrada")

    update_data = data.dict(exclude_none=True)
    for field, value in update_data.items():
        setattr(route, field, value)

    await db.commit()
    await db.refresh(route)

    # Auditoria
    await _write_audit(
        db,
        action=AuditAction.ROUTE_UPDATED,
        description=(
            f"Rota estática {route.destination_network} atualizada no dispositivo {device_id} "
            f"por {current_user.username}"
        ),
        user_id=current_user.id,
        device_id=device_id,
        ip_address=_get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
        resource_type="route",
        resource_id=route_id,
        extra_data={"fields_updated": list(update_data.keys())},
    )

    return route


@routes_router.delete("/{route_id}", status_code=204)
async def delete_route(
    device_id: str,
    route_id: str,
    request: Request,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StaticRoute).where(StaticRoute.id == route_id, StaticRoute.device_id == device_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Rota não encontrada")

    route_dest = route.destination_network
    await db.delete(route)
    await db.commit()

    # Auditoria
    await _write_audit(
        db,
        action=AuditAction.ROUTE_DELETED,
        description=(
            f"Rota estática {route_dest} removida do dispositivo {device_id} "
            f"por {current_user.username}"
        ),
        user_id=current_user.id,
        device_id=device_id,
        ip_address=_get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
        resource_type="route",
        resource_id=route_id,
        extra_data={"destination_network": route_dest},
    )

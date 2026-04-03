"""
BR10 NetManager - VPN API
Gerenciamento de VPN L2TP e rotas estáticas.
"""
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import logging

from app.core.database import get_db
from app.core.security import encrypt_field, decrypt_field
from app.models.vpn import VpnConfig, StaticRoute, VpnStatus
from app.models.user import User
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
    return vpn


@router.delete("/{vpn_id}", status_code=204)
async def delete_vpn_config(
    device_id: str,
    vpn_id: str,
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
    await db.delete(vpn)
    await db.commit()


# ─── VPN Connect / Disconnect ─────────────────────────────────────────────────

@router.post("/{vpn_id}/connect", response_model=VpnConfigResponse)
async def connect_vpn(
    device_id: str,
    vpn_id: str,
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
    else:
        vpn.status = VpnStatus.ERROR
        vpn.last_error = message
        logger.error(f"VPN {vpn.name} falhou ao conectar: {message}")

    await db.commit()
    vpn = await _load_vpn(db, vpn_id, device_id)

    if not success:
        raise HTTPException(status_code=502, detail=message)

    return vpn


@router.post("/{vpn_id}/disconnect", response_model=VpnConfigResponse)
async def disconnect_vpn(
    device_id: str,
    vpn_id: str,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    """Desconecta a VPN L2TP."""
    vpn = await _load_vpn(db, vpn_id, device_id)
    if not vpn:
        raise HTTPException(status_code=404, detail="Configuração VPN não encontrada")

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
        if status_info.get("local_ip"):
            vpn.tunnel_ip = status_info["local_ip"]
        await db.commit()
    elif not is_connected and db_active:
        vpn.status = VpnStatus.INACTIVE
        vpn.tunnel_ip = None
        await db.commit()

    return {
        "vpn_id": vpn_id,
        "name": vpn.name,
        "status": vpn.status,
        "connected": is_connected,
        "interface": status_info.get("interface"),
        "local_ip": status_info.get("local_ip"),
        "xl2tpd_running": status_info.get("xl2tpd_running"),
        "connected_at": vpn.connected_at,
        "last_error": vpn.last_error,
    }


# ─── Static Routes ────────────────────────────────────────────────────────────
@routes_router.get("", response_model=List[StaticRouteResponse])
async def list_static_routes(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista todas as rotas estáticas de um dispositivo."""
    result = await db.execute(
        select(StaticRoute).where(StaticRoute.device_id == device_id)
    )
    return result.scalars().all()


@routes_router.post("", response_model=StaticRouteResponse, status_code=201)
async def create_static_route(
    device_id: str,
    data: StaticRouteCreate,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    """Cria nova rota estática para o dispositivo."""
    route = StaticRoute(device_id=device_id, **data.dict())
    db.add(route)
    await db.commit()
    await db.refresh(route)
    return route


@routes_router.put("/{route_id}", response_model=StaticRouteResponse)
async def update_static_route(
    device_id: str,
    route_id: str,
    data: StaticRouteUpdate,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StaticRoute).where(StaticRoute.id == route_id, StaticRoute.device_id == device_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Rota não encontrada")

    for field, value in data.dict(exclude_none=True).items():
        setattr(route, field, value)

    await db.commit()
    await db.refresh(route)
    return route


@routes_router.delete("/{route_id}", status_code=204)
async def delete_static_route(
    device_id: str,
    route_id: str,
    current_user: User = Depends(require_technician),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StaticRoute).where(StaticRoute.id == route_id, StaticRoute.device_id == device_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Rota não encontrada")
    await db.delete(route)
    await db.commit()

"""
BR10 NetManager - Clients & Vendors API
CRUD completo para clientes, grupos de vendors, vendors e modelos.
"""
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.api.v1.auth import get_current_user, require_technician_or_admin, require_admin
from app.models.client import Client, VendorGroup, Vendor, VendorModel, DeviceGroupType
from app.models.user import User

# Routers separados para evitar conflito de rotas
router = APIRouter(prefix="/clients", tags=["Clients"])
vendor_groups_router = APIRouter(prefix="/vendor-groups", tags=["Vendor Groups"])
vendors_router = APIRouter(prefix="/vendors", tags=["Vendors"])
vendor_models_router = APIRouter(prefix="/vendor-models", tags=["Vendor Models"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class ClientCreate(BaseModel):
    name: str
    short_name: Optional[str] = None
    document: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True

class ClientUpdate(BaseModel):
    name: Optional[str] = None
    short_name: Optional[str] = None
    document: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

class VendorGroupCreate(BaseModel):
    name: str
    group_type: DeviceGroupType
    description: Optional[str] = None
    icon: Optional[str] = None
    is_active: bool = True

class VendorGroupUpdate(BaseModel):
    name: Optional[str] = None
    group_type: Optional[DeviceGroupType] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    is_active: Optional[bool] = None

class VendorCreate(BaseModel):
    group_id: str
    name: str
    description: Optional[str] = None
    website: Optional[str] = None
    is_active: bool = True

class VendorUpdate(BaseModel):
    group_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    website: Optional[str] = None
    is_active: Optional[bool] = None

class VendorModelCreate(BaseModel):
    vendor_id: str
    name: str
    description: Optional[str] = None
    default_ssh_port: Optional[int] = 22
    default_telnet_port: Optional[int] = 23
    default_http_port: Optional[int] = None
    default_https_port: Optional[int] = None
    default_winbox_port: Optional[int] = None
    notes: Optional[str] = None
    is_active: bool = True

class VendorModelUpdate(BaseModel):
    vendor_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    default_ssh_port: Optional[int] = None
    default_telnet_port: Optional[int] = None
    default_http_port: Optional[int] = None
    default_https_port: Optional[int] = None
    default_winbox_port: Optional[int] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def client_to_dict(c: Client, device_count: int = 0) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "short_name": c.short_name,
        "document": c.document,
        "email": c.email,
        "phone": c.phone,
        "address": c.address,
        "city": c.city,
        "state": c.state,
        "contact_name": c.contact_name,
        "contact_email": c.contact_email,
        "contact_phone": c.contact_phone,
        "notes": c.notes,
        "is_active": c.is_active,
        "device_count": device_count,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }

def group_to_dict(g: VendorGroup) -> dict:
    return {
        "id": str(g.id),
        "name": g.name,
        "group_type": g.group_type.value if g.group_type else None,
        "description": g.description,
        "icon": g.icon,
        "is_active": g.is_active,
        "vendor_count": len(g.vendors) if g.vendors else 0,
        "vendors": [vendor_to_dict(v) for v in (g.vendors or [])],
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }

def vendor_to_dict(v: Vendor) -> dict:
    # Acessar v.group apenas se estiver carregado (evitar lazy loading em contexto async)
    try:
        group_name = v.group.name if v.group else None
    except Exception:
        group_name = None
    return {
        "id": str(v.id),
        "group_id": str(v.group_id),
        "group_name": group_name,
        "name": v.name,
        "description": v.description,
        "website": v.website,
        "is_active": v.is_active,
        "model_count": len(v.models) if v.models else 0,
        "models": [model_to_dict(m) for m in (v.models or [])],
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }

def model_to_dict(m: VendorModel) -> dict:
    # Acessar m.vendor apenas se estiver carregado (evitar lazy loading em contexto async)
    try:
        vendor_name = m.vendor.name if m.vendor else None
    except Exception:
        vendor_name = None
    return {
        "id": str(m.id),
        "vendor_id": str(m.vendor_id),
        "vendor_name": vendor_name,
        "name": m.name,
        "description": m.description,
        "default_ssh_port": m.default_ssh_port,
        "default_telnet_port": m.default_telnet_port,
        "default_http_port": m.default_http_port,
        "default_https_port": m.default_https_port,
        "default_winbox_port": m.default_winbox_port,
        "notes": m.notes,
        "is_active": m.is_active,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


# ─── Clients Endpoints ────────────────────────────────────────────────────────

@router.get("")
async def list_clients(
    active_only: bool = False,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista todos os clientes."""
    from app.models.device import Device
    query = select(Client)
    if active_only:
        query = query.where(Client.is_active == True)
    query = query.order_by(Client.name)
    result = await db.execute(query)
    clients = result.scalars().all()
    counts_result = await db.execute(
        select(Device.client_id, func.count(Device.id)).group_by(Device.client_id)
    )
    counts = {str(row[0]): row[1] for row in counts_result if row[0]}
    return [client_to_dict(c, counts.get(str(c.id), 0)) for c in clients]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_client(
    data: ClientCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria um novo cliente."""
    existing = await db.execute(select(Client).where(Client.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Já existe um cliente com este nome")
    client = Client(**data.model_dump())
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return client_to_dict(client)


@router.get("/{client_id}")
async def get_client(
    client_id: str,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Retorna detalhes de um cliente."""
    from app.models.device import Device
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    count_result = await db.execute(
        select(func.count(Device.id)).where(Device.client_id == client_id)
    )
    count = count_result.scalar() or 0
    return client_to_dict(client, count)


@router.put("/{client_id}")
async def update_client(
    client_id: str,
    data: ClientUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza um cliente."""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    await db.commit()
    await db.refresh(client)
    return client_to_dict(client)


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_client(
    client_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove um cliente."""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    await db.delete(client)
    await db.commit()


# ─── Vendor Groups Endpoints ──────────────────────────────────────────────────

@vendor_groups_router.get("")
async def list_vendor_groups(
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista todos os grupos de vendors com seus vendors e modelos."""
    result = await db.execute(
        select(VendorGroup)
        .options(
            selectinload(VendorGroup.vendors).selectinload(Vendor.models)
        )
        .order_by(VendorGroup.name)
    )
    groups = result.scalars().all()
    return [group_to_dict(g) for g in groups]


@vendor_groups_router.post("", status_code=status.HTTP_201_CREATED)
async def create_vendor_group(
    data: VendorGroupCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria um novo grupo de vendors."""
    existing = await db.execute(select(VendorGroup).where(VendorGroup.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Já existe um grupo com este nome")
    group = VendorGroup(**data.model_dump())
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group_to_dict(group)


@vendor_groups_router.put("/{group_id}")
async def update_vendor_group(
    group_id: str,
    data: VendorGroupUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza um grupo de vendors."""
    result = await db.execute(
        select(VendorGroup).options(selectinload(VendorGroup.vendors))
        .where(VendorGroup.id == group_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await db.commit()
    await db.refresh(group)
    return group_to_dict(group)


@vendor_groups_router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor_group(
    group_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove um grupo de vendors."""
    result = await db.execute(select(VendorGroup).where(VendorGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    await db.delete(group)
    await db.commit()


# ─── Vendors Endpoints ────────────────────────────────────────────────────────

@vendors_router.get("")
async def list_vendors(
    group_id: Optional[str] = None,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista vendors, opcionalmente filtrados por grupo."""
    query = select(Vendor).options(
        selectinload(Vendor.group),
        selectinload(Vendor.models)
    )
    if group_id:
        query = query.where(Vendor.group_id == group_id)
    query = query.order_by(Vendor.name)
    result = await db.execute(query)
    vendors = result.scalars().all()
    return [vendor_to_dict(v) for v in vendors]


@vendors_router.post("", status_code=status.HTTP_201_CREATED)
async def create_vendor(
    data: VendorCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria um novo vendor."""
    group_result = await db.execute(select(VendorGroup).where(VendorGroup.id == data.group_id))
    if not group_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    vendor = Vendor(**data.model_dump())
    db.add(vendor)
    await db.commit()
    await db.refresh(vendor)
    result = await db.execute(
        select(Vendor)
        .options(selectinload(Vendor.group), selectinload(Vendor.models))
        .where(Vendor.id == vendor.id)
    )
    return vendor_to_dict(result.scalar_one())


@vendors_router.put("/{vendor_id}")
async def update_vendor(
    vendor_id: str,
    data: VendorUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza um vendor."""
    result = await db.execute(
        select(Vendor).options(selectinload(Vendor.group), selectinload(Vendor.models))
        .where(Vendor.id == vendor_id)
    )
    vendor = result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor não encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(vendor, field, value)
    await db.commit()
    result2 = await db.execute(
        select(Vendor).options(selectinload(Vendor.group), selectinload(Vendor.models))
        .where(Vendor.id == vendor_id)
    )
    return vendor_to_dict(result2.scalar_one())


@vendors_router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor(
    vendor_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove um vendor."""
    result = await db.execute(select(Vendor).where(Vendor.id == vendor_id))
    vendor = result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor não encontrado")
    await db.delete(vendor)
    await db.commit()


# ─── Vendor Models Endpoints ──────────────────────────────────────────────────

@vendor_models_router.get("")
async def list_vendor_models(
    vendor_id: Optional[str] = None,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista modelos de equipamentos, opcionalmente filtrados por vendor."""
    query = select(VendorModel).options(selectinload(VendorModel.vendor))
    if vendor_id:
        query = query.where(VendorModel.vendor_id == vendor_id)
    query = query.order_by(VendorModel.name)
    result = await db.execute(query)
    models = result.scalars().all()
    return [model_to_dict(m) for m in models]


@vendor_models_router.post("", status_code=status.HTTP_201_CREATED)
async def create_vendor_model(
    data: VendorModelCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria um novo modelo de equipamento."""
    vendor_result = await db.execute(select(Vendor).where(Vendor.id == data.vendor_id))
    if not vendor_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Vendor não encontrado")
    model = VendorModel(**data.model_dump())
    db.add(model)
    await db.commit()
    await db.refresh(model)
    result = await db.execute(
        select(VendorModel).options(selectinload(VendorModel.vendor))
        .where(VendorModel.id == model.id)
    )
    return model_to_dict(result.scalar_one())


@vendor_models_router.put("/{model_id}")
async def update_vendor_model(
    model_id: str,
    data: VendorModelUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza um modelo de equipamento."""
    result = await db.execute(
        select(VendorModel).options(selectinload(VendorModel.vendor))
        .where(VendorModel.id == model_id)
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(model, field, value)
    await db.commit()
    result2 = await db.execute(
        select(VendorModel).options(selectinload(VendorModel.vendor))
        .where(VendorModel.id == model_id)
    )
    return model_to_dict(result2.scalar_one())


@vendor_models_router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor_model(
    model_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove um modelo de equipamento."""
    result = await db.execute(select(VendorModel).where(VendorModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    await db.delete(model)
    await db.commit()


# ─── Visão Consolidada de Rede por Cliente ────────────────────────────────────

@router.get("/{client_id}/network")
async def get_client_network(
    client_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Retorna a visão consolidada de toda a infraestrutura de rede de um cliente:
    dispositivos, VLANs, portas, rotas estáticas e VPNs.
    """
    from app.models.device import Device, DeviceVlan, DevicePort
    from app.models.vpn import VpnConfig, StaticRoute

    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    devices_result = await db.execute(
        select(Device)
        .where(Device.client_id == client_id, Device.is_active == True)
        .order_by(Device.name)
    )
    devices = devices_result.scalars().all()
    device_ids = [d.id for d in devices]

    vlans_map: dict = {}
    ports_map: dict = {}
    routes_map: dict = {}
    vpns_map: dict = {}

    if device_ids:
        for v in (await db.execute(
            select(DeviceVlan).where(DeviceVlan.device_id.in_(device_ids))
            .order_by(DeviceVlan.vlan_id)
        )).scalars().all():
            vlans_map.setdefault(str(v.device_id), []).append({
                "id": str(v.id), "vlan_id": v.vlan_id, "name": v.name,
                "description": v.description, "ip_address": v.ip_address,
                "subnet_mask": v.subnet_mask, "gateway": v.gateway,
                "is_management": v.is_management, "is_active": v.is_active,
            })

        for p in (await db.execute(
            select(DevicePort).where(DevicePort.device_id.in_(device_ids))
            .order_by(DevicePort.port_name)
        )).scalars().all():
            ports_map.setdefault(str(p.device_id), []).append({
                "id": str(p.id), "port_name": p.port_name, "port_number": p.port_number,
                "port_type": p.port_type.value if hasattr(p.port_type, "value") else str(p.port_type),
                "status": p.status.value if hasattr(p.status, "value") else str(p.status),
                "speed_mbps": p.speed_mbps, "vlan_id": p.vlan_id, "ip_address": p.ip_address,
                "description": p.description, "is_trunk": p.is_trunk,
                "connected_device": p.connected_device,
            })

        for r in (await db.execute(
            select(StaticRoute).where(StaticRoute.device_id.in_(device_ids))
            .order_by(StaticRoute.destination_network)
        )).scalars().all():
            routes_map.setdefault(str(r.device_id), []).append({
                "id": str(r.id), "destination_network": r.destination_network,
                "next_hop": r.next_hop, "interface": r.interface,
                "metric": r.metric, "description": r.description, "is_active": r.is_active,
            })

        for vpn in (await db.execute(
            select(VpnConfig).where(VpnConfig.device_id.in_(device_ids))
            .order_by(VpnConfig.name)
        )).scalars().all():
            vpns_map.setdefault(str(vpn.device_id), []).append({
                "id": str(vpn.id), "name": vpn.name,
                "vpn_type": vpn.vpn_type.value if hasattr(vpn.vpn_type, "value") else str(vpn.vpn_type),
                "status": vpn.status.value if hasattr(vpn.status, "value") else str(vpn.status),
                "server_ip": vpn.server_ip, "local_ip": vpn.local_ip,
                "remote_ip": vpn.remote_ip, "tunnel_ip": vpn.tunnel_ip,
            })

    stats = {"total_devices": len(devices), "online": 0, "offline": 0, "unknown": 0,
             "total_vlans": 0, "total_ports": 0, "total_routes": 0, "total_vpns": 0}
    devices_data = []

    for d in devices:
        did = str(d.id)
        d_vlans = vlans_map.get(did, [])
        d_ports = ports_map.get(did, [])
        d_routes = routes_map.get(did, [])
        d_vpns = vpns_map.get(did, [])
        status_val = d.status.value if hasattr(d.status, "value") else str(d.status)
        stats["online" if status_val == "online" else "offline" if status_val == "offline" else "unknown"] += 1
        stats["total_vlans"] += len(d_vlans)
        stats["total_ports"] += len(d_ports)
        stats["total_routes"] += len(d_routes)
        stats["total_vpns"] += len(d_vpns)
        devices_data.append({
            "id": did, "name": d.name, "hostname": d.hostname, "description": d.description,
            "device_type": d.device_type.value if hasattr(d.device_type, "value") else str(d.device_type),
            "status": status_val, "manufacturer": d.manufacturer, "model": d.model,
            "firmware_version": d.firmware_version, "serial_number": d.serial_number,
            "location": d.location, "site": d.site,
            "management_ip": d.management_ip, "subnet_mask": d.subnet_mask,
            "gateway": d.gateway, "dns_primary": d.dns_primary, "dns_secondary": d.dns_secondary,
            "loopback_ip": d.loopback_ip,
            "primary_protocol": d.primary_protocol.value if hasattr(d.primary_protocol, "value") else str(d.primary_protocol),
            "ssh_port": d.ssh_port, "telnet_port": d.telnet_port,
            "winbox_port": d.winbox_port, "http_port": d.http_port, "https_port": d.https_port,
            "tags": d.tags or [], "notes": d.notes,
            "last_seen": d.last_seen.isoformat() if d.last_seen else None,
            "last_backup": d.last_backup.isoformat() if d.last_backup else None,
            "vlans": d_vlans, "ports": d_ports, "routes": d_routes, "vpns": d_vpns,
        })

    return {
        "client": {
            "id": str(client.id), "name": client.name, "short_name": client.short_name,
            "city": client.city, "state": client.state, "contact_name": client.contact_name,
            "contact_phone": client.contact_phone, "contact_email": client.contact_email,
            "notes": client.notes,
        },
        "stats": stats,
        "devices": devices_data,
    }

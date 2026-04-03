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
    return {
        "id": str(v.id),
        "group_id": str(v.group_id),
        "group_name": v.group.name if v.group else None,
        "name": v.name,
        "description": v.description,
        "website": v.website,
        "is_active": v.is_active,
        "model_count": len(v.models) if v.models else 0,
        "models": [model_to_dict(m) for m in (v.models or [])],
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }

def model_to_dict(m: VendorModel) -> dict:
    return {
        "id": str(m.id),
        "vendor_id": str(m.vendor_id),
        "vendor_name": m.vendor.name if m.vendor else None,
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

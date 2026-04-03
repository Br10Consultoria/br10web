"""
BR10 NetManager - Devices API
CRUD completo para dispositivos de rede.
"""
import os
import uuid
import asyncio
import aiofiles
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import encrypt_field, decrypt_field
from app.core.config import settings
from app.api.v1.auth import get_current_user, require_technician_or_admin, require_admin
from app.models.user import User
from app.models.device import (
    Device, DeviceVlan, DevicePort, DeviceCredential, DevicePhoto, DeviceBackup,
    DeviceType, DeviceStatus
)
from app.models.audit import AuditLog, AuditAction
from app.schemas.device import (
    DeviceCreate, DeviceUpdate, DeviceResponse, DeviceListResponse,
    VlanCreate, VlanResponse, PortCreate, PortResponse,
    CredentialCreate, CredentialResponse
)

router = APIRouter(prefix="/devices", tags=["Devices"])


@router.get("", response_model=List[DeviceListResponse])
async def list_devices(
    search: Optional[str] = Query(None, description="Busca por nome, IP, hostname"),
    device_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    site: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista dispositivos com filtros e paginação."""
    query = select(Device)

    if search:
        query = query.where(
            or_(
                Device.name.ilike(f"%{search}%"),
                Device.management_ip.ilike(f"%{search}%"),
                Device.hostname.ilike(f"%{search}%"),
                Device.description.ilike(f"%{search}%"),
            )
        )
    if device_type:
        query = query.where(Device.device_type == device_type)
    if status:
        query = query.where(Device.status == status)
    if site:
        query = query.where(Device.site.ilike(f"%{site}%"))
    if location:
        query = query.where(Device.location.ilike(f"%{location}%"))
    if is_active is not None:
        query = query.where(Device.is_active == is_active)

    query = query.order_by(Device.name).offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/stats")
async def get_device_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna estatísticas gerais dos dispositivos."""
    total = await db.scalar(select(func.count(Device.id)))
    online = await db.scalar(select(func.count(Device.id)).where(Device.status == DeviceStatus.ONLINE))
    offline = await db.scalar(select(func.count(Device.id)).where(Device.status == DeviceStatus.OFFLINE))
    maintenance = await db.scalar(select(func.count(Device.id)).where(Device.status == DeviceStatus.MAINTENANCE))

    # Por tipo
    type_counts = {}
    for dtype in DeviceType:
        count = await db.scalar(select(func.count(Device.id)).where(Device.device_type == dtype))
        type_counts[dtype.value] = count

    return {
        "total": total,
        "online": online,
        "offline": offline,
        "maintenance": maintenance,
        "unknown": total - online - offline - maintenance,
        "by_type": type_counts,
    }


@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def create_device(
    device_data: DeviceCreate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria um novo dispositivo."""
    # Verificar IP duplicado
    existing = await db.scalar(
        select(Device).where(Device.management_ip == device_data.management_ip)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Dispositivo com IP {device_data.management_ip} já cadastrado"
        )

    device_dict = device_data.dict(exclude={"password", "enable_password", "ssh_private_key"})

    # Criptografar credenciais
    if device_data.password:
        device_dict["password_encrypted"] = encrypt_field(device_data.password)
    if device_data.enable_password:
        device_dict["enable_password_encrypted"] = encrypt_field(device_data.enable_password)
    if device_data.ssh_private_key:
        device_dict["ssh_private_key_encrypted"] = encrypt_field(device_data.ssh_private_key)

    device = Device(**device_dict)
    db.add(device)
    await db.flush()

    # Log de auditoria
    log = AuditLog(
        user_id=current_user.id,
        device_id=device.id,
        action=AuditAction.DEVICE_CREATED,
        description=f"Dispositivo criado: {device.name} ({device.management_ip})",
        new_values={"name": device.name, "ip": device.management_ip, "type": device_data.device_type},
        status="success",
    )
    db.add(log)
    device_id_saved = device.id
    await db.commit()

    # Recarregar com relacionamentos para evitar DetachedInstanceError
    result2 = await db.execute(
        select(Device)
        .options(selectinload(Device.vlans), selectinload(Device.ports))
        .where(Device.id == device_id_saved)
    )
    return result2.scalar_one()


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna detalhes completos de um dispositivo."""
    result = await db.execute(
        select(Device)
        .options(
            selectinload(Device.vlans),
            selectinload(Device.ports),
        )
        .where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo não encontrado")

    return device


@router.put("/{device_id}", response_model=DeviceResponse)
async def update_device(
    device_id: str,
    device_data: DeviceUpdate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza dados de um dispositivo."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo não encontrado")

    old_values = {
        "name": device.name,
        "management_ip": device.management_ip,
        "status": device.status.value if device.status else None,
    }

    # exclude_unset=True: só atualiza campos enviados pelo cliente
    # Isso permite zerar campos opcionais (winbox_port, http_port, https_port) enviando null
    update_dict = device_data.dict(exclude_unset=True, exclude={"password", "enable_password"})
    # Garantir que ssh_port e telnet_port nunca sejam None (NOT NULL no banco)
    if "ssh_port" in update_dict and update_dict["ssh_port"] is None:
        update_dict["ssh_port"] = 22
    if "telnet_port" in update_dict and update_dict["telnet_port"] is None:
        update_dict["telnet_port"] = 23

    # Criptografar credenciais se fornecidas
    if device_data.password:
        update_dict["password_encrypted"] = encrypt_field(device_data.password)
    if device_data.enable_password:
        update_dict["enable_password_encrypted"] = encrypt_field(device_data.enable_password)

    for field, value in update_dict.items():
        setattr(device, field, value)

    log = AuditLog(
        user_id=current_user.id,
        device_id=device.id,
        action=AuditAction.DEVICE_UPDATED,
        description=f"Dispositivo atualizado: {device.name}",
        old_values=old_values,
        new_values=update_dict,
        status="success",
    )
    db.add(log)
    device_id_saved = device.id
    await db.commit()

    # Recarregar com relacionamentos para evitar DetachedInstanceError
    result2 = await db.execute(
        select(Device)
        .options(selectinload(Device.vlans), selectinload(Device.ports))
        .where(Device.id == device_id_saved)
    )
    return result2.scalar_one()


@router.delete("/{device_id}")
async def delete_device(
    device_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove um dispositivo e todos os dados associados."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo não encontrado")

    device_name = device.name
    device_ip = device.management_ip

    await db.delete(device)

    log = AuditLog(
        user_id=current_user.id,
        action=AuditAction.DEVICE_DELETED,
        description=f"Dispositivo removido: {device_name} ({device_ip})",
        old_values={"name": device_name, "ip": device_ip},
        status="success",
    )
    db.add(log)
    await db.commit()

    return {"message": f"Dispositivo {device_name} removido com sucesso"}


# ─── VLANs ───────────────────────────────────────────────────────────────────

@router.get("/{device_id}/vlans", response_model=List[VlanResponse])
async def list_vlans(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista VLANs de um dispositivo."""
    result = await db.execute(
        select(DeviceVlan).where(DeviceVlan.device_id == device_id)
        .order_by(DeviceVlan.vlan_id)
    )
    return result.scalars().all()


@router.post("/{device_id}/vlans", response_model=VlanResponse, status_code=status.HTTP_201_CREATED)
async def create_vlan(
    device_id: str,
    vlan_data: VlanCreate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Adiciona VLAN a um dispositivo."""
    device = await db.scalar(select(Device).where(Device.id == device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo não encontrado")

    existing = await db.scalar(
        select(DeviceVlan).where(
            DeviceVlan.device_id == device_id,
            DeviceVlan.vlan_id == vlan_data.vlan_id
        )
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"VLAN {vlan_data.vlan_id} já existe neste dispositivo"
        )

    vlan = DeviceVlan(device_id=device_id, **vlan_data.dict())
    db.add(vlan)
    await db.commit()
    await db.refresh(vlan)
    return vlan


@router.put("/{device_id}/vlans/{vlan_id}", response_model=VlanResponse)
async def update_vlan(
    device_id: str,
    vlan_id: str,
    vlan_data: VlanCreate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza VLAN de um dispositivo."""
    result = await db.execute(
        select(DeviceVlan).where(DeviceVlan.id == vlan_id, DeviceVlan.device_id == device_id)
    )
    vlan = result.scalar_one_or_none()
    if not vlan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VLAN não encontrada")

    for field, value in vlan_data.dict().items():
        setattr(vlan, field, value)

    await db.commit()
    await db.refresh(vlan)
    return vlan


@router.delete("/{device_id}/vlans/{vlan_id}")
async def delete_vlan(
    device_id: str,
    vlan_id: str,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove VLAN de um dispositivo."""
    result = await db.execute(
        select(DeviceVlan).where(DeviceVlan.id == vlan_id, DeviceVlan.device_id == device_id)
    )
    vlan = result.scalar_one_or_none()
    if not vlan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VLAN não encontrada")

    await db.delete(vlan)
    await db.commit()
    return {"message": "VLAN removida com sucesso"}


# ─── Ports ───────────────────────────────────────────────────────────────────

@router.get("/{device_id}/ports", response_model=List[PortResponse])
async def list_ports(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista portas de um dispositivo."""
    result = await db.execute(
        select(DevicePort).where(DevicePort.device_id == device_id)
        .order_by(DevicePort.port_name)
    )
    return result.scalars().all()


@router.post("/{device_id}/ports", response_model=PortResponse, status_code=status.HTTP_201_CREATED)
async def create_port(
    device_id: str,
    port_data: PortCreate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Adiciona porta a um dispositivo."""
    device = await db.scalar(select(Device).where(Device.id == device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo não encontrado")

    port = DevicePort(device_id=device_id, **port_data.dict())
    db.add(port)
    await db.commit()
    await db.refresh(port)
    return port


@router.put("/{device_id}/ports/{port_id}", response_model=PortResponse)
async def update_port(
    device_id: str,
    port_id: str,
    port_data: PortCreate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza porta de um dispositivo."""
    result = await db.execute(
        select(DevicePort).where(DevicePort.id == port_id, DevicePort.device_id == device_id)
    )
    port = result.scalar_one_or_none()
    if not port:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Porta não encontrada")

    for field, value in port_data.dict().items():
        setattr(port, field, value)

    await db.commit()
    await db.refresh(port)
    return port


@router.delete("/{device_id}/ports/{port_id}")
async def delete_port(
    device_id: str,
    port_id: str,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove porta de um dispositivo."""
    result = await db.execute(
        select(DevicePort).where(DevicePort.id == port_id, DevicePort.device_id == device_id)
    )
    port = result.scalar_one_or_none()
    if not port:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Porta não encontrada")

    await db.delete(port)
    await db.commit()
    return {"message": "Porta removida com sucesso"}


# ─── Photos ──────────────────────────────────────────────────────────────────

@router.post("/{device_id}/photos")
async def upload_photo(
    device_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Faz upload de foto para um dispositivo."""
    device = await db.scalar(select(Device).where(Device.id == device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo não encontrado")

    # Validar tipo de arquivo
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipo de arquivo não permitido. Use: {', '.join(allowed_types)}"
        )

    # Verificar tamanho
    content = await file.read()
    if len(content) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Arquivo muito grande. Máximo: {settings.MAX_FILE_SIZE_MB}MB"
        )

    # Salvar arquivo
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"{uuid.uuid4()}.{ext}"
    upload_dir = os.path.join(settings.UPLOAD_DIR, "devices", device_id)
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, filename)

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # Registrar no banco
    photo = DevicePhoto(
        device_id=device_id,
        filename=filename,
        original_filename=file.filename,
        file_path=file_path,
        file_size=len(content),
        mime_type=file.content_type,
    )
    db.add(photo)

    # Atualizar URL principal se for a primeira foto
    photos_count = await db.scalar(
        select(func.count(DevicePhoto.id)).where(DevicePhoto.device_id == device_id)
    )
    if photos_count == 0:
        device.photo_url = f"/api/v1/devices/{device_id}/photos/{filename}"
        photo.is_primary = True

    await db.commit()
    await db.refresh(photo)

    return {
        "id": str(photo.id),
        "filename": filename,
        "url": f"/api/v1/devices/{device_id}/photos/{filename}",
        "size": len(content),
    }


@router.get("/{device_id}/photos")
async def list_photos(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista fotos de um dispositivo."""
    result = await db.execute(
        select(DevicePhoto).where(DevicePhoto.device_id == device_id)
        .order_by(DevicePhoto.is_primary.desc(), DevicePhoto.created_at.desc())
    )
    photos = result.scalars().all()
    return [
        {
            "id": str(p.id),
            "filename": p.filename,
            "original_filename": p.original_filename,
            "url": f"/api/v1/devices/{device_id}/photos/{p.filename}",
            "size": p.file_size,
            "is_primary": p.is_primary,
            "created_at": p.created_at,
        }
        for p in photos
    ]


@router.delete("/{device_id}/photos/{photo_id}")
async def delete_photo(
    device_id: str,
    photo_id: str,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove foto de um dispositivo."""
    result = await db.execute(
        select(DevicePhoto).where(DevicePhoto.id == photo_id, DevicePhoto.device_id == device_id)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Foto não encontrada")

    # Remover arquivo físico
    if os.path.exists(photo.file_path):
        os.remove(photo.file_path)

    await db.delete(photo)
    await db.commit()
    return {"message": "Foto removida com sucesso"}


# ─── Credentials ─────────────────────────────────────────────────────────────

@router.get("/{device_id}/credentials", response_model=List[CredentialResponse])
async def list_credentials(
    device_id: str,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista credenciais de um dispositivo (sem senhas)."""
    result = await db.execute(
        select(DeviceCredential).where(DeviceCredential.device_id == device_id)
    )
    return result.scalars().all()


@router.post("/{device_id}/credentials", response_model=CredentialResponse, status_code=status.HTTP_201_CREATED)
async def create_credential(
    device_id: str,
    cred_data: CredentialCreate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Adiciona credencial a um dispositivo."""
    device = await db.scalar(select(Device).where(Device.id == device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo não encontrado")

    cred = DeviceCredential(
        device_id=device_id,
        credential_type=cred_data.credential_type,
        username=cred_data.username,
        description=cred_data.description,
    )

    if cred_data.password:
        cred.password_encrypted = encrypt_field(cred_data.password)
    if cred_data.community_string:
        cred.community_string_encrypted = encrypt_field(cred_data.community_string)
    if cred_data.api_key:
        cred.api_key_encrypted = encrypt_field(cred_data.api_key)

    db.add(cred)
    await db.commit()
    await db.refresh(cred)
    return cred


@router.delete("/{device_id}/credentials/{cred_id}")
async def delete_credential(
    device_id: str,
    cred_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove credencial de um dispositivo."""
    result = await db.execute(
        select(DeviceCredential).where(
            DeviceCredential.id == cred_id,
            DeviceCredential.device_id == device_id
        )
    )
    cred = result.scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credencial não encontrada")

    await db.delete(cred)
    await db.commit()
    return {"message": "Credencial removida com sucesso"}


class CheckStatusRequest(BaseModel):
    device_ids: Optional[List[str]] = None


@router.post("/{device_id}/check-status")
async def check_single_device_status(
    device_id: str,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Verifica o status de um dispositivo específico via TCP connect."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo não encontrado")

    from app.core.scheduler import check_device_reachable

    ip = device.management_ip
    ports_to_try = []
    if device.ssh_port and device.ssh_port > 0:
        ports_to_try.append(device.ssh_port)
    if device.telnet_port and device.telnet_port > 0:
        ports_to_try.append(device.telnet_port)
    if device.winbox_port:
        ports_to_try.append(device.winbox_port)
    if device.http_port:
        ports_to_try.append(device.http_port)
    if device.https_port:
        ports_to_try.append(device.https_port)
    if not ports_to_try:
        ports_to_try = [22, 23, 80, 443, 8291]
    ports_to_try = list(set(ports_to_try))

    # Usa ICMP ping primeiro, TCP como fallback
    new_status = DeviceStatus.OFFLINE
    try:
        is_reachable = await asyncio.wait_for(
            check_device_reachable(ip, ports_to_try),
            timeout=12.0
        )
        if is_reachable:
            new_status = DeviceStatus.ONLINE
    except Exception:
        pass

    old_status = device.status
    device.status = new_status
    device.last_seen = datetime.now(timezone.utc) if new_status == DeviceStatus.ONLINE else device.last_seen
    await db.commit()

    return {
        "id": str(device.id),
        "name": device.name,
        "ip": device.management_ip,
        "old_status": old_status.value,
        "new_status": new_status.value,
        "changed": old_status != new_status,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
    }


@router.post("/check-status")
async def check_devices_status(
    body: Optional[CheckStatusRequest] = None,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Verifica o status dos dispositivos via ICMP + TCP connect e atualiza no banco."""
    
    # Se não especificar IDs, verifica todos (exceto em manutenção)
    device_ids = body.device_ids if body else None
    query = select(Device).where(Device.status != DeviceStatus.MAINTENANCE)
    if device_ids:
        query = select(Device).where(Device.id.in_(device_ids))
    
    result = await db.execute(query)
    devices = result.scalars().all()
    
    from app.core.scheduler import check_device_reachable

    async def check_device(device: Device) -> DeviceStatus:
        """Verifica dispositivo via ICMP ping + TCP connect em paralelo."""
        ip = device.management_ip
        ports_to_try = []
        if device.ssh_port and device.ssh_port > 0:
            ports_to_try.append(device.ssh_port)
        if device.telnet_port and device.telnet_port > 0:
            ports_to_try.append(device.telnet_port)
        if device.winbox_port:
            ports_to_try.append(device.winbox_port)
        if device.http_port:
            ports_to_try.append(device.http_port)
        if device.https_port:
            ports_to_try.append(device.https_port)
        if not ports_to_try:
            ports_to_try = [22, 23, 80, 443, 8291]
        ports_to_try = list(set(ports_to_try))
        try:
            is_reachable = await asyncio.wait_for(
                check_device_reachable(ip, ports_to_try),
                timeout=12.0
            )
            return DeviceStatus.ONLINE if is_reachable else DeviceStatus.OFFLINE
        except Exception:
            return DeviceStatus.OFFLINE

    # Verifica todos os dispositivos em paralelo
    tasks = [check_device(device) for device in devices]
    statuses = await asyncio.gather(*tasks, return_exceptions=True)

    # Atualiza o status no banco e registra mudanças
    updated_count = 0
    changes = []
    for device, new_status in zip(devices, statuses):
        if isinstance(new_status, Exception):
            new_status = DeviceStatus.OFFLINE
        if device.status != new_status:
            old_status = device.status
            device.status = new_status
            if new_status == DeviceStatus.ONLINE:
                device.last_seen = datetime.now(timezone.utc)
            updated_count += 1
            changes.append({
                "id": str(device.id),
                "name": device.name,
                "ip": device.management_ip,
                "old_status": old_status.value,
                "new_status": new_status.value,
            })
        elif new_status == DeviceStatus.ONLINE:
            device.last_seen = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "message": f"Status verificado para {len(devices)} dispositivos",
        "checked": len(devices),
        "updated": updated_count,
        "changes": changes,
        "devices": [
            {"id": str(device.id), "name": device.name, "ip": device.management_ip, "status": device.status.value}
            for device in devices
        ]
    }


class PingRequest(BaseModel):
    target_ip: str
    port: Optional[int] = None
    timeout: Optional[int] = 3


@router.post("/{device_id}/ping")
async def ping_target(
    device_id: str,
    body: PingRequest,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Testa conectividade com um IP a partir do servidor (TCP connect nas portas comuns).
    Usado para validar rotas estáticas e next hops antes de salvar."""
    import time
    target = body.target_ip
    # Portas para testar (em ordem de prioridade)
    ports_to_try = [body.port] if body.port else [22, 23, 80, 443, 8291, 8080, 8443]
    timeout = body.timeout or 3

    for port in ports_to_try:
        try:
            start = time.monotonic()
            conn = _asyncio.open_connection(target, port)
            reader, writer = await _asyncio.wait_for(conn, timeout=timeout)
            latency_ms = round((time.monotonic() - start) * 1000, 1)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return {
                "target_ip": target,
                "reachable": True,
                "method": f"TCP:{port}",
                "latency_ms": latency_ms,
            }
        except Exception:
            continue

    return {
        "target_ip": target,
        "reachable": False,
        "method": "TCP",
        "error": f"Nenhuma porta respondeu ({', '.join(str(p) for p in ports_to_try)})",
    }

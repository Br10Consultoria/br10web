"""
BR10 NetManager - Device Schemas
Schemas Pydantic para dispositivos de rede.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from pydantic import BaseModel, Field, validator, field_serializer
import ipaddress


def validate_ip(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    try:
        ipaddress.ip_address(v)
        return v
    except ValueError:
        raise ValueError(f"Endereço IP inválido: {v}")


class VlanCreate(BaseModel):
    vlan_id: int = Field(..., ge=1, le=4094)
    name: Optional[str] = None
    description: Optional[str] = None
    ip_address: Optional[str] = None
    subnet_mask: Optional[str] = None
    gateway: Optional[str] = None
    is_management: bool = False
    is_active: bool = True


class VlanResponse(VlanCreate):
    id: UUID
    device_id: UUID

    @field_serializer('id', 'device_id')
    def serialize_uuid(self, v: UUID) -> str:
        return str(v)

    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PortCreate(BaseModel):
    port_name: str = Field(..., min_length=1, max_length=100)
    port_number: Optional[str] = None
    port_type: str = "ethernet"
    status: str = "unknown"
    speed_mbps: Optional[int] = None
    duplex: Optional[str] = None
    vlan_id: Optional[int] = None
    description: Optional[str] = None
    mac_address: Optional[str] = None
    ip_address: Optional[str] = None
    is_trunk: bool = False
    allowed_vlans: Optional[List[int]] = None
    connected_device: Optional[str] = None
    notes: Optional[str] = None


class PortResponse(PortCreate):
    id: UUID
    device_id: UUID

    @field_serializer('id', 'device_id')
    def serialize_uuid(self, v: UUID) -> str:
        return str(v)

    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CredentialCreate(BaseModel):
    credential_type: str = Field(..., description="ssh, telnet, snmp, api, web, winbox")
    username: Optional[str] = None
    password: Optional[str] = None
    community_string: Optional[str] = None
    api_key: Optional[str] = None
    description: Optional[str] = None


class CredentialResponse(BaseModel):
    id: UUID
    device_id: UUID

    @field_serializer('id', 'device_id')
    def serialize_uuid(self, v: UUID) -> str:
        return str(v)

    credential_type: str
    username: Optional[str]
    description: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class DeviceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    hostname: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    site: Optional[str] = None
    device_type: str
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    firmware_version: Optional[str] = None
    serial_number: Optional[str] = None

    management_ip: str
    management_port: Optional[int] = None
    primary_protocol: str = "ssh"

    username: Optional[str] = None
    password: Optional[str] = None
    enable_password: Optional[str] = None
    ssh_private_key: Optional[str] = None

    ssh_port: int = 22
    telnet_port: int = 23
    winbox_port: Optional[int] = 8291
    http_port: Optional[int] = 80
    https_port: Optional[int] = 443

    subnet_mask: Optional[str] = None
    gateway: Optional[str] = None
    dns_primary: Optional[str] = None
    dns_secondary: Optional[str] = None
    loopback_ip: Optional[str] = None

    tags: Optional[List[str]] = []
    custom_fields: Optional[Dict[str, Any]] = {}
    notes: Optional[str] = None

    @validator("management_ip")
    def validate_management_ip(cls, v):
        return validate_ip(v)


class DeviceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    hostname: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    site: Optional[str] = None
    device_type: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    firmware_version: Optional[str] = None
    serial_number: Optional[str] = None
    management_ip: Optional[str] = None
    management_port: Optional[int] = None
    primary_protocol: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    enable_password: Optional[str] = None
    ssh_port: Optional[int] = None
    telnet_port: Optional[int] = None
    winbox_port: Optional[int] = None
    http_port: Optional[int] = None
    https_port: Optional[int] = None
    subnet_mask: Optional[str] = None
    gateway: Optional[str] = None
    dns_primary: Optional[str] = None
    dns_secondary: Optional[str] = None
    loopback_ip: Optional[str] = None
    tags: Optional[List[str]] = None
    custom_fields: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    status: Optional[str] = None


class DeviceResponse(BaseModel):
    id: UUID
    name: str
    hostname: Optional[str]
    description: Optional[str]
    location: Optional[str]
    site: Optional[str]
    device_type: str
    status: str
    manufacturer: Optional[str]
    model: Optional[str]
    firmware_version: Optional[str]
    serial_number: Optional[str]
    management_ip: str
    management_port: Optional[int]
    primary_protocol: str
    username: Optional[str]
    ssh_port: int
    telnet_port: int
    winbox_port: Optional[int]
    http_port: Optional[int]
    https_port: Optional[int]
    subnet_mask: Optional[str]
    gateway: Optional[str]
    dns_primary: Optional[str]
    dns_secondary: Optional[str]
    loopback_ip: Optional[str]
    tags: Optional[List[str]]
    custom_fields: Optional[Dict[str, Any]]
    last_seen: Optional[datetime]
    last_backup: Optional[datetime]
    uptime_seconds: Optional[int]
    cpu_usage: Optional[float]
    memory_usage: Optional[float]
    photo_url: Optional[str]
    is_active: bool
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    vlans: Optional[List[VlanResponse]] = []
    ports: Optional[List[PortResponse]] = []

    @field_serializer('id')
    def serialize_id(self, v: UUID) -> str:
        return str(v)

    class Config:
        from_attributes = True


class DeviceListResponse(BaseModel):
    id: UUID
    name: str
    hostname: Optional[str]
    management_ip: str
    device_type: str
    status: str
    location: Optional[str]
    site: Optional[str]
    manufacturer: Optional[str]
    model: Optional[str]
    is_active: bool
    last_seen: Optional[datetime]
    photo_url: Optional[str]
    tags: Optional[List[str]]
    created_at: datetime

    @field_serializer('id')
    def serialize_id(self, v: UUID) -> str:
        return str(v)

    class Config:
        from_attributes = True

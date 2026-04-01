"""
BR10 NetManager - VPN Schemas
Schemas Pydantic para VPN L2TP e rotas estáticas.
"""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class StaticRouteCreate(BaseModel):
    destination_network: str = Field(..., description="Ex: 192.168.10.0/24")
    next_hop: str = Field(..., description="Ex: 10.0.0.1")
    interface: Optional[str] = None
    metric: int = Field(default=1, ge=1, le=255)
    description: Optional[str] = None
    is_active: bool = True
    is_persistent: bool = True


class StaticRouteUpdate(BaseModel):
    destination_network: Optional[str] = None
    next_hop: Optional[str] = None
    interface: Optional[str] = None
    metric: Optional[int] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    is_persistent: Optional[bool] = None


class StaticRouteResponse(BaseModel):
    id: str
    device_id: str
    vpn_config_id: Optional[str]
    destination_network: str
    next_hop: str
    interface: Optional[str]
    metric: int
    description: Optional[str]
    is_active: bool
    is_persistent: bool
    applied_at: Optional[datetime]
    last_verified: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VpnConfigCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    vpn_type: str = "l2tp"
    server_ip: str
    server_port: Optional[int] = 1701
    username: Optional[str] = None
    password: Optional[str] = None
    preshared_key: Optional[str] = None
    local_ip: Optional[str] = None
    remote_ip: Optional[str] = None
    local_subnet: Optional[str] = None
    remote_subnet: Optional[str] = None
    tunnel_ip: Optional[str] = None
    l2tp_secret: Optional[str] = None
    authentication_type: str = "chap"
    mtu: int = 1460
    mru: int = 1460
    ipsec_enabled: bool = False
    ipsec_encryption: str = "aes256"
    ipsec_hash: str = "sha256"
    ipsec_dh_group: str = "modp2048"
    auto_reconnect: bool = True
    keepalive_interval: int = 60
    static_routes: Optional[List[StaticRouteCreate]] = []


class VpnConfigUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    vpn_type: Optional[str] = None
    server_ip: Optional[str] = None
    server_port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    preshared_key: Optional[str] = None
    local_ip: Optional[str] = None
    remote_ip: Optional[str] = None
    local_subnet: Optional[str] = None
    remote_subnet: Optional[str] = None
    tunnel_ip: Optional[str] = None
    l2tp_secret: Optional[str] = None
    authentication_type: Optional[str] = None
    mtu: Optional[int] = None
    mru: Optional[int] = None
    ipsec_enabled: Optional[bool] = None
    ipsec_encryption: Optional[str] = None
    ipsec_hash: Optional[str] = None
    ipsec_dh_group: Optional[str] = None
    auto_reconnect: Optional[bool] = None
    keepalive_interval: Optional[int] = None
    is_active: Optional[bool] = None


class VpnConfigResponse(BaseModel):
    id: str
    device_id: str
    name: str
    description: Optional[str]
    vpn_type: str
    status: str
    server_ip: str
    server_port: Optional[int]
    username: Optional[str]
    local_ip: Optional[str]
    remote_ip: Optional[str]
    local_subnet: Optional[str]
    remote_subnet: Optional[str]
    tunnel_ip: Optional[str]
    authentication_type: str
    mtu: int
    mru: int
    ipsec_enabled: bool
    ipsec_encryption: str
    ipsec_hash: str
    ipsec_dh_group: str
    auto_reconnect: bool
    keepalive_interval: int
    is_active: bool
    connected_at: Optional[datetime]
    last_error: Optional[str]
    created_at: datetime
    updated_at: datetime
    static_routes: Optional[List[StaticRouteResponse]] = []

    class Config:
        from_attributes = True

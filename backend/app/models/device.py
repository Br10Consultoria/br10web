"""
BR10 NetManager - Device Model
Modelo completo de dispositivos de rede com suporte a múltiplos tipos.
"""
import enum
from sqlalchemy import (
    Boolean, Column, DateTime, Integer, String, Text, Float,
    Enum, ForeignKey, JSON
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class DeviceType(str, enum.Enum):
    HUAWEI_NE8000 = "huawei_ne8000"
    HUAWEI_6730 = "huawei_6730"
    DATACOM = "datacom"
    VSOL_OLT = "vsol_olt"
    MIKROTIK = "mikrotik"
    CISCO = "cisco"
    JUNIPER = "juniper"
    GENERIC_ROUTER = "generic_router"
    GENERIC_SWITCH = "generic_switch"
    GENERIC_OLT = "generic_olt"
    OTHER = "other"


class DeviceStatus(str, enum.Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    UNKNOWN = "unknown"
    MAINTENANCE = "maintenance"
    ALERT = "alert"


class ConnectionProtocol(str, enum.Enum):
    SSH = "ssh"
    TELNET = "telnet"
    WINBOX = "winbox"
    HTTP = "http"
    HTTPS = "https"
    CONSOLE = "console"


class Device(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "devices"

    # Identificação
    name = Column(String(255), nullable=False, index=True)
    hostname = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    location = Column(String(255), nullable=True)
    site = Column(String(255), nullable=True)

    # Tipo e Status
    device_type = Column(Enum(DeviceType), nullable=False, index=True)
    status = Column(Enum(DeviceStatus), default=DeviceStatus.UNKNOWN, nullable=False)
    manufacturer = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    firmware_version = Column(String(100), nullable=True)
    serial_number = Column(String(100), nullable=True)

    # Rede - Acesso Principal
    management_ip = Column(String(45), nullable=False, index=True)
    management_port = Column(Integer, nullable=True)
    primary_protocol = Column(Enum(ConnectionProtocol), default=ConnectionProtocol.SSH, nullable=False)

    # Credenciais (criptografadas)
    username = Column(String(100), nullable=True)
    password_encrypted = Column(Text, nullable=True)  # Fernet encrypted
    enable_password_encrypted = Column(Text, nullable=True)  # Enable/privileged password
    ssh_private_key_encrypted = Column(Text, nullable=True)  # SSH key

    # Portas de Acesso
    ssh_port = Column(Integer, default=22, nullable=False)
    telnet_port = Column(Integer, default=23, nullable=False)
    winbox_port = Column(Integer, default=8291, nullable=True)
    http_port = Column(Integer, default=80, nullable=True)
    https_port = Column(Integer, default=443, nullable=True)

    # Configuração de Rede
    subnet_mask = Column(String(45), nullable=True)
    gateway = Column(String(45), nullable=True)
    dns_primary = Column(String(45), nullable=True)
    dns_secondary = Column(String(45), nullable=True)
    loopback_ip = Column(String(45), nullable=True)

    # Tags e Metadados
    tags = Column(ARRAY(String), nullable=True, default=list)
    custom_fields = Column(JSON, nullable=True, default=dict)

    # Monitoramento
    last_seen = Column(DateTime(timezone=True), nullable=True)
    last_backup = Column(DateTime(timezone=True), nullable=True)
    uptime_seconds = Column(Integer, nullable=True)
    cpu_usage = Column(Float, nullable=True)
    memory_usage = Column(Float, nullable=True)

    # Imagens/Documentos
    photo_url = Column(String(500), nullable=True)

    # Controle
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)

    # Relationships
    vlans = relationship("DeviceVlan", back_populates="device", cascade="all, delete-orphan")
    ports = relationship("DevicePort", back_populates="device", cascade="all, delete-orphan")
    vpn_configs = relationship("VpnConfig", back_populates="device", cascade="all, delete-orphan")
    static_routes = relationship("StaticRoute", back_populates="device", cascade="all, delete-orphan")
    credentials = relationship("DeviceCredential", back_populates="device", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="device", lazy="dynamic")
    photos = relationship("DevicePhoto", back_populates="device", cascade="all, delete-orphan")
    backups = relationship("DeviceBackup", back_populates="device", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Device {self.name} ({self.management_ip})>"


class DeviceVlan(Base, UUIDMixin, TimestampMixin):
    """VLANs configuradas em um dispositivo."""
    __tablename__ = "device_vlans"

    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    vlan_id = Column(Integer, nullable=False)
    name = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    subnet_mask = Column(String(45), nullable=True)
    gateway = Column(String(45), nullable=True)
    is_management = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    device = relationship("Device", back_populates="vlans")

    def __repr__(self):
        return f"<VLAN {self.vlan_id} on {self.device_id}>"


class PortType(str, enum.Enum):
    ETHERNET = "ethernet"
    FIBER = "fiber"
    SFP = "sfp"
    SFP_PLUS = "sfp+"
    QSFP = "qsfp"
    GPON = "gpon"
    XGPON = "xgpon"
    SERIAL = "serial"
    MANAGEMENT = "management"
    OTHER = "other"


class PortStatus(str, enum.Enum):
    UP = "up"
    DOWN = "down"
    ADMIN_DOWN = "admin_down"
    UNKNOWN = "unknown"


class DevicePort(Base, UUIDMixin, TimestampMixin):
    """Portas físicas e lógicas de um dispositivo."""
    __tablename__ = "device_ports"

    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    port_name = Column(String(100), nullable=False)
    port_number = Column(String(50), nullable=True)
    port_type = Column(Enum(PortType), default=PortType.ETHERNET, nullable=False)
    status = Column(Enum(PortStatus), default=PortStatus.UNKNOWN, nullable=False)
    speed_mbps = Column(Integer, nullable=True)
    duplex = Column(String(20), nullable=True)
    vlan_id = Column(Integer, nullable=True)
    description = Column(Text, nullable=True)
    mac_address = Column(String(17), nullable=True)
    ip_address = Column(String(45), nullable=True)
    is_trunk = Column(Boolean, default=False)
    allowed_vlans = Column(ARRAY(Integer), nullable=True)
    connected_device = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)

    device = relationship("Device", back_populates="ports")


class DeviceCredential(Base, UUIDMixin, TimestampMixin):
    """Credenciais adicionais de acesso ao dispositivo."""
    __tablename__ = "device_credentials"

    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    credential_type = Column(String(50), nullable=False)  # ssh, telnet, snmp, api, web
    username = Column(String(100), nullable=True)
    password_encrypted = Column(Text, nullable=True)
    community_string_encrypted = Column(Text, nullable=True)  # SNMP
    api_key_encrypted = Column(Text, nullable=True)
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)

    device = relationship("Device", back_populates="credentials")


class DevicePhoto(Base, UUIDMixin, TimestampMixin):
    """Fotos e documentos associados ao dispositivo."""
    __tablename__ = "device_photos"

    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    is_primary = Column(Boolean, default=False)

    device = relationship("Device", back_populates="photos")


class DeviceBackup(Base, UUIDMixin, TimestampMixin):
    """Backups de configuração dos dispositivos."""
    __tablename__ = "device_backups"

    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    backup_type = Column(String(50), default="manual")  # manual, scheduled, pre-change
    status = Column(String(50), default="success")
    notes = Column(Text, nullable=True)
    config_hash = Column(String(64), nullable=True)  # SHA256 for change detection

    device = relationship("Device", back_populates="backups")

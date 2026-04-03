"""
BR10 NetManager - Client & Vendor Models
Modelos para gerenciamento de clientes e grupos de vendors/equipamentos.
"""
import enum
from sqlalchemy import Boolean, Column, String, Text, Integer, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, UUIDMixin


class DeviceGroupType(str, enum.Enum):
    ROUTER = "router"
    SWITCH = "switch"
    OLT = "olt"
    ONU = "onu"
    FIREWALL = "firewall"
    SERVER = "server"
    ACCESS_POINT = "access_point"
    OTHER = "other"


class Client(Base, UUIDMixin, TimestampMixin):
    """Representa um cliente de consultoria."""
    __tablename__ = "clients"

    name = Column(String(255), nullable=False, index=True, unique=True)
    short_name = Column(String(50), nullable=True)
    document = Column(String(20), nullable=True)          # CNPJ/CPF
    email = Column(String(255), nullable=True)
    phone = Column(String(30), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(2), nullable=True)
    contact_name = Column(String(255), nullable=True)     # Nome do responsável técnico
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(30), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    devices = relationship("Device", back_populates="client", lazy="noload")

    def __repr__(self):
        return f"<Client {self.name}>"


class VendorGroup(Base, UUIDMixin, TimestampMixin):
    """Grupo de equipamentos por categoria (Roteadores, Switches, OLTs, etc.)."""
    __tablename__ = "vendor_groups"

    name = Column(String(100), nullable=False, index=True, unique=True)
    group_type = Column(Enum(DeviceGroupType), nullable=False, index=True)
    description = Column(Text, nullable=True)
    icon = Column(String(50), nullable=True)              # Nome do ícone Lucide
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    vendors = relationship("Vendor", back_populates="group", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<VendorGroup {self.name}>"


class Vendor(Base, UUIDMixin, TimestampMixin):
    """Fabricante/Vendor dentro de um grupo (ex: Huawei, ZTE, Mikrotik)."""
    __tablename__ = "vendors"

    group_id = Column(UUID(as_uuid=True), ForeignKey("vendor_groups.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    website = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    group = relationship("VendorGroup", back_populates="vendors")
    models = relationship("VendorModel", back_populates="vendor", cascade="all, delete-orphan")
    devices = relationship("Device", back_populates="vendor", lazy="noload")

    def __repr__(self):
        return f"<Vendor {self.name}>"


class VendorModel(Base, UUIDMixin, TimestampMixin):
    """Modelo específico de equipamento (ex: NE8000, CX600, CCR1036)."""
    __tablename__ = "vendor_models"

    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    default_ssh_port = Column(Integer, default=22, nullable=True)
    default_telnet_port = Column(Integer, default=23, nullable=True)
    default_http_port = Column(Integer, nullable=True)
    default_https_port = Column(Integer, nullable=True)
    default_winbox_port = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    vendor = relationship("Vendor", back_populates="models")
    devices = relationship("Device", back_populates="vendor_model", lazy="noload")

    def __repr__(self):
        return f"<VendorModel {self.name}>"

"""
BR10 NetManager - VPN and Static Routes Models
Modelos para VPN L2TP e rotas estáticas associadas.
"""
import enum
from sqlalchemy import Boolean, Column, Integer, String, Text, Enum, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class VpnType(str, enum.Enum):
    L2TP = "l2tp"
    L2TP_IPSEC = "l2tp_ipsec"
    PPTP = "pptp"
    SSTP = "sstp"
    OPENVPN = "openvpn"
    WIREGUARD = "wireguard"
    IPSEC = "ipsec"


class VpnStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    CONNECTING = "connecting"
    ERROR = "error"
    DISABLED = "disabled"


class VpnConfig(Base, UUIDMixin, TimestampMixin):
    """Configuração de VPN para um dispositivo."""
    __tablename__ = "vpn_configs"

    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)

    # Identificação
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    vpn_type = Column(Enum(VpnType), default=VpnType.L2TP, nullable=False)
    status = Column(Enum(VpnStatus), default=VpnStatus.INACTIVE, nullable=False)

    # Servidor VPN
    server_ip = Column(String(45), nullable=False)
    server_port = Column(Integer, default=1701, nullable=True)

    # Credenciais (criptografadas)
    username = Column(String(100), nullable=True)
    password_encrypted = Column(Text, nullable=True)
    preshared_key_encrypted = Column(Text, nullable=True)  # L2TP/IPSec PSK

    # Endereçamento
    local_ip = Column(String(45), nullable=True)
    remote_ip = Column(String(45), nullable=True)
    local_subnet = Column(String(50), nullable=True)
    remote_subnet = Column(String(50), nullable=True)
    tunnel_ip = Column(String(45), nullable=True)

    # Configurações L2TP específicas
    l2tp_secret = Column(Text, nullable=True)
    authentication_type = Column(String(50), default="chap")  # chap, pap, mschapv2
    mtu = Column(Integer, default=1460)
    mru = Column(Integer, default=1460)

    # IPSec (quando L2TP/IPSec)
    ipsec_enabled = Column(Boolean, default=False)
    ipsec_encryption = Column(String(50), default="aes256")
    ipsec_hash = Column(String(50), default="sha256")
    ipsec_dh_group = Column(String(50), default="modp2048")

    # Controle
    auto_reconnect = Column(Boolean, default=True)
    keepalive_interval = Column(Integer, default=60)
    is_active = Column(Boolean, default=True)
    connected_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)

    # Relationships
    device = relationship("Device", back_populates="vpn_configs")
    static_routes = relationship("StaticRoute", back_populates="vpn_config", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<VPN {self.name} ({self.vpn_type}) on device {self.device_id}>"


class StaticRoute(Base, UUIDMixin, TimestampMixin):
    """Rotas estáticas associadas a um dispositivo ou VPN."""
    __tablename__ = "static_routes"

    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    vpn_config_id = Column(UUID(as_uuid=True), ForeignKey("vpn_configs.id", ondelete="SET NULL"), nullable=True)

    # Rota
    destination_network = Column(String(50), nullable=False)  # ex: 192.168.10.0/24
    next_hop = Column(String(45), nullable=False)             # ex: 10.0.0.1
    interface = Column(String(100), nullable=True)             # ex: ppp0, eth0
    metric = Column(Integer, default=1, nullable=False)
    description = Column(Text, nullable=True)

    # Controle
    is_active = Column(Boolean, default=True, nullable=False)
    is_persistent = Column(Boolean, default=True, nullable=False)
    applied_at = Column(DateTime(timezone=True), nullable=True)
    last_verified = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    device = relationship("Device", back_populates="static_routes")
    vpn_config = relationship("VpnConfig", back_populates="static_routes")

    def __repr__(self):
        return f"<Route {self.destination_network} via {self.next_hop}>"

"""
Modelos para monitoramento SNMP de dispositivos de rede.

Tabelas:
  - snmp_targets    : dispositivos configurados para polling SNMP
  - snmp_metrics    : série temporal de métricas coletadas
  - snmp_alerts     : alertas gerados por thresholds
  - snmp_netconf_log: log de ações de gestão via NETCONF/SSH
"""
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float,
    ForeignKey, Index, UniqueConstraint, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from .base import Base, UUIDMixin, TimestampMixin
import enum


class SnmpVersion(str, enum.Enum):
    V2C = "v2c"
    V3  = "v3"


class MetricType(str, enum.Enum):
    CPU_USAGE        = "cpu_usage"        # %
    MEMORY_USAGE     = "memory_usage"     # %
    MEMORY_USED_MB   = "memory_used_mb"   # MB
    MEMORY_TOTAL_MB  = "memory_total_mb"  # MB
    UPTIME_SECONDS   = "uptime_seconds"   # s
    IF_OPER_STATUS   = "if_oper_status"   # 1=up, 2=down
    IF_IN_BPS        = "if_in_bps"        # bps
    IF_OUT_BPS       = "if_out_bps"       # bps
    IF_IN_ERRORS     = "if_in_errors"     # counter
    IF_OUT_ERRORS    = "if_out_errors"    # counter
    BGP_PEER_STATE   = "bgp_peer_state"   # 1-6 (idle/connect/active/opensent/openconfirm/established)
    BGP_PEER_PREFIXES = "bgp_peer_prefixes" # prefixos recebidos


class AlertSeverity(str, enum.Enum):
    INFO     = "info"
    WARNING  = "warning"
    CRITICAL = "critical"


class NetconfActionType(str, enum.Enum):
    IF_ENABLE   = "if_enable"
    IF_DISABLE  = "if_disable"
    BGP_ENABLE  = "bgp_enable"
    BGP_DISABLE = "bgp_disable"
    BGP_CREATE  = "bgp_create"
    BGP_REMOVE  = "bgp_remove"


# ─── SnmpTarget ───────────────────────────────────────────────────────────────

class SnmpTarget(Base, UUIDMixin, TimestampMixin):
    """Dispositivo configurado para polling SNMP."""
    __tablename__ = "snmp_targets"

    device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name            = Column(String(150), nullable=False)
    host            = Column(String(255), nullable=False)   # IP ou hostname
    port            = Column(Integer, default=161)
    snmp_version    = Column(
        SAEnum(SnmpVersion, native_enum=False, length=10),
        default=SnmpVersion.V2C,
        nullable=False,
    )
    # SNMPv2c
    community_encrypted = Column(Text, nullable=True)       # criptografado com Fernet

    # SNMPv3 (para uso futuro)
    snmp_user       = Column(String(100), nullable=True)
    auth_protocol   = Column(String(20), nullable=True)     # MD5, SHA
    auth_key_encrypted = Column(Text, nullable=True)
    priv_protocol   = Column(String(20), nullable=True)     # DES, AES
    priv_key_encrypted = Column(Text, nullable=True)

    # Configuração de coleta
    poll_interval   = Column(Integer, default=300)          # segundos (padrão 5 min)
    active          = Column(Boolean, default=True)
    collect_interfaces = Column(Boolean, default=True)
    collect_bgp     = Column(Boolean, default=True)
    collect_cpu     = Column(Boolean, default=True)
    collect_memory  = Column(Boolean, default=True)

    # Thresholds para alertas
    cpu_threshold   = Column(Float, nullable=True)          # % — alerta acima disso
    memory_threshold = Column(Float, nullable=True)         # % — alerta acima disso

    # Estado atual (cache do último poll)
    last_polled_at  = Column(Text, nullable=True)           # ISO datetime string
    last_status     = Column(String(20), nullable=True)     # ok, error, timeout
    last_error      = Column(Text, nullable=True)

    # Metadados do dispositivo (coletados via sysDescr, sysName)
    sys_name        = Column(String(255), nullable=True)
    sys_descr       = Column(Text, nullable=True)
    sys_contact     = Column(String(255), nullable=True)
    sys_location    = Column(String(255), nullable=True)

    # Relacionamentos
    metrics  = relationship("SnmpMetric",     back_populates="target", cascade="all, delete-orphan")
    alerts   = relationship("SnmpAlert",      back_populates="target", cascade="all, delete-orphan")
    nc_logs  = relationship("NetconfActionLog", back_populates="target", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("host", "port", name="uq_snmp_target_host_port"),
    )


# ─── SnmpMetric ───────────────────────────────────────────────────────────────

class SnmpMetric(Base, UUIDMixin, TimestampMixin):
    """Série temporal de métricas coletadas via SNMP."""
    __tablename__ = "snmp_metrics"

    target_id   = Column(
        UUID(as_uuid=True),
        ForeignKey("snmp_targets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    metric_type = Column(
        SAEnum(MetricType, native_enum=False, length=30),
        nullable=False,
    )
    # Identificador do objeto (ex: nome da interface, IP do peer BGP)
    object_id   = Column(String(255), nullable=True)
    object_name = Column(String(255), nullable=True)

    value_float = Column(Float,   nullable=True)   # métricas numéricas
    value_int   = Column(Integer, nullable=True)   # contadores, status
    value_str   = Column(String(255), nullable=True)  # strings

    # Relacionamentos
    target = relationship("SnmpTarget", back_populates="metrics")

    __table_args__ = (
        Index("ix_snmp_metrics_target_type_time",
              "target_id", "metric_type", "created_at"),
        Index("ix_snmp_metrics_target_object_time",
              "target_id", "object_id", "created_at"),
    )


# ─── SnmpAlert ────────────────────────────────────────────────────────────────

class SnmpAlert(Base, UUIDMixin, TimestampMixin):
    """Alertas gerados quando uma métrica ultrapassa o threshold."""
    __tablename__ = "snmp_alerts"

    target_id   = Column(
        UUID(as_uuid=True),
        ForeignKey("snmp_targets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    severity    = Column(
        SAEnum(AlertSeverity, native_enum=False, length=20),
        nullable=False,
    )
    metric_type = Column(String(30), nullable=False)
    object_id   = Column(String(255), nullable=True)
    object_name = Column(String(255), nullable=True)
    message     = Column(Text, nullable=False)
    value       = Column(Float, nullable=True)
    threshold   = Column(Float, nullable=True)
    acknowledged = Column(Boolean, default=False)
    resolved    = Column(Boolean, default=False)
    resolved_at = Column(Text, nullable=True)

    target = relationship("SnmpTarget", back_populates="alerts")

    __table_args__ = (
        Index("ix_snmp_alerts_target_resolved", "target_id", "resolved"),
    )


# ─── NetconfActionLog ─────────────────────────────────────────────────────────

class NetconfActionLog(Base, UUIDMixin, TimestampMixin):
    """Log de ações de gestão executadas via NETCONF/SSH no dispositivo."""
    __tablename__ = "snmp_netconf_logs"

    target_id   = Column(
        UUID(as_uuid=True),
        ForeignKey("snmp_targets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id     = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action_type = Column(
        SAEnum(NetconfActionType, native_enum=False, length=30),
        nullable=False,
    )
    object_id   = Column(String(255), nullable=True)   # interface ou peer BGP
    object_name = Column(String(255), nullable=True)
    parameters  = Column(JSONB, nullable=True)          # parâmetros da ação
    status      = Column(String(20), nullable=False)    # success, error
    output      = Column(Text, nullable=True)           # saída do comando
    error       = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=True)

    target = relationship("SnmpTarget", back_populates="nc_logs")

    __table_args__ = (
        Index("ix_snmp_netconf_logs_target_time", "target_id", "created_at"),
    )

"""
BR10 NetManager - Vulnerability Scanner Models

Tabelas:
  - vuln_scans    : varreduras executadas (Nmap ou OpenVAS)
  - vuln_findings : vulnerabilidades/portas encontradas por varredura
"""
from sqlalchemy import (
    Column, String, Text, Integer, Float,
    ForeignKey, Index, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from .base import Base, UUIDMixin, TimestampMixin
import enum


class ScannerType(str, enum.Enum):
    NMAP    = "nmap"
    OPENVAS = "openvas"


class ScanStatus(str, enum.Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    CANCELLED = "cancelled"


class FindingSeverity(str, enum.Enum):
    INFO     = "info"
    LOW      = "low"
    MEDIUM   = "medium"
    HIGH     = "high"
    CRITICAL = "critical"


# ─── VulnScan ─────────────────────────────────────────────────────────────────

class VulnScan(Base, UUIDMixin, TimestampMixin):
    """Registro de uma varredura de vulnerabilidades."""
    __tablename__ = "vuln_scans"

    name        = Column(String(200), nullable=False)
    target      = Column(String(500), nullable=False)   # IP, range CIDR ou hostname
    scanner     = Column(SAEnum(ScannerType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ScannerType.NMAP)
    status      = Column(SAEnum(ScanStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ScanStatus.PENDING)

    # Opções de varredura
    scan_options = Column(JSONB, nullable=True)          # ex: {"ports": "1-1000", "timing": "T4"}

    # Resultados resumidos
    hosts_up    = Column(Integer, nullable=True)
    hosts_down  = Column(Integer, nullable=True)
    total_findings = Column(Integer, nullable=True, default=0)

    # Saída bruta e erros
    raw_output  = Column(Text, nullable=True)
    error_msg   = Column(Text, nullable=True)

    # Duração em segundos
    duration_s  = Column(Float, nullable=True)

    # Usuário que iniciou
    started_by  = Column(String(200), nullable=True)

    # Relacionamentos
    findings = relationship("VulnFinding", back_populates="scan",
                            cascade="all, delete-orphan", lazy="dynamic")

    __table_args__ = (
        Index("ix_vuln_scans_status", "status"),
        Index("ix_vuln_scans_scanner", "scanner"),
        Index("ix_vuln_scans_created_at", "created_at"),
    )


# ─── VulnFinding ──────────────────────────────────────────────────────────────

class VulnFinding(Base, UUIDMixin, TimestampMixin):
    """Vulnerabilidade ou porta encontrada em uma varredura."""
    __tablename__ = "vuln_findings"

    scan_id     = Column(UUID(as_uuid=True), ForeignKey("vuln_scans.id", ondelete="CASCADE"),
                         nullable=False, index=True)

    host        = Column(String(100), nullable=False)   # IP do host
    hostname    = Column(String(300), nullable=True)

    # Porta / serviço
    port        = Column(Integer, nullable=True)
    protocol    = Column(String(10), nullable=True)     # tcp / udp
    service     = Column(String(100), nullable=True)    # http, ssh, etc.
    service_version = Column(String(300), nullable=True)
    port_state  = Column(String(20), nullable=True)     # open, closed, filtered

    # Vulnerabilidade
    vuln_id     = Column(String(100), nullable=True)    # CVE-XXXX ou OID OpenVAS
    title       = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    severity    = Column(SAEnum(FindingSeverity, values_callable=lambda x: [e.value for e in x]), nullable=True, default=FindingSeverity.INFO)
    cvss_score  = Column(Float, nullable=True)
    solution    = Column(Text, nullable=True)

    # Dados extras (JSON livre)
    extra       = Column(JSONB, nullable=True)

    # Relacionamento
    scan = relationship("VulnScan", back_populates="findings")

    __table_args__ = (
        Index("ix_vuln_findings_scan_id", "scan_id"),
        Index("ix_vuln_findings_host", "host"),
        Index("ix_vuln_findings_severity", "severity"),
    )

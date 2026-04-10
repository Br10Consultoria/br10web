"""
BR10 NetManager - Modelo de Monitoramento RPKI

Tabelas:
  rpki_monitors   — ASNs/prefixos cadastrados para monitoramento contínuo
  rpki_checks     — Histórico de verificações (automáticas e manuais)
"""
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Text, JSON,
    ForeignKey, Index
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.models.base import Base


class RpkiMonitor(Base):
    """
    Registro de um ASN/prefixo para monitoramento RPKI contínuo.
    Um monitor pode ter múltiplos prefixos associados a um ASN,
    ou um único prefixo sem ASN (buscado automaticamente via RIPE).
    """
    __tablename__ = "rpki_monitors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Identificação
    name = Column(String(200), nullable=False)          # Nome amigável ex: "Bloco principal AS12345"
    description = Column(Text, nullable=True)

    # ASN e prefixo
    asn = Column(Integer, nullable=True)                # ex: 12345 (sem "AS")
    prefix = Column(String(50), nullable=False)         # ex: "177.75.0.0/20"

    # Estado atual (atualizado a cada verificação)
    last_status = Column(String(20), nullable=True)     # valid | invalid | not-found | unknown | error
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_roas = Column(JSON, nullable=True)             # lista de ROAs retornados
    last_origin_asns = Column(JSON, nullable=True)      # ASNs de origem detectados
    last_country = Column(String(10), nullable=True)
    last_rir = Column(String(20), nullable=True)
    last_error = Column(Text, nullable=True)            # mensagem de erro se houver

    # Configuração
    active = Column(Boolean, default=True, nullable=False)
    alert_on_invalid = Column(Boolean, default=True, nullable=False)   # alertar se inválido
    alert_on_not_found = Column(Boolean, default=False, nullable=False) # alertar se não encontrado

    # Auditoria
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_rpki_monitors_prefix", "prefix"),
        Index("ix_rpki_monitors_asn", "asn"),
        Index("ix_rpki_monitors_active", "active"),
    )


class RpkiCheck(Base):
    """
    Histórico de verificações RPKI — uma entrada por verificação de cada monitor.
    """
    __tablename__ = "rpki_checks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    monitor_id = Column(UUID(as_uuid=True), ForeignKey("rpki_monitors.id", ondelete="CASCADE"), nullable=False, index=True)

    # Resultado
    status = Column(String(20), nullable=False)         # valid | invalid | not-found | unknown | error
    prefix_checked = Column(String(50), nullable=False)
    asn_used = Column(Integer, nullable=True)
    roas = Column(JSON, nullable=True)
    origin_asns = Column(JSON, nullable=True)
    country = Column(String(10), nullable=True)
    rir = Column(String(20), nullable=True)
    sources_checked = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)

    # Metadados
    trigger_type = Column(String(20), default="scheduled")  # scheduled | manual
    triggered_by = Column(UUID(as_uuid=True), nullable=True)  # user_id se manual
    duration_ms = Column(Integer, nullable=True)

    checked_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        Index("ix_rpki_checks_monitor_checked", "monitor_id", "checked_at"),
    )

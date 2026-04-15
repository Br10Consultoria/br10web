"""
BR10 NetManager - Modelo de Monitoramento de Blacklist / Reputação IP

Tabelas:
  system_api_keys        — chaves de API de serviços externos (MxToolbox, etc.)
  blacklist_monitors     — IPs/prefixos cadastrados para monitoramento de blacklist
  blacklist_checks       — Histórico de verificações (automáticas e manuais)
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


class SystemApiKey(Base):
    """
    Armazena chaves de API de serviços externos de forma criptografada.
    Permite que o administrador configure tokens sem editar variáveis de ambiente.
    """
    __tablename__ = "system_api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    service = Column(String(50), nullable=False, unique=True)   # ex: "mxtoolbox", "shodan"
    label = Column(String(200), nullable=True)                  # ex: "MxToolbox API Key"
    api_key_encrypted = Column(Text, nullable=True)             # chave criptografada (Fernet)
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (
        Index("ix_system_api_keys_service", "service"),
    )


class BlacklistMonitor(Base):
    """
    Registro de um IP/prefixo/domínio para monitoramento contínuo de blacklist.
    Pode estar associado a um cliente ou ser genérico.
    """
    __tablename__ = "blacklist_monitors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Identificação
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)

    # Alvo da verificação
    target = Column(String(255), nullable=False)   # IP, CIDR ou domínio
    target_type = Column(String(20), default="ip") # ip | domain | asn

    # Associação com cliente (opcional)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    client_name = Column(String(255), nullable=True)  # cache do nome do cliente

    # Estado atual (atualizado a cada verificação)
    last_status = Column(String(20), nullable=True)    # clean | listed | error | unknown
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_listed_count = Column(Integer, default=0)     # quantas blacklists listaram o IP
    last_checked_count = Column(Integer, default=0)    # total de blacklists verificadas
    last_blacklists = Column(JSON, nullable=True)      # lista de blacklists onde está listado
    last_error = Column(Text, nullable=True)

    # Configuração
    active = Column(Boolean, default=True, nullable=False)
    alert_on_listed = Column(Boolean, default=True, nullable=False)

    # Auditoria
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_blacklist_monitors_target", "target"),
        Index("ix_blacklist_monitors_client", "client_id"),
        Index("ix_blacklist_monitors_active", "active"),
    )


class BlacklistCheck(Base):
    """
    Histórico de verificações de blacklist — uma entrada por verificação.
    """
    __tablename__ = "blacklist_checks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    monitor_id = Column(UUID(as_uuid=True), ForeignKey("blacklist_monitors.id", ondelete="CASCADE"), nullable=True, index=True)

    # Alvo (para consultas manuais sem monitor cadastrado)
    target = Column(String(255), nullable=False)
    target_type = Column(String(20), default="ip")

    # Resultado
    status = Column(String(20), nullable=False)        # clean | listed | error | unknown
    listed_count = Column(Integer, default=0)
    checked_count = Column(Integer, default=0)
    blacklists_found = Column(JSON, nullable=True)     # lista de blacklists onde está listado
    all_results = Column(JSON, nullable=True)          # resultado completo da API
    error_message = Column(Text, nullable=True)

    # Metadados
    trigger_type = Column(String(20), default="scheduled")  # scheduled | manual
    triggered_by = Column(UUID(as_uuid=True), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    api_used = Column(String(50), default="mxtoolbox")

    checked_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        Index("ix_blacklist_checks_monitor_checked", "monitor_id", "checked_at"),
        Index("ix_blacklist_checks_target", "target"),
    )

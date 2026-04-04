"""
BR10 NetManager - Modelos de Automação
Biblioteca de comandos por vendor e histórico de execuções.
"""
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Integer, Boolean, DateTime,
    ForeignKey, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.models.base import Base


class CommandCategory(str, enum.Enum):
    DIAGNOSTICS   = "diagnostics"    # show, display, ping, traceroute
    CONFIGURATION = "configuration"  # set, configure
    BACKUP        = "backup"         # copy, backup
    MONITORING    = "monitoring"     # cpu, memory, interfaces
    ROUTING       = "routing"        # bgp, ospf, routes
    OPTICAL       = "optical"        # OLT, ONU, PON
    SECURITY      = "security"       # acl, firewall
    OTHER         = "other"


class ExecutionStatus(str, enum.Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    SUCCESS   = "success"
    ERROR     = "error"
    TIMEOUT   = "timeout"


class CommandTemplate(Base):
    """
    Biblioteca de comandos reutilizáveis por vendor/fabricante.
    Cada template define um comando que pode ser executado em
    dispositivos do vendor correspondente.
    """
    __tablename__ = "command_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Identificação
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category    = Column(SAEnum(CommandCategory), default=CommandCategory.DIAGNOSTICS, nullable=False)

    # Comando(s) — pode ser uma linha ou múltiplas separadas por \n
    command     = Column(Text, nullable=False)

    # Filtro por vendor (NULL = compatível com qualquer vendor)
    vendor_id   = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True)
    vendor_name = Column(String(200), nullable=True)  # cache para exibição rápida

    # Metadados
    is_active   = Column(Boolean, default=True, nullable=False)
    is_global   = Column(Boolean, default=True, nullable=False)   # visível para todos os usuários
    timeout     = Column(Integer, default=30, nullable=False)     # segundos
    created_by  = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relacionamentos
    executions  = relationship("CommandExecution", back_populates="template",
                               cascade="all, delete-orphan", lazy="dynamic")
    creator     = relationship("User", foreign_keys=[created_by])

    def __repr__(self):
        return f"<CommandTemplate {self.name}>"


class CommandExecution(Base):
    """
    Histórico de execuções de comandos em dispositivos.
    Registra quem executou, quando, em qual dispositivo e qual foi o resultado.
    """
    __tablename__ = "command_executions"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Referências
    template_id = Column(UUID(as_uuid=True), ForeignKey("command_templates.id", ondelete="SET NULL"), nullable=True, index=True)
    device_id   = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Cache de nomes para exibição no histórico mesmo após deleção
    template_name = Column(String(200), nullable=True)
    device_name   = Column(String(200), nullable=True)
    device_ip     = Column(String(45), nullable=True)
    username      = Column(String(100), nullable=True)

    # Comando executado (pode ter sido editado ad-hoc)
    command       = Column(Text, nullable=False)
    protocol      = Column(String(10), default="ssh", nullable=False)  # ssh | telnet

    # Resultado
    status        = Column(SAEnum(ExecutionStatus), default=ExecutionStatus.PENDING, nullable=False)
    output        = Column(Text, nullable=True)       # saída completa do comando
    error_message = Column(Text, nullable=True)
    duration_ms   = Column(Integer, nullable=True)    # duração em milissegundos

    # Timestamps
    started_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at   = Column(DateTime(timezone=True), nullable=True)

    # Relacionamentos
    template = relationship("CommandTemplate", back_populates="executions")
    device   = relationship("Device", foreign_keys=[device_id])
    user     = relationship("User", foreign_keys=[user_id])

    def __repr__(self):
        return f"<CommandExecution {self.device_name} - {self.status}>"

"""
BR10 NetManager - Modelo de Agendamento de Backup de Dispositivos

Tabelas:
  backup_schedules  — agendamentos cron vinculados a um playbook + lista de dispositivos
  backup_executions — histórico de execuções com logs e status por dispositivo
"""
from datetime import datetime
from typing import Optional, List
import json

from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime,
    ForeignKey, Text, JSON, Enum as SAEnum,
)
from sqlalchemy.orm import relationship
import enum

from app.models.base import Base


class BackupScheduleStatus(str, enum.Enum):
    ACTIVE   = "active"
    PAUSED   = "paused"
    DISABLED = "disabled"


class BackupRunStatus(str, enum.Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    SUCCESS   = "success"
    PARTIAL   = "partial"    # alguns dispositivos falharam
    FAILURE   = "failure"
    CANCELLED = "cancelled"


class BackupSchedule(Base):
    """Agendamento de backup: playbook + dispositivos + cron + Telegram."""
    __tablename__ = "backup_schedules"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)

    # Playbook a executar
    playbook_id   = Column(Integer, ForeignKey("playbooks.id", ondelete="SET NULL"), nullable=True)
    playbook_name = Column(String(200), nullable=True)  # cache para exibição

    # Dispositivos alvo (lista de IDs armazenada como JSON)
    device_ids    = Column(JSON, nullable=False, default=list)   # [1, 2, 3]
    device_names  = Column(JSON, nullable=True,  default=list)   # cache ["OLT1", "OLT2"]

    # Agendamento cron (ex: "0 0 22 * * *" = todo dia às 22h)
    cron_expression = Column(String(100), nullable=False, default="0 0 22 * * *")
    timezone        = Column(String(50),  nullable=False, default="America/Bahia")
    status          = Column(SAEnum(BackupScheduleStatus), nullable=False, default=BackupScheduleStatus.ACTIVE)

    # Variáveis extras para o playbook (sobrescreve as do playbook)
    variables_override = Column(JSON, nullable=True, default=dict)

    # Notificação Telegram
    telegram_enabled  = Column(Boolean, nullable=False, default=False)
    telegram_token    = Column(String(500), nullable=True)
    telegram_chat_id  = Column(String(100), nullable=True)
    telegram_on_error = Column(Boolean, nullable=False, default=True)   # notifica só em erro
    telegram_on_success = Column(Boolean, nullable=False, default=True) # notifica em sucesso

    # Retenção de arquivos de backup (dias)
    retention_days = Column(Integer, nullable=False, default=30)

    # Metadados
    created_by  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_status = Column(SAEnum(BackupRunStatus), nullable=True)

    # Relacionamentos
    executions = relationship("BackupExecution", back_populates="schedule", cascade="all, delete-orphan")
    playbook   = relationship("Playbook", foreign_keys=[playbook_id])
    creator    = relationship("User",     foreign_keys=[created_by])


class BackupExecution(Base):
    """Registro de uma execução de backup (um agendamento × N dispositivos)."""
    __tablename__ = "backup_executions"

    id          = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("backup_schedules.id", ondelete="CASCADE"), nullable=False)

    # Quem disparou (None = agendamento automático)
    triggered_by      = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    triggered_by_name = Column(String(200), nullable=True)
    trigger_type      = Column(String(20), nullable=False, default="scheduled")  # scheduled | manual

    status     = Column(SAEnum(BackupRunStatus), nullable=False, default=BackupRunStatus.PENDING)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)

    # Resultados por dispositivo: [{device_id, device_name, status, error, output_file, duration_ms}]
    device_results = Column(JSON, nullable=True, default=list)

    # Resumo
    total_devices   = Column(Integer, nullable=False, default=0)
    success_count   = Column(Integer, nullable=False, default=0)
    failure_count   = Column(Integer, nullable=False, default=0)
    error_message   = Column(Text, nullable=True)

    # Telegram: foi enviada notificação?
    telegram_sent   = Column(Boolean, nullable=False, default=False)
    telegram_error  = Column(Text, nullable=True)

    # Relacionamentos
    schedule = relationship("BackupSchedule", back_populates="executions")
    user     = relationship("User", foreign_keys=[triggered_by])

"""
BR10 NetManager - Configurações Globais do Sistema

Tabela key/value para configurações persistentes, incluindo:
  - Integração Telegram (token, chat_id, alertas)
  - Preferências de notificação
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, Boolean, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.models.base import Base


class SystemConfig(Base):
    """
    Configurações globais do sistema armazenadas como pares chave/valor.

    Chaves reservadas:
      telegram_bot_token          — token do bot Telegram
      telegram_chat_id            — chat_id padrão para alertas
      telegram_enabled            — "true" | "false"
      telegram_alert_device_down  — alertar quando dispositivo ficar offline
      telegram_alert_device_up    — alertar quando dispositivo voltar online
      telegram_alert_backup_ok    — alertar backup concluído com sucesso
      telegram_alert_backup_fail  — alertar falha de backup
      telegram_alert_playbook_ok  — alertar execução de playbook concluída
      telegram_alert_playbook_fail— alertar falha de playbook
    """
    __tablename__ = "system_config"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key        = Column(String(100), nullable=False, unique=True, index=True)
    value      = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(String(200), nullable=True)  # username de quem alterou

    def __repr__(self):
        return f"<SystemConfig {self.key}={self.value!r}>"


# Chaves padrão com valores iniciais
SYSTEM_CONFIG_DEFAULTS: dict[str, tuple[str, str]] = {
    "telegram_bot_token":           ("",      "Token do Bot Telegram (obtenha via @BotFather)"),
    "telegram_chat_id":             ("",      "Chat ID para envio de alertas (use @userinfobot para descobrir)"),
    "telegram_enabled":             ("false", "Habilitar notificações Telegram globais"),
    "telegram_alert_device_down":   ("true",  "Alertar quando dispositivo ficar offline"),
    "telegram_alert_device_up":     ("true",  "Alertar quando dispositivo voltar online"),
    "telegram_alert_backup_ok":     ("true",  "Alertar backup concluído com sucesso"),
    "telegram_alert_backup_fail":   ("true",  "Alertar falha de backup"),
    "telegram_alert_playbook_ok":   ("false", "Alertar execução de playbook concluída"),
    "telegram_alert_playbook_fail": ("true",  "Alertar falha de execução de playbook"),
}

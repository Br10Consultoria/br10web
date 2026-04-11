"""
BR10 NetManager - Audit Log Model

SOLUÇÃO PARA O ENUM auditaction:
O banco PostgreSQL tem registros antigos com valores em MAIÚSCULO (LOGIN, LOGOUT)
e novos em minúsculo (login, logout). Para compatibilidade total:

- A coluna `action` usa postgresql.ENUM com create_type=False para referenciar
  o ENUM nativo do banco sem tentar recriá-lo.
- O ENUM nativo aceita tanto valores MAIÚSCULO (legados) quanto minúsculo (novos).
- Na LEITURA: o valor é retornado como string bruta (sem mapeamento para enum Python).
- Na ESCRITA: o SQLAlchemy envia o valor sem o sufixo ::VARCHAR, permitindo que o
  PostgreSQL aceite o cast implícito da string para o tipo auditaction.

IMPORTANTE: Nunca usar TypeDecorator com impl=String para colunas ENUM nativas do
PostgreSQL — isso gera $N::VARCHAR que o PostgreSQL rejeita com DatatypeMismatchError.
"""
from sqlalchemy import Column, String, Text, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID, ENUM as PgEnum
from sqlalchemy.orm import relationship
import enum

from app.models.base import Base, TimestampMixin, UUIDMixin


class AuditAction(str, enum.Enum):
    # ── Autenticação ──────────────────────────────────────────────────────────
    LOGIN = "login"
    LOGOUT = "logout"
    LOGIN_FAILED = "login_failed"
    PASSWORD_CHANGED = "password_changed"
    TWO_FA_ENABLED = "2fa_enabled"
    TWO_FA_DISABLED = "2fa_disabled"

    # ── Dispositivos ──────────────────────────────────────────────────────────
    DEVICE_CREATED = "device_created"
    DEVICE_UPDATED = "device_updated"
    DEVICE_DELETED = "device_deleted"
    DEVICE_CONNECTED = "device_connected"
    DEVICE_DISCONNECTED = "device_disconnected"
    DEVICE_CONNECTION_FAILED = "device_connection_failed"

    # ── Terminal ──────────────────────────────────────────────────────────────
    TERMINAL_SESSION_STARTED = "terminal_session_started"
    TERMINAL_SESSION_ENDED = "terminal_session_ended"
    TERMINAL_COMMAND = "terminal_command"
    TERMINAL_CONNECTION_FAILED = "terminal_connection_failed"

    # ── Automação ─────────────────────────────────────────────────────────────
    COMMAND_EXECUTED = "command_executed"
    COMMAND_FAILED = "command_failed"

    # ── VPN ───────────────────────────────────────────────────────────────────
    VPN_CREATED = "vpn_created"
    VPN_UPDATED = "vpn_updated"
    VPN_DELETED = "vpn_deleted"
    VPN_CONNECTED = "vpn_connected"
    VPN_DISCONNECTED = "vpn_disconnected"
    VPN_CONNECTION_FAILED = "vpn_connection_failed"

    # ── Rotas ─────────────────────────────────────────────────────────────────
    ROUTE_CREATED = "route_created"
    ROUTE_UPDATED = "route_updated"
    ROUTE_DELETED = "route_deleted"

    # ── Backup DB ─────────────────────────────────────────────────────────────
    BACKUP_CREATED = "backup_created"
    BACKUP_RESTORED = "backup_restored"

    # ── Playbooks ─────────────────────────────────────────────────────────────
    PLAYBOOK_CREATED = "playbook_created"
    PLAYBOOK_UPDATED = "playbook_updated"
    PLAYBOOK_DELETED = "playbook_deleted"
    PLAYBOOK_EXECUTED = "playbook_executed"

    # ── Backup de Dispositivos ────────────────────────────────────────────────
    BACKUP_SCHEDULE_CREATED = "backup_schedule_created"
    BACKUP_SCHEDULE_UPDATED = "backup_schedule_updated"
    BACKUP_SCHEDULE_DELETED = "backup_schedule_deleted"
    BACKUP_SCHEDULE_EXECUTED = "backup_schedule_executed"

    # ── Monitor RPKI ──────────────────────────────────────────────────────────
    RPKI_MONITOR_CREATED = "rpki_monitor_created"
    RPKI_MONITOR_UPDATED = "rpki_monitor_updated"
    RPKI_MONITOR_DELETED = "rpki_monitor_deleted"
    RPKI_MONITOR_CHECKED = "rpki_monitor_checked"

    # ── Usuários ──────────────────────────────────────────────────────────────
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_DELETED = "user_deleted"

    # ── Geral ─────────────────────────────────────────────────────────────────
    EXPORT_DATA = "export_data"
    IMPORT_DATA = "import_data"


# Tipo ENUM nativo do PostgreSQL referenciando o tipo auditaction já existente no banco.
# create_type=False: não tenta criar/dropar o ENUM — usa o que já existe.
# values_callable: extrai os .value do AuditAction enum para o bind correto.
# Ao escrever, o SQLAlchemy envia a string sem ::VARCHAR, permitindo cast implícito.
# Ao ler, retorna a string bruta (compatível com valores MAIÚSCULO legados).
AuditActionPgEnum = PgEnum(
    *[a.value for a in AuditAction],
    name="auditaction",
    create_type=False,  # O ENUM já existe no banco — não recriar
)


class AuditLog(Base, UUIDMixin, TimestampMixin):
    """Log de auditoria de todas as ações do sistema."""
    __tablename__ = "audit_logs"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)

    # Usa o ENUM nativo do PostgreSQL — evita DatatypeMismatchError com ::VARCHAR
    action = Column(AuditActionPgEnum, nullable=False, index=True)

    resource_type = Column(String(100), nullable=True)
    resource_id = Column(String(255), nullable=True)

    # Detalhes
    description = Column(Text, nullable=True)
    old_values = Column(JSON, nullable=True)
    new_values = Column(JSON, nullable=True)
    extra_data = Column(JSON, nullable=True)

    # Contexto de Rede
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)

    # Status
    status = Column(String(20), default="success")  # success, failure, warning
    error_message = Column(Text, nullable=True)

    # Relationships
    user = relationship("User", back_populates="audit_logs")
    device = relationship("Device", back_populates="audit_logs")

    def __repr__(self):
        return f"<AuditLog {self.action} by {self.user_id}>"

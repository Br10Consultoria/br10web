"""
BR10 NetManager - Audit Log Model

A coluna `action` usa VARCHAR(100) — não ENUM nativo do PostgreSQL.

Motivo: logs de auditoria são extensíveis por natureza. Novos tipos de ação
surgem com o tempo, e ENUM nativo do PostgreSQL exige ALTER TYPE a cada adição
(operação fora de transação). VARCHAR com validação na aplicação é o padrão
da indústria para sistemas de auditoria (Django Audit Log, AWS CloudTrail, etc.).

Validação de integridade: garantida pelo enum Python AuditAction — apenas
valores definidos ali são aceitos pelo código da aplicação.
"""
from sqlalchemy import Column, String, Text, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
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

    # ── CGNAT ─────────────────────────────────────────────────────────────────
    CGNAT_GENERATED = "cgnat_generated"
    CGNAT_SAVED = "cgnat_saved"
    CGNAT_DELETED = "cgnat_deleted"

    # ── Usuários ──────────────────────────────────────────────────────────────
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_DELETED = "user_deleted"

    # ── Geral ─────────────────────────────────────────────────────────────────
    EXPORT_DATA = "export_data"
    IMPORT_DATA = "import_data"


class AuditLog(Base, UUIDMixin, TimestampMixin):
    """Log de auditoria de todas as ações do sistema."""
    __tablename__ = "audit_logs"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)

    # VARCHAR(100) — sem ENUM nativo. Simples, extensível, sem problemas de cast.
    # Validação garantida pelo enum Python AuditAction na camada de aplicação.
    action = Column(String(100), nullable=False, index=True)

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

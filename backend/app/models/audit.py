"""
BR10 NetManager - Audit Log Model
Registro completo de auditoria de todas as ações do sistema.
"""
from sqlalchemy import Column, String, Text, Enum, ForeignKey, JSON
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

    # ── Automação (execução de comandos) ──────────────────────────────────────
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

    # ── Backup ────────────────────────────────────────────────────────────────
    BACKUP_CREATED = "backup_created"
    BACKUP_RESTORED = "backup_restored"

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

    action = Column(Enum(AuditAction), nullable=False, index=True)
    resource_type = Column(String(100), nullable=True)
    resource_id = Column(String(255), nullable=True)

    # Detalhes
    description = Column(Text, nullable=True)
    old_values = Column(JSON, nullable=True)
    new_values = Column(JSON, nullable=True)
    extra_data = Column(JSON, nullable=True)  # Renomeado de 'metadata' (reservado pelo SQLAlchemy)

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

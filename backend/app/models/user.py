"""
BR10 NetManager - User Model
Modelo de usuário com suporte a 2FA e controle de acesso.
"""
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.models.base import Base, TimestampMixin, UUIDMixin


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    TECHNICIAN = "technician"
    VIEWER = "viewer"


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.VIEWER, nullable=False)

    # Status
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)

    # 2FA
    totp_secret = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, default=False, nullable=False)

    # Security
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    last_login_ip = Column(String(45), nullable=True)
    password_changed_at = Column(DateTime(timezone=True), nullable=True)

    # Profile
    avatar_url = Column(String(500), nullable=True)
    phone = Column(String(20), nullable=True)

    # Relationships
    audit_logs = relationship("AuditLog", back_populates="user", lazy="dynamic")
    sessions = relationship("UserSession", back_populates="user", lazy="dynamic")
    permissions = relationship("UserPermission", back_populates="user", lazy="selectin", cascade="all, delete-orphan")
    client_scopes = relationship("UserClientScope", back_populates="user", lazy="selectin", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User {self.username} ({self.role})>"


class UserSession(Base, UUIDMixin, TimestampMixin):
    """Sessões ativas de usuários para controle de acesso."""
    __tablename__ = "user_sessions"

    from sqlalchemy import ForeignKey
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_jti = Column(String(64), unique=True, nullable=False, index=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    user = relationship("User", back_populates="sessions")

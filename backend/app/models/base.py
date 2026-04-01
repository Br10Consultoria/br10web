"""
BR10 NetManager - Base Models
Modelos base SQLAlchemy com timestamps automáticos.
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


class TimestampMixin:
    """Mixin com campos de auditoria de tempo."""
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class UUIDMixin:
    """Mixin com UUID como chave primária."""
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

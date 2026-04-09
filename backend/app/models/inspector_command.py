"""
BR10 NetManager - Inspector Command Model
Armazena comandos de inspeção editáveis por tipo de dispositivo (vendor).
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime, Index
from app.models.base import Base


class InspectorCommand(Base):
    __tablename__ = "inspector_commands"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    device_type = Column(String(50), nullable=False, index=True)
    category_id = Column(String(50), nullable=False)
    category_label = Column(String(100), nullable=False)
    category_icon = Column(String(50), nullable=False, default="Terminal")
    command = Column(Text, nullable=False)
    description = Column(String(255), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_inspector_commands_device_type_category", "device_type", "category_id"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "device_type": self.device_type,
            "category_id": self.category_id,
            "category_label": self.category_label,
            "category_icon": self.category_icon,
            "command": self.command,
            "description": self.description,
            "sort_order": self.sort_order,
            "is_active": self.is_active,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

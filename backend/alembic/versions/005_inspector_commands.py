"""
005 - Inspector Commands: tabela de comandos de inspeção por vendor/device_type
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
import uuid


revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "inspector_commands",
        sa.Column("id", sa.String(36), primary_key=True, default=lambda: str(uuid.uuid4())),
        sa.Column("device_type", sa.String(50), nullable=False, index=True,
                  comment="Tipo de dispositivo: huawei_ne8000, mikrotik, cisco, etc."),
        sa.Column("category_id", sa.String(50), nullable=False,
                  comment="ID da categoria: interfaces, bgp, routing, etc."),
        sa.Column("category_label", sa.String(100), nullable=False,
                  comment="Rótulo exibido na UI: Interfaces, BGP, etc."),
        sa.Column("category_icon", sa.String(50), nullable=False, default="Terminal",
                  comment="Nome do ícone Lucide"),
        sa.Column("command", sa.Text, nullable=False,
                  comment="Comando a ser executado"),
        sa.Column("description", sa.String(255), nullable=True,
                  comment="Descrição opcional do comando"),
        sa.Column("sort_order", sa.Integer, nullable=False, default=0,
                  comment="Ordem de exibição dentro da categoria"),
        sa.Column("is_active", sa.Boolean, nullable=False, default=True),
        sa.Column("created_by", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now()),
    )

    op.create_index(
        "ix_inspector_commands_device_type_category",
        "inspector_commands",
        ["device_type", "category_id"],
    )


def downgrade():
    op.drop_index("ix_inspector_commands_device_type_category", "inspector_commands")
    op.drop_table("inspector_commands")

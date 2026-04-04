"""Add automation tables (command_templates, command_executions)

Revision ID: 003_automation
Revises: 002
Create Date: 2026-04-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '003_automation'
down_revision = None  # standalone - aplica sobre o schema existente
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tabela de templates de comandos
    op.create_table(
        'command_templates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(50), nullable=False, server_default='diagnostics'),
        sa.Column('command', sa.Text(), nullable=False),
        sa.Column('vendor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('vendors.id', ondelete='SET NULL'), nullable=True),
        sa.Column('vendor_name', sa.String(200), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('is_global', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('timeout', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_command_templates_category', 'command_templates', ['category'])
    op.create_index('ix_command_templates_vendor_id', 'command_templates', ['vendor_id'])

    # Tabela de execuções
    op.create_table(
        'command_executions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('template_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('command_templates.id', ondelete='SET NULL'), nullable=True),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('devices.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('template_name', sa.String(200), nullable=True),
        sa.Column('device_name', sa.String(200), nullable=True),
        sa.Column('device_ip', sa.String(45), nullable=True),
        sa.Column('username', sa.String(100), nullable=True),
        sa.Column('command', sa.Text(), nullable=False),
        sa.Column('protocol', sa.String(10), nullable=False, server_default='ssh'),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('output', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_command_executions_device_id', 'command_executions', ['device_id'])
    op.create_index('ix_command_executions_template_id', 'command_executions', ['template_id'])
    op.create_index('ix_command_executions_started_at', 'command_executions', ['started_at'])


def downgrade() -> None:
    op.drop_table('command_executions')
    op.drop_table('command_templates')

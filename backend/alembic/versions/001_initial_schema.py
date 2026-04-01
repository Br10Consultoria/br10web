"""Initial schema

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-04-01 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ─── Users ────────────────────────────────────────────────────────────────
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('username', sa.String(50), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=True),
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('hashed_password', sa.Text(), nullable=False),
        sa.Column('role', sa.String(20), nullable=False, server_default='viewer'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('is_superuser', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('totp_secret', sa.Text(), nullable=True),
        sa.Column('totp_enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('last_login', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_login_ip', sa.String(45), nullable=True),
        sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'),
        sa.UniqueConstraint('email'),
    )
    op.create_index('ix_users_username', 'users', ['username'])
    op.create_index('ix_users_email', 'users', ['email'])

    # ─── Devices ──────────────────────────────────────────────────────────────
    op.create_table(
        'devices',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('hostname', sa.String(255), nullable=True),
        sa.Column('device_type', sa.String(50), nullable=False),
        sa.Column('manufacturer', sa.String(100), nullable=True),
        sa.Column('model', sa.String(100), nullable=True),
        sa.Column('firmware_version', sa.String(100), nullable=True),
        sa.Column('serial_number', sa.String(100), nullable=True),
        sa.Column('management_ip', sa.String(45), nullable=False),
        sa.Column('subnet_mask', sa.String(45), nullable=True),
        sa.Column('gateway', sa.String(45), nullable=True),
        sa.Column('dns_primary', sa.String(45), nullable=True),
        sa.Column('dns_secondary', sa.String(45), nullable=True),
        sa.Column('loopback_ip', sa.String(45), nullable=True),
        sa.Column('primary_protocol', sa.String(20), nullable=False, server_default='ssh'),
        sa.Column('ssh_port', sa.Integer(), nullable=False, server_default='22'),
        sa.Column('telnet_port', sa.Integer(), nullable=False, server_default='23'),
        sa.Column('http_port', sa.Integer(), nullable=True),
        sa.Column('https_port', sa.Integer(), nullable=True),
        sa.Column('winbox_port', sa.Integer(), nullable=True, server_default='8291'),
        sa.Column('snmp_community', sa.Text(), nullable=True),
        sa.Column('snmp_version', sa.String(10), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='unknown'),
        sa.Column('location', sa.String(255), nullable=True),
        sa.Column('site', sa.String(255), nullable=True),
        sa.Column('rack', sa.String(100), nullable=True),
        sa.Column('rack_unit', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('tags', postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_devices_management_ip', 'devices', ['management_ip'])
    op.create_index('ix_devices_name', 'devices', ['name'])
    op.create_index('ix_devices_device_type', 'devices', ['device_type'])
    op.create_index('ix_devices_status', 'devices', ['status'])

    # ─── Device Credentials ───────────────────────────────────────────────────
    op.create_table(
        'device_credentials',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('credential_type', sa.String(20), nullable=False),
        sa.Column('username', sa.String(255), nullable=True),
        sa.Column('encrypted_password', sa.Text(), nullable=True),
        sa.Column('encrypted_enable_password', sa.Text(), nullable=True),
        sa.Column('encrypted_private_key', sa.Text(), nullable=True),
        sa.Column('key_passphrase', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ─── Device VLANs ─────────────────────────────────────────────────────────
    op.create_table(
        'device_vlans',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('vlan_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('subnet_mask', sa.String(45), nullable=True),
        sa.Column('gateway', sa.String(45), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('device_id', 'vlan_id', name='uq_device_vlan'),
    )

    # ─── Device Ports ─────────────────────────────────────────────────────────
    op.create_table(
        'device_ports',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('port_name', sa.String(100), nullable=False),
        sa.Column('port_type', sa.String(50), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='unknown'),
        sa.Column('speed_mbps', sa.Integer(), nullable=True),
        sa.Column('duplex', sa.String(20), nullable=True),
        sa.Column('vlan_id', sa.Integer(), nullable=True),
        sa.Column('mac_address', sa.String(17), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_uplink', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ─── Device Photos ────────────────────────────────────────────────────────
    op.create_table(
        'device_photos',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('original_filename', sa.String(255), nullable=True),
        sa.Column('file_path', sa.Text(), nullable=False),
        sa.Column('url', sa.Text(), nullable=True),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('caption', sa.Text(), nullable=True),
        sa.Column('uploaded_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploaded_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ─── VPN Configs ──────────────────────────────────────────────────────────
    op.create_table(
        'vpn_configs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('vpn_type', sa.String(20), nullable=False, server_default='l2tp'),
        sa.Column('server_ip', sa.String(45), nullable=False),
        sa.Column('server_port', sa.Integer(), nullable=False, server_default='1701'),
        sa.Column('local_ip', sa.String(45), nullable=True),
        sa.Column('remote_ip', sa.String(45), nullable=True),
        sa.Column('encrypted_username', sa.Text(), nullable=True),
        sa.Column('encrypted_password', sa.Text(), nullable=True),
        sa.Column('encrypted_psk', sa.Text(), nullable=True),
        sa.Column('auth_method', sa.String(20), nullable=True, server_default='pap'),
        sa.Column('ike_version', sa.Integer(), nullable=True, server_default='1'),
        sa.Column('encryption_algorithm', sa.String(50), nullable=True),
        sa.Column('hash_algorithm', sa.String(50), nullable=True),
        sa.Column('dh_group', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='inactive'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ─── Static Routes ────────────────────────────────────────────────────────
    op.create_table(
        'static_routes',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('vpn_config_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('destination_network', sa.String(50), nullable=False),
        sa.Column('subnet_mask', sa.String(45), nullable=True),
        sa.Column('next_hop', sa.String(45), nullable=False),
        sa.Column('metric', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('interface', sa.String(100), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['vpn_config_id'], ['vpn_configs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ─── Audit Logs ───────────────────────────────────────────────────────────
    op.create_table(
        'audit_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('username', sa.String(50), nullable=True),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('resource_type', sa.String(50), nullable=True),
        sa.Column('resource_id', sa.String(255), nullable=True),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('device_name', sa.String(255), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='success'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('extra_data', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])
    op.create_index('ix_audit_logs_user_id', 'audit_logs', ['user_id'])
    op.create_index('ix_audit_logs_action', 'audit_logs', ['action'])


def downgrade() -> None:
    op.drop_table('audit_logs')
    op.drop_table('static_routes')
    op.drop_table('vpn_configs')
    op.drop_table('device_photos')
    op.drop_table('device_ports')
    op.drop_table('device_vlans')
    op.drop_table('device_credentials')
    op.drop_table('devices')
    op.drop_table('users')

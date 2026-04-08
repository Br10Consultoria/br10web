"""
Audit logs improvements - adiciona colunas faltantes e índices para auditoria completa.

Revision ID: 004_audit_logs_improvements
Revises: 001_initial_schema
Create Date: 2026-04-08 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '004_audit_logs_improvements'
down_revision: Union[str, None] = '001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    """Verifica se uma coluna já existe na tabela (compatibilidade com init_db)."""
    from alembic import op as _op
    conn = _op.get_bind()
    result = conn.execute(sa.text(
        f"SELECT column_name FROM information_schema.columns "
        f"WHERE table_name='{table}' AND column_name='{column}'"
    ))
    return result.fetchone() is not None


def _index_exists(index_name: str) -> bool:
    """Verifica se um índice já existe."""
    from alembic import op as _op
    conn = _op.get_bind()
    result = conn.execute(sa.text(
        f"SELECT indexname FROM pg_indexes WHERE indexname='{index_name}'"
    ))
    return result.fetchone() is not None


def upgrade() -> None:
    # ── Adicionar colunas faltantes na tabela audit_logs ──────────────────────

    # old_values: valores antes de uma alteração (ex: update de dispositivo)
    if not _column_exists('audit_logs', 'old_values'):
        op.add_column('audit_logs', sa.Column('old_values', postgresql.JSONB(), nullable=True))

    # new_values: valores depois de uma alteração
    if not _column_exists('audit_logs', 'new_values'):
        op.add_column('audit_logs', sa.Column('new_values', postgresql.JSONB(), nullable=True))

    # error_message: mensagem de erro detalhada quando status=failure
    if not _column_exists('audit_logs', 'error_message'):
        op.add_column('audit_logs', sa.Column('error_message', sa.Text(), nullable=True))

    # device_id como FK (a migration inicial não tinha FK para devices)
    # Verificar se a FK já existe antes de criar
    conn = op.get_bind()
    fk_result = conn.execute(sa.text(
        "SELECT constraint_name FROM information_schema.table_constraints "
        "WHERE table_name='audit_logs' AND constraint_type='FOREIGN KEY' "
        "AND constraint_name='audit_logs_device_id_fkey'"
    ))
    if not fk_result.fetchone():
        # Adicionar FK para devices se não existir
        try:
            op.create_foreign_key(
                'audit_logs_device_id_fkey',
                'audit_logs', 'devices',
                ['device_id'], ['id'],
                ondelete='SET NULL'
            )
        except Exception:
            pass  # Pode falhar se device_id não existia como coluna

    # ── Adicionar índices para melhor performance ─────────────────────────────
    if not _index_exists('ix_audit_logs_status'):
        op.create_index('ix_audit_logs_status', 'audit_logs', ['status'])

    if not _index_exists('ix_audit_logs_device_id'):
        op.create_index('ix_audit_logs_device_id', 'audit_logs', ['device_id'])

    if not _index_exists('ix_audit_logs_resource_type'):
        op.create_index('ix_audit_logs_resource_type', 'audit_logs', ['resource_type'])

    # ── Garantir que extra_data existe (pode ter sido criado como JSON ao invés de JSONB) ──
    if not _column_exists('audit_logs', 'extra_data'):
        op.add_column('audit_logs', sa.Column('extra_data', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    # Remover índices adicionados
    for idx in ['ix_audit_logs_resource_type', 'ix_audit_logs_device_id', 'ix_audit_logs_status']:
        try:
            op.drop_index(idx, table_name='audit_logs')
        except Exception:
            pass

    # Remover colunas adicionadas
    for col in ['error_message', 'new_values', 'old_values']:
        try:
            op.drop_column('audit_logs', col)
        except Exception:
            pass

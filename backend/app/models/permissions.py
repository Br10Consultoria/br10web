"""
BR10 NetManager — Permissões Granulares por Usuário

Modelo de controle de acesso baseado em:
  - Módulos: quais seções o usuário pode acessar
  - Nível de acesso: view / execute / edit / manage por módulo
  - Escopo de clientes: quais clientes o usuário pode ver (vazio = todos)
"""
from sqlalchemy import (
    Boolean, Column, String, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


# ─── Módulos disponíveis no sistema ──────────────────────────────────────────

MODULES = [
    # Infraestrutura
    "clients",          # Clientes / Fornecedores
    "devices",          # Dispositivos
    "device_backup",    # Backup de Dispositivos
    "terminal",         # Terminal SSH/Telnet
    # Ferramentas
    "rpki_monitor",     # Monitor RPKI
    "cgnat",            # Gerador CGNAT
    "vpn",              # VPN L2TP
    "playbooks",        # Automação / Playbooks
    "ai_analysis",      # Análise IA
    # Sistema
    "backup",           # Backup do Sistema
    "audit",            # Log de Auditoria
    "users",            # Gerenciamento de Usuários (apenas admin)
]

# Níveis de acesso por módulo (hierárquico — cada nível inclui o anterior)
ACCESS_LEVELS = ["view", "execute", "edit", "manage"]

# Nível mínimo necessário por operação (usado no enforcement)
# Módulos que não têm "execute" usam apenas view/edit/manage
MODULE_OPERATIONS = {
    "clients":       {"view": "view", "create": "edit", "update": "edit", "delete": "manage"},
    "devices":       {"view": "view", "create": "edit", "update": "edit", "delete": "manage"},
    "device_backup": {"view": "view", "create": "execute", "restore": "manage", "delete": "manage"},
    "terminal":      {"view": "view", "connect": "execute"},
    "rpki_monitor":  {"view": "view", "check": "execute", "create": "edit", "update": "edit", "delete": "manage"},
    "cgnat":         {"view": "view", "generate": "execute", "save": "edit", "delete": "manage"},
    "vpn":           {"view": "view", "create": "edit", "update": "edit", "delete": "manage"},
    "playbooks":     {"view": "view", "execute": "execute", "create": "edit", "update": "edit", "delete": "manage"},
    "ai_analysis":   {"view": "view", "analyze": "execute"},
    "backup":        {"view": "view", "create": "execute", "restore": "manage", "delete": "manage"},
    "audit":         {"view": "view"},
    "users":         {"view": "manage", "create": "manage", "update": "manage", "delete": "manage"},
}


class UserPermission(Base, UUIDMixin, TimestampMixin):
    """
    Permissão de um usuário em um módulo específico.
    Um registro por (user_id, module) — se não existir, acesso negado.
    """
    __tablename__ = "user_permissions"

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module = Column(String(50), nullable=False)
    access_level = Column(String(20), nullable=False, default="view")
    # view < execute < edit < manage

    __table_args__ = (
        UniqueConstraint("user_id", "module", name="uq_user_permission_module"),
        Index("ix_user_permissions_user_id", "user_id"),
    )

    user = relationship("User", back_populates="permissions")

    def has_access(self, required_level: str) -> bool:
        """Verifica se o nível de acesso é suficiente para a operação."""
        levels = ACCESS_LEVELS
        try:
            return levels.index(self.access_level) >= levels.index(required_level)
        except ValueError:
            return False

    def __repr__(self):
        return f"<UserPermission user={self.user_id} module={self.module} level={self.access_level}>"


class UserClientScope(Base, UUIDMixin, TimestampMixin):
    """
    Restrição de escopo de cliente para um usuário.
    Se não existir nenhum registro para o usuário → acesso a TODOS os clientes.
    Se existirem registros → acesso apenas aos clientes listados.
    """
    __tablename__ = "user_client_scopes"

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    client_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clients.id", ondelete="CASCADE"),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_user_client_scope"),
        Index("ix_user_client_scopes_user_id", "user_id"),
    )

    user = relationship("User", back_populates="client_scopes")
    client = relationship("Client")

    def __repr__(self):
        return f"<UserClientScope user={self.user_id} client={self.client_id}>"

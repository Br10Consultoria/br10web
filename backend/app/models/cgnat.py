"""
BR10 NetManager - Modelo de Gerador CGNAT

Tabelas:
  cgnat_configs   — Configurações CGNAT salvas (prefixo público + privado + opções)
  cgnat_mappings  — Mapeamento de portas por IP privado (para consulta/rastreamento)
"""
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Text, JSON,
    ForeignKey, Index, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.models.base import Base


class CgnatConfig(Base):
    """
    Configuração CGNAT salva.
    Armazena os parâmetros usados para gerar um script RouterOS de CGNAT.
    """
    __tablename__ = "cgnat_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Identificação
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)

    # Prefixo privado (rede CGNAT)
    private_network = Column(String(50), nullable=False)   # ex: "100.64.0.0"
    private_prefix_len = Column(Integer, nullable=False)   # ex: 23 (para /23 = 512 IPs)

    # Prefixo público
    public_prefix = Column(String(50), nullable=False)     # ex: "170.83.186.128/28"

    # Opções de geração
    clients_per_ip = Column(Integer, nullable=False)       # 8, 16, 32 ou 64
    sequential_chain = Column(Integer, default=0)          # offset para numeração das chains
    use_blackhole = Column(Boolean, default=True)
    use_fasttrack = Column(Boolean, default=True)
    protocol = Column(String(10), default="tcp_udp")       # tcp_udp | tcp_only
    ros_version = Column(String(5), default="6")           # 6 | 7

    # Estatísticas calculadas
    total_private_ips = Column(Integer, nullable=True)
    total_public_ips = Column(Integer, nullable=True)
    ports_per_client = Column(Integer, nullable=True)
    total_chains = Column(Integer, nullable=True)

    # Cliente associado
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)

    # Auditoria
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_cgnat_configs_name", "name"),
        Index("ix_cgnat_configs_public_prefix", "public_prefix"),
    )


class CgnatMapping(Base):
    """
    Mapeamento de portas CGNAT por IP privado.
    Uma entrada por IP privado, armazenando qual IP público e range de portas ele usa.
    Permite rastrear qual cliente (IP privado) estava usando qual IP público e portas
    em um determinado momento.
    """
    __tablename__ = "cgnat_mappings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    config_id = Column(
        UUID(as_uuid=True),
        ForeignKey("cgnat_configs.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # IP privado
    private_ip = Column(String(45), nullable=False)        # ex: "100.64.0.1"
    private_subnet = Column(String(50), nullable=True)     # ex: "100.64.0.0/28" (chain)

    # IP público e portas mapeadas
    public_ip = Column(String(45), nullable=False)         # ex: "170.83.186.128"
    port_start = Column(Integer, nullable=False)           # ex: 1024
    port_end = Column(Integer, nullable=False)             # ex: 3039

    # Índice da chain RouterOS
    chain_index = Column(Integer, nullable=False)          # ex: 0, 1, 2...
    chain_name = Column(String(50), nullable=False)        # ex: "CGNAT_0"

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_cgnat_mappings_config_private", "config_id", "private_ip"),
        Index("ix_cgnat_mappings_private_ip", "private_ip"),
        Index("ix_cgnat_mappings_public_ip", "public_ip"),
        UniqueConstraint("config_id", "private_ip", name="uq_cgnat_mapping_config_private"),
    )

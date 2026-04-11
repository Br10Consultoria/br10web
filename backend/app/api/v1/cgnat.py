"""
BR10 NetManager - API de Gerador CGNAT

Endpoints:
  POST   /cgnat/generate              — gerar script RouterOS (sem salvar)
  POST   /cgnat/configs               — criar configuração e salvar mapeamento
  GET    /cgnat/configs               — listar configurações salvas
  GET    /cgnat/configs/{id}          — detalhe de uma configuração
  DELETE /cgnat/configs/{id}          — remover configuração e mapeamentos
  GET    /cgnat/configs/{id}/script   — regenerar script de uma configuração salva
  GET    /cgnat/configs/{id}/mappings — listar mapeamento de portas
  GET    /cgnat/lookup                — consultar IP privado → IP público + portas
"""
import ipaddress
import logging
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_user, require_admin
from app.models.user import User
from app.models.cgnat import CgnatConfig, CgnatMapping
from app.models.audit import AuditAction
from app.core.audit_helper import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cgnat", tags=["CGNAT"])

# Portas disponíveis para CGNAT (RFC 6598 recomenda 1024-65535)
PORT_START = 1024
PORT_END = 65535
TOTAL_PORTS = PORT_END - PORT_START + 1  # 64512


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CgnatGenerateRequest(BaseModel):
    """Parâmetros para geração de script CGNAT."""
    name: str
    description: Optional[str] = None
    private_network: str          # ex: "100.64.0.0" (início do bloco privado)
    public_prefix: str            # ex: "170.83.186.128/28"
    clients_per_ip: int           # 8, 16, 32 ou 64
    sequential_chain: int = 0     # offset para numeração das chains (padrão 0)
    use_blackhole: bool = True
    use_fasttrack: bool = True
    protocol: str = "tcp_udp"     # tcp_udp | tcp_only
    ros_version: str = "6"        # 6 | 7
    save: bool = False            # True = salvar no banco

    @field_validator("clients_per_ip")
    @classmethod
    def validate_clients(cls, v):
        if v not in (8, 16, 32, 64):
            raise ValueError("clients_per_ip deve ser 8, 16, 32 ou 64")
        return v

    @field_validator("public_prefix")
    @classmethod
    def validate_public_prefix(cls, v):
        try:
            net = ipaddress.ip_network(v.strip(), strict=False)
            return str(net)
        except ValueError:
            raise ValueError(f"Prefixo público inválido: {v}")

    @field_validator("private_network")
    @classmethod
    def validate_private_network(cls, v):
        try:
            ipaddress.ip_address(v.strip())
            return v.strip()
        except ValueError:
            raise ValueError(f"Endereço de rede privada inválido: {v}")

    @field_validator("protocol")
    @classmethod
    def validate_protocol(cls, v):
        if v not in ("tcp_udp", "tcp_only"):
            raise ValueError("protocol deve ser tcp_udp ou tcp_only")
        return v

    @field_validator("ros_version")
    @classmethod
    def validate_ros_version(cls, v):
        if v not in ("6", "7"):
            raise ValueError("ros_version deve ser 6 ou 7")
        return v


# ─── Lógica de geração CGNAT ──────────────────────────────────────────────────

def _calculate_cgnat_params(
    private_network_str: str,
    public_prefix_str: str,
    clients_per_ip: int,
    sequential_chain: int = 0,
) -> dict:
    """
    Calcula todos os parâmetros necessários para geração do script CGNAT.

    Retorna um dict com:
      - public_ips: lista de IPs públicos
      - total_public_ips: quantidade de IPs públicos
      - ports_per_client: portas por cliente
      - total_private_ips: total de IPs privados (total_public_ips × clients_per_ip)
      - chains: lista de chains com sub-redes privadas e ranges de porta
      - private_subnets_by_24: dict {rede_24: [chains]}
      - mappings: lista de {private_ip, public_ip, port_start, port_end, chain_index, chain_name}
    """
    public_net = ipaddress.ip_network(public_prefix_str, strict=False)
    public_ips = list(public_net.hosts()) if public_net.prefixlen < 32 else [public_net.network_address]
    # Para /28: 16 hosts (sem network e broadcast)
    # Para /29: 8 hosts, /27: 32 hosts, etc.
    # Nota: ip_network.hosts() exclui network e broadcast automaticamente
    total_public_ips = len(public_ips)

    if total_public_ips == 0:
        raise ValueError("O prefixo público não contém IPs utilizáveis")

    # Portas por cliente
    ports_per_client = TOTAL_PORTS // clients_per_ip  # ex: 64512 / 32 = 2016

    # Total de IPs privados = IPs públicos × clientes por IP
    total_private_ips = total_public_ips * clients_per_ip

    # IPs privados: blocos de 16 IPs (/28 privado) por chain
    # Cada chain agrupa 16 IPs privados mapeados para todos os IPs públicos
    # Número de chains = total_private_ips / 16
    private_block_size = total_public_ips  # cada chain tem tantos IPs quanto IPs públicos
    total_chains = total_private_ips // private_block_size  # = clients_per_ip

    # Calcular o prefixlen do bloco privado por chain
    # private_block_size IPs → prefixlen = 32 - log2(private_block_size)
    import math
    private_chain_prefixlen = 32 - int(math.log2(private_block_size))
    # ex: 16 IPs → /28, 8 IPs → /29, 32 IPs → /27

    # Gerar IPs privados sequencialmente a partir de private_network
    private_start = ipaddress.ip_address(private_network_str)
    private_start_int = int(private_start)

    # Construir chains
    chains = []
    mappings = []

    for chain_idx in range(total_chains):
        chain_number = sequential_chain + chain_idx
        chain_name = f"CGNAT_{chain_number}"

        # Sub-rede privada desta chain
        subnet_start_int = private_start_int + chain_idx * private_block_size
        subnet_start = ipaddress.ip_address(subnet_start_int)
        private_subnet = f"{subnet_start}/{private_chain_prefixlen}"

        # Range de portas desta chain
        port_start = PORT_START + chain_idx * ports_per_client
        port_end = port_start + ports_per_client - 1

        chains.append({
            "chain_index": chain_number,
            "chain_name": chain_name,
            "private_subnet": private_subnet,
            "port_start": port_start,
            "port_end": port_end,
        })

        # Mapeamento individual por IP privado
        for ip_offset in range(private_block_size):
            private_ip = str(ipaddress.ip_address(subnet_start_int + ip_offset))
            public_ip = str(public_ips[ip_offset % total_public_ips])
            mappings.append({
                "private_ip": private_ip,
                "private_subnet": private_subnet,
                "public_ip": public_ip,
                "port_start": port_start,
                "port_end": port_end,
                "chain_index": chain_number,
                "chain_name": chain_name,
            })

    # Agrupar chains por /24 privado (para as regras srcnat de jump)
    private_subnets_by_24: dict = {}
    for chain in chains:
        subnet_net = ipaddress.ip_network(chain["private_subnet"], strict=False)
        # Descobrir o /24 que contém esta subnet
        net_24 = ipaddress.ip_network(
            f"{subnet_net.network_address}/{min(24, private_chain_prefixlen)}", strict=False
        )
        net_24_str = str(net_24)
        if net_24_str not in private_subnets_by_24:
            private_subnets_by_24[net_24_str] = []
        private_subnets_by_24[net_24_str].append(chain)

    return {
        "public_ips": [str(ip) for ip in public_ips],
        "total_public_ips": total_public_ips,
        "ports_per_client": ports_per_client,
        "total_private_ips": total_private_ips,
        "private_chain_prefixlen": private_chain_prefixlen,
        "total_chains": total_chains,
        "chains": chains,
        "private_subnets_by_24": private_subnets_by_24,
        "mappings": mappings,
    }


def _generate_ros_script(
    params: dict,
    public_prefix: str,
    use_blackhole: bool,
    use_fasttrack: bool,
    protocol: str,
    ros_version: str,
    private_network: str,
    clients_per_ip: int,
) -> str:
    """Gera o script RouterOS completo para CGNAT."""
    lines = []

    total_private_ips = params["total_private_ips"]
    ports_per_client = params["ports_per_client"]

    # Calcular range de IPs privados
    private_start = ipaddress.ip_address(private_network)
    private_end = ipaddress.ip_address(int(private_start) + total_private_ips - 1)

    lines.append(f"# RANGE IPs PRIVADOS PARA CGNAT {private_start}-{private_end} | "
                 f"TOTAL DE IPS {total_private_ips} | PORTAS POR CLIENTE: {ports_per_client}")
    lines.append("# Gerado pelo BR10 NetManager")
    lines.append("")

    # BLACKHOLE
    if use_blackhole:
        lines.append("# BLACKHOLE")
        lines.append(f"/ip route add type=blackhole dst-address={public_prefix} comment=CGNAT_BLACKHOLE")
        lines.append("")

    # FASTTRACK
    if use_fasttrack:
        lines.append("# FASTTRACK")
        if ros_version == "7":
            lines.append("/ip firewall filter add chain=forward action=fasttrack-connection "
                         "connection-state=established,related hw-offload=yes")
        else:
            lines.append("/ip firewall filter add chain=forward action=fasttrack-connection "
                         "connection-state=established,related")
        lines.append("/ip firewall filter add chain=forward action=accept "
                     "connection-state=established,related")
        lines.append("")

    # CGNAT — srcnat jump por /24 privado
    lines.append("#CGNAT")
    for net_24_str in params["private_subnets_by_24"]:
        # Nome da chain: CGNAT_100_64_0 para 100.64.0.0/24
        net_24 = ipaddress.ip_network(net_24_str, strict=False)
        octets = str(net_24.network_address).split(".")
        chain_24_name = f"CGNAT_{'_'.join(octets)}"
        lines.append(f"/ip firewall nat add chain=srcnat src-address={net_24_str} "
                     f"action=jump jump-target={chain_24_name}")

    lines.append(" ")

    # CGNAT — sub-chains por bloco privado
    for net_24_str, chains_in_24 in params["private_subnets_by_24"].items():
        net_24 = ipaddress.ip_network(net_24_str, strict=False)
        octets = str(net_24.network_address).split(".")
        chain_24_name = f"CGNAT_{'_'.join(octets)}"
        for chain in chains_in_24:
            lines.append(f"/ip firewall nat add chain={chain_24_name} "
                         f"src-address={chain['private_subnet']} "
                         f"action=jump jump-target={chain['chain_name']}")

    lines.append(" ")

    # CGNAT — regras netmap por chain
    for chain in params["chains"]:
        chain_name = chain["chain_name"]
        private_subnet = chain["private_subnet"]
        port_start = chain["port_start"]
        port_end = chain["port_end"]

        if protocol in ("tcp_udp", "tcp_only"):
            lines.append(f"/ip firewall nat add action=netmap chain={chain_name} "
                         f"protocol=tcp src-address={private_subnet} "
                         f"to-addresses={public_prefix} to-ports={port_start}-{port_end}")
        if protocol == "tcp_udp":
            lines.append(f"/ip firewall nat add action=netmap chain={chain_name} "
                         f"protocol=udp src-address={private_subnet} "
                         f"to-addresses={public_prefix} to-ports={port_start}-{port_end}")

        lines.append(f"/ip firewall nat add action=netmap chain={chain_name} "
                     f"src-address={private_subnet} "
                     f"to-addresses={public_prefix}")

    return "\n".join(lines)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_cgnat(
    req: CgnatGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Gera script RouterOS CGNAT. Se save=True, salva a configuração e o mapeamento no banco.
    """
    try:
        params = _calculate_cgnat_params(
            private_network_str=req.private_network,
            public_prefix_str=req.public_prefix,
            clients_per_ip=req.clients_per_ip,
            sequential_chain=req.sequential_chain,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    script = _generate_ros_script(
        params=params,
        public_prefix=req.public_prefix,
        use_blackhole=req.use_blackhole,
        use_fasttrack=req.use_fasttrack,
        protocol=req.protocol,
        ros_version=req.ros_version,
        private_network=req.private_network,
        clients_per_ip=req.clients_per_ip,
    )

    config_id = None

    if req.save:
        # Salvar configuração
        config = CgnatConfig(
            name=req.name,
            description=req.description,
            private_network=req.private_network,
            private_prefix_len=32 - len(bin(params["total_private_ips"]).lstrip("0b")) + 1,
            public_prefix=req.public_prefix,
            clients_per_ip=req.clients_per_ip,
            sequential_chain=req.sequential_chain,
            use_blackhole=req.use_blackhole,
            use_fasttrack=req.use_fasttrack,
            protocol=req.protocol,
            ros_version=req.ros_version,
            total_private_ips=params["total_private_ips"],
            total_public_ips=params["total_public_ips"],
            ports_per_client=params["ports_per_client"],
            total_chains=params["total_chains"],
            created_by=current_user.id,
        )
        db.add(config)
        await db.flush()  # para obter config.id antes do commit

        config_id = str(config.id)

        # Salvar mapeamentos
        for m in params["mappings"]:
            mapping = CgnatMapping(
                config_id=config.id,
                private_ip=m["private_ip"],
                private_subnet=m["private_subnet"],
                public_ip=m["public_ip"],
                port_start=m["port_start"],
                port_end=m["port_end"],
                chain_index=m["chain_index"],
                chain_name=m["chain_name"],
            )
            db.add(mapping)

        await db.commit()

        await log_audit(
            db=db,
            user_id=current_user.id,
            action=AuditAction.CGNAT_SAVED,
            description=f"Configuração CGNAT salva: {req.name} ({req.public_prefix}, "
                        f"{req.clients_per_ip} clientes/IP, {params['total_private_ips']} IPs privados)",
            status="success",
            extra_data={
                "config_id": config_id,
                "public_prefix": req.public_prefix,
                "clients_per_ip": req.clients_per_ip,
                "total_private_ips": params["total_private_ips"],
                "total_public_ips": params["total_public_ips"],
                "ports_per_client": params["ports_per_client"],
            },
        )

    return {
        "script": script,
        "config_id": config_id,
        "saved": req.save,
        "stats": {
            "total_private_ips": params["total_private_ips"],
            "total_public_ips": params["total_public_ips"],
            "ports_per_client": params["ports_per_client"],
            "total_chains": params["total_chains"],
            "private_range_start": req.private_network,
            "private_range_end": str(
                ipaddress.ip_address(int(ipaddress.ip_address(req.private_network)) + params["total_private_ips"] - 1)
            ),
        },
        "mappings": params["mappings"] if not req.save else [],
    }


@router.get("/configs")
async def list_cgnat_configs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Listar configurações CGNAT salvas."""
    count_q = select(func.count(CgnatConfig.id))
    total = (await db.execute(count_q)).scalar()

    q = (
        select(CgnatConfig)
        .order_by(CgnatConfig.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    configs = (await db.execute(q)).scalars().all()

    return {
        "items": [_config_to_dict(c) for c in configs],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total else 0,
    }


@router.get("/configs/{config_id}")
async def get_cgnat_config(
    config_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Detalhe de uma configuração CGNAT."""
    config = await db.get(CgnatConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    return _config_to_dict(config)


@router.delete("/configs/{config_id}")
async def delete_cgnat_config(
    config_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Remover configuração CGNAT e todos os mapeamentos associados."""
    config = await db.get(CgnatConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")

    config_name = config.name
    config_prefix = config.public_prefix

    await db.execute(delete(CgnatMapping).where(CgnatMapping.config_id == config_id))
    await db.delete(config)
    await db.commit()

    await log_audit(
        db=db,
        user_id=current_user.id,
        action=AuditAction.CGNAT_DELETED,
        description=f"Configuração CGNAT removida: {config_name} ({config_prefix})",
        status="success",
    )

    return {"message": "Configuração removida com sucesso"}


@router.get("/configs/{config_id}/script")
async def get_cgnat_script(
    config_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Regenerar o script RouterOS de uma configuração salva."""
    config = await db.get(CgnatConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")

    try:
        params = _calculate_cgnat_params(
            private_network_str=config.private_network,
            public_prefix_str=config.public_prefix,
            clients_per_ip=config.clients_per_ip,
            sequential_chain=config.sequential_chain,
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"Erro ao recalcular parâmetros: {e}")

    script = _generate_ros_script(
        params=params,
        public_prefix=config.public_prefix,
        use_blackhole=config.use_blackhole,
        use_fasttrack=config.use_fasttrack,
        protocol=config.protocol,
        ros_version=config.ros_version,
        private_network=config.private_network,
        clients_per_ip=config.clients_per_ip,
    )

    return {"script": script, "config": _config_to_dict(config)}


@router.get("/configs/{config_id}/mappings")
async def get_cgnat_mappings(
    config_id: UUID,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=500),
    search: Optional[str] = Query(None, description="Buscar por IP privado ou público"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Listar mapeamento de portas de uma configuração CGNAT."""
    config = await db.get(CgnatConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")

    q = select(CgnatMapping).where(CgnatMapping.config_id == config_id)
    count_q = select(func.count(CgnatMapping.id)).where(CgnatMapping.config_id == config_id)

    if search:
        from sqlalchemy import or_
        search_filter = or_(
            CgnatMapping.private_ip.ilike(f"%{search}%"),
            CgnatMapping.public_ip.ilike(f"%{search}%"),
            CgnatMapping.chain_name.ilike(f"%{search}%"),
        )
        q = q.where(search_filter)
        count_q = count_q.where(search_filter)

    q = q.order_by(CgnatMapping.chain_index, CgnatMapping.private_ip)
    total = (await db.execute(count_q)).scalar()
    q = q.offset((page - 1) * per_page).limit(per_page)
    mappings = (await db.execute(q)).scalars().all()

    return {
        "config": _config_to_dict(config),
        "items": [_mapping_to_dict(m) for m in mappings],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total else 0,
    }


@router.get("/lookup")
async def lookup_cgnat(
    ip: str = Query(..., description="IP privado para consultar"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Consultar qual IP público e range de portas está mapeado para um IP privado.
    Retorna todos os mapeamentos encontrados (pode estar em múltiplas configurações).
    """
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        raise HTTPException(status_code=400, detail="IP inválido")

    q = (
        select(CgnatMapping, CgnatConfig)
        .join(CgnatConfig, CgnatMapping.config_id == CgnatConfig.id)
        .where(CgnatMapping.private_ip == ip)
        .order_by(CgnatConfig.created_at.desc())
    )
    rows = (await db.execute(q)).all()

    results = []
    for mapping, config in rows:
        results.append({
            "config_id": str(config.id),
            "config_name": config.name,
            "private_ip": mapping.private_ip,
            "private_subnet": mapping.private_subnet,
            "public_ip": mapping.public_ip,
            "port_start": mapping.port_start,
            "port_end": mapping.port_end,
            "chain_name": mapping.chain_name,
            "public_prefix": config.public_prefix,
        })

    return {"ip": ip, "results": results, "found": len(results) > 0}


# ─── Helpers de serialização ──────────────────────────────────────────────────

def _config_to_dict(c: CgnatConfig) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "description": c.description,
        "private_network": c.private_network,
        "public_prefix": c.public_prefix,
        "clients_per_ip": c.clients_per_ip,
        "sequential_chain": c.sequential_chain,
        "use_blackhole": c.use_blackhole,
        "use_fasttrack": c.use_fasttrack,
        "protocol": c.protocol,
        "ros_version": c.ros_version,
        "total_private_ips": c.total_private_ips,
        "total_public_ips": c.total_public_ips,
        "ports_per_client": c.ports_per_client,
        "total_chains": c.total_chains,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _mapping_to_dict(m: CgnatMapping) -> dict:
    return {
        "id": str(m.id),
        "private_ip": m.private_ip,
        "private_subnet": m.private_subnet,
        "public_ip": m.public_ip,
        "port_start": m.port_start,
        "port_end": m.port_end,
        "chain_index": m.chain_index,
        "chain_name": m.chain_name,
    }

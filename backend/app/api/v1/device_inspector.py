"""
BR10 NetManager - Device Inspector (Fase 1 — Somente Leitura)
=============================================================
Módulo de consulta read-only de dispositivos via SSH/Telnet.
Executa exclusivamente comandos 'display' (Huawei VRP/OLT) ou 'show' (Cisco/Mikrotik).

Segurança:
  - Apenas comandos da whitelist são permitidos
  - Nenhum comando de configuração (system-view, config t, etc.) é aceito
  - Toda consulta é registrada no log de auditoria
  - Credenciais nunca são expostas na resposta

Suporte:
  - Huawei NE40E / NE8000 (VRP)
  - Huawei OLT MA5800 / MA5600
  - Huawei Switch S5700 / S6730
  - Mikrotik RouterOS
  - Cisco IOS / IOS-XE
  - Genérico (comandos livres da whitelist)
"""
import asyncio
import logging
import re
import time
from typing import List, Optional, Dict, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.core.security import decrypt_field
from app.models.device import Device
from app.models.user import User
from app.services.command_runner import CommandRunner

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/device-inspector", tags=["Device Inspector"])

# ─── Whitelist de comandos permitidos ─────────────────────────────────────────
# Apenas prefixos read-only são aceitos. Qualquer outro comando é bloqueado.

ALLOWED_PREFIXES = (
    # Huawei VRP
    "display ",
    "dis ",
    # Cisco / genérico
    "show ",
    # Mikrotik
    "/ip ",
    "/interface ",
    "/routing ",
    "/system ",
    "/mpls ",
    "/queue ",
    "/tool ",
    # Huawei OLT
    "display ont",
    "display board",
    "display port",
    "display alarm",
    "display dba",
    "display service-port",
    "display traffic",
    # Auxiliares (sem efeito de escrita)
    "ping ",
    "tracert ",
    "traceroute ",
)

BLOCKED_KEYWORDS = (
    "system-view", "config", "configure", "commit", "save",
    "undo ", "set ", "delete ", "reset ", "reboot", "shutdown",
    "interface ", "vlan ", "ip route", "bgp ", "ospf ",
    "no ", "write ", "copy ", "erase ", "format ",
)


def _validate_command(cmd: str) -> None:
    """Valida que o comando é somente leitura. Lança HTTPException se inválido."""
    cmd_lower = cmd.strip().lower()
    if not cmd_lower:
        raise HTTPException(status_code=400, detail="Comando vazio.")

    # Verifica se começa com prefixo permitido
    if not any(cmd_lower.startswith(p) for p in ALLOWED_PREFIXES):
        raise HTTPException(
            status_code=403,
            detail=f"Comando não permitido: '{cmd.strip()}'. "
                   "Apenas comandos 'display' e 'show' são aceitos neste módulo."
        )

    # Verifica palavras-chave bloqueadas
    for kw in BLOCKED_KEYWORDS:
        if kw in cmd_lower:
            raise HTTPException(
                status_code=403,
                detail=f"Comando bloqueado: contém '{kw}'. Apenas consultas são permitidas."
            )


# ─── Catálogo de consultas por tipo de dispositivo ────────────────────────────

INSPECTION_CATALOG: Dict[str, Dict[str, Any]] = {

    # ── Huawei NE40E / NE8000 (VRP) ──────────────────────────────────────────
    "huawei_ne8000": {
        "label": "Huawei NE40E / NE8000",
        "categories": {
            "interfaces": {
                "label": "Interfaces",
                "icon": "Network",
                "commands": [
                    "display interface brief",
                    "display ip interface brief",
                ],
            },
            "bgp": {
                "label": "BGP",
                "icon": "GitBranch",
                "commands": [
                    "display bgp summary",
                    "display bgp peer",
                    "display bgp routing-table statistics",
                ],
            },
            "routing": {
                "label": "Tabela de Rotas",
                "icon": "Route",
                "commands": [
                    "display ip routing-table statistics",
                    "display ip routing-table",
                ],
            },
            "ospf": {
                "label": "OSPF",
                "icon": "Share2",
                "commands": [
                    "display ospf peer brief",
                    "display ospf brief",
                ],
            },
            "mpls": {
                "label": "MPLS / LDP",
                "icon": "Layers",
                "commands": [
                    "display mpls ldp session",
                    "display mpls lsp",
                    "display mpls ldp peer",
                ],
            },
            "vrf": {
                "label": "VRF / VPN",
                "icon": "Lock",
                "commands": [
                    "display ip vpn-instance",
                    "display bgp vpnv4 all summary",
                ],
            },
            "system": {
                "label": "Sistema",
                "icon": "Cpu",
                "commands": [
                    "display version",
                    "display cpu-usage",
                    "display memory-usage",
                    "display device",
                ],
            },
            "logs": {
                "label": "Logs / Alarmes",
                "icon": "AlertTriangle",
                "commands": [
                    "display logbuffer",
                    "display alarm active",
                ],
            },
            "arp": {
                "label": "ARP",
                "icon": "Link",
                "commands": [
                    "display arp all",
                    "display arp statistics all",
                ],
            },
        },
    },

    # ── Huawei OLT (MA5800 / MA5600) ─────────────────────────────────────────
    "generic_olt": {
        "label": "Huawei OLT (MA5800/MA5600)",
        "categories": {
            "boards": {
                "label": "Placas / Portas",
                "icon": "Server",
                "commands": [
                    "display board 0",
                    "display port state all",
                ],
            },
            "ont_online": {
                "label": "ONUs Online",
                "icon": "Wifi",
                "commands": [
                    "display ont info summary 0",
                ],
            },
            "ont_offline": {
                "label": "ONUs Offline / Falhas",
                "icon": "WifiOff",
                "commands": [
                    "display ont info failed-table 0",
                ],
            },
            "optical": {
                "label": "Sinal Óptico",
                "icon": "Zap",
                "commands": [
                    "display ont optical-info 0 all",
                ],
            },
            "vlans": {
                "label": "VLANs",
                "icon": "Layers",
                "commands": [
                    "display vlan all",
                ],
            },
            "service_ports": {
                "label": "Service Ports",
                "icon": "Plug",
                "commands": [
                    "display service-port all",
                ],
            },
            "dba": {
                "label": "DBA Profiles",
                "icon": "BarChart2",
                "commands": [
                    "display dba-profile all",
                ],
            },
            "alarms": {
                "label": "Alarmes Ativos",
                "icon": "AlertTriangle",
                "commands": [
                    "display alarm active",
                ],
            },
            "system": {
                "label": "Sistema",
                "icon": "Cpu",
                "commands": [
                    "display version",
                    "display cpu-usage",
                    "display memory-usage",
                ],
            },
        },
    },

    # ── Huawei Switch (S5700 / S6730) ─────────────────────────────────────────
    "huawei_6730": {
        "label": "Huawei Switch (S5700/S6730)",
        "categories": {
            "interfaces": {
                "label": "Interfaces",
                "icon": "Network",
                "commands": [
                    "display interface brief",
                    "display ip interface brief",
                ],
            },
            "vlans": {
                "label": "VLANs",
                "icon": "Layers",
                "commands": [
                    "display vlan all",
                    "display port vlan",
                ],
            },
            "stp": {
                "label": "STP / RSTP",
                "icon": "GitMerge",
                "commands": [
                    "display stp brief",
                    "display stp",
                ],
            },
            "mac": {
                "label": "Tabela MAC",
                "icon": "Database",
                "commands": [
                    "display mac-address",
                    "display mac-address statistics",
                ],
            },
            "lacp": {
                "label": "LACP / Eth-Trunk",
                "icon": "Link",
                "commands": [
                    "display eth-trunk",
                    "display lacp brief",
                ],
            },
            "arp": {
                "label": "ARP",
                "icon": "Link2",
                "commands": [
                    "display arp all",
                ],
            },
            "routing": {
                "label": "Rotas",
                "icon": "Route",
                "commands": [
                    "display ip routing-table",
                ],
            },
            "system": {
                "label": "Sistema",
                "icon": "Cpu",
                "commands": [
                    "display version",
                    "display cpu-usage",
                    "display memory-usage",
                    "display device",
                ],
            },
        },
    },

    # ── Mikrotik RouterOS ─────────────────────────────────────────────────────
    "mikrotik": {
        "label": "Mikrotik RouterOS",
        "categories": {
            "interfaces": {
                "label": "Interfaces",
                "icon": "Network",
                "commands": [
                    "/interface print detail",
                    "/interface ethernet print",
                ],
            },
            "routing": {
                "label": "Rotas",
                "icon": "Route",
                "commands": [
                    "/ip route print",
                    "/ip route summary print",
                ],
            },
            "bgp": {
                "label": "BGP",
                "icon": "GitBranch",
                "commands": [
                    "/routing bgp peer print",
                    "/routing bgp advertisement print",
                ],
            },
            "addresses": {
                "label": "Endereços IP",
                "icon": "Globe",
                "commands": [
                    "/ip address print",
                ],
            },
            "firewall": {
                "label": "Firewall / Regras",
                "icon": "Shield",
                "commands": [
                    "/ip firewall filter print",
                    "/ip firewall nat print",
                ],
            },
            "system": {
                "label": "Sistema",
                "icon": "Cpu",
                "commands": [
                    "/system resource print",
                    "/system identity print",
                    "/system routerboard print",
                ],
            },
            "logs": {
                "label": "Logs",
                "icon": "FileText",
                "commands": [
                    "/log print",
                ],
            },
        },
    },

    # ── Cisco IOS / IOS-XE ────────────────────────────────────────────────────
    "cisco": {
        "label": "Cisco IOS / IOS-XE",
        "categories": {
            "interfaces": {
                "label": "Interfaces",
                "icon": "Network",
                "commands": [
                    "show interfaces status",
                    "show ip interface brief",
                ],
            },
            "bgp": {
                "label": "BGP",
                "icon": "GitBranch",
                "commands": [
                    "show bgp summary",
                    "show bgp neighbors",
                ],
            },
            "routing": {
                "label": "Tabela de Rotas",
                "icon": "Route",
                "commands": [
                    "show ip route summary",
                    "show ip route",
                ],
            },
            "ospf": {
                "label": "OSPF",
                "icon": "Share2",
                "commands": [
                    "show ip ospf neighbor",
                    "show ip ospf",
                ],
            },
            "vlans": {
                "label": "VLANs",
                "icon": "Layers",
                "commands": [
                    "show vlan brief",
                ],
            },
            "system": {
                "label": "Sistema",
                "icon": "Cpu",
                "commands": [
                    "show version",
                    "show processes cpu sorted",
                    "show memory statistics",
                ],
            },
            "logs": {
                "label": "Logs",
                "icon": "FileText",
                "commands": [
                    "show logging",
                ],
            },
        },
    },

    # ── Genérico (qualquer dispositivo) ───────────────────────────────────────
    "generic_router": {
        "label": "Roteador Genérico",
        "categories": {
            "interfaces": {
                "label": "Interfaces",
                "icon": "Network",
                "commands": ["display interface brief"],
            },
            "routing": {
                "label": "Rotas",
                "icon": "Route",
                "commands": ["display ip routing-table"],
            },
            "system": {
                "label": "Sistema",
                "icon": "Cpu",
                "commands": ["display version"],
            },
        },
    },
    "generic_switch": {
        "label": "Switch Genérico",
        "categories": {
            "interfaces": {
                "label": "Interfaces",
                "icon": "Network",
                "commands": ["display interface brief"],
            },
            "vlans": {
                "label": "VLANs",
                "icon": "Layers",
                "commands": ["display vlan all"],
            },
            "system": {
                "label": "Sistema",
                "icon": "Cpu",
                "commands": ["display version"],
            },
        },
    },
}

# Alias para outros tipos Huawei
INSPECTION_CATALOG["juniper"] = {
    "label": "Juniper JunOS",
    "categories": {
        "interfaces": {
            "label": "Interfaces",
            "icon": "Network",
            "commands": ["show interfaces terse", "show interfaces"],
        },
        "bgp": {
            "label": "BGP",
            "icon": "GitBranch",
            "commands": ["show bgp summary", "show bgp neighbor"],
        },
        "routing": {
            "label": "Tabela de Rotas",
            "icon": "Route",
            "commands": ["show route summary", "show route"],
        },
        "system": {
            "label": "Sistema",
            "icon": "Cpu",
            "commands": ["show version", "show chassis hardware", "show system uptime"],
        },
    },
}
INSPECTION_CATALOG["datacom"] = INSPECTION_CATALOG["huawei_6730"]
INSPECTION_CATALOG["vsol_olt"] = INSPECTION_CATALOG["generic_olt"]
INSPECTION_CATALOG["other"] = INSPECTION_CATALOG["generic_router"]


# ─── Schemas ──────────────────────────────────────────────────────────────────

class InspectRequest(BaseModel):
    device_id: str
    category: str
    custom_commands: Optional[List[str]] = None  # Comandos customizados (validados)
    timeout: int = 30
    interactive: bool = True  # Huawei VRP requer modo interativo


class CommandResult(BaseModel):
    command: str
    output: str
    success: bool
    duration_ms: int
    error: Optional[str] = None


class InspectResponse(BaseModel):
    device_id: str
    device_name: str
    device_ip: str
    device_type: str
    protocol: str
    category: str
    category_label: str
    results: List[CommandResult]
    total_duration_ms: int
    timestamp: str


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_catalog_for_device(device_type: str) -> Dict[str, Any]:
    """Retorna o catálogo de comandos para o tipo de dispositivo."""
    return INSPECTION_CATALOG.get(device_type, INSPECTION_CATALOG["generic_router"])


def _clean_output(output: str) -> str:
    """Remove caracteres de controle ANSI e limpeza básica do output."""
    # Remove sequências ANSI de cor/controle
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    output = ansi_escape.sub('', output)
    # Remove caracteres de controle (exceto \n e \t)
    output = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', output)
    # Normaliza quebras de linha
    output = output.replace('\r\n', '\n').replace('\r', '\n')
    # Remove linhas em branco excessivas (mais de 2 seguidas)
    output = re.sub(r'\n{3,}', '\n\n', output)
    return output.strip()


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/catalog")
async def get_catalog(
    current_user: User = Depends(get_current_user),
):
    """
    Retorna o catálogo completo de consultas disponíveis por tipo de dispositivo.
    Usado pelo frontend para montar os menus de categorias dinamicamente.
    """
    catalog_summary = {}
    for device_type, info in INSPECTION_CATALOG.items():
        catalog_summary[device_type] = {
            "label": info["label"],
            "categories": {
                cat_id: {
                    "label": cat["label"],
                    "icon": cat["icon"],
                    "command_count": len(cat["commands"]),
                }
                for cat_id, cat in info["categories"].items()
            },
        }
    return catalog_summary


@router.get("/catalog/{device_type}")
async def get_catalog_for_type(
    device_type: str,
    current_user: User = Depends(get_current_user),
):
    """Retorna o catálogo de consultas para um tipo específico de dispositivo."""
    catalog = _get_catalog_for_device(device_type)
    return {
        "device_type": device_type,
        "label": catalog["label"],
        "categories": {
            cat_id: {
                "label": cat["label"],
                "icon": cat["icon"],
                "commands": cat["commands"],
            }
            for cat_id, cat in catalog["categories"].items()
        },
    }


@router.post("/inspect")
async def inspect_device(
    body: InspectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Executa uma consulta read-only em um dispositivo.

    - Valida que todos os comandos são somente leitura
    - Conecta via SSH ou Telnet usando credenciais cadastradas
    - Retorna o output de cada comando separadamente
    - Registra a consulta no log de auditoria
    """
    # ── Busca o dispositivo ───────────────────────────────────────────────────
    result = await db.execute(select(Device).where(Device.id == body.device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Dispositivo não encontrado.")
    if not device.is_active:
        raise HTTPException(status_code=400, detail="Dispositivo inativo.")

    # ── Determina os comandos a executar ─────────────────────────────────────
    device_type = device.device_type.value if hasattr(device.device_type, "value") else str(device.device_type)
    catalog = _get_catalog_for_device(device_type)

    if body.custom_commands:
        # Valida cada comando customizado
        for cmd in body.custom_commands:
            _validate_command(cmd)
        commands = body.custom_commands
        category_label = "Consulta Customizada"
    else:
        if body.category not in catalog["categories"]:
            available = list(catalog["categories"].keys())
            raise HTTPException(
                status_code=400,
                detail=f"Categoria '{body.category}' não disponível para {device_type}. "
                       f"Disponíveis: {available}"
            )
        cat = catalog["categories"][body.category]
        commands = cat["commands"]
        category_label = cat["label"]

    # ── Descriptografa credenciais ────────────────────────────────────────────
    try:
        password = decrypt_field(device.password_encrypted) if device.password_encrypted else ""
    except Exception:
        password = ""

    try:
        enable_password = decrypt_field(device.enable_password_encrypted) if device.enable_password_encrypted else ""
    except Exception:
        enable_password = ""

    try:
        private_key = decrypt_field(device.ssh_private_key_encrypted) if device.ssh_private_key_encrypted else None
    except Exception:
        private_key = None

    if not device.username:
        raise HTTPException(status_code=400, detail="Dispositivo sem usuário configurado.")

    protocol = device.primary_protocol.value if hasattr(device.primary_protocol, "value") else "ssh"
    port = device.ssh_port if protocol == "ssh" else device.telnet_port

    # ── Executa os comandos ───────────────────────────────────────────────────
    runner = CommandRunner(
        host=device.management_ip,
        port=port or 22,
        username=device.username,
        password=password,
        protocol=protocol,
        timeout=body.timeout,
        private_key=private_key,
    )

    results: List[CommandResult] = []
    total_start = time.time()

    for cmd in commands:
        cmd_start = time.time()
        try:
            # Huawei VRP e OLT precisam de modo interativo (invoke_shell)
            # para lidar com paginadores e prompts corretamente
            use_interactive = body.interactive or device_type in (
                "huawei_ne8000", "huawei_6730", "generic_olt",
                "vsol_olt", "datacom",
            )
            success, output, duration_ms = await runner.run(cmd, interactive=use_interactive)
            output_clean = _clean_output(output)
            results.append(CommandResult(
                command=cmd,
                output=output_clean,
                success=success,
                duration_ms=duration_ms,
                error=None if success else output_clean,
            ))
        except Exception as e:
            duration_ms = int((time.time() - cmd_start) * 1000)
            results.append(CommandResult(
                command=cmd,
                output="",
                success=False,
                duration_ms=duration_ms,
                error=str(e),
            ))

    total_duration_ms = int((time.time() - total_start) * 1000)

    # ── Log de auditoria ──────────────────────────────────────────────────────
    logger.info(
        f"[Inspector] Usuário '{current_user.username}' consultou "
        f"'{device.name}' ({device.management_ip}) — "
        f"categoria: {body.category} — "
        f"{len(commands)} comandos em {total_duration_ms}ms"
    )

    from datetime import datetime, timezone
    return InspectResponse(
        device_id=str(device.id),
        device_name=device.name,
        device_ip=device.management_ip,
        device_type=device_type,
        protocol=protocol,
        category=body.category,
        category_label=category_label,
        results=results,
        total_duration_ms=total_duration_ms,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/inspect/custom")
async def inspect_custom(
    device_id: str,
    commands: List[str],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Executa comandos customizados (somente leitura) em um dispositivo.
    Todos os comandos são validados contra a whitelist antes de executar.
    """
    for cmd in commands:
        _validate_command(cmd)

    body = InspectRequest(
        device_id=device_id,
        category="custom",
        custom_commands=commands,
    )
    return await inspect_device(body, db, current_user)


@router.get("/devices")
async def list_inspectable_devices(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Lista todos os dispositivos ativos com suas informações básicas e
    as categorias de consulta disponíveis para cada um.
    """
    result = await db.execute(
        select(Device)
        .where(Device.is_active == True)
        .order_by(Device.name)
    )
    devices = result.scalars().all()

    device_list = []
    for d in devices:
        device_type = d.device_type.value if hasattr(d.device_type, "value") else str(d.device_type)
        protocol = d.primary_protocol.value if hasattr(d.primary_protocol, "value") else "ssh"
        catalog = _get_catalog_for_device(device_type)
        status = d.status.value if hasattr(d.status, "value") else str(d.status)

        device_list.append({
            "id": str(d.id),
            "name": d.name,
            "hostname": d.hostname,
            "management_ip": d.management_ip,
            "device_type": device_type,
            "device_type_label": catalog["label"],
            "manufacturer": d.manufacturer,
            "model": d.model,
            "status": status,
            "protocol": protocol,
            "has_credentials": bool(d.username and (d.password_encrypted or d.ssh_private_key_encrypted)),
            "client_name": d.client_name,
            "location": d.location,
            "categories": list(catalog["categories"].keys()),
            "category_labels": {
                cat_id: cat["label"]
                for cat_id, cat in catalog["categories"].items()
            },
        })

    return {"devices": device_list, "total": len(device_list)}

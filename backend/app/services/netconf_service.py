"""
Serviço de Gestão via NETCONF/SSH para roteadores Huawei (VRP).

Ações suportadas:
  - Ativar / Desativar interface
  - Criar / Remover peer BGP
  - Ativar / Desativar sessão BGP (peer enable/undo)
  - Listar interfaces e sessões BGP via SSH CLI

Usa ncclient para NETCONF (porta 830) e paramiko para SSH CLI como fallback.
"""
import asyncio
import logging
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

# ─── SSH CLI (via paramiko em thread separada) ────────────────────────────────

def _ssh_exec(host: str, username: str, password: str, commands: list[str],
              port: int = 22, timeout: int = 30) -> dict:
    """
    Executa uma lista de comandos via SSH no roteador Huawei.
    Retorna dict com output e status.
    Executado em thread separada (não bloqueante para asyncio).
    """
    import paramiko
    import socket

    output_lines = []
    error = None
    start = time.monotonic()

    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=timeout,
            allow_agent=False,
            look_for_keys=False,
            banner_timeout=30,
        )

        channel = client.invoke_shell(width=200, height=50)
        channel.settimeout(timeout)

        # Aguarda o prompt inicial
        _read_until_prompt(channel, timeout=10)

        # Desativa paginação
        channel.send("screen-length 0 temporary\n")
        _read_until_prompt(channel, timeout=5)

        # Executa cada comando
        for cmd in commands:
            channel.send(cmd + "\n")
            out = _read_until_prompt(channel, timeout=timeout)
            output_lines.append(f"[CMD] {cmd}")
            output_lines.append(out)

        channel.close()
        client.close()

    except Exception as e:
        error = str(e)
        logger.error(f"SSH {host}: {e}")

    duration_ms = int((time.monotonic() - start) * 1000)
    return {
        "success":     error is None,
        "output":      "\n".join(output_lines),
        "error":       error,
        "duration_ms": duration_ms,
    }


def _read_until_prompt(channel, timeout: int = 10) -> str:
    """Lê do canal SSH até encontrar um prompt Huawei (#, >, [])."""
    import socket
    output = ""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if channel.recv_ready():
                chunk = channel.recv(4096).decode("utf-8", errors="replace")
                output += chunk
                # Prompts Huawei: ">", "#", "]"
                if re.search(r"[>#\]]\s*$", output.rstrip()):
                    break
            else:
                time.sleep(0.1)
        except Exception:
            break
    return output


async def _run_ssh(host: str, username: str, password: str, commands: list[str],
                   port: int = 22, timeout: int = 30) -> dict:
    """Wrapper assíncrono para _ssh_exec (executa em thread pool)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: _ssh_exec(host, username, password, commands, port, timeout),
    )


# ─── Ações de Gestão ─────────────────────────────────────────────────────────

async def interface_enable(host: str, username: str, password: str,
                           interface_name: str, port: int = 22) -> dict:
    """Ativa uma interface (undo shutdown)."""
    commands = [
        "system-view",
        f"interface {interface_name}",
        "undo shutdown",
        "commit",
        "quit",
        "quit",
    ]
    result = await _run_ssh(host, username, password, commands, port)
    result["action"] = "interface_enable"
    result["interface"] = interface_name
    return result


async def interface_disable(host: str, username: str, password: str,
                            interface_name: str, port: int = 22) -> dict:
    """Desativa uma interface (shutdown)."""
    commands = [
        "system-view",
        f"interface {interface_name}",
        "shutdown",
        "commit",
        "quit",
        "quit",
    ]
    result = await _run_ssh(host, username, password, commands, port)
    result["action"] = "interface_disable"
    result["interface"] = interface_name
    return result


async def bgp_peer_enable(host: str, username: str, password: str,
                          local_asn: int, peer_ip: str, port: int = 22) -> dict:
    """Ativa uma sessão BGP (peer enable)."""
    commands = [
        "system-view",
        f"bgp {local_asn}",
        f"peer {peer_ip} enable",
        "commit",
        "quit",
        "quit",
    ]
    result = await _run_ssh(host, username, password, commands, port)
    result["action"] = "bgp_peer_enable"
    result["peer_ip"] = peer_ip
    return result


async def bgp_peer_disable(host: str, username: str, password: str,
                           local_asn: int, peer_ip: str, port: int = 22) -> dict:
    """Desativa uma sessão BGP (undo peer enable)."""
    commands = [
        "system-view",
        f"bgp {local_asn}",
        f"undo peer {peer_ip} enable",
        "commit",
        "quit",
        "quit",
    ]
    result = await _run_ssh(host, username, password, commands, port)
    result["action"] = "bgp_peer_disable"
    result["peer_ip"] = peer_ip
    return result


async def bgp_peer_create(host: str, username: str, password: str,
                          local_asn: int, peer_ip: str, remote_asn: int,
                          description: str = "", port: int = 22) -> dict:
    """Cria um novo peer BGP."""
    commands = [
        "system-view",
        f"bgp {local_asn}",
        f"peer {peer_ip} as-number {remote_asn}",
    ]
    if description:
        commands.append(f"peer {peer_ip} description {description}")
    commands += [
        f"peer {peer_ip} enable",
        "commit",
        "quit",
        "quit",
    ]
    result = await _run_ssh(host, username, password, commands, port)
    result["action"] = "bgp_peer_create"
    result["peer_ip"] = peer_ip
    result["remote_asn"] = remote_asn
    return result


async def bgp_peer_remove(host: str, username: str, password: str,
                          local_asn: int, peer_ip: str, port: int = 22) -> dict:
    """Remove um peer BGP."""
    commands = [
        "system-view",
        f"bgp {local_asn}",
        f"undo peer {peer_ip}",
        "commit",
        "quit",
        "quit",
    ]
    result = await _run_ssh(host, username, password, commands, port)
    result["action"] = "bgp_peer_remove"
    result["peer_ip"] = peer_ip
    return result


async def get_interfaces_cli(host: str, username: str, password: str,
                             port: int = 22) -> dict:
    """Obtém lista de interfaces via CLI (display interface brief)."""
    commands = ["display interface brief"]
    result = await _run_ssh(host, username, password, commands, port)
    interfaces = []
    if result["success"] and result["output"]:
        # Parse da saída do Huawei:
        # Interface            PHY   Protocol InUti OutUti   inErrors  outErrors
        # GigabitEthernet0/0/0 up    up         0%     0%          0          0
        for line in result["output"].splitlines():
            m = re.match(
                r"^(\S+)\s+(up|down|\*down|administratively down)\s+(up|down)\s+",
                line, re.IGNORECASE
            )
            if m:
                phy_status = m.group(2).lower().replace("*", "")
                interfaces.append({
                    "name":       m.group(1),
                    "phy_status": phy_status,
                    "proto_status": m.group(3).lower(),
                    "is_up":      phy_status == "up",
                })
    result["interfaces"] = interfaces
    return result


async def get_bgp_summary_cli(host: str, username: str, password: str,
                              local_asn: int, port: int = 22) -> dict:
    """Obtém resumo das sessões BGP via CLI."""
    commands = [f"display bgp peer"]
    result = await _run_ssh(host, username, password, commands, port)
    peers = []
    if result["success"] and result["output"]:
        # Parse da saída do Huawei:
        # Peer            V    AS  MsgRcvd  MsgSent  OutQ  Up/Down       State  PrefRcv
        # 10.0.0.1        4  65001    12345    12346     0  1d02h03m  Established     100
        for line in result["output"].splitlines():
            m = re.match(
                r"^\s*(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\S+\s+(\w+)\s+(\d+)?",
                line
            )
            if m:
                peers.append({
                    "peer_ip":    m.group(1),
                    "version":    int(m.group(2)),
                    "remote_as":  int(m.group(3)),
                    "state":      m.group(4),
                    "is_established": m.group(4).lower() == "established",
                    "prefixes_received": int(m.group(5)) if m.group(5) else 0,
                })
    result["peers"] = peers
    return result

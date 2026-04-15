"""
Serviço de Monitoramento SNMP para roteadores Huawei (e outros vendors).

Coleta via SNMPv2c:
  - CPU usage (OID Huawei + fallback genérico)
  - Memória usada/total
  - Status e tráfego de interfaces (IF-MIB)
  - Sessões BGP (BGP4-MIB)
  - Uptime, sysName, sysDescr

Usa pysnmp (assíncrono via asyncio).
"""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

try:
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity,
        getCmd, bulkCmd,
    )
    PYSNMP_AVAILABLE = True
except ImportError:
    PYSNMP_AVAILABLE = False
    logger.warning("pysnmp não instalado — módulo SNMP desabilitado. Execute: pip install pysnmp")

# ─── OIDs ─────────────────────────────────────────────────────────────────────

# Sistema
OID_SYS_DESCR    = "1.3.6.1.2.1.1.1.0"
OID_SYS_NAME     = "1.3.6.1.2.1.1.5.0"
OID_SYS_UPTIME   = "1.3.6.1.2.1.1.3.0"
OID_SYS_CONTACT  = "1.3.6.1.2.1.1.4.0"
OID_SYS_LOCATION = "1.3.6.1.2.1.1.6.0"

# CPU Huawei (VRP)
OID_HUAWEI_CPU_5SEC  = "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5"   # HUAWEI-ENTITY-EXTENT-MIB
OID_HUAWEI_CPU_1MIN  = "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.6"
OID_HUAWEI_CPU_5MIN  = "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7"

# CPU genérico (HOST-RESOURCES-MIB) — fallback
OID_HOST_CPU_LOAD    = "1.3.6.1.2.1.25.3.3.1.2"

# Memória Huawei
OID_HUAWEI_MEM_TOTAL = "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.37"  # bytes
OID_HUAWEI_MEM_FREE  = "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.38"  # bytes

# Interfaces (IF-MIB)
OID_IF_TABLE         = "1.3.6.1.2.1.2.2"
OID_IF_DESCR         = "1.3.6.1.2.1.2.2.1.2"    # ifDescr
OID_IF_OPER_STATUS   = "1.3.6.1.2.1.2.2.1.8"    # ifOperStatus: 1=up, 2=down
OID_IF_IN_OCTETS     = "1.3.6.1.2.1.2.2.1.10"   # ifInOctets (32-bit)
OID_IF_OUT_OCTETS    = "1.3.6.1.2.1.2.2.1.16"   # ifOutOctets (32-bit)
OID_IF_IN_OCTETS_HC  = "1.3.6.1.2.1.31.1.1.1.6" # ifHCInOctets (64-bit)
OID_IF_OUT_OCTETS_HC = "1.3.6.1.2.1.31.1.1.1.10"# ifHCOutOctets (64-bit)
OID_IF_IN_ERRORS     = "1.3.6.1.2.1.2.2.1.14"   # ifInErrors
OID_IF_OUT_ERRORS    = "1.3.6.1.2.1.2.2.1.20"   # ifOutErrors
OID_IF_NAME          = "1.3.6.1.2.1.31.1.1.1.1" # ifName (IF-MIB extension)
OID_IF_ALIAS         = "1.3.6.1.2.1.31.1.1.1.18"# ifAlias

# BGP (BGP4-MIB)
OID_BGP_PEER_TABLE   = "1.3.6.1.2.1.15.3"
OID_BGP_PEER_STATE   = "1.3.6.1.2.1.15.3.1.2"   # bgpPeerState: 1=idle..6=established
OID_BGP_PEER_REMOTE_AS = "1.3.6.1.2.1.15.3.1.9" # bgpPeerRemoteAs
OID_BGP_PEER_IN_PREFIXES = "1.3.6.1.2.1.15.3.1.24" # bgpPeerInUpdateElapsedTime (fallback)
# Huawei BGP prefixes (HUAWEI-BGP-VPN-MIB)
OID_HUAWEI_BGP_PEER_PREFIXES = "1.3.6.1.4.1.2011.5.25.177.1.1.3.1.11"

BGP_STATE_NAMES = {
    1: "idle", 2: "connect", 3: "active",
    4: "opensent", 5: "openconfirm", 6: "established",
}


# ─── Helper: SNMP GET ─────────────────────────────────────────────────────────

async def snmp_get(host: str, community: str, oid: str, port: int = 161, timeout: int = 5) -> Any:
    """Executa um SNMP GET e retorna o valor ou None em caso de erro."""
    if not PYSNMP_AVAILABLE:
        return None
    try:
        engine = SnmpEngine()
        error_indication, error_status, error_index, var_binds = await getCmd(
            engine,
            CommunityData(community, mpModel=1),  # mpModel=1 = SNMPv2c
            await UdpTransportTarget.create((host, port), timeout=timeout, retries=1),
            ContextData(),
            ObjectType(ObjectIdentity(oid)),
        )
        if error_indication or error_status:
            return None
        for var_bind in var_binds:
            return var_bind[1].prettyPrint()
    except Exception as e:
        logger.debug(f"SNMP GET {host} {oid}: {e}")
        return None


async def snmp_bulk_walk(host: str, community: str, oid: str, port: int = 161,
                         timeout: int = 10, max_rows: int = 512) -> list[tuple[str, str]]:
    """Executa SNMP BULK WALK e retorna lista de (oid_suffix, value)."""
    if not PYSNMP_AVAILABLE:
        return []
    results = []
    try:
        engine = SnmpEngine()
        async for error_indication, error_status, _, var_bind_table in bulkCmd(
            engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((host, port), timeout=timeout, retries=1),
            ContextData(),
            0, 25,
            ObjectType(ObjectIdentity(oid)),
            lexicographicMode=False,
        ):
            if error_indication or error_status:
                break
            for var_bind in var_bind_table:
                oid_str = str(var_bind[0])
                val_str = var_bind[1].prettyPrint()
                results.append((oid_str, val_str))
                if len(results) >= max_rows:
                    return results
    except Exception as e:
        logger.debug(f"SNMP WALK {host} {oid}: {e}")
    return results


# ─── Coleta de métricas ───────────────────────────────────────────────────────

async def collect_system_info(host: str, community: str, port: int = 161) -> dict:
    """Coleta informações básicas do sistema (sysName, sysDescr, uptime)."""
    tasks = [
        snmp_get(host, community, OID_SYS_NAME, port),
        snmp_get(host, community, OID_SYS_DESCR, port),
        snmp_get(host, community, OID_SYS_UPTIME, port),
        snmp_get(host, community, OID_SYS_CONTACT, port),
        snmp_get(host, community, OID_SYS_LOCATION, port),
    ]
    results = await asyncio.gather(*tasks)
    uptime_raw = results[2]
    uptime_seconds = None
    if uptime_raw:
        try:
            # sysUpTime é em centisegundos (timeticks)
            uptime_seconds = int(uptime_raw.split("(")[1].split(")")[0]) // 100
        except Exception:
            try:
                uptime_seconds = int(uptime_raw) // 100
            except Exception:
                pass
    return {
        "sys_name":     results[0],
        "sys_descr":    results[1],
        "uptime_seconds": uptime_seconds,
        "sys_contact":  results[3],
        "sys_location": results[4],
    }


async def collect_cpu(host: str, community: str, port: int = 161) -> float | None:
    """Coleta CPU usage (%). Tenta OID Huawei primeiro, depois fallback genérico."""
    # Huawei VRP: walk na tabela de entidades para pegar o primeiro valor
    rows = await snmp_bulk_walk(host, community, OID_HUAWEI_CPU_5MIN, port, max_rows=5)
    for _, val in rows:
        try:
            cpu = float(val)
            if 0 <= cpu <= 100:
                return cpu
        except (ValueError, TypeError):
            pass

    # Fallback: HOST-RESOURCES-MIB
    rows = await snmp_bulk_walk(host, community, OID_HOST_CPU_LOAD, port, max_rows=5)
    for _, val in rows:
        try:
            cpu = float(val)
            if 0 <= cpu <= 100:
                return cpu
        except (ValueError, TypeError):
            pass
    return None


async def collect_memory(host: str, community: str, port: int = 161) -> dict:
    """Coleta memória total e usada (Huawei VRP)."""
    total_rows = await snmp_bulk_walk(host, community, OID_HUAWEI_MEM_TOTAL, port, max_rows=5)
    free_rows  = await snmp_bulk_walk(host, community, OID_HUAWEI_MEM_FREE,  port, max_rows=5)

    total_bytes = None
    free_bytes  = None

    for _, val in total_rows:
        try:
            total_bytes = int(val)
            break
        except (ValueError, TypeError):
            pass

    for _, val in free_rows:
        try:
            free_bytes = int(val)
            break
        except (ValueError, TypeError):
            pass

    if total_bytes and total_bytes > 0:
        used_bytes = (total_bytes - free_bytes) if free_bytes is not None else None
        used_mb    = round(used_bytes / 1024 / 1024, 2) if used_bytes is not None else None
        total_mb   = round(total_bytes / 1024 / 1024, 2)
        usage_pct  = round((used_bytes / total_bytes) * 100, 2) if used_bytes is not None else None
        return {
            "total_mb":  total_mb,
            "used_mb":   used_mb,
            "usage_pct": usage_pct,
        }
    return {"total_mb": None, "used_mb": None, "usage_pct": None}


async def collect_interfaces(host: str, community: str, port: int = 161) -> list[dict]:
    """Coleta status e tráfego de todas as interfaces."""
    # Coleta em paralelo: nome, status, octets in/out, erros
    tasks = [
        snmp_bulk_walk(host, community, OID_IF_NAME,         port),
        snmp_bulk_walk(host, community, OID_IF_DESCR,        port),
        snmp_bulk_walk(host, community, OID_IF_OPER_STATUS,  port),
        snmp_bulk_walk(host, community, OID_IF_IN_OCTETS_HC, port),
        snmp_bulk_walk(host, community, OID_IF_OUT_OCTETS_HC,port),
        snmp_bulk_walk(host, community, OID_IF_IN_ERRORS,    port),
        snmp_bulk_walk(host, community, OID_IF_OUT_ERRORS,   port),
        snmp_bulk_walk(host, community, OID_IF_ALIAS,        port),
    ]
    results = await asyncio.gather(*tasks)
    names, descrs, statuses, in_oct, out_oct, in_err, out_err, aliases = results

    def _index(rows: list) -> dict:
        """Extrai o índice (último número do OID) como chave."""
        d = {}
        for oid_str, val in rows:
            try:
                idx = oid_str.rsplit(".", 1)[-1]
                d[idx] = val
            except Exception:
                pass
        return d

    name_map   = _index(names)
    descr_map  = _index(descrs)
    status_map = _index(statuses)
    in_map     = _index(in_oct)
    out_map    = _index(out_oct)
    in_err_map = _index(in_err)
    out_err_map= _index(out_err)
    alias_map  = _index(aliases)

    interfaces = []
    for idx in status_map:
        try:
            oper_status = int(status_map[idx])
        except (ValueError, TypeError):
            oper_status = 0

        name  = name_map.get(idx) or descr_map.get(idx) or f"if{idx}"
        alias = alias_map.get(idx, "")

        # Ignorar interfaces de loopback e nulas
        if name.lower().startswith(("lo", "null", "nul")):
            continue

        try:
            in_octets  = int(in_map.get(idx, 0) or 0)
            out_octets = int(out_map.get(idx, 0) or 0)
        except (ValueError, TypeError):
            in_octets = out_octets = 0

        try:
            in_errors  = int(in_err_map.get(idx, 0) or 0)
            out_errors = int(out_err_map.get(idx, 0) or 0)
        except (ValueError, TypeError):
            in_errors = out_errors = 0

        interfaces.append({
            "index":       idx,
            "name":        name,
            "alias":       alias,
            "oper_status": oper_status,   # 1=up, 2=down
            "in_octets":   in_octets,
            "out_octets":  out_octets,
            "in_errors":   in_errors,
            "out_errors":  out_errors,
        })

    return interfaces


async def collect_bgp_sessions(host: str, community: str, port: int = 161) -> list[dict]:
    """Coleta sessões BGP e seus estados."""
    tasks = [
        snmp_bulk_walk(host, community, OID_BGP_PEER_STATE,     port),
        snmp_bulk_walk(host, community, OID_BGP_PEER_REMOTE_AS, port),
    ]
    state_rows, as_rows = await asyncio.gather(*tasks)

    def _peer_ip(oid_str: str, base_oid: str) -> str:
        """Extrai o IP do peer a partir do OID (ex: .1.3.6.1.2.1.15.3.1.2.10.0.0.1 → 10.0.0.1)."""
        suffix = oid_str[len(base_oid):].lstrip(".")
        return suffix

    state_map = {}
    for oid_str, val in state_rows:
        peer_ip = _peer_ip(oid_str, OID_BGP_PEER_STATE)
        try:
            state_map[peer_ip] = int(val)
        except (ValueError, TypeError):
            state_map[peer_ip] = 0

    as_map = {}
    for oid_str, val in as_rows:
        peer_ip = _peer_ip(oid_str, OID_BGP_PEER_REMOTE_AS)
        try:
            as_map[peer_ip] = int(val)
        except (ValueError, TypeError):
            as_map[peer_ip] = 0

    sessions = []
    for peer_ip, state in state_map.items():
        if not peer_ip or len(peer_ip.split(".")) != 4:
            continue
        sessions.append({
            "peer_ip":    peer_ip,
            "remote_as":  as_map.get(peer_ip, 0),
            "state":      state,
            "state_name": BGP_STATE_NAMES.get(state, "unknown"),
        })

    return sessions


# ─── Poll completo de um target ───────────────────────────────────────────────

async def poll_target(host: str, community: str, port: int = 161,
                      collect_interfaces_flag: bool = True,
                      collect_bgp_flag: bool = True,
                      collect_cpu_flag: bool = True,
                      collect_memory_flag: bool = True) -> dict:
    """
    Executa o poll completo de um target SNMP.
    Retorna dict com todas as métricas coletadas.
    """
    start = time.monotonic()
    result = {
        "success":    False,
        "error":      None,
        "polled_at":  datetime.now(timezone.utc).isoformat(),
        "duration_ms": 0,
        "system":     {},
        "cpu":        None,
        "memory":     {},
        "interfaces": [],
        "bgp":        [],
    }

    try:
        # Sempre coleta info do sistema
        tasks = [collect_system_info(host, community, port)]
        if collect_cpu_flag:
            tasks.append(collect_cpu(host, community, port))
        if collect_memory_flag:
            tasks.append(collect_memory(host, community, port))
        if collect_interfaces_flag:
            tasks.append(collect_interfaces(host, community, port))
        if collect_bgp_flag:
            tasks.append(collect_bgp_sessions(host, community, port))

        gathered = await asyncio.gather(*tasks, return_exceptions=True)

        idx = 0
        result["system"] = gathered[idx] if not isinstance(gathered[idx], Exception) else {}
        idx += 1

        if collect_cpu_flag:
            result["cpu"] = gathered[idx] if not isinstance(gathered[idx], Exception) else None
            idx += 1
        if collect_memory_flag:
            result["memory"] = gathered[idx] if not isinstance(gathered[idx], Exception) else {}
            idx += 1
        if collect_interfaces_flag:
            result["interfaces"] = gathered[idx] if not isinstance(gathered[idx], Exception) else []
            idx += 1
        if collect_bgp_flag:
            result["bgp"] = gathered[idx] if not isinstance(gathered[idx], Exception) else []

        # Verifica se o poll foi bem-sucedido (ao menos sysName retornou)
        if result["system"].get("sys_name") or result["cpu"] is not None or result["interfaces"]:
            result["success"] = True
        else:
            result["error"] = "Nenhuma métrica retornada — verifique community string e conectividade"

    except Exception as e:
        result["error"] = str(e)
        logger.error(f"Erro no poll SNMP {host}: {e}")

    result["duration_ms"] = int((time.monotonic() - start) * 1000)
    return result

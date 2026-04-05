"""
BR10 NetManager - Network Tools API
Ferramentas de diagnóstico de rede:
  - Ping ICMP (IPv4 e IPv6)
  - Traceroute (IPv4 e IPv6)
  - DNS Lookup (A, AAAA, MX, NS, TXT, CNAME, SOA, PTR)
  - Validação DNSSEC
  - Validação RPKI de prefixos IP via RIPE Stat
"""
import asyncio
import ipaddress
import re
import socket
import time
from typing import Optional, List

import dns.resolver
import dns.dnssec
import dns.name
import dns.query
import dns.rdatatype
import dns.message
import dns.flags
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.api.v1.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/network-tools", tags=["Network Tools"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PingRequest(BaseModel):
    target: str
    count: int = 4
    ip_version: int = 4
    timeout: int = 5

    @field_validator("count")
    @classmethod
    def validate_count(cls, v):
        if not 1 <= v <= 20:
            raise ValueError("count deve estar entre 1 e 20")
        return v

    @field_validator("ip_version")
    @classmethod
    def validate_ip_version(cls, v):
        if v not in (4, 6):
            raise ValueError("ip_version deve ser 4 ou 6")
        return v


class TracerouteRequest(BaseModel):
    target: str
    ip_version: int = 4
    max_hops: int = 30
    timeout: int = 3

    @field_validator("ip_version")
    @classmethod
    def validate_ip_version(cls, v):
        if v not in (4, 6):
            raise ValueError("ip_version deve ser 4 ou 6")
        return v

    @field_validator("max_hops")
    @classmethod
    def validate_max_hops(cls, v):
        if not 5 <= v <= 64:
            raise ValueError("max_hops deve estar entre 5 e 64")
        return v


class DnsRequest(BaseModel):
    target: str                       # hostname ou IP (para PTR)
    record_type: str = "A"            # A, AAAA, MX, NS, TXT, CNAME, SOA, PTR
    nameserver: Optional[str] = None  # servidor DNS customizado
    check_dnssec: bool = False

    @field_validator("record_type")
    @classmethod
    def validate_record_type(cls, v):
        allowed = {"A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "PTR", "CAA", "SRV", "DNSKEY", "DS"}
        v = v.upper()
        if v not in allowed:
            raise ValueError(f"Tipo inválido. Permitidos: {', '.join(sorted(allowed))}")
        return v


class RpkiRequest(BaseModel):
    prefix: str
    asn: Optional[int] = None

    @field_validator("prefix")
    @classmethod
    def validate_prefix(cls, v):
        v = v.strip()
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError:
            raise ValueError(f"Prefixo inválido: {v}")
        return v


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_target(target: str, ip_version: int) -> str:
    """Resolve hostname para IP da versão correta."""
    target = target.strip()
    try:
        addr = ipaddress.ip_address(target)
        if addr.version != ip_version:
            raise HTTPException(
                status_code=400,
                detail=f"O endereço {target} é IPv{addr.version}, mas foi solicitado IPv{ip_version}"
            )
        return target
    except ValueError:
        pass

    family = socket.AF_INET if ip_version == 4 else socket.AF_INET6
    try:
        results = socket.getaddrinfo(target, None, family)
        if not results:
            raise HTTPException(status_code=400, detail=f"Não foi possível resolver {target} para IPv{ip_version}")
        return results[0][4][0]
    except socket.gaierror as e:
        raise HTTPException(status_code=400, detail=f"Erro ao resolver {target}: {str(e)}")


def _parse_ping_output(output: str) -> dict:
    lines = output.strip().split("\n")
    packets_sent = packets_recv = 0
    rtt_min = rtt_avg = rtt_max = rtt_mdev = 0.0
    packet_lines = []

    for line in lines:
        if "bytes from" in line or ("from" in line and "ttl=" in line.lower()):
            packet_lines.append(line.strip())
        m = re.search(r"(\d+) packets? transmitted,\s*(\d+) received", line)
        if m:
            packets_sent = int(m.group(1))
            packets_recv = int(m.group(2))
        m = re.search(r"rtt min/avg/max/mdev\s*=\s*([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)", line)
        if m:
            rtt_min, rtt_avg, rtt_max, rtt_mdev = map(float, m.groups())

    packet_loss = 0.0
    if packets_sent > 0:
        packet_loss = round((packets_sent - packets_recv) / packets_sent * 100, 1)

    return {
        "packets_sent": packets_sent,
        "packets_received": packets_recv,
        "packet_loss_pct": packet_loss,
        "rtt_min_ms": rtt_min,
        "rtt_avg_ms": rtt_avg,
        "rtt_max_ms": rtt_max,
        "rtt_mdev_ms": rtt_mdev,
        "raw_lines": packet_lines,
        "raw_output": output,
    }


def _parse_traceroute_output(output: str) -> list:
    """Extrai os hops do output do traceroute."""
    hops = []
    for line in output.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        # Linha típica: " 1  192.168.1.1 (192.168.1.1)  1.234 ms  1.456 ms  1.789 ms"
        # Ou: " 2  * * *"
        m = re.match(r"^\s*(\d+)\s+(.+)$", line)
        if not m:
            continue
        hop_num = int(m.group(1))
        rest = m.group(2).strip()

        if rest.startswith("* * *") or rest == "*":
            hops.append({
                "hop": hop_num,
                "hostname": None,
                "ip": None,
                "rtts_ms": [],
                "timeout": True,
            })
            continue

        # Extrai IP/hostname e RTTs
        ip_match = re.search(r"\(?([\d.a-fA-F:]+)\)?", rest)
        ip = ip_match.group(1) if ip_match else None

        hostname_match = re.match(r"^([^\s(]+)", rest)
        hostname = hostname_match.group(1) if hostname_match else None
        if hostname == ip:
            hostname = None

        rtts = re.findall(r"([\d.]+)\s*ms", rest)
        rtts_ms = [float(r) for r in rtts]

        hops.append({
            "hop": hop_num,
            "hostname": hostname,
            "ip": ip,
            "rtts_ms": rtts_ms,
            "avg_rtt_ms": round(sum(rtts_ms) / len(rtts_ms), 2) if rtts_ms else None,
            "timeout": False,
        })
    return hops


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/ping")
async def ping(
    body: PingRequest,
    current_user: User = Depends(get_current_user),
):
    """Ping ICMP IPv4 ou IPv6 com estatísticas de RTT e perda de pacotes."""
    resolved_ip = _resolve_target(body.target, body.ip_version)

    cmd = ["ping6" if body.ip_version == 6 else "ping",
           "-c", str(body.count),
           "-W", str(body.timeout),
           resolved_ip]

    start_time = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=body.count * body.timeout + 5,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="Timeout ao executar ping")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Comando ping não encontrado no servidor")

    elapsed = round((time.monotonic() - start_time) * 1000, 1)
    output = stdout.decode(errors="replace")
    error_output = stderr.decode(errors="replace")

    stats = _parse_ping_output(output)
    stats["elapsed_ms"] = elapsed
    stats["resolved_ip"] = resolved_ip
    stats["target"] = body.target
    stats["ip_version"] = body.ip_version
    stats["success"] = stats["packets_received"] > 0
    stats["return_code"] = proc.returncode

    if proc.returncode != 0 and stats["packets_received"] == 0:
        stats["error"] = error_output.strip() or "Host inacessível"

    return stats


@router.post("/traceroute")
async def traceroute(
    body: TracerouteRequest,
    current_user: User = Depends(get_current_user),
):
    """Traceroute IPv4 ou IPv6 mostrando o caminho até o destino hop a hop."""
    resolved_ip = _resolve_target(body.target, body.ip_version)

    # traceroute -n (sem resolução DNS reversa para ser mais rápido)
    # -q 2 (2 probes por hop)
    # -w timeout
    cmd = [
        "traceroute",
        "-n",
        "-q", "2",
        "-w", str(body.timeout),
        "-m", str(body.max_hops),
    ]
    if body.ip_version == 6:
        cmd.append("-6")
    else:
        cmd.append("-4")
    cmd.append(resolved_ip)

    start_time = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=body.max_hops * body.timeout * 2 + 10,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="Timeout ao executar traceroute")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Comando traceroute não encontrado no servidor")

    elapsed = round((time.monotonic() - start_time) * 1000, 1)
    output = stdout.decode(errors="replace")
    error_output = stderr.decode(errors="replace")

    hops = _parse_traceroute_output(output)

    return {
        "target": body.target,
        "resolved_ip": resolved_ip,
        "ip_version": body.ip_version,
        "max_hops": body.max_hops,
        "hops": hops,
        "total_hops": len(hops),
        "elapsed_ms": elapsed,
        "raw_output": output,
        "return_code": proc.returncode,
    }


@router.post("/dns")
async def dns_lookup(
    body: DnsRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Consulta DNS para qualquer tipo de registro.
    Se check_dnssec=True, verifica também a cadeia DNSSEC.
    """
    target = body.target.strip()
    record_type = body.record_type

    # Configura o resolver
    resolver = dns.resolver.Resolver()
    resolver.timeout = 5
    resolver.lifetime = 10

    if body.nameserver:
        ns = body.nameserver.strip()
        try:
            resolver.nameservers = [ns]
        except Exception:
            raise HTTPException(status_code=400, detail=f"Nameserver inválido: {ns}")

    results = {
        "target": target,
        "record_type": record_type,
        "nameserver_used": body.nameserver or resolver.nameservers[0] if resolver.nameservers else "sistema",
        "records": [],
        "ttl": None,
        "dnssec": None,
        "error": None,
    }

    # ── Consulta principal ────────────────────────────────────────────────────
    try:
        answer = resolver.resolve(target, record_type)
        results["ttl"] = answer.rrset.ttl if answer.rrset else None

        for rdata in answer:
            rt = record_type
            if rt in ("A", "AAAA"):
                results["records"].append(str(rdata))
            elif rt == "MX":
                results["records"].append({
                    "priority": rdata.preference,
                    "exchange": str(rdata.exchange),
                })
            elif rt == "NS":
                results["records"].append(str(rdata.target))
            elif rt == "TXT":
                results["records"].append(" ".join(s.decode() for s in rdata.strings))
            elif rt == "CNAME":
                results["records"].append(str(rdata.target))
            elif rt == "SOA":
                results["records"].append({
                    "mname": str(rdata.mname),
                    "rname": str(rdata.rname),
                    "serial": rdata.serial,
                    "refresh": rdata.refresh,
                    "retry": rdata.retry,
                    "expire": rdata.expire,
                    "minimum": rdata.minimum,
                })
            elif rt == "PTR":
                results["records"].append(str(rdata.target))
            elif rt == "CAA":
                results["records"].append({
                    "flags": rdata.flags,
                    "tag": rdata.tag.decode(),
                    "value": rdata.value.decode(),
                })
            elif rt == "SRV":
                results["records"].append({
                    "priority": rdata.priority,
                    "weight": rdata.weight,
                    "port": rdata.port,
                    "target": str(rdata.target),
                })
            else:
                results["records"].append(str(rdata))

    except dns.resolver.NXDOMAIN:
        results["error"] = f"Domínio não encontrado: {target}"
    except dns.resolver.NoAnswer:
        results["error"] = f"Nenhum registro {record_type} encontrado para {target}"
    except dns.resolver.Timeout:
        results["error"] = "Timeout na consulta DNS"
    except dns.resolver.NoNameservers:
        results["error"] = "Nenhum nameserver disponível"
    except Exception as e:
        results["error"] = str(e)

    # ── Verificação DNSSEC ────────────────────────────────────────────────────
    if body.check_dnssec:
        dnssec_result = {
            "enabled": False,
            "validated": False,
            "status": "unknown",
            "details": [],
            "error": None,
        }
        try:
            # Verifica se há registros DNSKEY na zona
            try:
                # Extrai o domínio base (sem subdomínio)
                name = dns.name.from_text(target)
                # Tenta resolver DNSKEY no domínio
                dnskey_answer = resolver.resolve(target, "DNSKEY")
                dnssec_result["enabled"] = True
                dnssec_result["details"].append(f"{len(list(dnskey_answer))} DNSKEY(s) encontrado(s)")

                # Verifica DS no pai
                try:
                    ds_answer = resolver.resolve(target, "DS")
                    dnssec_result["details"].append(f"{len(list(ds_answer))} DS record(s) encontrado(s)")
                    dnssec_result["validated"] = True
                    dnssec_result["status"] = "signed"
                except dns.resolver.NoAnswer:
                    dnssec_result["status"] = "dnskey-only"
                    dnssec_result["details"].append("Sem DS records no pai — cadeia incompleta")
                except Exception:
                    dnssec_result["status"] = "dnskey-only"

            except dns.resolver.NoAnswer:
                dnssec_result["status"] = "unsigned"
                dnssec_result["details"].append("Nenhum DNSKEY encontrado — zona não assinada")
            except dns.resolver.NXDOMAIN:
                dnssec_result["status"] = "nxdomain"
                dnssec_result["error"] = "Domínio não existe"

            # Verifica AD bit (Authenticated Data) — indica validação pelo resolver
            try:
                request = dns.message.make_query(target, dns.rdatatype.A, want_dnssec=True)
                request.flags |= dns.flags.AD
                response = dns.query.udp(request, resolver.nameservers[0], timeout=5)
                if response.flags & dns.flags.AD:
                    dnssec_result["validated"] = True
                    dnssec_result["status"] = "validated"
                    dnssec_result["details"].append("AD bit presente — validado pelo resolver")
                else:
                    dnssec_result["details"].append("AD bit ausente — não validado pelo resolver")
            except Exception as e:
                dnssec_result["details"].append(f"Não foi possível verificar AD bit: {str(e)}")

        except Exception as e:
            dnssec_result["error"] = str(e)

        results["dnssec"] = dnssec_result

    return results


@router.post("/rpki")
async def validate_rpki(
    body: RpkiRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Valida o estado RPKI de um prefixo IP.
    Usa RIPE Stat API (rpki-validation) como fonte primária.
    Fallback: Cloudflare RPKI API.

    Estados: valid, invalid, not-found, unknown
    """
    network = ipaddress.ip_network(body.prefix, strict=False)
    prefix_str = str(network)
    ip_version = network.version

    results = {
        "prefix": prefix_str,
        "ip_version": ip_version,
        "rpki_status": "unknown",
        "roas": [],
        "origin_asns": [],
        "country": None,
        "rir": None,
        "announced": None,
        "sources_checked": [],
        "errors": [],
    }

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:

        # ── 1. RIPE Stat — prefix-overview (ASN de origem) ──────────────────
        origin_asn = body.asn
        try:
            ripe_url = f"https://stat.ripe.net/data/prefix-overview/data.json?resource={prefix_str}"
            resp = await client.get(ripe_url)
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                asns = data.get("asns", [])
                if asns:
                    results["origin_asns"] = [a.get("asn") for a in asns if a.get("asn")]
                    if not origin_asn:
                        origin_asn = results["origin_asns"][0]
                results["announced"] = data.get("announced", False)
                results["sources_checked"].append("RIPE prefix-overview")
        except Exception as e:
            results["errors"].append(f"RIPE prefix-overview: {str(e)}")

        # ── 2. RIPE Stat — rpki-validation (fonte primária) ─────────────────
        try:
            resource = f"AS{origin_asn}/{prefix_str}" if origin_asn else prefix_str
            roa_url = f"https://stat.ripe.net/data/rpki-validation/data.json?resource={resource}"
            resp = await client.get(roa_url)
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                validating_roas = data.get("validating_roas", [])
                status = data.get("status", "")

                # Mapeia status do RIPE para nosso padrão
                status_map = {
                    "valid": "valid",
                    "invalid": "invalid",
                    "unknown": "not-found",
                    "not-found": "not-found",
                }
                if status:
                    results["rpki_status"] = status_map.get(status.lower(), "not-found")
                elif validating_roas:
                    # Determina pelo primeiro ROA
                    first = validating_roas[0].get("validity", "unknown").lower()
                    results["rpki_status"] = status_map.get(first, "not-found")
                else:
                    results["rpki_status"] = "not-found"

                for roa in validating_roas:
                    results["roas"].append({
                        "asn": roa.get("origin"),
                        "prefix": roa.get("prefix"),
                        "max_length": roa.get("max_length"),
                        "validity": roa.get("validity"),
                        "match": roa.get("validity", "").lower() == "valid",
                    })
                results["sources_checked"].append("RIPE rpki-validation")
        except Exception as e:
            results["errors"].append(f"RIPE rpki-validation: {str(e)}")

        # ── 3. Cloudflare RPKI (fallback se RIPE não retornou status) ───────
        if results["rpki_status"] == "unknown" and origin_asn:
            try:
                cf_url = f"https://rpki.cloudflare.com/api/v1/validity/{origin_asn}/{prefix_str}"
                resp = await client.get(cf_url, headers={"Accept": "application/json"})
                if resp.status_code == 200:
                    cf_data = resp.json()
                    validity = cf_data.get("validity", {})
                    state = validity.get("state", "unknown")
                    status_map = {"valid": "valid", "invalid": "invalid", "unknown": "not-found"}
                    results["rpki_status"] = status_map.get(state, "not-found")

                    vrs = validity.get("VRPs", {})
                    for roa in vrs.get("matched", []) + vrs.get("unmatched_as", []) + vrs.get("unmatched_length", []):
                        results["roas"].append({
                            "asn": roa.get("asn"),
                            "prefix": roa.get("prefix"),
                            "max_length": roa.get("max_length"),
                            "validity": "valid" if roa in vrs.get("matched", []) else "invalid",
                            "match": roa in vrs.get("matched", []),
                        })
                    results["sources_checked"].append("Cloudflare RPKI")
            except Exception as e:
                results["errors"].append(f"Cloudflare RPKI: {str(e)}")

        # ── 4. RIPE Stat — informações geográficas e RIR ────────────────────
        try:
            geo_url = f"https://stat.ripe.net/data/geoloc/data.json?resource={prefix_str}"
            resp = await client.get(geo_url)
            if resp.status_code == 200:
                locations = resp.json().get("data", {}).get("locations", [])
                if locations:
                    results["country"] = locations[0].get("country")
        except Exception:
            pass

        try:
            rir_url = f"https://stat.ripe.net/data/rir/data.json?resource={prefix_str}"
            resp = await client.get(rir_url)
            if resp.status_code == 200:
                rirs = resp.json().get("data", {}).get("rirs", [])
                if rirs:
                    results["rir"] = rirs[0].get("rir")
        except Exception:
            pass

    return results


@router.get("/ping/test")
async def ping_test(
    target: str = "8.8.8.8",
    current_user: User = Depends(get_current_user),
):
    """Teste rápido de ping com 3 pacotes (GET simples)."""
    req = PingRequest(target=target, count=3, ip_version=4)
    return await ping(req, current_user)

"""
BR10 NetManager - Network Tools API
Ferramentas de diagnóstico de rede:
  - Ping ICMP (IPv4 e IPv6) com estatísticas completas
  - Traceroute (IPv4 e IPv6)
  - Validação RPKI de prefixos IP via Cloudflare/RIPE API
"""
import asyncio
import ipaddress
import re
import socket
import subprocess
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.api.v1.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/network-tools", tags=["Network Tools"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PingRequest(BaseModel):
    target: str          # IP ou hostname
    count: int = 4       # número de pacotes (1-20)
    ip_version: int = 4  # 4 ou 6
    timeout: int = 5     # timeout por pacote em segundos

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

    @field_validator("timeout")
    @classmethod
    def validate_timeout(cls, v):
        if not 1 <= v <= 30:
            raise ValueError("timeout deve estar entre 1 e 30")
        return v


class RpkiRequest(BaseModel):
    prefix: str   # ex: "177.75.0.0/20"
    asn: Optional[int] = None  # ASN de origem para validar (opcional)

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
        # Verifica se já é um IP
        addr = ipaddress.ip_address(target)
        if addr.version != ip_version:
            raise HTTPException(
                status_code=400,
                detail=f"O endereço {target} é IPv{addr.version}, mas foi solicitado IPv{ip_version}"
            )
        return target
    except ValueError:
        pass

    # É um hostname — resolve
    family = socket.AF_INET if ip_version == 4 else socket.AF_INET6
    try:
        results = socket.getaddrinfo(target, None, family)
        if not results:
            raise HTTPException(status_code=400, detail=f"Não foi possível resolver {target} para IPv{ip_version}")
        return results[0][4][0]
    except socket.gaierror as e:
        raise HTTPException(status_code=400, detail=f"Erro ao resolver {target}: {str(e)}")


def _parse_ping_output(output: str, ip_version: int) -> dict:
    """Extrai estatísticas do output do comando ping."""
    lines = output.strip().split("\n")
    packets_sent = packets_recv = 0
    rtt_min = rtt_avg = rtt_max = rtt_mdev = 0.0
    packet_lines = []

    for line in lines:
        # Captura linhas individuais de resposta
        if "bytes from" in line or "from" in line and "ttl=" in line.lower():
            packet_lines.append(line.strip())

        # Estatísticas de pacotes: "4 packets transmitted, 4 received, 0% packet loss"
        m = re.search(r"(\d+) packets? transmitted,\s*(\d+) received", line)
        if m:
            packets_sent = int(m.group(1))
            packets_recv = int(m.group(2))

        # RTT: "rtt min/avg/max/mdev = 1.234/2.345/3.456/0.123 ms"
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


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/ping")
async def ping(
    body: PingRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Executa ping ICMP para um IP ou hostname.
    Suporta IPv4 e IPv6. Retorna estatísticas completas de RTT e perda de pacotes.
    """
    resolved_ip = _resolve_target(body.target, body.ip_version)

    # Monta o comando ping
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

    stats = _parse_ping_output(output, body.ip_version)
    stats["elapsed_ms"] = elapsed
    stats["resolved_ip"] = resolved_ip
    stats["target"] = body.target
    stats["ip_version"] = body.ip_version
    stats["success"] = stats["packets_received"] > 0
    stats["return_code"] = proc.returncode

    if proc.returncode != 0 and stats["packets_received"] == 0:
        stats["error"] = error_output.strip() or "Host inacessível"

    return stats


@router.post("/rpki")
async def validate_rpki(
    body: RpkiRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Valida o estado RPKI de um prefixo IP usando a API pública do Cloudflare RPKI.
    Também consulta o RIPE Stat para informações de origem (ASN, país, LIR).

    Estados possíveis:
    - valid:    ROA encontrado e prefixo/ASN correspondem
    - invalid:  ROA encontrado mas ASN não corresponde (possível hijack)
    - not-found: Nenhum ROA encontrado para o prefixo
    - unknown:  Erro ao consultar
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
        "cloudflare_checked": False,
        "ripe_checked": False,
        "errors": [],
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        # ── 1. Cloudflare RPKI API ──────────────────────────────────────────
        try:
            cf_url = "https://rpki.cloudflare.com/api/v1/validity"
            # Cloudflare precisa do ASN para validar; se não fornecido, busca do RIPE
            asn_to_check = body.asn

            if not asn_to_check:
                # Tenta obter o ASN de origem via RIPE Stat
                ripe_prefix_url = f"https://stat.ripe.net/data/prefix-overview/data.json?resource={prefix_str}"
                try:
                    ripe_resp = await client.get(ripe_prefix_url)
                    ripe_data = ripe_resp.json()
                    asns = ripe_data.get("data", {}).get("asns", [])
                    if asns:
                        asn_to_check = asns[0].get("asn")
                        results["origin_asns"] = [a.get("asn") for a in asns if a.get("asn")]
                    results["announced"] = ripe_data.get("data", {}).get("announced", False)
                    results["ripe_checked"] = True
                except Exception as e:
                    results["errors"].append(f"RIPE prefix-overview: {str(e)}")

            if asn_to_check:
                cf_resp = await client.get(
                    f"{cf_url}/{asn_to_check}/{prefix_str}",
                    headers={"Accept": "application/json"},
                )
                if cf_resp.status_code == 200:
                    cf_data = cf_resp.json()
                    validity = cf_data.get("validity", {})
                    status = validity.get("state", "unknown")
                    results["rpki_status"] = status
                    results["cloudflare_checked"] = True

                    # ROAs encontrados
                    vrs = validity.get("VRPs", {})
                    matched = vrs.get("matched", [])
                    unmatched_as = vrs.get("unmatched_as", [])
                    unmatched_len = vrs.get("unmatched_length", [])
                    for roa in matched + unmatched_as + unmatched_len:
                        results["roas"].append({
                            "asn": roa.get("asn"),
                            "prefix": roa.get("prefix"),
                            "max_length": roa.get("max_length"),
                            "match": roa in matched,
                        })
            else:
                results["rpki_status"] = "not-found"
                results["errors"].append("Nenhum ASN de origem encontrado para este prefixo")

        except Exception as e:
            results["errors"].append(f"Cloudflare RPKI: {str(e)}")

        # ── 2. RIPE Stat — informações adicionais ───────────────────────────
        try:
            geo_url = f"https://stat.ripe.net/data/geoloc/data.json?resource={prefix_str}"
            geo_resp = await client.get(geo_url)
            if geo_resp.status_code == 200:
                geo_data = geo_resp.json()
                locations = geo_data.get("data", {}).get("locations", [])
                if locations:
                    results["country"] = locations[0].get("country")
        except Exception:
            pass

        try:
            rir_url = f"https://stat.ripe.net/data/rir/data.json?resource={prefix_str}"
            rir_resp = await client.get(rir_url)
            if rir_resp.status_code == 200:
                rir_data = rir_resp.json()
                rirs = rir_data.get("data", {}).get("rirs", [])
                if rirs:
                    results["rir"] = rirs[0].get("rir")
        except Exception:
            pass

        # ── 3. RIPE Stat — ROAs diretos (fallback se Cloudflare falhou) ─────
        if not results["cloudflare_checked"]:
            try:
                roa_url = f"https://stat.ripe.net/data/rpki-validation/data.json?resource={prefix_str}"
                roa_resp = await client.get(roa_url)
                if roa_resp.status_code == 200:
                    roa_data = roa_resp.json()
                    validating_roas = roa_data.get("data", {}).get("validating_roas", [])
                    for roa in validating_roas:
                        results["roas"].append({
                            "asn": roa.get("origin"),
                            "prefix": roa.get("prefix"),
                            "max_length": roa.get("max_length"),
                            "validity": roa.get("validity"),
                        })
                    if validating_roas:
                        # Determina status pelo primeiro ROA
                        first_validity = validating_roas[0].get("validity", "unknown")
                        results["rpki_status"] = first_validity
                    else:
                        results["rpki_status"] = "not-found"
                    results["ripe_checked"] = True
            except Exception as e:
                results["errors"].append(f"RIPE RPKI: {str(e)}")

    return results


@router.get("/ping/test")
async def ping_test(
    target: str = "8.8.8.8",
    current_user: User = Depends(get_current_user),
):
    """Teste rápido de ping com 3 pacotes para um alvo (GET simples)."""
    req = PingRequest(target=target, count=3, ip_version=4)
    return await ping(req, current_user)

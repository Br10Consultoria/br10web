"""
BR10 NetManager - Nmap Scanner Service
Executa varreduras Nmap e parseia os resultados para o banco de dados.
"""
import asyncio
import logging
import subprocess
import time
import xml.etree.ElementTree as ET
from typing import Optional

logger = logging.getLogger(__name__)

# Mapeamento de severidade por script NSE
SCRIPT_SEVERITY_MAP = {
    "CRITICAL": "critical",
    "HIGH":     "high",
    "MEDIUM":   "medium",
    "LOW":      "low",
    "INFO":     "info",
}

VULN_SCRIPT_KEYWORDS = [
    "vuln", "exploit", "cve", "ms", "smb-vuln", "ssl-", "http-vuln",
    "ftp-vuln", "rdp-vuln", "ssh-", "heartbleed", "shellshock",
]


def _classify_severity(script_id: str, output: str) -> str:
    """Classifica severidade com base no script NSE e output."""
    output_upper = output.upper()
    if "VULNERABLE" in output_upper or "EXPLOIT" in output_upper:
        if "CRITICAL" in output_upper:
            return "critical"
        if "HIGH" in output_upper:
            return "high"
        if "MEDIUM" in output_upper:
            return "medium"
        return "high"  # vulnerável sem classificação = alto
    if any(kw in script_id.lower() for kw in ["heartbleed", "shellshock", "ms17-010"]):
        return "critical"
    if any(kw in script_id.lower() for kw in ["ssl-", "tls-"]):
        return "medium"
    return "info"


def _abbreviate_iface(name: str) -> str:
    """Converte nome de interface Huawei para abreviação (ex: GigabitEthernet -> GE)."""
    replacements = [
        ("GigabitEthernet", "GE"),
        ("XGigabitEthernet", "XGE"),
        ("Eth-Trunk", "Eth-Trunk"),
        ("LoopBack", "LoopBack"),
        ("Vlanif", "Vlanif"),
    ]
    for full, abbr in replacements:
        if name.startswith(full):
            return name.replace(full, abbr, 1)
    return name


# Tipos de scan disponíveis com descrição para o frontend
SCAN_TYPES = {
    "quick":        {"label": "Rápido (portas comuns)",           "description": "Varredura rápida nas 100 portas mais comuns (-F)"},
    "full":         {"label": "Completo (todas as portas)",        "description": "Todas as 65535 portas TCP com detecção de serviços"},
    "vuln":         {"label": "Vulnerabilidades (NSE vuln)",       "description": "Scripts NSE de vulnerabilidades nas portas 1-10000"},
    "syn":          {"label": "SYN Scan (TCP stealth)",            "description": "Varredura TCP SYN furtiva, não completa o handshake"},
    "udp":          {"label": "UDP Scan",                          "description": "Varredura de portas UDP (mais lento)"},
    "arp":          {"label": "ARP Scan (descoberta de rede)",     "description": "Descoberta de hosts ativos via ARP na rede local"},
    "os":           {"label": "Detecção de SO e Serviços",         "description": "Identifica sistema operacional, versões e scripts padrão"},
    "snmp":         {"label": "SNMP Discovery",                    "description": "Varredura UDP 161 com scripts SNMP (community, interfaces)"},
    "http":         {"label": "HTTP/HTTPS (portas web)",           "description": "Varredura nas portas 80,443,8080,8443 com scripts HTTP"},
    "ssh":          {"label": "SSH Audit",                         "description": "Auditoria SSH: algoritmos, versão, configurações"},
    "smb":          {"label": "SMB/Windows",                       "description": "Varredura SMB com scripts de vulnerabilidades Windows"},
    "custom":       {"label": "Personalizado",                     "description": "Defina portas e opções manualmente"},
}


def build_nmap_command(target: str, options: dict) -> list[str]:
    """
    Monta o comando Nmap com base nas opções fornecidas.

    Opções suportadas:
      - scan_type: ver SCAN_TYPES acima
      - ports: "22,80,443" | "1-1000" | "all"
      - timing: "T1" .. "T5" (padrão T4)
      - os_detection: bool
      - service_version: bool
      - scripts: lista de scripts NSE
      - extra_args: string com args adicionais
    """
    cmd = ["nmap", "-oX", "-"]  # saída XML para stdout

    scan_type = options.get("scan_type", "quick")
    timing    = options.get("timing", "T4")
    ports     = options.get("ports", "")

    if scan_type == "quick":
        # Varredura rápida nas 100 portas mais comuns
        cmd += [f"-{timing}", "-sV", "--open", "-F"]

    elif scan_type == "full":
        # Todas as portas TCP
        cmd += [f"-{timing}", "-sV", "-sC", "-p-", "--open"]

    elif scan_type == "vuln":
        # Scripts NSE de vulnerabilidades
        cmd += [f"-{timing}", "-sV", "--script=vuln", "--open"]
        if not ports:
            ports = "1-10000"

    elif scan_type == "syn":
        # TCP SYN scan (stealth)
        cmd += [f"-{timing}", "-sS", "-sV", "-O", "--open"]
        if not ports:
            ports = "1-10000"

    elif scan_type == "udp":
        # UDP scan
        cmd += [f"-{timing}", "-sU", "--open"]
        if not ports:
            ports = "53,67,68,69,123,161,162,500,514,1194"

    elif scan_type == "arp":
        # ARP scan para descoberta de hosts na rede local
        cmd += ["-sn", "-PR"]

    elif scan_type == "os":
        # Detecção de SO + serviços + scripts padrão
        cmd += [f"-{timing}", "-sS", "-sV", "-O", "-sC", "--osscan-guess", "--open"]
        if not ports:
            ports = "1-10000"

    elif scan_type == "snmp":
        # SNMP discovery via UDP 161
        cmd += [f"-{timing}", "-sU", "-p161",
                "--script=snmp-info,snmp-interfaces,snmp-sysdescr,snmp-processes"]

    elif scan_type == "http":
        # Varredura HTTP/HTTPS com scripts web
        cmd += [f"-{timing}", "-sV",
                "--script=http-title,http-headers,http-methods,http-auth-finder,http-vuln-cve2017-5638",
                "--open"]
        if not ports:
            ports = "80,443,8080,8443,8888,3000,4443"

    elif scan_type == "ssh":
        # Auditoria SSH
        cmd += [f"-{timing}", "-sV",
                "--script=ssh2-enum-algos,ssh-auth-methods,ssh-hostkey",
                "--open"]
        if not ports:
            ports = "22,2222"

    elif scan_type == "smb":
        # SMB / Windows vulnerabilities
        cmd += [f"-{timing}", "-sV",
                "--script=smb-vuln-ms17-010,smb-vuln-ms08-067,smb-security-mode,smb-os-discovery",
                "--open"]
        if not ports:
            ports = "445,139,135"

    elif scan_type == "custom":
        cmd += [f"-{timing}", "-sV", "--open"]

    else:
        cmd += [f"-{timing}", "-sV", "--open", "-F"]

    # Portas (sobrescreve o padrão do scan_type se informado)
    if ports:
        if ports == "all":
            cmd += ["-p-"]
        else:
            cmd += [f"-p{ports}"]

    if options.get("os_detection") and "-O" not in cmd:
        cmd += ["-O", "--osscan-guess"]

    if options.get("service_version", True):
        if "-sV" not in cmd:
            cmd += ["-sV"]

    scripts = options.get("scripts", [])
    if scripts:
        cmd += [f"--script={','.join(scripts)}"]

    extra = options.get("extra_args", "")
    if extra:
        cmd += extra.split()

    cmd.append(target)
    return cmd


def parse_nmap_xml(xml_output: str) -> dict:
    """
    Parseia saída XML do Nmap e retorna estrutura normalizada.
    Retorna: { hosts_up, hosts_down, findings: [...] }
    """
    findings = []
    hosts_up = 0
    hosts_down = 0

    try:
        root = ET.fromstring(xml_output)
    except ET.ParseError as e:
        logger.error(f"Erro ao parsear XML Nmap: {e}")
        return {"hosts_up": 0, "hosts_down": 0, "findings": []}

    # Contagem de hosts
    runstats = root.find("runstats/hosts")
    if runstats is not None:
        hosts_up   = int(runstats.get("up", 0))
        hosts_down = int(runstats.get("down", 0))

    for host in root.findall("host"):
        # Status do host
        status_el = host.find("status")
        if status_el is not None and status_el.get("state") != "up":
            continue

        # IP e hostname
        ip = ""
        hostname = ""
        for addr in host.findall("address"):
            if addr.get("addrtype") == "ipv4":
                ip = addr.get("addr", "")
        hostnames_el = host.find("hostnames")
        if hostnames_el is not None:
            hn = hostnames_el.find("hostname")
            if hn is not None:
                hostname = hn.get("name", "")

        # Portas
        ports_el = host.find("ports")
        if ports_el is None:
            # Host up mas sem portas — registrar como finding de info
            findings.append({
                "host": ip,
                "hostname": hostname,
                "port": None,
                "protocol": None,
                "service": None,
                "service_version": None,
                "port_state": "up",
                "vuln_id": None,
                "title": "Host ativo",
                "description": "Host respondeu ao ping mas sem portas abertas detectadas.",
                "severity": "info",
                "cvss_score": None,
                "solution": None,
                "extra": {},
            })
            continue

        for port in ports_el.findall("port"):
            portid   = int(port.get("portid", 0))
            protocol = port.get("protocol", "tcp")

            state_el = port.find("state")
            state    = state_el.get("state", "") if state_el is not None else ""
            if state not in ("open", "open|filtered"):
                continue

            service_el = port.find("service")
            svc_name   = ""
            svc_version = ""
            if service_el is not None:
                svc_name    = service_el.get("name", "")
                product     = service_el.get("product", "")
                version     = service_el.get("version", "")
                extrainfo   = service_el.get("extrainfo", "")
                svc_version = " ".join(filter(None, [product, version, extrainfo])).strip()

            # Scripts NSE
            scripts = port.findall("script")
            if scripts:
                for script in scripts:
                    script_id     = script.get("id", "")
                    script_output = script.get("output", "")

                    is_vuln = any(kw in script_id.lower() for kw in VULN_SCRIPT_KEYWORDS)
                    severity = _classify_severity(script_id, script_output) if is_vuln else "info"

                    # Extrair CVE se presente
                    vuln_id = None
                    for elem in script.iter("elem"):
                        if elem.get("key") == "id" and elem.text and elem.text.startswith("CVE"):
                            vuln_id = elem.text.strip()
                            break

                    findings.append({
                        "host": ip,
                        "hostname": hostname,
                        "port": portid,
                        "protocol": protocol,
                        "service": svc_name,
                        "service_version": svc_version,
                        "port_state": state,
                        "vuln_id": vuln_id,
                        "title": script_id,
                        "description": script_output[:2000] if script_output else None,
                        "severity": severity,
                        "cvss_score": None,
                        "solution": None,
                        "extra": {"script_id": script_id},
                    })
            else:
                # Porta aberta sem scripts — registrar como info
                findings.append({
                    "host": ip,
                    "hostname": hostname,
                    "port": portid,
                    "protocol": protocol,
                    "service": svc_name,
                    "service_version": svc_version,
                    "port_state": state,
                    "vuln_id": None,
                    "title": f"Porta {portid}/{protocol} aberta ({svc_name or 'desconhecido'})",
                    "description": f"Porta {portid}/{protocol} está aberta. Serviço: {svc_version or svc_name or 'desconhecido'}",
                    "severity": "info",
                    "cvss_score": None,
                    "solution": None,
                    "extra": {},
                })

    return {
        "hosts_up": hosts_up,
        "hosts_down": hosts_down,
        "findings": findings,
    }


async def run_nmap_scan(target: str, options: dict) -> dict:
    """
    Executa Nmap de forma assíncrona e retorna resultado parseado.
    Retorna: { success, hosts_up, hosts_down, findings, raw_output, error, duration_s }
    """
    cmd = build_nmap_command(target, options)
    logger.info(f"Executando Nmap: {' '.join(cmd)}")

    start = time.time()
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=options.get("timeout_s", 600)  # 10 min padrão
        )
        duration_s = time.time() - start

        xml_output = stdout.decode("utf-8", errors="replace")
        err_output = stderr.decode("utf-8", errors="replace")

        if proc.returncode != 0 and not xml_output.strip():
            return {
                "success": False,
                "error": err_output or f"Nmap retornou código {proc.returncode}",
                "raw_output": err_output,
                "duration_s": duration_s,
                "hosts_up": 0,
                "hosts_down": 0,
                "findings": [],
            }

        parsed = parse_nmap_xml(xml_output)
        return {
            "success": True,
            "error": None,
            "raw_output": xml_output,
            "duration_s": duration_s,
            **parsed,
        }

    except asyncio.TimeoutError:
        return {
            "success": False,
            "error": f"Timeout: varredura excedeu {options.get('timeout_s', 600)}s",
            "raw_output": "",
            "duration_s": time.time() - start,
            "hosts_up": 0,
            "hosts_down": 0,
            "findings": [],
        }
    except FileNotFoundError:
        return {
            "success": False,
            "error": "Nmap não encontrado. Instale com: apt install nmap",
            "raw_output": "",
            "duration_s": 0,
            "hosts_up": 0,
            "hosts_down": 0,
            "findings": [],
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "raw_output": "",
            "duration_s": time.time() - start,
            "hosts_up": 0,
            "hosts_down": 0,
            "findings": [],
        }

"""
BR10 NetManager - OpenVAS/GVM Scanner Service
Integração com OpenVAS via GVM Python Library (python-gvm).
Requer container Greenbone Community Edition rodando.
"""
import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Configuração padrão do GVM (pode ser sobrescrita via env)
GVM_HOST    = "openvas"   # nome do container no docker-compose
GVM_PORT    = 9390
GVM_SOCKET  = "/run/gvmd/gvmd.sock"
GVM_USER    = "admin"
GVM_PASS    = "admin"

# UUIDs padrão do Greenbone Community Edition
DEFAULT_SCANNER_ID  = "08b69003-5fc2-4037-a479-93b440211c73"  # OpenVAS Default
DEFAULT_CONFIG_FULL = "daba56c8-73ec-11df-a475-002264764cea"  # Full and fast
DEFAULT_CONFIG_FAST = "8715c877-47a0-438d-98a3-27c7a6ab2196"  # Discovery


def _severity_from_cvss(cvss: Optional[float]) -> str:
    """Classifica severidade a partir do CVSS score."""
    if cvss is None:
        return "info"
    if cvss >= 9.0:
        return "critical"
    if cvss >= 7.0:
        return "high"
    if cvss >= 4.0:
        return "medium"
    if cvss > 0.0:
        return "low"
    return "info"


async def _get_gvm_connection():
    """Cria conexão com o GVM via socket Unix ou TCP."""
    try:
        from gvm.connections import UnixSocketConnection, TLSConnection
        from gvm.protocols.gmp import Gmp
        from gvm.transforms import EtreeCheckCommandTransform

        # Tentar socket Unix primeiro (mais seguro)
        try:
            conn = UnixSocketConnection(path=GVM_SOCKET)
            gmp = Gmp(connection=conn, transform=EtreeCheckCommandTransform())
            return gmp
        except Exception:
            pass

        # Fallback para TCP/TLS
        import os
        host = os.environ.get("GVM_HOST", GVM_HOST)
        port = int(os.environ.get("GVM_PORT", GVM_PORT))
        conn = TLSConnection(hostname=host, port=port)
        gmp = Gmp(connection=conn, transform=EtreeCheckCommandTransform())
        return gmp

    except ImportError:
        raise RuntimeError(
            "python-gvm não instalado. Execute: pip install python-gvm"
        )


async def check_openvas_available() -> dict:
    """Verifica se o OpenVAS está disponível e retorna versão."""
    try:
        import os
        gmp = await _get_gvm_connection()
        user = os.environ.get("GVM_USER", GVM_USER)
        pwd  = os.environ.get("GVM_PASS", GVM_PASS)

        loop = asyncio.get_event_loop()

        def _check():
            with gmp:
                gmp.authenticate(user, pwd)
                version = gmp.get_version()
                return True, version.find("version").text if version.find("version") is not None else "unknown"

        available, version = await loop.run_in_executor(None, _check)
        return {"available": available, "version": version}
    except Exception as e:
        return {"available": False, "error": str(e)}


async def run_openvas_scan(target: str, options: dict) -> dict:
    """
    Cria e executa uma varredura OpenVAS.
    Aguarda conclusão e retorna resultados parseados.

    options:
      - scan_config: "full" | "fast" | UUID personalizado
      - timeout_s: int (padrão 3600)
    """
    import os
    start = time.time()

    try:
        from gvm.protocols.gmp import Gmp
        import xml.etree.ElementTree as ET

        gmp = await _get_gvm_connection()
        user = os.environ.get("GVM_USER", GVM_USER)
        pwd  = os.environ.get("GVM_PASS", GVM_PASS)

        scan_config_key = options.get("scan_config", "full")
        if scan_config_key == "full":
            config_id = DEFAULT_CONFIG_FULL
        elif scan_config_key == "fast":
            config_id = DEFAULT_CONFIG_FAST
        else:
            config_id = scan_config_key  # UUID personalizado

        scanner_id = options.get("scanner_id", DEFAULT_SCANNER_ID)
        timeout_s  = options.get("timeout_s", 3600)

        loop = asyncio.get_event_loop()

        def _run():
            with gmp:
                gmp.authenticate(user, pwd)

                # Criar alvo
                target_resp = gmp.create_target(
                    name=f"br10-scan-{int(time.time())}",
                    hosts=[target],
                    port_list_id="33d0cd82-57c6-11e1-8ed1-406186ea4fc5",  # All IANA assigned TCP
                )
                target_id = target_resp.get("id")
                if not target_id:
                    raise RuntimeError("Falha ao criar alvo no OpenVAS")

                # Criar tarefa
                task_resp = gmp.create_task(
                    name=f"br10-task-{int(time.time())}",
                    config_id=config_id,
                    target_id=target_id,
                    scanner_id=scanner_id,
                )
                task_id = task_resp.get("id")
                if not task_id:
                    raise RuntimeError("Falha ao criar tarefa no OpenVAS")

                # Iniciar tarefa
                gmp.start_task(task_id)

                # Aguardar conclusão com polling
                deadline = time.time() + timeout_s
                report_id = None
                while time.time() < deadline:
                    time.sleep(15)
                    task = gmp.get_task(task_id)
                    status = task.find(".//status")
                    if status is not None:
                        st = status.text
                        if st == "Done":
                            last_report = task.find(".//last_report/report")
                            if last_report is not None:
                                report_id = last_report.get("id")
                            break
                        elif st in ("Stopped", "Stop Requested", "Interrupted"):
                            raise RuntimeError(f"Tarefa OpenVAS interrompida: {st}")

                if not report_id:
                    raise RuntimeError("Timeout aguardando conclusão do OpenVAS")

                # Obter relatório
                report = gmp.get_report(
                    report_id,
                    filter_string="levels=hmlgd rows=-1",
                    report_format_id=None,  # XML padrão
                    ignore_pagination=True,
                    details=True,
                )

                # Parsear resultados
                findings = []
                for result in report.findall(".//result"):
                    host_el   = result.find("host")
                    host_ip   = host_el.text.strip() if host_el is not None and host_el.text else ""
                    hostname  = ""
                    if host_el is not None:
                        asset = host_el.find("asset")
                        if asset is not None:
                            hostname = asset.get("name", "")

                    port_el   = result.find("port")
                    port_str  = port_el.text if port_el is not None else ""
                    port_num  = None
                    protocol  = None
                    if port_str and "/" in port_str:
                        parts = port_str.split("/")
                        try:
                            port_num = int(parts[0])
                            protocol = parts[1]
                        except (ValueError, IndexError):
                            pass

                    name_el   = result.find("name")
                    desc_el   = result.find("description")
                    nvt_el    = result.find("nvt")
                    cvss_el   = result.find(".//cvss_base")
                    sol_el    = result.find(".//solution")
                    sev_el    = result.find("severity")

                    vuln_id   = nvt_el.get("oid") if nvt_el is not None else None
                    title     = name_el.text if name_el is not None else vuln_id
                    desc      = desc_el.text if desc_el is not None else None
                    solution  = sol_el.text if sol_el is not None else None

                    try:
                        cvss = float(sev_el.text) if sev_el is not None and sev_el.text else None
                    except ValueError:
                        cvss = None

                    severity = _severity_from_cvss(cvss)

                    # Extrair CVE
                    cve_id = None
                    if nvt_el is not None:
                        for ref in nvt_el.findall(".//ref"):
                            if ref.get("type") == "cve":
                                cve_id = ref.get("id")
                                break

                    findings.append({
                        "host": host_ip,
                        "hostname": hostname,
                        "port": port_num,
                        "protocol": protocol,
                        "service": None,
                        "service_version": None,
                        "port_state": "open" if port_num else None,
                        "vuln_id": cve_id or vuln_id,
                        "title": title,
                        "description": desc,
                        "severity": severity,
                        "cvss_score": cvss,
                        "solution": solution,
                        "extra": {"oid": vuln_id},
                    })

                # Limpar tarefa e alvo
                try:
                    gmp.delete_task(task_id, ultimate=True)
                    gmp.delete_target(target_id, ultimate=True)
                except Exception:
                    pass

                return findings

        findings = await loop.run_in_executor(None, _run)
        duration_s = time.time() - start

        hosts = list({f["host"] for f in findings if f["host"]})
        return {
            "success": True,
            "error": None,
            "raw_output": f"OpenVAS scan completed. {len(findings)} findings.",
            "duration_s": duration_s,
            "hosts_up": len(hosts),
            "hosts_down": 0,
            "findings": findings,
        }

    except ImportError:
        return {
            "success": False,
            "error": "python-gvm não instalado. Execute: pip install python-gvm",
            "raw_output": "",
            "duration_s": time.time() - start,
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

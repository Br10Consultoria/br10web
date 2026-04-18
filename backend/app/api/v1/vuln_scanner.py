"""
BR10 NetManager - Vulnerability Scanner API
Endpoints para execução de varreduras Nmap e OpenVAS, listagem de resultados e geração de PDF.

Execução em background:
  Os scans são iniciados com asyncio.create_task() diretamente no event loop do uvicorn,
  garantindo que continuem em execução mesmo que a conexão HTTP que disparou o scan seja
  encerrada. Isso é diferente do FastAPI BackgroundTasks, que pode ser cancelado se o
  worker reiniciar durante uma requisição longa.

  Para sobreviver a reinicializações do container, use um worker externo (Celery + Redis)
  — veja a documentação em scripts/install-celery-worker.md.
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.vuln_scanner import VulnScan, VulnFinding, ScannerType, ScanStatus, FindingSeverity
from app.services.nmap_scanner import run_nmap_scan, SCAN_TYPES
from app.services.openvas_scanner import run_openvas_scan, check_openvas_available

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vuln-scanner", tags=["Vulnerability Scanner"])


# ─── Scan Types ──────────────────────────────────────────────

@router.get("/scan-types", summary="Listar tipos de scan Nmap disponíveis")
async def list_scan_types(current_user: User = Depends(get_current_user)):
    """Retorna todos os tipos de scan Nmap com label e descrição."""
    return [
        {"value": k, "label": v["label"], "description": v["description"]}
        for k, v in SCAN_TYPES.items()
    ]


# ─── Schemas ──────────────────────────────────────────────

class StartScanRequest(BaseModel):
    name: str
    target: str                          # IP, CIDR ou hostname
    scanner: ScannerType = ScannerType.NMAP
    client_id: Optional[str] = None      # UUID do cliente (opcional)
    # Opções Nmap
    scan_type: str = "quick"             # quick | full | vuln | custom
    ports: Optional[str] = None          # "22,80,443" | "1-1000" | "all"
    timing: str = "T4"                   # T1..T5
    os_detection: bool = False
    scripts: Optional[list[str]] = None
    extra_args: Optional[str] = None
    # Opções OpenVAS
    openvas_config: str = "full"         # full | fast | UUID
    # Geral — padrão 3600s (1h) para suportar redes /24
    timeout_s: int = 3600


# ─── Background task ──────────────────────────────────────────────────────────

async def _execute_scan(scan_id: str, request: StartScanRequest):
    """
    Executa a varredura em background e salva resultados no banco.

    Usa asyncio.create_task() para rodar desvinculado da requisição HTTP,
    garantindo que o scan continue mesmo que o cliente desconecte.
    """
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        try:
            # Marcar como running
            result = await db.execute(select(VulnScan).where(VulnScan.id == scan_id))
            scan = result.scalar_one_or_none()
            if not scan:
                return

            scan.status = ScanStatus.RUNNING
            await db.commit()
            logger.info(f"[vuln-scanner] Scan {scan_id} iniciado: {request.target} via {request.scanner.value.upper()}")

            # Executar scanner
            if request.scanner == ScannerType.NMAP:
                options = {
                    "scan_type":    request.scan_type,
                    "ports":        request.ports or "",
                    "timing":       request.timing,
                    "os_detection": request.os_detection,
                    "scripts":      request.scripts or [],
                    "extra_args":   request.extra_args or "",
                    "timeout_s":    request.timeout_s,
                }
                scan_result = await run_nmap_scan(request.target, options)
            else:
                options = {
                    "scan_config": request.openvas_config,
                    "timeout_s":   request.timeout_s,
                }
                scan_result = await run_openvas_scan(request.target, options)

            # Atualizar scan com resultados
            result2 = await db.execute(select(VulnScan).where(VulnScan.id == scan_id))
            scan = result2.scalar_one_or_none()
            if not scan:
                return

            # Contadores de severidade para alerta Telegram
            _critical_count = 0
            _high_count = 0

            if scan_result["success"]:
                scan.status      = ScanStatus.COMPLETED
                scan.hosts_up    = scan_result.get("hosts_up", 0)
                scan.hosts_down  = scan_result.get("hosts_down", 0)
                scan.raw_output  = (scan_result.get("raw_output") or "")[:50000]
                scan.duration_s  = scan_result.get("duration_s")

                # Salvar findings
                findings_data = scan_result.get("findings", [])
                scan.total_findings = len(findings_data)

                for f in findings_data:
                    sev = f.get("severity", "info")
                    if sev == "critical": _critical_count += 1
                    elif sev == "high": _high_count += 1
                    finding = VulnFinding(
                        scan_id         = scan.id,
                        host            = f.get("host", ""),
                        hostname        = f.get("hostname"),
                        port            = f.get("port"),
                        protocol        = f.get("protocol"),
                        service         = f.get("service"),
                        service_version = f.get("service_version"),
                        port_state      = f.get("port_state"),
                        vuln_id         = f.get("vuln_id"),
                        title           = (f.get("title") or "")[:500],
                        description     = f.get("description"),
                        severity        = FindingSeverity(f.get("severity", "info")),
                        cvss_score      = f.get("cvss_score"),
                        solution        = f.get("solution"),
                        extra           = f.get("extra"),
                    )
                    db.add(finding)

                logger.info(
                    f"[vuln-scanner] Scan {scan_id} concluído: "
                    f"{scan.hosts_up} hosts, {scan.total_findings} findings, "
                    f"{scan.duration_s:.0f}s"
                )
            else:
                scan.status    = ScanStatus.FAILED
                scan.error_msg = scan_result.get("error", "Erro desconhecido")
                scan.duration_s = scan_result.get("duration_s")
                logger.warning(f"[vuln-scanner] Scan {scan_id} falhou: {scan.error_msg}")

            await db.commit()

            # ── Alerta Telegram ────────────────────────────────────────────────
            try:
                from app.services.telegram_notify import notify_scan_result
                _tg_status = "completed" if scan_result["success"] else (
                    "timeout" if "timeout" in (scan.error_msg or "").lower() else "failed"
                )
                await notify_scan_result(
                    db=db,
                    scan_name=scan.name,
                    target=scan.target,
                    scanner=scan.scanner.value,
                    status=_tg_status,
                    findings_count=scan.total_findings or 0,
                    critical_count=_critical_count,
                    high_count=_high_count,
                    duration_s=scan.duration_s or 0,
                    error_msg=scan.error_msg,
                )
            except Exception as _tg_err:
                logger.warning(f"[vuln-scanner] Falha ao enviar alerta Telegram: {_tg_err}")

        except Exception as e:
            logger.error(f"[vuln-scanner] Erro crítico no scan {scan_id}: {e}", exc_info=True)
            async with AsyncSessionLocal() as db2:
                result3 = await db2.execute(select(VulnScan).where(VulnScan.id == scan_id))
                scan = result3.scalar_one_or_none()
                if scan:
                    scan.status    = ScanStatus.FAILED
                    scan.error_msg = str(e)
                    await db2.commit()
                    try:
                        from app.services.telegram_notify import notify_scan_result
                        await notify_scan_result(
                            db=db2, scan_name=scan.name, target=scan.target,
                            scanner=scan.scanner.value, status="failed",
                            duration_s=0, error_msg=str(e)[:300],
                        )
                    except Exception:
                        pass


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/scans", summary="Iniciar nova varredura")
async def start_scan(
    req: StartScanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cria um registro de varredura e inicia execução em background via asyncio.create_task().

    O scan continua rodando mesmo que a conexão HTTP seja encerrada ou o cliente
    navegue para outra página. O status pode ser consultado via GET /scans/{id}.
    """
    # Normalizar client_id: string vazia ou 'null' deve virar None para evitar erro de UUID inválido
    client_id_value = req.client_id if req.client_id and req.client_id.strip() else None

    scan = VulnScan(
        name        = req.name,
        target      = req.target,
        scanner     = req.scanner,
        client_id   = client_id_value,
        status      = ScanStatus.PENDING,
        scan_options = {
            "scan_type":       req.scan_type,
            "ports":           req.ports,
            "timing":          req.timing,
            "os_detection":    req.os_detection,
            "scripts":         req.scripts,
            "extra_args":      req.extra_args,
            "openvas_config":  req.openvas_config,
            "timeout_s":       req.timeout_s,
        },
        started_by = current_user.username,
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)

    # asyncio.create_task() garante execução independente da requisição HTTP
    # O scan continua mesmo que o cliente desconecte ou navegue para outra página
    asyncio.create_task(_execute_scan(str(scan.id), req))

    return {
        "id":      str(scan.id),
        "status":  scan.status.value,
        "message": f"Varredura '{req.name}' iniciada com {req.scanner.value.upper()} (background)",
    }


@router.post("/scans/{scan_id}/rerun", summary="Refazer varredura com as mesmas configurações")
async def rerun_scan(
    scan_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cria uma nova varredura com as mesmas configurações de uma varredura anterior.
    Útil para repetir scans que falharam ou para comparar resultados ao longo do tempo.
    """
    result = await db.execute(
        select(VulnScan).options(selectinload(VulnScan.client)).where(VulnScan.id == scan_id)
    )
    original = result.scalar_one_or_none()
    if not original:
        raise HTTPException(status_code=404, detail="Varredura original não encontrada")

    opts = original.scan_options or {}

    req = StartScanRequest(
        name           = f"{original.name} (nova)",
        target         = original.target,
        scanner        = original.scanner,
        client_id      = str(original.client_id) if original.client_id else None,
        scan_type      = opts.get("scan_type", "quick"),
        ports          = opts.get("ports"),
        timing         = opts.get("timing", "T4"),
        os_detection   = opts.get("os_detection", False),
        scripts        = opts.get("scripts"),
        extra_args     = opts.get("extra_args"),
        openvas_config = opts.get("openvas_config", "full"),
        timeout_s      = opts.get("timeout_s", 3600),
    )

    new_scan = VulnScan(
        name         = req.name,
        target       = req.target,
        scanner      = req.scanner,
        client_id    = req.client_id,
        status       = ScanStatus.PENDING,
        scan_options = opts,
        started_by   = current_user.username,
    )
    db.add(new_scan)
    await db.commit()
    await db.refresh(new_scan)

    asyncio.create_task(_execute_scan(str(new_scan.id), req))

    return {
        "id":      str(new_scan.id),
        "status":  new_scan.status.value,
        "message": f"Varredura '{req.name}' reiniciada com {req.scanner.value.upper()}",
    }


@router.get("/scans", summary="Listar varreduras")
async def list_scans(
    scanner: Optional[ScannerType] = None,
    status:  Optional[ScanStatus]  = None,
    client_id: Optional[str] = None,
    limit:   int = Query(50, ge=1, le=200),
    offset:  int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(VulnScan).options(selectinload(VulnScan.client)).order_by(VulnScan.created_at.desc())
    if scanner:
        q = q.where(VulnScan.scanner == scanner)
    if status:
        q = q.where(VulnScan.status == status)
    if client_id:
        q = q.where(VulnScan.client_id == client_id)
    q = q.offset(offset).limit(limit)

    result = await db.execute(q)
    scans  = result.scalars().all()

    # Contagem total
    count_q = select(func.count()).select_from(VulnScan)
    if scanner:
        count_q = count_q.where(VulnScan.scanner == scanner)
    if status:
        count_q = count_q.where(VulnScan.status == status)
    if client_id:
        count_q = count_q.where(VulnScan.client_id == client_id)
    total = (await db.execute(count_q)).scalar()

    return {
        "total": total,
        "items": [
            {
                "id":             str(s.id),
                "name":           s.name,
                "target":         s.target,
                "scanner":        s.scanner.value,
                "status":         s.status.value,
                "hosts_up":       s.hosts_up,
                "hosts_down":     s.hosts_down,
                "total_findings": s.total_findings,
                "duration_s":     s.duration_s,
                "started_by":     s.started_by,
                "error_msg":      s.error_msg,
                "scan_options":   s.scan_options,
                "client_id":      str(s.client_id) if s.client_id else None,
                "client_name":    s.client.name if s.client else None,
                "created_at":     s.created_at.isoformat() if s.created_at else None,
            }
            for s in scans
        ],
    }


@router.get("/scans/{scan_id}", summary="Detalhes de uma varredura")
async def get_scan_details(
    scan_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(VulnScan)
        .options(selectinload(VulnScan.client))
        .where(VulnScan.id == scan_id)
    )
    scan = result.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Varredura não encontrada")

    return {
        "id":             str(scan.id),
        "name":           scan.name,
        "target":         scan.target,
        "scanner":        scan.scanner.value,
        "status":         scan.status.value,
        "scan_options":   scan.scan_options,
        "hosts_up":       scan.hosts_up,
        "hosts_down":     scan.hosts_down,
        "total_findings": scan.total_findings,
        "duration_s":     scan.duration_s,
        "started_by":     scan.started_by,
        "error_msg":      scan.error_msg,
        "raw_output":     scan.raw_output,
        "client_id":      str(scan.client_id) if scan.client_id else None,
        "client_name":    scan.client.name if scan.client else None,
        "created_at":     scan.created_at.isoformat() if scan.created_at else None,
    }


@router.get("/scans/{scan_id}/findings", summary="Findings de uma varredura")
async def get_findings(
    scan_id:  UUID,
    severity: Optional[FindingSeverity] = None,
    host:     Optional[str] = None,
    limit:    int = Query(500, ge=1, le=2000),
    offset:   int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verificar se scan existe
    scan_res = await db.execute(select(VulnScan).where(VulnScan.id == scan_id))
    if not scan_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Varredura não encontrada")

    q = select(VulnFinding).where(VulnFinding.scan_id == scan_id)
    if severity:
        q = q.where(VulnFinding.severity == severity)
    if host:
        q = q.where(VulnFinding.host == host)

    q = q.order_by(VulnFinding.host, VulnFinding.port)
    q = q.offset(offset).limit(limit)

    result   = await db.execute(q)
    findings = result.scalars().all()

    return [
        {
            "id":              str(f.id),
            "host":            f.host,
            "hostname":        f.hostname,
            "port":            f.port,
            "protocol":        f.protocol,
            "service":         f.service,
            "service_version": f.service_version,
            "port_state":      f.port_state,
            "vuln_id":         f.vuln_id,
            "title":           f.title,
            "description":     f.description,
            "severity":        f.severity.value if f.severity else "info",
            "cvss_score":      f.cvss_score,
            "solution":        f.solution,
            "extra":           f.extra,
        }
        for f in findings
    ]


@router.delete("/scans/{scan_id}", summary="Remover varredura")
async def delete_scan(
    scan_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(VulnScan).where(VulnScan.id == scan_id))
    scan   = result.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Varredura não encontrada")
    await db.delete(scan)
    await db.commit()
    return {"message": "Varredura removida com sucesso"}


@router.get("/scans/{scan_id}/report/pdf", summary="Gerar relatório PDF")
async def generate_pdf_report(
    scan_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Gera relatório PDF completo da varredura para download."""
    scan_res = await db.execute(select(VulnScan).where(VulnScan.id == scan_id))
    scan     = scan_res.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Varredura não encontrada")
    if scan.status != ScanStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Varredura ainda não concluída")

    findings_res = await db.execute(
        select(VulnFinding).where(VulnFinding.scan_id == scan_id)
        .order_by(VulnFinding.host, VulnFinding.port)
    )
    findings = findings_res.scalars().all()

    html = _build_pdf_html(scan, findings)

    try:
        from weasyprint import HTML as WeasyprintHTML
        pdf_bytes = WeasyprintHTML(string=html).write_pdf()
    except ImportError:
        raise HTTPException(status_code=500, detail="WeasyPrint não disponível")

    filename = f"vuln-scan-{scan.name.replace(' ', '_')}-{scan.created_at.strftime('%Y%m%d')}.pdf"

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_pdf_html(scan: VulnScan, findings: list) -> str:
    """Gera HTML do relatório de vulnerabilidades."""
    severity_colors = {
        "critical": "#dc2626",
        "high":     "#ea580c",
        "medium":   "#d97706",
        "low":      "#2563eb",
        "info":     "#6b7280",
    }
    severity_labels = {
        "critical": "Crítico",
        "high":     "Alto",
        "medium":   "Médio",
        "low":      "Baixo",
        "info":     "Info",
    }

    sev_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        sev = f.severity.value if f.severity else "info"
        sev_counts[sev] = sev_counts.get(sev, 0) + 1

    hosts: dict = {}
    for f in findings:
        if f.host not in hosts:
            hosts[f.host] = []
        hosts[f.host].append(f)

    findings_html = ""
    for host_ip, host_findings in hosts.items():
        hostname = host_findings[0].hostname or ""
        findings_html += f"""
        <div class="host-block">
          <h3>🖥 {host_ip} {f'<span class="hostname">({hostname})</span>' if hostname else ''}</h3>
          <table>
            <thead>
              <tr>
                <th>Porta</th><th>Serviço</th><th>Título</th>
                <th>Severidade</th><th>CVE/ID</th>
              </tr>
            </thead>
            <tbody>
        """
        for f in sorted(host_findings, key=lambda x: (
            {"critical":0,"high":1,"medium":2,"low":3,"info":4}.get(
                x.severity.value if x.severity else "info", 4)
        )):
            sev = f.severity.value if f.severity else "info"
            color = severity_colors.get(sev, "#6b7280")
            label = severity_labels.get(sev, sev)
            port_str = f"{f.port}/{f.protocol}" if f.port else "—"
            findings_html += f"""
              <tr>
                <td class="mono">{port_str}</td>
                <td>{f.service or '—'} {f.service_version or ''}</td>
                <td>{f.title or '—'}</td>
                <td><span class="badge" style="background:{color}">{label}</span></td>
                <td class="mono">{f.vuln_id or '—'}</td>
              </tr>
            """
            if f.description:
                findings_html += f"""
              <tr class="desc-row">
                <td colspan="5"><pre>{f.description[:500]}</pre></td>
              </tr>
                """
        findings_html += "</tbody></table></div>"

    scanner_name = scan.scanner.value.upper()
    scan_date    = scan.created_at.strftime("%d/%m/%Y %H:%M") if scan.created_at else "—"
    duration     = f"{scan.duration_s:.0f}s" if scan.duration_s else "—"

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  body {{ font-family: Arial, sans-serif; font-size: 11px; color: #1f2937; margin: 20px; }}
  h1   {{ color: #111827; font-size: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }}
  h2   {{ color: #374151; font-size: 14px; margin-top: 20px; }}
  h3   {{ color: #374151; font-size: 12px; margin: 16px 0 6px; }}
  .hostname {{ color: #6b7280; font-weight: normal; font-size: 10px; }}
  .summary {{ display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }}
  .stat    {{ background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
              padding: 8px 14px; text-align: center; }}
  .stat .n {{ font-size: 22px; font-weight: bold; }}
  .stat .l {{ font-size: 10px; color: #6b7280; }}
  table {{ width: 100%; border-collapse: collapse; margin-bottom: 8px; }}
  th    {{ background: #f3f4f6; text-align: left; padding: 5px 8px;
           font-size: 10px; border: 1px solid #e5e7eb; }}
  td    {{ padding: 4px 8px; border: 1px solid #e5e7eb; vertical-align: top; }}
  .mono {{ font-family: monospace; font-size: 10px; }}
  .badge {{ color: white; padding: 2px 6px; border-radius: 4px;
            font-size: 9px; font-weight: bold; }}
  .host-block {{ margin-bottom: 20px; page-break-inside: avoid; }}
  .desc-row td {{ background: #f9fafb; }}
  pre {{ margin: 0; white-space: pre-wrap; word-break: break-all;
         font-size: 9px; color: #374151; }}
  .meta {{ color: #6b7280; font-size: 10px; margin-bottom: 16px; }}
  .footer {{ margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 8px;
             color: #9ca3af; font-size: 9px; text-align: center; }}
</style>
</head>
<body>
  <h1>Relatório de Vulnerabilidades — {scan.name}</h1>
  <div class="meta">
    <strong>Alvo:</strong> {scan.target} &nbsp;|&nbsp;
    <strong>Scanner:</strong> {scanner_name} &nbsp;|&nbsp;
    <strong>Data:</strong> {scan_date} &nbsp;|&nbsp;
    <strong>Duração:</strong> {duration} &nbsp;|&nbsp;
    <strong>Iniciado por:</strong> {scan.started_by or '—'}
  </div>

  <h2>Resumo</h2>
  <div class="summary">
    <div class="stat"><div class="n">{scan.hosts_up or 0}</div><div class="l">Hosts Ativos</div></div>
    <div class="stat"><div class="n">{scan.total_findings or 0}</div><div class="l">Total de Findings</div></div>
    <div class="stat"><div class="n" style="color:#dc2626">{sev_counts['critical']}</div><div class="l">Críticos</div></div>
    <div class="stat"><div class="n" style="color:#ea580c">{sev_counts['high']}</div><div class="l">Altos</div></div>
    <div class="stat"><div class="n" style="color:#d97706">{sev_counts['medium']}</div><div class="l">Médios</div></div>
    <div class="stat"><div class="n" style="color:#2563eb">{sev_counts['low']}</div><div class="l">Baixos</div></div>
    <div class="stat"><div class="n" style="color:#6b7280">{sev_counts['info']}</div><div class="l">Info</div></div>
  </div>

  <h2>Resultados por Host</h2>
  {findings_html if findings_html else '<p style="color:#6b7280">Nenhum finding encontrado.</p>'}

  <div class="footer">
    Relatório gerado pelo BR10 NetManager em {datetime.now().strftime('%d/%m/%Y %H:%M')} &nbsp;|&nbsp;
    Retenção: 90 dias
  </div>
</body>
</html>"""


@router.get("/openvas/status", summary="Verificar disponibilidade do OpenVAS")
async def openvas_status(
    current_user: User = Depends(get_current_user),
):
    return await check_openvas_available()


@router.post("/cleanup", summary="Limpar varreduras antigas (>90 dias)")
async def cleanup_old_scans(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove varreduras com mais de 90 dias."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    result = await db.execute(
        delete(VulnScan).where(VulnScan.created_at < cutoff)
    )
    await db.commit()
    return {"deleted": result.rowcount, "message": f"{result.rowcount} varreduras removidas"}

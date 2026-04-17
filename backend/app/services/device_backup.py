"""
BR10 NetManager - Serviço de Backup de Dispositivos

Responsabilidades:
  - Executar playbooks de backup em múltiplos dispositivos
  - Enviar notificações Telegram ao final de cada execução
  - Registrar logs detalhados por dispositivo
  - Integrar com APScheduler para execuções automáticas
"""
import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.backup_schedule import BackupSchedule, BackupExecution, BackupRunStatus
from app.models.device import Device, DeviceCredential
from app.models.playbook import Playbook, PlaybookExecution, PlaybookRunStatus
from app.core.security import decrypt_field as decrypt_value

logger = logging.getLogger(__name__)


# ─── Telegram ─────────────────────────────────────────────────────────────────

async def send_telegram(token: str, chat_id: str, message: str) -> tuple[bool, str]:
    """Envia mensagem para o Telegram. Retorna (sucesso, erro)."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
            })
            data = resp.json()
            if resp.status_code == 200 and data.get("ok"):
                return True, ""
            return False, data.get("description", f"HTTP {resp.status_code}")
    except Exception as e:
        return False, str(e)


async def send_telegram_file(
    token: str,
    chat_id: str,
    file_path: str,
    caption: str = "",
) -> tuple[bool, str]:
    """Envia um arquivo (documento) para o Telegram. Retorna (sucesso, erro)."""
    url = f"https://api.telegram.org/bot{token}/sendDocument"
    if not os.path.exists(file_path):
        return False, f"Arquivo não encontrado: {file_path}"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            with open(file_path, "rb") as f:
                resp = await client.post(
                    url,
                    data={"chat_id": chat_id, "caption": caption[:1024]},
                    files={"document": (os.path.basename(file_path), f)},
                )
            data = resp.json()
            if resp.status_code == 200 and data.get("ok"):
                return True, ""
            return False, data.get("description", f"HTTP {resp.status_code}")
    except Exception as e:
        return False, str(e)


def _build_telegram_message(
    schedule_name: str,
    execution: BackupExecution,
    device_results: List[Dict],
) -> str:
    """Monta a mensagem de notificação do Telegram com logs detalhados."""
    status_emoji = {
        BackupRunStatus.SUCCESS: "✅",
        BackupRunStatus.PARTIAL: "⚠️",
        BackupRunStatus.FAILURE: "❌",
    }.get(execution.status, "ℹ️")

    duration_s = (execution.duration_ms or 0) / 1000
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")

    lines = [
        f"{status_emoji} <b>Backup: {schedule_name}</b>",
        f"📅 {now_str}  |  ⏱ {duration_s:.1f}s",
        f"✅ {execution.success_count} sucesso(s)  ❌ {execution.failure_count} falha(s)",
        "",
    ]

    for dr in device_results:
        icon = "✅" if dr.get("status") == "success" else "❌"
        name = dr.get("device_name", dr.get("device_id", "?"))
        dur  = f" ({dr.get('duration_ms', 0)/1000:.1f}s)" if dr.get("duration_ms") else ""
        lines.append(f"  {icon} <b>{name}</b>{dur}")

        # Arquivos gerados (backup baixado)
        output_files = dr.get("output_files", [])
        for f in output_files:
            filename = os.path.basename(f)
            lines.append(f"     📂 {filename}")

        # Erro principal
        if dr.get("error") and dr.get("status") != "success":
            err = str(dr["error"])[:150]
            lines.append(f"     ❌ {err}")

        # Logs de passos com erro
        step_logs = dr.get("step_logs", [])
        failed_steps = [s for s in step_logs if s.get("status") == "error"]
        for s in failed_steps[:3]:  # max 3 passos com erro
            label = s.get("label", s.get("type", "?"))
            err_msg = (s.get("error") or "")[:100]
            lines.append(f"     ⚠️ Passo '{label}': {err_msg}")

    if execution.error_message:
        lines.append(f"\n⚠️ {execution.error_message[:200]}")

    lines.append(f"\n🤖 BR10 NetManager")
    return "\n".join(lines)


# ─── Executor de Backup ───────────────────────────────────────────────────────

async def run_backup_schedule(
    schedule_id: int,
    db: AsyncSession,
    triggered_by_id: Optional[int] = None,
    triggered_by_name: Optional[str] = None,
    trigger_type: str = "scheduled",
) -> BackupExecution:
    """
    Executa um agendamento de backup:
    1. Carrega o schedule e o playbook
    2. Para cada dispositivo, executa o playbook via PlaybookRunner
    3. Registra resultados
    4. Envia notificação Telegram se configurado
    5. Atualiza last_run_at e last_status no schedule
    """
    # Carregar schedule
    result = await db.execute(
        select(BackupSchedule).where(BackupSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise ValueError(f"Schedule {schedule_id} não encontrado")

    # Criar registro de execução
    execution = BackupExecution(
        schedule_id=schedule_id,
        triggered_by=triggered_by_id,
        triggered_by_name=triggered_by_name or "Sistema",
        trigger_type=trigger_type,
        status=BackupRunStatus.RUNNING,
        started_at=datetime.utcnow(),
        total_devices=len(schedule.device_ids or []),
        device_results=[],
    )
    db.add(execution)
    await db.flush()  # gera o ID

    start_time = time.time()
    device_results: List[Dict] = []
    success_count = 0
    failure_count = 0

    # Carregar playbook
    playbook = None
    if schedule.playbook_id:
        pb_result = await db.execute(
            select(Playbook).where(Playbook.id == schedule.playbook_id)
        )
        playbook = pb_result.scalar_one_or_none()

    if not playbook:
        execution.status = BackupRunStatus.FAILURE
        execution.error_message = f"Playbook ID {schedule.playbook_id} não encontrado ou removido."
        execution.finished_at = datetime.utcnow()
        execution.duration_ms = int((time.time() - start_time) * 1000)
        await db.commit()
        return execution

    # Executar para cada dispositivo
    device_ids = schedule.device_ids or []
    for device_id in device_ids:
        dev_result: Dict[str, Any] = {
            "device_id": device_id,
            "device_name": "?",
            "status": "pending",
            "error": None,
            "duration_ms": None,
            "playbook_execution_id": None,
        }

        dev_start = time.time()
        try:
            # Carregar dispositivo
            dev_res = await db.execute(
                select(Device).where(Device.id == device_id)
            )
            device = dev_res.scalar_one_or_none()
            if not device:
                dev_result["error"] = f"Dispositivo ID {device_id} não encontrado"
                dev_result["status"] = "failure"
                failure_count += 1
                device_results.append(dev_result)
                continue

            dev_result["device_name"] = device.name

            # Carregar credencial padrão
            cred_res = await db.execute(
                select(DeviceCredential).where(
                    DeviceCredential.device_id == device_id,
                    DeviceCredential.is_default == True,
                )
            )
            credential = cred_res.scalar_one_or_none()

            # Descriptografar senha
            password = ""
            if credential and credential.password_encrypted:
                try:
                    password = decrypt_value(credential.password_encrypted)
                except Exception:
                    password = ""

            username = credential.username if credential else (device.username or "")

            # Montar variáveis de runtime
            variables = dict(schedule.variables_override or {})
            variables.update({
                "HOST":        device.ip_address,
                "USERNAME":    username,
                "PASSWORD":    password,
                "DEVICE_NAME": device.name,
                "DEVICE_IP":   device.ip_address,
                "DATE":        datetime.now().strftime("%Y-%m-%d"),
                "DATETIME":    datetime.now().strftime("%Y%m%d_%H%M%S"),
            })

            # Executar playbook em thread separada (é síncrono)
            from app.services.playbook_runner import PlaybookRunner
            from app.models.playbook import PlaybookStep

            steps_res = await db.execute(
                select(PlaybookStep)
                .where(PlaybookStep.playbook_id == playbook.id)
                .order_by(PlaybookStep.order)
            )
            steps = steps_res.scalars().all()

            # Criar registro de execução do playbook
            pb_exec = PlaybookExecution(
                playbook_id=playbook.id,
                device_id=device_id,
                user_id=triggered_by_id,
                playbook_name=playbook.name,
                device_name=device.name,
                device_ip=device.ip_address,
                variables_used=variables,
                status=PlaybookRunStatus.RUNNING,
                started_at=datetime.utcnow(),
            )
            db.add(pb_exec)
            await db.flush()
            dev_result["playbook_execution_id"] = pb_exec.id

            # Executar em thread (runner é síncrono)
            runner = PlaybookRunner(
                steps=[{
                    "step_type": s.step_type,
                    "label": s.label,
                    "params": s.params or {},
                    "on_error": s.on_error,
                    "timeout_seconds": s.timeout_seconds,
                    "order": s.order,
                } for s in steps],
                variables=variables,
                device_name=device.name,
                device_ip=device.ip_address,
                device_username=username,
                device_password=password,
                device_telnet_port=int(device.telnet_port or 23),
                device_ssh_port=int(device.ssh_port or 22),
                client_name=getattr(device, 'client_name', '') or '',
            )

            loop = asyncio.get_event_loop()
            run_result = await loop.run_in_executor(None, runner.run)

            # Atualizar execução do playbook
            run_success = run_result.get("status") == "success"
            pb_exec.status = PlaybookRunStatus.SUCCESS if run_success else PlaybookRunStatus.ERROR
            pb_exec.step_logs = run_result.get("step_logs", [])
            pb_exec.output_files = run_result.get("output_files", [])
            pb_exec.error_message = run_result.get("error_message")
            pb_exec.finished_at = datetime.utcnow()
            pb_exec.duration_ms = int((time.time() - dev_start) * 1000)
            pb_exec.current_step = len(run_result.get("step_logs", []))

            # Guardar logs e arquivos no resultado do dispositivo
            dev_result["step_logs"] = run_result.get("step_logs", [])
            dev_result["output_files"] = run_result.get("output_files", [])

            if run_success:
                dev_result["status"] = "success"
                success_count += 1
                # Atualizar last_backup no dispositivo
                device.last_backup = datetime.utcnow()
            else:
                dev_result["status"] = "failure"
                dev_result["error"] = run_result.get("error_message", "Erro desconhecido")
                failure_count += 1

        except Exception as exc:
            logger.exception(f"Erro ao executar backup para dispositivo {device_id}: {exc}")
            dev_result["status"] = "failure"
            dev_result["error"] = str(exc)[:500]
            failure_count += 1

        dev_result["duration_ms"] = int((time.time() - dev_start) * 1000)
        device_results.append(dev_result)

    # Determinar status final
    if failure_count == 0:
        final_status = BackupRunStatus.SUCCESS
    elif success_count == 0:
        final_status = BackupRunStatus.FAILURE
    else:
        final_status = BackupRunStatus.PARTIAL

    total_ms = int((time.time() - start_time) * 1000)

    # Atualizar execução
    execution.status = final_status
    execution.finished_at = datetime.utcnow()
    execution.duration_ms = total_ms
    execution.device_results = device_results
    execution.success_count = success_count
    execution.failure_count = failure_count

    # Atualizar schedule
    schedule.last_run_at = datetime.utcnow()
    schedule.last_status = final_status

    await db.commit()
    await db.refresh(execution)

    # ── Logs de Auditoria Adicionais ──────────────────────────────────────────
    from app.core.audit_helper import log_audit
    from app.models.audit import AuditAction
    
    # Log de execução de serviço
    await log_audit(
        db,
        action=AuditAction.SERVICE_EXECUTION,
        description=f"Execução de backup agendado: {schedule.name}",
        status="success" if final_status == BackupRunStatus.SUCCESS else "warning" if final_status == BackupRunStatus.PARTIAL else "failure",
        extra_data={
            "service": "device_backup",
            "schedule_name": schedule.name,
            "success_count": success_count,
            "failure_count": failure_count,
            "duration_ms": total_ms
        }
    )

    # Log de acesso a equipamento para cada dispositivo no backup
    for dr in device_results:
        if dr.get("status") == "success":
            await log_audit(
                db,
                action=AuditAction.EQUIPMENT_ACCESS,
                description=f"Acesso ao equipamento {dr.get('device_name')} para backup",
                status="success",
                device_id=dr.get("device_id"),
                extra_data={
                    "method": "backup_playbook",
                    "schedule_id": schedule_id,
                    "duration_ms": dr.get("duration_ms")
                }
            )

    # Enviar Telegram
    if schedule.telegram_enabled and schedule.telegram_token and schedule.telegram_chat_id:
        should_notify = (
            (final_status == BackupRunStatus.SUCCESS and schedule.telegram_on_success) or
            (final_status in (BackupRunStatus.FAILURE, BackupRunStatus.PARTIAL) and schedule.telegram_on_error)
        )
        if should_notify:
            # 1. Enviar mensagem de resumo
            msg = _build_telegram_message(schedule.name, execution, device_results)
            ok, err = await send_telegram(
                schedule.telegram_token,
                schedule.telegram_chat_id,
                msg,
            )
            execution.telegram_sent = ok
            execution.telegram_error = err if not ok else None

            # 2. Enviar arquivos de backup gerados como documentos
            for dr in device_results:
                output_files = dr.get("output_files", [])
                for fpath in output_files:
                    if os.path.exists(fpath):
                        dev_name = dr.get("device_name", "dispositivo")
                        caption = f"Backup {dev_name} - {datetime.now().strftime('%d/%m/%Y %H:%M')}"
                        file_ok, file_err = await send_telegram_file(
                            schedule.telegram_token,
                            schedule.telegram_chat_id,
                            fpath,
                            caption=caption,
                        )
                        if not file_ok:
                            logger.warning(f"Falha ao enviar arquivo {fpath} ao Telegram: {file_err}")

            await db.commit()

    logger.info(
        f"Backup '{schedule.name}' concluído: {success_count}/{len(device_ids)} "
        f"dispositivos OK em {total_ms}ms"
    )
    return execution


# ─── Teste de Telegram ─────────────────────────────────────────────────────────

async def test_telegram(token: str, chat_id: str) -> tuple[bool, str]:
    """Envia mensagem de teste para validar a configuração do Telegram."""
    msg = (
        "✅ <b>BR10 NetManager — Teste de Notificação</b>\n\n"
        "Configuração do Telegram validada com sucesso!\n"
        "Você receberá notificações de backup neste chat."
    )
    return await send_telegram(token, chat_id, msg)

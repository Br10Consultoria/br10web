"""
BR10 NetManager - Serviço de Notificações Telegram Globais

Funções de alto nível para envio de alertas do sistema via Telegram,
usando as configurações globais armazenadas em SystemConfig.

Uso:
    from app.services.telegram_notify import notify_device_down, notify_backup_result
    await notify_device_down(db, device_name="OLT-01", device_ip="10.0.0.1")
"""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system_config import SystemConfig

logger = logging.getLogger(__name__)


# ─── Helpers internos ────────────────────────────────────────────────────────

async def _get_config(db: AsyncSession, key: str, default: str = "") -> str:
    """Busca uma configuração do sistema pelo key."""
    try:
        result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
        row = result.scalar_one_or_none()
        return row.value if row and row.value is not None else default
    except Exception:
        return default


async def _is_telegram_enabled(db: AsyncSession) -> bool:
    val = await _get_config(db, "telegram_enabled", "false")
    return val.lower() == "true"


async def _get_credentials(db: AsyncSession) -> tuple[str, str]:
    token   = await _get_config(db, "telegram_bot_token")
    chat_id = await _get_config(db, "telegram_chat_id")
    return token, chat_id


async def _send(token: str, chat_id: str, text: str) -> tuple[bool, str]:
    """Envia mensagem de texto via Telegram Bot API."""
    if not token or not chat_id:
        return False, "Token ou chat_id não configurados."
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            })
            if resp.status_code == 200:
                return True, ""
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return False, str(e)


def _now_br() -> str:
    """Retorna data/hora atual formatada no fuso de Brasília."""
    from datetime import timezone, timedelta
    tz_br = timezone(timedelta(hours=-3))
    return datetime.now(tz_br).strftime("%d/%m/%Y %H:%M:%S")


# ─── Funções públicas de notificação ─────────────────────────────────────────

async def notify_device_down(
    db: AsyncSession,
    device_name: str,
    device_ip: str,
    client_name: Optional[str] = None,
) -> None:
    """Envia alerta quando um dispositivo fica offline."""
    try:
        if not await _is_telegram_enabled(db):
            return
        flag = await _get_config(db, "telegram_alert_device_down", "true")
        if flag.lower() != "true":
            return
        token, chat_id = await _get_credentials(db)
        client_info = f"\n<b>Cliente:</b> {client_name}" if client_name else ""
        msg = (
            f"🔴 <b>DISPOSITIVO OFFLINE</b>\n"
            f"<b>Nome:</b> {device_name}\n"
            f"<b>IP:</b> <code>{device_ip}</code>"
            f"{client_info}\n"
            f"<b>Horário:</b> {_now_br()}"
        )
        ok, err = await _send(token, chat_id, msg)
        if not ok:
            logger.warning(f"[Telegram] Falha ao enviar alerta device_down ({device_name}): {err}")
        else:
            logger.info(f"[Telegram] Alerta device_down enviado: {device_name} ({device_ip})")
    except Exception as e:
        logger.error(f"[Telegram] Erro em notify_device_down: {e}")


async def notify_device_up(
    db: AsyncSession,
    device_name: str,
    device_ip: str,
    client_name: Optional[str] = None,
) -> None:
    """Envia alerta quando um dispositivo volta online."""
    try:
        if not await _is_telegram_enabled(db):
            return
        flag = await _get_config(db, "telegram_alert_device_up", "true")
        if flag.lower() != "true":
            return
        token, chat_id = await _get_credentials(db)
        client_info = f"\n<b>Cliente:</b> {client_name}" if client_name else ""
        msg = (
            f"🟢 <b>DISPOSITIVO ONLINE</b>\n"
            f"<b>Nome:</b> {device_name}\n"
            f"<b>IP:</b> <code>{device_ip}</code>"
            f"{client_info}\n"
            f"<b>Horário:</b> {_now_br()}"
        )
        ok, err = await _send(token, chat_id, msg)
        if not ok:
            logger.warning(f"[Telegram] Falha ao enviar alerta device_up ({device_name}): {err}")
        else:
            logger.info(f"[Telegram] Alerta device_up enviado: {device_name} ({device_ip})")
    except Exception as e:
        logger.error(f"[Telegram] Erro em notify_device_up: {e}")


async def notify_backup_result(
    db: AsyncSession,
    schedule_name: str,
    status: str,          # "success" | "partial" | "failure"
    device_count: int,
    failed_devices: list[str],
    duration_s: float,
) -> None:
    """Envia alerta com resultado de execução de backup agendado."""
    try:
        if not await _is_telegram_enabled(db):
            return
        is_ok = status == "success"
        flag_key = "telegram_alert_backup_ok" if is_ok else "telegram_alert_backup_fail"
        flag = await _get_config(db, flag_key, "true")
        if flag.lower() != "true":
            return
        token, chat_id = await _get_credentials(db)
        icon = "✅" if is_ok else ("⚠️" if status == "partial" else "❌")
        status_label = {"success": "SUCESSO", "partial": "PARCIAL", "failure": "FALHA"}.get(status, status.upper())
        failed_info = ""
        if failed_devices:
            failed_info = f"\n<b>Falhas:</b> {', '.join(failed_devices[:5])}"
            if len(failed_devices) > 5:
                failed_info += f" (+{len(failed_devices) - 5})"
        msg = (
            f"{icon} <b>BACKUP {status_label}</b>\n"
            f"<b>Agendamento:</b> {schedule_name}\n"
            f"<b>Dispositivos:</b> {device_count}"
            f"{failed_info}\n"
            f"<b>Duração:</b> {duration_s:.0f}s\n"
            f"<b>Horário:</b> {_now_br()}"
        )
        ok, err = await _send(token, chat_id, msg)
        if not ok:
            logger.warning(f"[Telegram] Falha ao enviar alerta backup ({schedule_name}): {err}")
        else:
            logger.info(f"[Telegram] Alerta backup enviado: {schedule_name} — {status_label}")
    except Exception as e:
        logger.error(f"[Telegram] Erro em notify_backup_result: {e}")


async def notify_playbook_result(
    db: AsyncSession,
    playbook_name: str,
    status: str,          # "success" | "failure" | "partial"
    device_name: Optional[str] = None,
    duration_s: float = 0,
    error_summary: Optional[str] = None,
) -> None:
    """Envia alerta com resultado de execução de playbook."""
    try:
        if not await _is_telegram_enabled(db):
            return
        is_ok = status in ("success", "partial")
        flag_key = "telegram_alert_playbook_ok" if is_ok else "telegram_alert_playbook_fail"
        flag = await _get_config(db, flag_key, "false" if is_ok else "true")
        if flag.lower() != "true":
            return
        token, chat_id = await _get_credentials(db)
        icon = "✅" if status == "success" else ("⚠️" if status == "partial" else "❌")
        status_label = {"success": "CONCLUÍDO", "partial": "PARCIAL", "failure": "FALHOU"}.get(status, status.upper())
        device_info = f"\n<b>Dispositivo:</b> {device_name}" if device_name else ""
        error_info  = f"\n<b>Erro:</b> {error_summary[:200]}" if error_summary else ""
        msg = (
            f"{icon} <b>PLAYBOOK {status_label}</b>\n"
            f"<b>Playbook:</b> {playbook_name}"
            f"{device_info}"
            f"{error_info}\n"
            f"<b>Duração:</b> {duration_s:.0f}s\n"
            f"<b>Horário:</b> {_now_br()}"
        )
        ok, err = await _send(token, chat_id, msg)
        if not ok:
            logger.warning(f"[Telegram] Falha ao enviar alerta playbook ({playbook_name}): {err}")
        else:
            logger.info(f"[Telegram] Alerta playbook enviado: {playbook_name} — {status_label}")
    except Exception as e:
        logger.error(f"[Telegram] Erro em notify_playbook_result: {e}")


async def send_custom_message(
    db: AsyncSession,
    message: str,
    token: Optional[str] = None,
    chat_id: Optional[str] = None,
) -> tuple[bool, str]:
    """
    Envia mensagem customizada.
    Se token/chat_id não fornecidos, usa as configurações globais.
    """
    try:
        if not token or not chat_id:
            token, chat_id = await _get_credentials(db)
        return await _send(token, chat_id, message)
    except Exception as e:
        return False, str(e)


async def test_telegram_global(db: AsyncSession) -> tuple[bool, str]:
    """Testa as configurações globais de Telegram."""
    token, chat_id = await _get_credentials(db)
    if not token or not chat_id:
        return False, "Token ou chat_id não configurados em Configurações do Sistema."
    msg = (
        f"✅ <b>BR10 NetManager</b>\n"
        f"Configuração Telegram validada com sucesso!\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    return await _send(token, chat_id, msg)

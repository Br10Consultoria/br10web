"""
BR10 NetManager - Serviço de Notificações Telegram Globais

Funções de alto nível para envio de alertas do sistema via Telegram,
usando as configurações globais armazenadas em SystemConfig.

Eventos cobertos:
  - Dispositivo offline / online
  - Backup concluído / falhou
  - Playbook executado / falhou
  - RPKI inválido / mudança de status
  - Scan Nmap/VulnScanner concluído / falhou
  - Análise de IA concluída
  - Comando crítico executado no dispositivo
  - Auditoria: login suspeito, falha de autenticação, ação de admin
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system_config import SystemConfig

logger = logging.getLogger(__name__)

# ─── Helpers internos ────────────────────────────────────────────────────────

async def _get_config(db: AsyncSession, key: str, default: str = "") -> str:
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


async def _is_flag_on(db: AsyncSession, key: str, default: str = "true") -> bool:
    val = await _get_config(db, key, default)
    return val.lower() == "true"


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
    tz_br = timezone(timedelta(hours=-3))
    return datetime.now(tz_br).strftime("%d/%m/%Y %H:%M:%S")


async def _notify(db: AsyncSession, flag_key: str, msg: str, flag_default: str = "true", label: str = "") -> None:
    """Helper genérico: verifica flag, busca credenciais e envia."""
    try:
        if not await _is_telegram_enabled(db):
            return
        if not await _is_flag_on(db, flag_key, flag_default):
            return
        token, chat_id = await _get_credentials(db)
        ok, err = await _send(token, chat_id, msg)
        if not ok:
            logger.warning(f"[Telegram] Falha ao enviar {label}: {err}")
        else:
            logger.info(f"[Telegram] Alerta enviado: {label}")
    except Exception as e:
        logger.error(f"[Telegram] Erro em _notify({label}): {e}")


# ─── Dispositivos ─────────────────────────────────────────────────────────────

async def notify_device_down(
    db: AsyncSession,
    device_name: str,
    device_ip: str,
    client_name: Optional[str] = None,
) -> None:
    client_info = f"\n<b>Cliente:</b> {client_name}" if client_name else ""
    msg = (
        f"🔴 <b>DISPOSITIVO OFFLINE</b>\n"
        f"<b>Nome:</b> {device_name}\n"
        f"<b>IP:</b> <code>{device_ip}</code>"
        f"{client_info}\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, "telegram_alert_device_down", msg, label=f"device_down:{device_name}")


async def notify_device_up(
    db: AsyncSession,
    device_name: str,
    device_ip: str,
    client_name: Optional[str] = None,
) -> None:
    client_info = f"\n<b>Cliente:</b> {client_name}" if client_name else ""
    msg = (
        f"🟢 <b>DISPOSITIVO ONLINE</b>\n"
        f"<b>Nome:</b> {device_name}\n"
        f"<b>IP:</b> <code>{device_ip}</code>"
        f"{client_info}\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, "telegram_alert_device_up", msg, label=f"device_up:{device_name}")


# ─── Backup ───────────────────────────────────────────────────────────────────

async def notify_backup_result(
    db: AsyncSession,
    schedule_name: str,
    status: str,
    device_count: int,
    failed_devices: list[str],
    duration_s: float,
) -> None:
    is_ok = status == "success"
    flag_key = "telegram_alert_backup_ok" if is_ok else "telegram_alert_backup_fail"
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
    await _notify(db, flag_key, msg, label=f"backup:{schedule_name}:{status_label}")


# ─── Playbook ─────────────────────────────────────────────────────────────────

async def notify_playbook_result(
    db: AsyncSession,
    playbook_name: str,
    status: str,
    device_name: Optional[str] = None,
    duration_s: float = 0,
    error_summary: Optional[str] = None,
) -> None:
    is_ok = status in ("success", "partial")
    flag_key = "telegram_alert_playbook_ok" if is_ok else "telegram_alert_playbook_fail"
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
    await _notify(db, flag_key, msg, flag_default="false" if is_ok else "true",
                  label=f"playbook:{playbook_name}:{status_label}")


# ─── RPKI ─────────────────────────────────────────────────────────────────────

async def notify_rpki_invalid(
    db: AsyncSession,
    prefix: str,
    asn: Optional[int],
    monitor_name: Optional[str] = None,
    previous_status: Optional[str] = None,
) -> None:
    """Alerta quando um prefixo RPKI tem status INVALID."""
    name_info = f"\n<b>Monitor:</b> {monitor_name}" if monitor_name else ""
    asn_info  = f"\n<b>ASN:</b> AS{asn}" if asn else ""
    prev_info = f"\n<b>Status anterior:</b> {previous_status.upper()}" if previous_status else ""
    msg = (
        f"🚨 <b>RPKI INVÁLIDO</b>\n"
        f"<b>Prefixo:</b> <code>{prefix}</code>"
        f"{asn_info}"
        f"{name_info}"
        f"{prev_info}\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, "telegram_alert_rpki_invalid", msg, label=f"rpki_invalid:{prefix}")


async def notify_rpki_status_change(
    db: AsyncSession,
    prefix: str,
    old_status: str,
    new_status: str,
    asn: Optional[int] = None,
    monitor_name: Optional[str] = None,
) -> None:
    """Alerta quando o status RPKI de um prefixo muda."""
    icons = {"valid": "🟢", "invalid": "🔴", "not-found": "🟡", "error": "⚠️", "unknown": "⚪"}
    icon_old = icons.get(old_status, "⚪")
    icon_new = icons.get(new_status, "⚪")
    name_info = f"\n<b>Monitor:</b> {monitor_name}" if monitor_name else ""
    asn_info  = f"\n<b>ASN:</b> AS{asn}" if asn else ""
    msg = (
        f"🔄 <b>RPKI — MUDANÇA DE STATUS</b>\n"
        f"<b>Prefixo:</b> <code>{prefix}</code>"
        f"{asn_info}"
        f"{name_info}\n"
        f"<b>Antes:</b> {icon_old} {old_status.upper()}\n"
        f"<b>Agora:</b>  {icon_new} {new_status.upper()}\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, "telegram_alert_rpki_change", msg, label=f"rpki_change:{prefix}:{old_status}->{new_status}")


# ─── VulnScanner / Nmap ───────────────────────────────────────────────────────

async def notify_scan_result(
    db: AsyncSession,
    scan_name: str,
    target: str,
    scanner: str,
    status: str,           # "completed" | "failed" | "timeout"
    findings_count: int = 0,
    critical_count: int = 0,
    high_count: int = 0,
    duration_s: float = 0,
    error_msg: Optional[str] = None,
) -> None:
    """Alerta ao concluir ou falhar um scan de vulnerabilidades."""
    is_ok = status == "completed"
    flag_key = "telegram_alert_scan_ok" if is_ok else "telegram_alert_scan_fail"
    icon = "✅" if is_ok else ("⏱️" if status == "timeout" else "❌")
    status_label = {"completed": "CONCLUÍDO", "failed": "FALHOU", "timeout": "TIMEOUT"}.get(status, status.upper())
    findings_info = ""
    if is_ok and findings_count > 0:
        findings_info = (
            f"\n<b>Findings:</b> {findings_count} total"
            + (f" | 🔴 Críticos: {critical_count}" if critical_count else "")
            + (f" | 🟠 Altos: {high_count}" if high_count else "")
        )
    elif is_ok:
        findings_info = "\n<b>Findings:</b> Nenhum encontrado ✓"
    error_info = f"\n<b>Erro:</b> {error_msg[:200]}" if error_msg else ""
    msg = (
        f"{icon} <b>SCAN {status_label}</b>\n"
        f"<b>Nome:</b> {scan_name}\n"
        f"<b>Alvo:</b> <code>{target}</code>\n"
        f"<b>Scanner:</b> {scanner.upper()}"
        f"{findings_info}"
        f"{error_info}\n"
        f"<b>Duração:</b> {duration_s:.0f}s\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, flag_key, msg, flag_default="true", label=f"scan:{scan_name}:{status_label}")


# ─── Análise de IA ────────────────────────────────────────────────────────────

async def notify_ai_analysis(
    db: AsyncSession,
    analysis_type: str,
    device_name: Optional[str] = None,
    status: str = "success",
    tokens_used: int = 0,
    duration_s: float = 0,
    summary: Optional[str] = None,
    error_msg: Optional[str] = None,
) -> None:
    """Alerta ao concluir uma análise de IA."""
    is_ok = status == "success"
    flag_key = "telegram_alert_ai_ok" if is_ok else "telegram_alert_ai_fail"
    icon = "🤖" if is_ok else "❌"
    status_label = "CONCLUÍDA" if is_ok else "FALHOU"
    type_labels = {
        "alarms": "Alarmes", "bgp": "BGP", "olt": "OLT",
        "system_log": "Log do Sistema", "security": "Segurança",
        "config": "Configuração", "custom": "Personalizada",
    }
    type_label = type_labels.get(analysis_type, analysis_type.replace("_", " ").title())
    device_info  = f"\n<b>Dispositivo:</b> {device_name}" if device_name else ""
    summary_info = f"\n<b>Resumo:</b> {summary[:300]}..." if summary and len(summary) > 50 else (f"\n<b>Resumo:</b> {summary}" if summary else "")
    tokens_info  = f"\n<b>Tokens:</b> {tokens_used:,}" if tokens_used else ""
    error_info   = f"\n<b>Erro:</b> {error_msg[:200]}" if error_msg else ""
    msg = (
        f"{icon} <b>ANÁLISE DE IA {status_label}</b>\n"
        f"<b>Tipo:</b> {type_label}"
        f"{device_info}"
        f"{summary_info}"
        f"{tokens_info}"
        f"{error_info}\n"
        f"<b>Duração:</b> {duration_s:.1f}s\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, flag_key, msg, flag_default="false", label=f"ai:{analysis_type}:{status_label}")


# ─── Comandos críticos no dispositivo ────────────────────────────────────────

# Palavras-chave que identificam comandos críticos (que alteram configuração)
CRITICAL_COMMAND_KEYWORDS = [
    "shutdown", "no shutdown", "no onu", "undo", "reset",
    "delete", "remove", "disable", "enable port", "port down",
    "interface shutdown", "no interface", "ip route", "no ip route",
    "bgp", "ospf", "isis", "no bgp", "no ospf",
    "write", "save", "commit", "rollback",
    "reboot", "restart", "reload",
    "no access-user", "cut access-user",
]


def _is_critical_command(cmd: str) -> bool:
    cmd_lower = cmd.lower().strip()
    return any(kw in cmd_lower for kw in CRITICAL_COMMAND_KEYWORDS)


async def notify_critical_command(
    db: AsyncSession,
    username: str,
    device_name: str,
    device_ip: str,
    command: str,
    success: bool,
    category: Optional[str] = None,
    client_name: Optional[str] = None,
) -> None:
    """Alerta quando um comando crítico é executado em um dispositivo."""
    icon = "⚙️" if success else "❌"
    status_label = "EXECUTADO" if success else "FALHOU"
    client_info   = f"\n<b>Cliente:</b> {client_name}" if client_name else ""
    category_info = f"\n<b>Categoria:</b> {category}" if category else ""
    msg = (
        f"{icon} <b>COMANDO CRÍTICO {status_label}</b>\n"
        f"<b>Operador:</b> {username}\n"
        f"<b>Dispositivo:</b> {device_name} (<code>{device_ip}</code>)"
        f"{client_info}"
        f"{category_info}\n"
        f"<b>Comando:</b> <code>{command[:300]}</code>\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, "telegram_alert_critical_command", msg, flag_default="true",
                  label=f"critical_cmd:{device_name}:{command[:40]}")


# ─── Auditoria ────────────────────────────────────────────────────────────────

async def notify_login_failed(
    db: AsyncSession,
    username: str,
    ip_address: Optional[str] = None,
    attempt_count: int = 1,
) -> None:
    """Alerta em falhas de autenticação (possível ataque de força bruta)."""
    ip_info = f"\n<b>IP:</b> <code>{ip_address}</code>" if ip_address else ""
    count_info = f"\n<b>Tentativas:</b> {attempt_count}" if attempt_count > 1 else ""
    msg = (
        f"⚠️ <b>FALHA DE AUTENTICAÇÃO</b>\n"
        f"<b>Usuário:</b> <code>{username}</code>"
        f"{ip_info}"
        f"{count_info}\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, "telegram_alert_login_failed", msg, flag_default="true",
                  label=f"login_failed:{username}")


async def notify_login_new_ip(
    db: AsyncSession,
    username: str,
    ip_address: str,
    user_agent: Optional[str] = None,
) -> None:
    """Alerta quando um usuário faz login de um IP não visto antes."""
    ua_info = f"\n<b>Navegador:</b> {user_agent[:100]}" if user_agent else ""
    msg = (
        f"🔐 <b>LOGIN DE IP NOVO</b>\n"
        f"<b>Usuário:</b> {username}\n"
        f"<b>IP:</b> <code>{ip_address}</code>"
        f"{ua_info}\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, "telegram_alert_login_new_ip", msg, flag_default="false",
                  label=f"login_new_ip:{username}:{ip_address}")


async def notify_admin_action(
    db: AsyncSession,
    username: str,
    action: str,
    target: Optional[str] = None,
    details: Optional[str] = None,
) -> None:
    """Alerta para ações administrativas críticas (criar/deletar usuário, alterar permissões, etc.)."""
    target_info  = f"\n<b>Alvo:</b> {target}" if target else ""
    details_info = f"\n<b>Detalhes:</b> {details[:200]}" if details else ""
    msg = (
        f"🛡️ <b>AÇÃO ADMINISTRATIVA</b>\n"
        f"<b>Operador:</b> {username}\n"
        f"<b>Ação:</b> {action}"
        f"{target_info}"
        f"{details_info}\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, "telegram_alert_admin_action", msg, flag_default="true",
                  label=f"admin_action:{username}:{action}")


# ─── Blacklist / Reputação de IP ────────────────────────────────────────────

async def notify_blacklist_check(
    db: AsyncSession,
    target: str,
    target_type: str,
    status: str,              # "listed" | "clean" | "error"
    listed_count: int = 0,
    checked_count: int = 0,
    blacklists_found: Optional[list] = None,
    all_results: Optional[list] = None,
    trigger_type: str = "manual",   # "manual" | "scheduled" | "monitor"
    monitor_name: Optional[str] = None,
    triggered_by_username: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> None:
    """
    Alerta quando uma consulta de blacklist/reputação é realizada.
    - Sempre dispara quando o alvo está LISTADO (status=listed).
    - Consultas limpas disparam apenas se o toggle 'blacklist_clean' estiver ativo.
    - Erros disparam apenas se o toggle 'blacklist_error' estiver ativo.
    """
    if status == "listed":
        flag_key = "telegram_alert_blacklist_listed"
        flag_default = "true"
    elif status == "clean":
        flag_key = "telegram_alert_blacklist_clean"
        flag_default = "false"   # desligado por padrão — evita spam em consultas limpas
    else:
        flag_key = "telegram_alert_blacklist_error"
        flag_default = "false"

    # ─── Ícone e título ───────────────────────────────────────────────────────
    icons = {"listed": "🚫", "clean": "✅", "error": "⚠️"}
    titles = {"listed": "BLACKLIST — ALVO LISTADO", "clean": "BLACKLIST — ALVO LIMPO", "error": "BLACKLIST — ERRO NA CONSULTA"}
    icon  = icons.get(status, "❓")
    title = titles.get(status, f"BLACKLIST — {status.upper()}")

    # ─── Tipo do alvo ─────────────────────────────────────────────────────────
    type_labels = {"ip": "IP", "domain": "Domínio", "asn": "ASN"}
    type_label = type_labels.get(target_type, target_type.upper())

    # ─── Listas positivas ─────────────────────────────────────────────────────
    listed_info = ""
    if blacklists_found and status == "listed":
        # Mostrar até 10 listas onde o alvo foi encontrado
        bl_list = blacklists_found[:10]
        bl_lines = "\n".join(f"  • {bl}" for bl in bl_list)
        extra = f"\n  <i>(+{len(blacklists_found) - 10} mais)</i>" if len(blacklists_found) > 10 else ""
        listed_info = f"\n<b>Listas positivas:</b>\n{bl_lines}{extra}"

    # ─── Score / escore de risco ──────────────────────────────────────────────
    score_info = ""
    if checked_count > 0:
        score_pct = round((listed_count / checked_count) * 100, 1)
        if status == "listed":
            if score_pct >= 50:
                score_icon = "🔴"
            elif score_pct >= 20:
                score_icon = "🟠"
            else:
                score_icon = "🟡"
            score_info = f"\n<b>Escore de risco:</b> {score_icon} {listed_count}/{checked_count} listas ({score_pct}%)"
        else:
            score_info = f"\n<b>Verificado em:</b> {checked_count} listas"

    # ─── Detalhes adicionais ──────────────────────────────────────────────────
    trigger_labels = {"manual": "Manual", "scheduled": "Agendado", "monitor": "Monitor automático"}
    trigger_label = trigger_labels.get(trigger_type, trigger_type.title())
    monitor_info  = f"\n<b>Monitor:</b> {monitor_name}" if monitor_name else ""
    user_info     = f"\n<b>Consultado por:</b> {triggered_by_username}" if triggered_by_username else ""
    duration_info = f"\n<b>Duração:</b> {duration_ms}ms" if duration_ms else ""

    msg = (
        f"{icon} <b>{title}</b>\n"
        f"<b>Alvo:</b> <code>{target}</code>\n"
        f"<b>Tipo:</b> {type_label}"
        f"{score_info}"
        f"{listed_info}"
        f"{monitor_info}"
        f"\n<b>Origem:</b> {trigger_label}"
        f"{user_info}"
        f"{duration_info}\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    await _notify(db, flag_key, msg, flag_default=flag_default,
                  label=f"blacklist:{status}:{target}")


# ─── Mensagem customizada / Teste ─────────────────────────────────────────────

async def send_custom_message(
    db: AsyncSession,
    message: str,
    token: Optional[str] = None,
    chat_id: Optional[str] = None,
) -> tuple[bool, str]:
    try:
        if not token or not chat_id:
            token, chat_id = await _get_credentials(db)
        return await _send(token, chat_id, message)
    except Exception as e:
        return False, str(e)


async def test_telegram_global(db: AsyncSession) -> tuple[bool, str]:
    token, chat_id = await _get_credentials(db)
    if not token or not chat_id:
        return False, "Token ou chat_id não configurados em Configurações do Sistema."
    msg = (
        f"✅ <b>BR10 NetManager</b>\n"
        f"Configuração Telegram validada com sucesso!\n"
        f"Todos os alertas do sistema estão configurados.\n"
        f"<b>Horário:</b> {_now_br()}"
    )
    return await _send(token, chat_id, msg)

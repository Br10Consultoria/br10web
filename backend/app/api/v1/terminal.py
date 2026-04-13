"""
BR10 NetManager - Terminal WebSocket API
Terminal web interativo via WebSocket para SSH e Telnet.
Inclui auditoria completa: sessão iniciada/encerrada, comandos executados, erros.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import decode_token, decrypt_field
from app.core.ws_tickets import create_ticket, consume_ticket
from app.models.device import Device
from app.models.user import User
from app.models.audit import AuditAction
from app.core.audit_helper import log_audit
from app.api.v1.auth import get_current_user
from app.services.terminal import (
    SSHTerminalSession, TelnetTerminalSession, session_manager
)

router = APIRouter(prefix="/terminal", tags=["Terminal"])
logger = logging.getLogger(__name__)


async def authenticate_ws(token: str, db: AsyncSession) -> Optional[User]:
    """Autentica usuário via token JWT no WebSocket."""
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return None
    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    return result.scalar_one_or_none()


async def _write_audit(
    db: AsyncSession,
    action: AuditAction,
    description: str,
    status: str = "success",
    user_id=None,
    device_id=None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    error_message: Optional[str] = None,
    extra_data: Optional[dict] = None,
):
    """Wrapper para log_audit centralizado."""
    await log_audit(
        db,
        action=action,
        description=description,
        status=status,
        user_id=user_id,
        device_id=device_id,
        ip_address=ip_address,
        user_agent=user_agent,
        error_message=error_message,
        extra_data=extra_data,
        resource_type="terminal",
    )


@router.post("/ticket/{device_id}")
async def create_terminal_ticket(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Gera um ticket de sessão de uso único (TTL: 15s) para autenticação segura no WebSocket.
    Autenticação via header Authorization: Bearer <token> (nunca via query string).
    O frontend usa este ticket na URL do WebSocket em vez do token JWT,
    evitando que o token apareça em logs de proxy, histórico do navegador ou ferramentas de dev.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Dispositivo não encontrado")

    ticket = await create_ticket(
        user_id=str(current_user.id),
        device_id=device_id,
    )
    return {"ticket": ticket, "expires_in": 15}


@router.websocket("/ws/{device_id}")
async def terminal_websocket(
    websocket: WebSocket,
    device_id: str,
    ticket: str = Query(None),
    token: str = Query(None),
    protocol: str = Query("ssh"),
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket para terminal interativo SSH/Telnet.

    Protocolo de mensagens JSON:
    - Cliente -> Servidor: {"type": "input", "data": "comando\\n"}
    - Cliente -> Servidor: {"type": "resize", "cols": 220, "rows": 50}
    - Servidor -> Cliente: {"type": "output", "data": "resposta"}
    - Servidor -> Cliente: {"type": "connected", "session_id": "..."}
    - Servidor -> Cliente: {"type": "error", "message": "..."}
    - Servidor -> Cliente: {"type": "disconnected"}
    """
    await websocket.accept()

    # Capturar IP do cliente para auditoria
    client_ip = None
    try:
        client_ip = websocket.client.host if websocket.client else None
    except Exception:
        pass

    # Capturar User-Agent para auditoria
    user_agent = websocket.headers.get("user-agent", None)

    # Autenticar usuário — suporta ticket de uso único (seguro) ou token legado (compatibilidade)
    user = None
    if ticket:
        user_id = await consume_ticket(ticket, device_id)
        if user_id:
            result_u = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
            user = result_u.scalar_one_or_none()
    elif token:
        user = await authenticate_ws(token, db)

    if not user:
        await websocket.send_json({"type": "error", "message": "Token inválido ou expirado"})
        # Auditoria: tentativa de acesso sem autenticação
        await _write_audit(
            db,
            action=AuditAction.TERMINAL_CONNECTION_FAILED,
            description=f"Tentativa de acesso ao terminal sem autenticação válida (device_id={device_id})",
            status="failure",
            ip_address=client_ip,
            user_agent=user_agent,
            error_message="Token inválido ou expirado",
        )
        await websocket.close(code=4001)
        return

    # Buscar dispositivo
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        await websocket.send_json({"type": "error", "message": "Dispositivo não encontrado"})
        await websocket.close(code=4004)
        return

    # Verificar protocolo
    proto = protocol.lower()
    if proto not in ("ssh", "telnet"):
        await websocket.send_json({"type": "error", "message": "Protocolo inválido. Use: ssh ou telnet"})
        await websocket.close(code=4000)
        return

    session_id = str(uuid.uuid4())
    terminal_session = None
    session_start = datetime.now(timezone.utc)

    # Buffer para capturar comandos digitados (linha atual)
    # Usa lista para ser mutável dentro de funções aninhadas sem precisar de nonlocal
    _input_buffer = [""]

    try:
        # Descriptografar credenciais
        password = None
        private_key = None
        if device.password_encrypted:
            password = decrypt_field(device.password_encrypted)
        if device.ssh_private_key_encrypted:
            private_key = decrypt_field(device.ssh_private_key_encrypted)

        await websocket.send_json({
            "type": "info",
            "message": f"Conectando a {device.name} ({device.management_ip}) via {proto.upper()}..."
        })

        # Criar sessão de terminal
        if proto == "ssh":
            terminal_session = SSHTerminalSession(
                host=device.management_ip,
                port=device.ssh_port or 22,
                username=device.username or "",
                password=password,
                private_key=private_key,
                timeout=30,
            )
        else:
            terminal_session = TelnetTerminalSession(
                host=device.management_ip,
                port=device.telnet_port or 23,
                username=device.username or "",
                password=password,
                timeout=30,
            )

        # Conectar em thread separada para não bloquear
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, terminal_session.connect)
        except ValueError as conn_err:
            # Erro de conexão/autenticação — registrar em auditoria
            error_msg = str(conn_err)
            logger.error(
                f"[Terminal] Falha ao conectar em {device.name} ({device.management_ip}) "
                f"via {proto.upper()} por {user.username}: {error_msg}"
            )
            await _write_audit(
                db,
                action=AuditAction.TERMINAL_CONNECTION_FAILED,
                description=(
                    f"Falha ao abrir terminal {proto.upper()} em "
                    f"{device.name} ({device.management_ip}) por {user.username}"
                ),
                status="failure",
                user_id=user.id,
                device_id=device.id,
                ip_address=client_ip,
                user_agent=user_agent,
                error_message=error_msg,
                extra_data={
                    "protocol": proto.upper(),
                    "device_ip": device.management_ip,
                    "device_port": device.ssh_port if proto == "ssh" else device.telnet_port,
                    "session_id": session_id,
                },
            )
            await websocket.send_json({"type": "error", "message": error_msg})
            return

        session_manager.add(session_id, terminal_session)

        # Auditoria: sessão iniciada com sucesso
        await _write_audit(
            db,
            action=AuditAction.TERMINAL_SESSION_STARTED,
            description=(
                f"Sessão {proto.upper()} iniciada em "
                f"{device.name} ({device.management_ip}) por {user.username}"
            ),
            status="success",
            user_id=user.id,
            device_id=device.id,
            ip_address=client_ip,
            user_agent=user_agent,
            extra_data={
                "protocol": proto.upper(),
                "device_ip": device.management_ip,
                "device_port": device.ssh_port if proto == "ssh" else device.telnet_port,
                "session_id": session_id,
            },
        )

        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
            "device": device.name,
            "protocol": proto.upper(),
            "message": f"Conectado a {device.name} via {proto.upper()}"
        })

        logger.info(
            f"[Terminal] {proto.upper()} iniciado: {device.management_ip} "
            f"por {user.username} (IP: {client_ip}) session={session_id}"
        )

        # Loop de comunicação bidirecional
        async def read_from_device():
            """Lê dados do dispositivo e envia ao WebSocket."""
            while terminal_session.connected:
                try:
                    data = await loop.run_in_executor(None, terminal_session.recv)
                    if data:
                        await websocket.send_json({"type": "output", "data": data})
                    await asyncio.sleep(0.05)
                except Exception as e:
                    logger.error(f"[Terminal] Erro ao ler do dispositivo: {e}")
                    break

        # Iniciar leitura em background
        read_task = asyncio.create_task(read_from_device())

        try:
            while True:
                message = await websocket.receive_text()
                try:
                    msg = json.loads(message)
                    msg_type = msg.get("type", "input")

                    if msg_type == "input":
                        data = msg.get("data", "")
                        await loop.run_in_executor(None, terminal_session.send, data)

                        # Capturar comandos completos (quando usuário pressiona Enter)
                        _input_buffer[0] += data
                        if "\r" in _input_buffer[0] or "\n" in _input_buffer[0]:
                            # Extrair linha do comando
                            cmd_line = _input_buffer[0].replace("\r\n", "\n").replace("\r", "\n")
                            cmd_line = cmd_line.split("\n")[0].strip()
                            _input_buffer[0] = ""

                            if cmd_line:
                                # Auditoria: comando executado no terminal
                                await _write_audit(
                                    db,
                                    action=AuditAction.TERMINAL_COMMAND,
                                    description=(
                                        f"Comando executado em {device.name} "
                                        f"({device.management_ip}) por {user.username}: {cmd_line}"
                                    ),
                                    status="success",
                                    user_id=user.id,
                                    device_id=device.id,
                                    ip_address=client_ip,
                                    user_agent=user_agent,
                                    extra_data={
                                        "command": cmd_line,
                                        "protocol": proto.upper(),
                                        "session_id": session_id,
                                    },
                                )

                    elif msg_type == "resize":
                        cols = msg.get("cols", 220)
                        rows = msg.get("rows", 50)
                        if hasattr(terminal_session, "resize"):
                            await loop.run_in_executor(None, terminal_session.resize, cols, rows)

                    elif msg_type == "ping":
                        await websocket.send_json({"type": "pong"})

                except json.JSONDecodeError:
                    # Dados brutos (compatibilidade)
                    await loop.run_in_executor(None, terminal_session.send, message)

        except WebSocketDisconnect:
            logger.info(f"[Terminal] WebSocket desconectado: {session_id}")
        finally:
            read_task.cancel()

    except ValueError as e:
        # Erros de validação (credenciais, etc.) já auditados acima
        await websocket.send_json({"type": "error", "message": str(e)})
    except Exception as e:
        error_msg = str(e)
        logger.error(f"[Terminal] Erro inesperado: {error_msg}")
        # Auditoria: erro inesperado no terminal
        await _write_audit(
            db,
            action=AuditAction.TERMINAL_CONNECTION_FAILED,
            description=(
                f"Erro inesperado no terminal {proto.upper()} em "
                f"{device.name if device else device_id} por "
                f"{user.username if user else 'desconhecido'}"
            ),
            status="failure",
            user_id=user.id if user else None,
            device_id=device.id if device else None,
            ip_address=client_ip,
            user_agent=user_agent,
            error_message=error_msg,
        )
        await websocket.send_json({"type": "error", "message": f"Erro interno: {error_msg}"})
    finally:
        # Auditoria: sessão encerrada
        if terminal_session and terminal_session.connected:
            duration_s = int((datetime.now(timezone.utc) - session_start).total_seconds())
            await _write_audit(
                db,
                action=AuditAction.TERMINAL_SESSION_ENDED,
                description=(
                    f"Sessão {proto.upper()} encerrada em "
                    f"{device.name if device else device_id} por "
                    f"{user.username if user else 'desconhecido'} "
                    f"(duração: {duration_s}s)"
                ),
                status="success",
                user_id=user.id if user else None,
                device_id=device.id if device else None,
                ip_address=client_ip,
                user_agent=user_agent,
                extra_data={
                    "protocol": proto.upper(),
                    "session_id": session_id,
                    "duration_seconds": duration_s,
                },
            )

        if terminal_session:
            terminal_session.close()
        session_manager.remove(session_id)
        try:
            await websocket.send_json({"type": "disconnected", "session_id": session_id})
        except Exception:
            pass


@router.get("/sessions")
async def list_active_sessions(
    db: AsyncSession = Depends(get_db),
    token: str = Query(...),
):
    """Lista sessões de terminal ativas."""
    user = await authenticate_ws(token, db)
    if not user or user.role.value not in ("admin", "technician"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    return {
        "active_sessions": session_manager.count(),
    }

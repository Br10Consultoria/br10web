"""
BR10 NetManager - Terminal WebSocket API
Terminal web interativo via WebSocket para SSH e Telnet.
"""
import asyncio
import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import decode_token, decrypt_field
from app.models.device import Device
from app.models.user import User
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


@router.websocket("/ws/{device_id}")
async def terminal_websocket(
    websocket: WebSocket,
    device_id: str,
    token: str = Query(...),
    protocol: str = Query("ssh"),
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket para terminal interativo SSH/Telnet.

    Protocolo de mensagens JSON:
    - Cliente -> Servidor: {"type": "input", "data": "comando\n"}
    - Cliente -> Servidor: {"type": "resize", "cols": 220, "rows": 50}
    - Servidor -> Cliente: {"type": "output", "data": "resposta"}
    - Servidor -> Cliente: {"type": "connected", "session_id": "..."}
    - Servidor -> Cliente: {"type": "error", "message": "..."}
    - Servidor -> Cliente: {"type": "disconnected"}
    """
    await websocket.accept()

    # Autenticar usuário
    user = await authenticate_ws(token, db)
    if not user:
        await websocket.send_json({"type": "error", "message": "Token inválido ou expirado"})
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
        await loop.run_in_executor(None, terminal_session.connect)

        session_manager.add(session_id, terminal_session)

        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
            "device": device.name,
            "protocol": proto.upper(),
            "message": f"Conectado a {device.name} via {proto.upper()}"
        })

        logger.info(f"Terminal {proto.upper()} iniciado: {device.management_ip} por {user.username}")

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
                    logger.error(f"Erro ao ler do dispositivo: {e}")
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
            logger.info(f"WebSocket desconectado: {session_id}")
        finally:
            read_task.cancel()

    except ValueError as e:
        await websocket.send_json({"type": "error", "message": str(e)})
    except Exception as e:
        logger.error(f"Erro no terminal: {e}")
        await websocket.send_json({"type": "error", "message": f"Erro interno: {str(e)}"})
    finally:
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

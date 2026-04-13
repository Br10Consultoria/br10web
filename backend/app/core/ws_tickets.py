"""
BR10 NetManager - WebSocket Session Tickets
Tickets de sessão de uso único para autenticação segura no WebSocket do terminal.

Fluxo:
  1. Frontend faz POST /api/v1/terminal/ticket (autenticado via JWT no header)
  2. Backend gera um ticket UUID aleatório, armazena em memória com TTL de 15s
  3. Frontend usa esse ticket na URL do WebSocket: ?ticket=<uuid>
  4. Backend valida o ticket no handshake do WebSocket e o descarta imediatamente
  5. O token JWT nunca aparece em URLs, logs de proxy ou histórico do navegador
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional

# Armazenamento em memória dos tickets ativos
# Estrutura: { ticket_id: { "user_id": str, "device_id": str, "expires_at": datetime } }
_tickets: Dict[str, dict] = {}

# TTL padrão: 15 segundos (tempo suficiente para o frontend abrir o WebSocket)
TICKET_TTL_SECONDS = 15

# Lock para operações thread-safe
_lock = asyncio.Lock()


async def create_ticket(user_id: str, device_id: str) -> str:
    """
    Cria um ticket de sessão de uso único para o WebSocket.
    Retorna o UUID do ticket.
    """
    ticket_id = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=TICKET_TTL_SECONDS)

    async with _lock:
        # Limpar tickets expirados antes de inserir novo
        _cleanup_expired()
        _tickets[ticket_id] = {
            "user_id": user_id,
            "device_id": device_id,
            "expires_at": expires_at,
        }

    return ticket_id


async def consume_ticket(ticket_id: str, device_id: str) -> Optional[str]:
    """
    Valida e consome (remove) um ticket de sessão.
    Retorna o user_id se o ticket for válido, None caso contrário.

    O ticket é removido imediatamente após o primeiro uso (uso único).
    """
    async with _lock:
        ticket = _tickets.get(ticket_id)

        if not ticket:
            return None  # Ticket inexistente ou já consumido

        # Remover imediatamente (uso único)
        del _tickets[ticket_id]

        # Verificar expiração
        if datetime.now(timezone.utc) > ticket["expires_at"]:
            return None  # Ticket expirado

        # Verificar que o ticket é para o device correto
        if ticket["device_id"] != device_id:
            return None  # Ticket não pertence a este dispositivo

        return ticket["user_id"]


def _cleanup_expired():
    """Remove tickets expirados do dicionário (chamado internamente)."""
    now = datetime.now(timezone.utc)
    expired = [k for k, v in _tickets.items() if now > v["expires_at"]]
    for k in expired:
        del _tickets[k]

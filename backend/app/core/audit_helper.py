"""
BR10 NetManager - Helper centralizado para gravação de logs de auditoria.

Todos os módulos devem usar esta função em vez de chamar
AuditLog.__table__.insert() ou db.add(AuditLog(...)) diretamente.

Garante que:
- O valor da ação é sempre enviado como string (.value do enum)
- Nunca passa o objeto enum Python para o banco (evita erros de tipo)
- Erros de auditoria são logados mas não propagados (não quebram a operação principal)
"""
from typing import Optional, Any
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def log_audit(
    db: AsyncSession,
    action,  # AuditAction enum ou string
    description: str = "",
    status: str = "success",
    user_id=None,
    device_id=None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    error_message: Optional[str] = None,
    extra_data: Optional[dict] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
) -> None:
    """
    Grava um registro de auditoria no banco de dados.

    Extrai o .value do enum Python antes de enviar ao banco,
    garantindo que o PostgreSQL receba uma string VARCHAR pura.

    Nunca levanta exceção — erros são logados silenciosamente
    para não interromper a operação principal.
    """
    try:
        from app.models.audit import AuditLog

        # Extrair o valor string do enum (ou usar a string diretamente)
        action_value = action.value if hasattr(action, "value") else str(action)

        audit = AuditLog(
            action=action_value,
            description=description,
            status=status,
            user_id=user_id,
            device_id=device_id,
            ip_address=ip_address,
            user_agent=user_agent,
            error_message=error_message,
            extra_data=extra_data,
            old_values=old_values,
            new_values=new_values,
            resource_type=resource_type,
            resource_id=resource_id,
        )
        db.add(audit)
        await db.commit()

    except Exception as e:
        logger.error(f"[audit] Falha ao gravar log de auditoria (action={action}): {e}")
        try:
            await db.rollback()
        except Exception:
            pass

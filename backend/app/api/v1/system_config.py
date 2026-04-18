"""
BR10 NetManager - API de Configurações Globais do Sistema

Endpoints:
  GET    /system-config          — listar todas as configurações
  PUT    /system-config          — salvar múltiplas configurações de uma vez
  GET    /system-config/{key}    — obter configuração específica
  PUT    /system-config/{key}    — salvar configuração específica
  POST   /system-config/telegram/test — testar configuração Telegram
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.system_config import SystemConfig, SYSTEM_CONFIG_DEFAULTS
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system-config", tags=["System Config"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class ConfigItem(BaseModel):
    key: str
    value: Optional[str] = None
    description: Optional[str] = None


class ConfigBulkUpdate(BaseModel):
    configs: List[ConfigItem]


class ConfigResponse(BaseModel):
    key: str
    value: Optional[str]
    description: Optional[str]
    updated_by: Optional[str]


class TelegramTestResponse(BaseModel):
    success: bool
    message: str


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def _ensure_defaults(db: AsyncSession) -> None:
    """Garante que todas as chaves padrão existam no banco."""
    result = await db.execute(select(SystemConfig))
    existing = {row.key for row in result.scalars().all()}
    for key, (default_val, description) in SYSTEM_CONFIG_DEFAULTS.items():
        if key not in existing:
            db.add(SystemConfig(key=key, value=default_val, description=description))
    await db.commit()


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("", response_model=List[ConfigResponse])
async def list_configs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista todas as configurações do sistema."""
    await _ensure_defaults(db)
    result = await db.execute(select(SystemConfig).order_by(SystemConfig.key))
    rows = result.scalars().all()
    return [
        ConfigResponse(
            key=r.key,
            value=r.value if "token" not in r.key.lower() or not r.value else "***",
            description=r.description,
            updated_by=r.updated_by,
        )
        for r in rows
    ]


@router.get("/raw", response_model=List[ConfigResponse])
async def list_configs_raw(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista todas as configurações sem mascarar tokens (para edição)."""
    await _ensure_defaults(db)
    result = await db.execute(select(SystemConfig).order_by(SystemConfig.key))
    rows = result.scalars().all()
    return [
        ConfigResponse(key=r.key, value=r.value, description=r.description, updated_by=r.updated_by)
        for r in rows
    ]


@router.put("", response_model=Dict[str, Any])
async def bulk_update_configs(
    payload: ConfigBulkUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Salva múltiplas configurações de uma vez."""
    await _ensure_defaults(db)
    updated = 0
    for item in payload.configs:
        result = await db.execute(select(SystemConfig).where(SystemConfig.key == item.key))
        row = result.scalar_one_or_none()
        if row:
            row.value = item.value
            row.updated_by = current_user.username
        else:
            db.add(SystemConfig(
                key=item.key,
                value=item.value,
                description=item.description,
                updated_by=current_user.username,
            ))
        updated += 1
    await db.commit()
    logger.info(f"[SystemConfig] {updated} configuração(ões) atualizadas por {current_user.username}")
    return {"updated": updated, "message": f"{updated} configuração(ões) salva(s) com sucesso."}


@router.put("/{key}", response_model=ConfigResponse)
async def update_config(
    key: str,
    payload: ConfigItem,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Atualiza uma configuração específica."""
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = payload.value
        row.updated_by = current_user.username
    else:
        row = SystemConfig(
            key=key,
            value=payload.value,
            description=payload.description,
            updated_by=current_user.username,
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return ConfigResponse(key=row.key, value=row.value, description=row.description, updated_by=row.updated_by)


@router.post("/telegram/test", response_model=TelegramTestResponse)
async def test_telegram(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Testa a configuração global de Telegram enviando uma mensagem de teste."""
    from app.services.telegram_notify import test_telegram_global
    ok, err = await test_telegram_global(db)
    return TelegramTestResponse(
        success=ok,
        message="Mensagem de teste enviada com sucesso!" if ok else f"Falha: {err}",
    )

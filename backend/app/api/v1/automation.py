"""
BR10 NetManager - Automation API
Endpoints para gerenciamento da biblioteca de comandos e execução em dispositivos.
"""
import logging
from datetime import datetime, timezone
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import decrypt_field
from app.api.v1.auth import get_current_user
from app.models.automation import CommandTemplate, CommandExecution, CommandCategory, ExecutionStatus
from app.models.audit import AuditLog, AuditAction
from app.models.device import Device
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/automation", tags=["Automation"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CommandTemplateCreate(BaseModel):
    name:        str             = Field(..., min_length=1, max_length=200)
    description: Optional[str]  = None
    category:    CommandCategory = CommandCategory.DIAGNOSTICS
    command:     str             = Field(..., min_length=1)
    vendor_id:   Optional[str]  = None
    vendor_name: Optional[str]  = None
    timeout:     int             = Field(default=30, ge=5, le=300)
    is_active:   bool            = True
    is_global:   bool            = True


class CommandTemplateUpdate(BaseModel):
    name:        Optional[str]            = None
    description: Optional[str]           = None
    category:    Optional[CommandCategory] = None
    command:     Optional[str]            = None
    vendor_id:   Optional[str]           = None
    vendor_name: Optional[str]           = None
    timeout:     Optional[int]           = None
    is_active:   Optional[bool]          = None
    is_global:   Optional[bool]          = None


class CommandTemplateResponse(BaseModel):
    id:          str
    name:        str
    description: Optional[str]
    category:    str
    command:     str
    vendor_id:   Optional[str]
    vendor_name: Optional[str]
    timeout:     int
    is_active:   bool
    is_global:   bool
    created_at:  str
    updated_at:  str

    model_config = {"from_attributes": True}


class ExecuteCommandRequest(BaseModel):
    device_id:   str
    template_id: Optional[str] = None
    command:     str            = Field(..., min_length=1)
    protocol:    str            = Field(default="auto")  # auto | ssh | telnet
    interactive: bool           = False
    timeout:     int            = Field(default=30, ge=5, le=300)


class ExecuteCommandResponse(BaseModel):
    execution_id: str
    status:       str
    output:       str
    error:        Optional[str]
    duration_ms:  int
    device_name:  str
    device_ip:    str
    command:      str
    protocol:     str
    started_at:   str
    finished_at:  str


class CommandExecutionResponse(BaseModel):
    id:            str
    template_id:   Optional[str]
    template_name: Optional[str]
    device_id:     str
    device_name:   Optional[str]
    device_ip:     Optional[str]
    command:       str
    protocol:      str
    status:        str
    output:        Optional[str]
    error_message: Optional[str]
    duration_ms:   Optional[int]
    username:      Optional[str]
    started_at:    str
    finished_at:   Optional[str]

    model_config = {"from_attributes": True}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _template_to_dict(t: CommandTemplate) -> dict:
    return {
        "id":          str(t.id),
        "name":        t.name,
        "description": t.description,
        "category":    t.category.value if t.category else "other",
        "command":     t.command,
        "vendor_id":   str(t.vendor_id) if t.vendor_id else None,
        "vendor_name": t.vendor_name,
        "timeout":     t.timeout,
        "is_active":   t.is_active,
        "is_global":   t.is_global,
        "created_at":  t.created_at.isoformat() if t.created_at else "",
        "updated_at":  t.updated_at.isoformat() if t.updated_at else "",
    }


def _execution_to_dict(e: CommandExecution) -> dict:
    return {
        "id":            str(e.id),
        "template_id":   str(e.template_id) if e.template_id else None,
        "template_name": e.template_name,
        "device_id":     str(e.device_id),
        "device_name":   e.device_name,
        "device_ip":     e.device_ip,
        "command":       e.command,
        "protocol":      e.protocol,
        "status":        e.status.value if e.status else "unknown",
        "output":        e.output,
        "error_message": e.error_message,
        "duration_ms":   e.duration_ms,
        "username":      e.username,
        "started_at":    e.started_at.isoformat() if e.started_at else "",
        "finished_at":   e.finished_at.isoformat() if e.finished_at else None,
    }


# ─── Endpoints: Biblioteca de Comandos ────────────────────────────────────────

@router.get("/commands", response_model=List[dict])
async def list_commands(
    category:  Optional[str] = Query(None),
    vendor_id: Optional[str] = Query(None),
    search:    Optional[str] = Query(None),
    active_only: bool        = Query(True),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista todos os templates de comandos com filtros opcionais."""
    q = select(CommandTemplate).order_by(CommandTemplate.category, CommandTemplate.name)

    if active_only:
        q = q.where(CommandTemplate.is_active == True)
    if category:
        q = q.where(CommandTemplate.category == category)
    if vendor_id:
        q = q.where(
            (CommandTemplate.vendor_id == vendor_id) |
            (CommandTemplate.vendor_id == None)
        )
    if search:
        term = f"%{search}%"
        q = q.where(
            CommandTemplate.name.ilike(term) |
            CommandTemplate.description.ilike(term) |
            CommandTemplate.command.ilike(term)
        )

    q = q.offset(skip).limit(limit)
    result = await db.execute(q)
    templates = result.scalars().all()
    return [_template_to_dict(t) for t in templates]


@router.post("/commands", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_command(
    data: CommandTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cria um novo template de comando."""
    template = CommandTemplate(
        name=data.name,
        description=data.description,
        category=data.category,
        command=data.command,
        vendor_id=data.vendor_id,
        vendor_name=data.vendor_name,
        timeout=data.timeout,
        is_active=data.is_active,
        is_global=data.is_global,
        created_by=current_user.id,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return _template_to_dict(template)


@router.get("/commands/{command_id}", response_model=dict)
async def get_command(
    command_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna um template de comando pelo ID."""
    result = await db.execute(
        select(CommandTemplate).where(CommandTemplate.id == command_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Comando não encontrado")
    return _template_to_dict(template)


@router.put("/commands/{command_id}", response_model=dict)
async def update_command(
    command_id: str,
    data: CommandTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Atualiza um template de comando."""
    result = await db.execute(
        select(CommandTemplate).where(CommandTemplate.id == command_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Comando não encontrado")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)

    await db.commit()
    await db.refresh(template)
    return _template_to_dict(template)


@router.delete("/commands/{command_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_command(
    command_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove um template de comando."""
    result = await db.execute(
        select(CommandTemplate).where(CommandTemplate.id == command_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Comando não encontrado")
    await db.delete(template)
    await db.commit()


# ─── Endpoint: Execução ───────────────────────────────────────────────────────

@router.post("/execute", response_model=dict)
async def execute_command(
    data: ExecuteCommandRequest,
    request: "Request" = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Executa um comando em um dispositivo via SSH ou Telnet.
    Retorna a saída completa do comando.
    """
    from fastapi import Request
    from app.services.command_runner import CommandRunner

    # Buscar dispositivo
    result = await db.execute(
        select(Device).where(Device.id == data.device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Dispositivo não encontrado")

    # Determinar protocolo
    protocol = data.protocol.lower()
    if protocol == "auto":
        protocol = device.primary_protocol.value.lower() if device.primary_protocol else "ssh"

    port = device.ssh_port or 22 if protocol == "ssh" else device.telnet_port or 23

    # Descriptografar senha
    password = None
    private_key = None
    if device.password_encrypted:
        try:
            password = decrypt_field(device.password_encrypted)
        except Exception:
            pass
    if hasattr(device, "ssh_private_key_encrypted") and device.ssh_private_key_encrypted:
        try:
            private_key = decrypt_field(device.ssh_private_key_encrypted)
        except Exception:
            pass

    # Buscar nome do template se fornecido
    template_name = None
    if data.template_id:
        t_result = await db.execute(
            select(CommandTemplate).where(CommandTemplate.id == data.template_id)
        )
        tmpl = t_result.scalar_one_or_none()
        if tmpl:
            template_name = tmpl.name

    # Criar registro de execução
    execution = CommandExecution(
        template_id=data.template_id,
        template_name=template_name,
        device_id=device.id,
        device_name=device.name,
        device_ip=device.management_ip,
        username=current_user.username,
        command=data.command,
        protocol=protocol,
        status=ExecutionStatus.RUNNING,
        started_at=datetime.now(timezone.utc),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    # Executar comando
    runner = CommandRunner(
        host=device.management_ip,
        port=port,
        username=device.username or "",
        password=password,
        protocol=protocol,
        timeout=data.timeout,
        private_key=private_key,
    )

    try:
        success, output, duration_ms = await runner.run(
            data.command,
            interactive=data.interactive
        )

        execution.status = ExecutionStatus.SUCCESS if success else ExecutionStatus.ERROR
        execution.output = output if success else None
        execution.error_message = output if not success else None
        execution.duration_ms = duration_ms
        execution.finished_at = datetime.now(timezone.utc)

    except Exception as e:
        logger.exception(f"Erro ao executar comando no dispositivo {device.name}: {e}")
        execution.status = ExecutionStatus.ERROR
        execution.error_message = str(e)
        execution.duration_ms = 0
        execution.finished_at = datetime.now(timezone.utc)
        success = False
        output = str(e)
        duration_ms = 0

    await db.commit()
    await db.refresh(execution)

    # ── Auditoria de execução de comando ──────────────────────────────────────
    from app.core.audit_helper import log_audit
    audit_action = AuditAction.COMMAND_EXECUTED if success else AuditAction.COMMAND_FAILED
    audit_status = "success" if success else "failure"
    
    # Log de auditoria padrão
    await log_audit(
        db,
        action=audit_action,
        description=(
            f"Comando '{data.command[:80]}{'...' if len(data.command) > 80 else ''}' "
            f"executado em {device.name} ({device.management_ip}) "
            f"via {protocol.upper()} por {current_user.username}"
        ),
        status=audit_status,
        user_id=current_user.id,
        device_id=device.id,
        resource_type="automation",
        resource_id=str(execution.id),
        error_message=execution.error_message if not success else None,
        extra_data={
            "command": data.command,
            "protocol": protocol.upper(),
            "interactive": data.interactive,
            "duration_ms": execution.duration_ms,
            "template_name": template_name,
            "execution_id": str(execution.id),
        },
    )

    # Log de execução de serviço
    await log_audit(
        db,
        action=AuditAction.SERVICE_EXECUTION,
        description=f"Execução de automação: {template_name or 'Comando manual'}",
        status=audit_status,
        user_id=current_user.id,
        device_id=device.id,
        extra_data={
            "service": "automation",
            "template": template_name,
            "duration_ms": execution.duration_ms
        }
    )

    # Log de acesso a equipamento
    await log_audit(
        db,
        action=AuditAction.EQUIPMENT_ACCESS,
        description=f"Acesso ao equipamento {device.name} via automação ({protocol.upper()})",
        status=audit_status,
        user_id=current_user.id,
        device_id=device.id,
        extra_data={
            "method": "automation",
            "protocol": protocol,
            "command": data.command[:100]
        }
    )

    return _execution_to_dict(execution)


# ─── Endpoints: Histórico ─────────────────────────────────────────────────────

@router.get("/history", response_model=List[dict])
async def list_executions(
    device_id:   Optional[str] = Query(None),
    template_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    skip:  int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista o histórico de execuções com filtros opcionais."""
    q = select(CommandExecution).order_by(desc(CommandExecution.started_at))

    if device_id:
        q = q.where(CommandExecution.device_id == device_id)
    if template_id:
        q = q.where(CommandExecution.template_id == template_id)
    if status_filter:
        q = q.where(CommandExecution.status == status_filter)

    q = q.offset(skip).limit(limit)
    result = await db.execute(q)
    executions = result.scalars().all()
    return [_execution_to_dict(e) for e in executions]


@router.get("/history/{execution_id}", response_model=dict)
async def get_execution(
    execution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna os detalhes de uma execução específica."""
    result = await db.execute(
        select(CommandExecution).where(CommandExecution.id == execution_id)
    )
    execution = result.scalar_one_or_none()
    if not execution:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    return _execution_to_dict(execution)


@router.delete("/history/{execution_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_execution(
    execution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove um registro do histórico."""
    result = await db.execute(
        select(CommandExecution).where(CommandExecution.id == execution_id)
    )
    execution = result.scalar_one_or_none()
    if not execution:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    await db.delete(execution)
    await db.commit()


# ─── Endpoint: Categorias disponíveis ────────────────────────────────────────

@router.get("/categories", response_model=List[dict])
async def list_categories(
    current_user: User = Depends(get_current_user),
):
    """Lista as categorias disponíveis para comandos."""
    labels = {
        "diagnostics":   "Diagnóstico",
        "configuration": "Configuração",
        "backup":        "Backup",
        "monitoring":    "Monitoramento",
        "routing":       "Roteamento",
        "optical":       "Óptico (OLT/ONU)",
        "security":      "Segurança",
        "other":         "Outros",
    }
    return [
        {"value": c.value, "label": labels.get(c.value, c.value)}
        for c in CommandCategory
    ]

"""
BR10 NetManager - API de Playbooks e Análise de IA
Endpoints para gerenciamento de playbooks, execução e análise de IA.
"""
import asyncio
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.core.security import encrypt_field, decrypt_field
from app.models.playbook import (
    Playbook, PlaybookStep, PlaybookExecution, PlaybookRunStatus,
    AIProviderConfig, AIAnalysis, AIAnalysisStatus, AIProvider,
    PlaybookStatus, PlaybookStepType,
)
from app.models.device import Device, DeviceCredential
from app.models.audit import AuditLog, AuditAction
from app.models.user import User
from app.services.playbook_runner import PlaybookRunner
from app.services.ai_analyzer import analyze_with_ai, SYSTEM_PROMPTS, PROVIDER_MODELS as AI_PROVIDERS
from app.services.script_importer import import_script_to_playbook

logger = logging.getLogger(__name__)

# ─── Routers ──────────────────────────────────────────────────────────────────

playbooks_router = APIRouter(prefix="/playbooks", tags=["Playbooks"])
ai_router = APIRouter(prefix="/ai", tags=["AI Analysis"])


# ─── Schemas Pydantic ─────────────────────────────────────────────────────────

class PlaybookStepCreate(BaseModel):
    order: int
    step_type: str
    params: Dict[str, Any] = {}
    label: Optional[str] = None
    on_error: str = "stop"


class PlaybookCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: str = "backup"
    variables: Dict[str, str] = {}
    schedule_cron: Optional[str] = None
    schedule_enabled: bool = False
    steps: List[PlaybookStepCreate] = []


class PlaybookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    variables: Optional[Dict[str, str]] = None
    schedule_cron: Optional[str] = None
    schedule_enabled: Optional[bool] = None
    status: Optional[str] = None
    steps: Optional[List[PlaybookStepCreate]] = None


class PlaybookExecuteRequest(BaseModel):
    device_id: str
    variables_override: Dict[str, str] = {}  # sobrescreve variáveis do playbook


class AIProviderConfigCreate(BaseModel):
    provider: Optional[str] = None   # opcional: vem da URL
    api_key: Optional[str] = None    # None ou '___keep___' = manter chave atual
    default_model: Optional[str] = None
    max_tokens: int = 4096
    temperature: float = 0.3
    system_prompt: Optional[str] = None


class AIProviderTestRequest(BaseModel):
    api_key: Optional[str] = None    # se None, usa a chave salva no banco
    model: Optional[str] = None


class AIAnalyzeRequest(BaseModel):
    content: str
    analysis_type: str = "custom"
    provider: Optional[str] = None  # usa o provider ativo se não informado
    model: Optional[str] = None
    custom_prompt: Optional[str] = None
    context: Optional[str] = None
    # Origem (para rastreabilidade)
    source_type: str = "manual"
    source_id: Optional[str] = None
    device_name: Optional[str] = None
    client_name: Optional[str] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _playbook_to_dict(pb: Playbook) -> Dict:
    return {
        "id": str(pb.id),
        "name": pb.name,
        "description": pb.description,
        "category": pb.category,
        "variables": pb.variables or {},
        "schedule_cron": pb.schedule_cron,
        "schedule_enabled": pb.schedule_enabled,
        "status": pb.status.value if pb.status else "active",
        "steps": [_step_to_dict(s) for s in (pb.steps or [])],
        "created_at": pb.created_at.isoformat() if pb.created_at else None,
        "updated_at": pb.updated_at.isoformat() if pb.updated_at else None,
    }


def _step_to_dict(s: PlaybookStep) -> Dict:
    return {
        "id": str(s.id),
        "order": s.order,
        "step_type": s.step_type.value if hasattr(s.step_type, "value") else s.step_type,
        "params": s.params or {},
        "label": s.label,
        "on_error": s.on_error,
    }


def _execution_to_dict(ex: PlaybookExecution) -> Dict:
    return {
        "id": str(ex.id),
        "playbook_id": str(ex.playbook_id) if ex.playbook_id else None,
        "playbook_name": ex.playbook_name,
        "device_id": str(ex.device_id),
        "device_name": ex.device_name,
        "device_ip": ex.device_ip,
        "client_name": ex.client_name,
        "status": ex.status.value if ex.status else "pending",
        "current_step": ex.current_step,
        "total_steps": ex.total_steps,
        "step_logs": ex.step_logs or [],
        "output_files": ex.output_files or [],
        "error_message": ex.error_message,
        "duration_ms": ex.duration_ms,
        "started_at": ex.started_at.isoformat() if ex.started_at else None,
        "finished_at": ex.finished_at.isoformat() if ex.finished_at else None,
    }


def _provider_to_dict(p: AIProviderConfig, include_key: bool = False) -> Dict:
    return {
        "id": str(p.id),
        "provider": p.provider.value if hasattr(p.provider, "value") else p.provider,
        "display_name": p.display_name,
        "default_model": p.default_model,
        "available_models": p.available_models or [],
        "is_active": p.is_active,
        "max_tokens": p.max_tokens,
        "temperature": p.temperature,
        "system_prompt": p.system_prompt,
        "has_api_key": bool(p.api_key_encrypted),
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _analysis_to_dict(a: AIAnalysis) -> Dict:
    return {
        "id": str(a.id),
        "source_type": a.source_type,
        "source_id": a.source_id,
        "device_name": a.device_name,
        "client_name": a.client_name,
        "analysis_type": a.analysis_type,
        "provider": a.provider,
        "model_used": a.model_used,
        "input_preview": (a.input_text[:300] + "...") if a.input_text and len(a.input_text) > 300 else a.input_text,
        "result": a.result,
        "tokens_used": a.tokens_used,
        "status": a.status.value if a.status else "pending",
        "error_message": a.error_message,
        "duration_ms": a.duration_ms,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "finished_at": a.finished_at.isoformat() if a.finished_at else None,
    }


# ─── Playbooks CRUD ───────────────────────────────────────────────────────────

@playbooks_router.get("")
async def list_playbooks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Playbook)
        .options(selectinload(Playbook.steps))
        .order_by(Playbook.created_at.desc())
    )
    playbooks = result.scalars().all()
    return [_playbook_to_dict(pb) for pb in playbooks]


@playbooks_router.post("", status_code=status.HTTP_201_CREATED)
async def create_playbook(
    data: PlaybookCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pb = Playbook(
        name=data.name,
        description=data.description,
        category=data.category,
        variables=data.variables,
        schedule_cron=data.schedule_cron,
        schedule_enabled=data.schedule_enabled,
        created_by=current_user.id,
    )
    db.add(pb)
    await db.flush()

    for step_data in data.steps:
        step = PlaybookStep(
            playbook_id=pb.id,
            order=step_data.order,
            step_type=step_data.step_type,
            params=step_data.params,
            label=step_data.label,
            on_error=step_data.on_error,
        )
        db.add(step)

    await db.commit()

    result = await db.execute(
        select(Playbook)
        .options(selectinload(Playbook.steps))
        .where(Playbook.id == pb.id)
    )
    pb = result.scalar_one()
    return _playbook_to_dict(pb)


@playbooks_router.get("/{playbook_id}")
async def get_playbook(
    playbook_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Playbook)
        .options(selectinload(Playbook.steps))
        .where(Playbook.id == playbook_id)
    )
    pb = result.scalar_one_or_none()
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook não encontrado.")
    return _playbook_to_dict(pb)


@playbooks_router.put("/{playbook_id}")
async def update_playbook(
    playbook_id: str,
    data: PlaybookUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Playbook)
        .options(selectinload(Playbook.steps))
        .where(Playbook.id == playbook_id)
    )
    pb = result.scalar_one_or_none()
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook não encontrado.")

    if data.name is not None:
        pb.name = data.name
    if data.description is not None:
        pb.description = data.description
    if data.category is not None:
        pb.category = data.category
    if data.variables is not None:
        pb.variables = data.variables
    if data.schedule_cron is not None:
        pb.schedule_cron = data.schedule_cron
    if data.schedule_enabled is not None:
        pb.schedule_enabled = data.schedule_enabled
    if data.status is not None:
        pb.status = data.status

    # Atualizar passos se fornecidos
    if data.steps is not None:
        # Remover passos existentes
        for step in pb.steps:
            await db.delete(step)
        await db.flush()
        # Adicionar novos passos
        for step_data in data.steps:
            step = PlaybookStep(
                playbook_id=pb.id,
                order=step_data.order,
                step_type=step_data.step_type,
                params=step_data.params,
                label=step_data.label,
                on_error=step_data.on_error,
            )
            db.add(step)

    await db.commit()

    result = await db.execute(
        select(Playbook)
        .options(selectinload(Playbook.steps))
        .where(Playbook.id == pb.id)
    )
    pb = result.scalar_one()
    return _playbook_to_dict(pb)


@playbooks_router.delete("/{playbook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playbook(
    playbook_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Playbook).where(Playbook.id == playbook_id))
    pb = result.scalar_one_or_none()
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook não encontrado.")
    await db.delete(pb)
    await db.commit()


# ─── Execução de Playbooks ────────────────────────────────────────────────────

@playbooks_router.post("/{playbook_id}/execute")
async def execute_playbook(
    playbook_id: str,
    req: PlaybookExecuteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Executa um playbook em um dispositivo específico."""
    # Buscar playbook com passos
    pb_result = await db.execute(
        select(Playbook)
        .options(selectinload(Playbook.steps))
        .where(Playbook.id == playbook_id)
    )
    pb = pb_result.scalar_one_or_none()
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook não encontrado.")

    # Buscar dispositivo
    dev_result = await db.execute(
        select(Device).where(Device.id == req.device_id)
    )
    device = dev_result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Dispositivo não encontrado.")

    # Buscar credencial padrão do dispositivo
    cred_res = await db.execute(
        select(DeviceCredential).where(
            DeviceCredential.device_id == device.id,
            DeviceCredential.is_active == True,
        ).order_by(DeviceCredential.id)
    )
    credential = cred_res.scalars().first()

    # Descriptografar senha — tenta credencial dedicada primeiro, depois campo direto do device
    password = ""
    username = device.username or ""
    if credential:
        if credential.password_encrypted:
            try:
                password = decrypt_field(credential.password_encrypted)
            except Exception:
                password = ""
        if credential.username:
            username = credential.username
    elif device.password_encrypted:
        try:
            password = decrypt_field(device.password_encrypted)
        except Exception:
            password = ""

    # Mesclar variáveis: playbook + override da requisição
    # HOST, USERNAME, PASSWORD, DEVICE_IP são preenchidos automaticamente pelo dispositivo
    variables = dict(pb.variables or {})
    auto_vars = {
        "HOST":        device.management_ip,
        "DEVICE_IP":   device.management_ip,
        "USERNAME":    username,
        "PASSWORD":    password,
        "DEVICE_NAME": device.name,
        "DATE":        datetime.utcnow().strftime("%Y-%m-%d"),
        "DATETIME":    datetime.utcnow().strftime("%Y%m%d_%H%M%S"),
    }
    variables.update(auto_vars)
    variables.update(req.variables_override)  # override manual tem prioridade

    # Criar registro de execução
    execution = PlaybookExecution(
        playbook_id=pb.id,
        device_id=device.id,
        user_id=current_user.id,
        playbook_name=pb.name,
        device_name=device.name,
        device_ip=device.management_ip,
        client_name=getattr(device, "client_name", "") or "",
        variables_used={k: v for k, v in variables.items() if k not in ("PASSWORD", "password")},
        status=PlaybookRunStatus.RUNNING,
        total_steps=len(pb.steps),
    )
    db.add(execution)
    await db.commit()

    # Serializar passos para o runner
    steps_data = [
        {
            "step_type": s.step_type.value if hasattr(s.step_type, "value") else s.step_type,
            "params": s.params or {},
            "label": s.label,
            "on_error": s.on_error,
        }
        for s in sorted(pb.steps, key=lambda x: x.order)
    ]

    # Executar em thread separada para não bloquear o event loop
    def run_sync():
        runner = PlaybookRunner(
            steps=steps_data,
            variables=variables,
            device_name=device.name,
            device_ip=device.management_ip,
            device_username=username,
            device_password=password,
            device_telnet_port=device.telnet_port or 23,
            device_ssh_port=device.ssh_port or 22,
            client_name=execution.client_name or "",
        )
        return runner.run()

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, run_sync)

    # Atualizar execução com resultado
    execution.status = PlaybookRunStatus.SUCCESS if result["status"] == "success" else PlaybookRunStatus.ERROR
    execution.step_logs = result["step_logs"]
    execution.output_files = result["output_files"]
    execution.error_message = result.get("error_message")
    execution.duration_ms = result["duration_ms"]
    execution.finished_at = datetime.utcnow()
    execution.current_step = len(result["step_logs"])

    # Registrar na auditoria
    run_ok = result["status"] == "success"
    audit = AuditLog(
        user_id=current_user.id,
        device_id=device.id,
        action=AuditAction.COMMAND_EXECUTED if run_ok else AuditAction.COMMAND_FAILED,
        description=f"Playbook '{pb.name}' executado em {device.name} ({device.management_ip})",
        status="success" if run_ok else "failure",
        error_message=result.get("error_message"),
        extra_data={
            "playbook_id": str(pb.id),
            "playbook_name": pb.name,
            "execution_id": str(execution.id),
            "device_ip": device.management_ip,
            "total_steps": len(result.get("step_logs", [])),
            "duration_ms": result.get("duration_ms"),
        },
    )
    db.add(audit)
    await db.commit()

    return _execution_to_dict(execution)


@playbooks_router.get("/{playbook_id}/executions")
async def list_playbook_executions(
    playbook_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PlaybookExecution)
        .where(PlaybookExecution.playbook_id == playbook_id)
        .order_by(PlaybookExecution.started_at.desc())
        .limit(limit)
    )
    executions = result.scalars().all()
    return [_execution_to_dict(ex) for ex in executions]


@playbooks_router.get("/executions/all")
async def list_all_executions(
    limit: int = 50,
    device_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(PlaybookExecution).order_by(PlaybookExecution.started_at.desc()).limit(limit)
    if device_id:
        query = query.where(PlaybookExecution.device_id == device_id)
    result = await db.execute(query)
    executions = result.scalars().all()
    return [_execution_to_dict(ex) for ex in executions]


# ─── Tipos de passos disponíveis ─────────────────────────────────────────────

@playbooks_router.get("/meta/step-types")
async def get_step_types(current_user: User = Depends(get_current_user)):
    """Retorna os tipos de passos disponíveis com descrições e parâmetros esperados."""
    return [
        {
            "type": "telnet_connect",
            "label": "Conectar via Telnet",
            "description": "Conecta no dispositivo via Telnet e faz login automático",
            "params": [
                {"key": "host", "label": "Host/IP", "default": "{DEVICE_IP}", "required": False},
                {"key": "port", "label": "Porta", "default": "23", "required": False},
                {"key": "timeout", "label": "Timeout (s)", "default": "30", "required": False},
            ],
        },
        {
            "type": "ssh_connect",
            "label": "Conectar via SSH",
            "description": "Conecta no dispositivo via SSH",
            "params": [
                {"key": "host", "label": "Host/IP", "default": "{DEVICE_IP}", "required": False},
                {"key": "port", "label": "Porta", "default": "22", "required": False},
                {"key": "timeout", "label": "Timeout (s)", "default": "30", "required": False},
            ],
        },
        {
            "type": "send_command",
            "label": "Enviar Comando",
            "description": "Envia um comando e aguarda o prompt de resposta",
            "params": [
                {"key": "command", "label": "Comando", "default": "", "required": True},
                {"key": "wait_for", "label": "Aguardar prompt", "default": "#", "required": False},
                {"key": "timeout", "label": "Timeout (s)", "default": "30", "required": False},
            ],
        },
        {
            "type": "wait_for",
            "label": "Aguardar Texto",
            "description": "Aguarda até que um texto específico apareça na saída",
            "params": [
                {"key": "pattern", "label": "Texto a aguardar", "default": "Transfer complete", "required": True},
                {"key": "timeout", "label": "Timeout (s)", "default": "60", "required": False},
            ],
        },
        {
            "type": "ftp_download",
            "label": "Baixar via FTP",
            "description": "Baixa um arquivo do servidor FTP para o servidor BR10",
            "params": [
                {"key": "host", "label": "FTP Host", "default": "{FTP_HOST}", "required": True},
                {"key": "port", "label": "FTP Porta", "default": "21", "required": False},
                {"key": "user", "label": "FTP Usuário", "default": "{FTP_USER}", "required": True},
                {"key": "pass", "label": "FTP Senha", "default": "{FTP_PASS}", "required": True},
                {"key": "remote_path", "label": "Caminho remoto", "default": "/backups/{DEVICE_NAME}.cfg", "required": True},
                {"key": "local_dir", "label": "Diretório local", "default": "/app/backups/devices/{CLIENT_NAME}/{DATE}", "required": False},
                {"key": "filename", "label": "Nome do arquivo", "default": "{DEVICE_NAME}_{DATETIME}.cfg", "required": False},
                {"key": "timeout", "label": "Timeout (s)", "default": "60", "required": False},
            ],
        },
        {
            "type": "sleep",
            "label": "Aguardar",
            "description": "Pausa a execução por N segundos",
            "params": [
                {"key": "seconds", "label": "Segundos", "default": "2", "required": True},
            ],
        },
        {
            "type": "log",
            "label": "Registrar Mensagem",
            "description": "Registra uma mensagem no log da execução",
            "params": [
                {"key": "message", "label": "Mensagem", "default": "Backup de {DEVICE_NAME} concluído", "required": True},
            ],
        },
        {
            "type": "disconnect",
            "label": "Desconectar",
            "description": "Encerra a conexão com o dispositivo",
            "params": [],
        },
    ]


# ─── Import de Script → Playbook ────────────────────────────────────────────

@playbooks_router.post("/import-script", status_code=status.HTTP_200_OK)
async def preview_import_script(
    file: UploadFile = File(...),
    vendor: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
):
    """
    Recebe um script (.py, .sh, .bash, .expect, .txt) e retorna
    a estrutura de playbook convertida para revisão antes de salvar.
    NÃO persiste no banco — apenas retorna o preview.
    O campo 'vendor' é opcional e, quando informado, é usado para
    ajustar o nome e a descrição do playbook gerado.
    """
    # Validar extensão
    allowed_exts = {'.py', '.sh', '.bash', '.expect', '.tcl', '.txt', '.exp'}
    filename = file.filename or 'script.txt'
    ext = '.' + filename.rsplit('.', 1)[-1].lower() if '.' in filename else '.txt'
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Extensão '{ext}' não suportada. Use: {', '.join(sorted(allowed_exts))}"
        )

    # Ler conteúdo (limite 500KB)
    content_bytes = await file.read()
    if len(content_bytes) > 512_000:
        raise HTTPException(status_code=400, detail="Arquivo muito grande. Limite: 500KB.")

    try:
        content = content_bytes.decode('utf-8')
    except UnicodeDecodeError:
        try:
            content = content_bytes.decode('latin-1')
        except Exception:
            raise HTTPException(status_code=400, detail="Não foi possível decodificar o arquivo. Use UTF-8 ou Latin-1.")

    # Converter script → playbook
    result = import_script_to_playbook(content, filename=filename, vendor=vendor)
    return result


@playbooks_router.post("/import-script/save", status_code=status.HTTP_201_CREATED)
async def save_imported_playbook(
    data: PlaybookCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Salva o playbook importado (após revisão pelo usuário).
    Usa o mesmo endpoint de criação padrão mas com rota semântica.
    """
    pb = Playbook(
        name=data.name,
        description=data.description,
        category=data.category,
        variables=data.variables,
        schedule_cron=data.schedule_cron,
        schedule_enabled=data.schedule_enabled,
        created_by=current_user.id,
    )
    db.add(pb)
    await db.flush()

    for step_data in data.steps:
        step = PlaybookStep(
            playbook_id=pb.id,
            order=step_data.order,
            step_type=step_data.step_type,
            params=step_data.params,
            label=step_data.label,
            on_error=step_data.on_error,
        )
        db.add(step)

    await db.commit()

    result = await db.execute(
        select(Playbook)
        .options(selectinload(Playbook.steps))
        .where(Playbook.id == pb.id)
    )
    pb = result.scalar_one()
    return _playbook_to_dict(pb)


# ─── AI Provider Config ───────────────────────────────────────────────────────

@ai_router.get("/providers")
async def list_ai_providers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista todos os providers de IA configurados."""
    result = await db.execute(select(AIProviderConfig).order_by(AIProviderConfig.provider))
    providers = result.scalars().all()

    # Retornar providers configurados + providers disponíveis não configurados
    configured = {p.provider.value if hasattr(p.provider, "value") else p.provider: _provider_to_dict(p)
                  for p in providers}

    all_providers = []
    for provider_key, info in AI_PROVIDERS.items():
        if provider_key in configured:
            all_providers.append(configured[provider_key])
        else:
            all_providers.append({
                "id": None,
                "provider": provider_key,
                "display_name": info["display_name"],
                "default_model": info["default_model"],
                "available_models": info["models"],
                "is_active": False,
                "max_tokens": 4096,
                "temperature": 0.3,
                "system_prompt": None,
                "has_api_key": False,
                "updated_at": None,
            })

    return all_providers


@ai_router.put("/providers/{provider}")
async def configure_ai_provider(
    provider: str,
    data: AIProviderConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Configura ou atualiza um provider de IA."""
    if provider not in AI_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Provider '{provider}' não suportado.")

    provider_info = AI_PROVIDERS[provider]

    result = await db.execute(
        select(AIProviderConfig).where(AIProviderConfig.provider == provider)
    )
    config = result.scalar_one_or_none()

    if not config:
        config = AIProviderConfig(
            provider=provider,
            display_name=provider_info["display_name"],
            available_models=provider_info["models"],
        )
        db.add(config)

    # Criptografar chave de API (ignorar se for placeholder '___keep___')
    if data.api_key and data.api_key.strip() and data.api_key.strip() != '___keep___':
        config.api_key_encrypted = encrypt_field(data.api_key.strip())
        config.is_active = True

    config.default_model = data.default_model or provider_info["default_model"]
    config.max_tokens = data.max_tokens
    config.temperature = data.temperature
    if data.system_prompt:
        config.system_prompt = data.system_prompt

    await db.commit()
    await db.refresh(config)
    return _provider_to_dict(config)


@ai_router.delete("/providers/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_ai_provider(
    provider: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AIProviderConfig).where(AIProviderConfig.provider == provider)
    )
    config = result.scalar_one_or_none()
    if config:
        await db.delete(config)
        await db.commit()


# ─── Análise de IA ────────────────────────────────────────────────────────────

@ai_router.post("/analyze")
async def analyze_content(
    req: AIAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analisa conteúdo de texto usando IA."""
    # Buscar provider ativo
    if req.provider:
        result = await db.execute(
            select(AIProviderConfig).where(AIProviderConfig.provider == req.provider)
        )
    else:
        result = await db.execute(
            select(AIProviderConfig)
            .where(AIProviderConfig.is_active == True)
            .order_by(AIProviderConfig.updated_at.desc())
        )
    config = result.scalar_one_or_none()

    if not config or not config.api_key_encrypted:
        raise HTTPException(
            status_code=400,
            detail="Nenhum provider de IA configurado. Configure uma chave de API em Análise de IA → Configurações."
        )

    api_key = decrypt_field(config.api_key_encrypted)
    provider = config.provider.value if hasattr(config.provider, "value") else config.provider
    model = req.model or config.default_model

    # Criar registro de análise
    analysis = AIAnalysis(
        provider_config_id=config.id,
        user_id=current_user.id,
        source_type=req.source_type,
        source_id=req.source_id,
        device_name=req.device_name,
        client_name=req.client_name,
        analysis_type=req.analysis_type,
        provider=provider,
        model_used=model,
        input_text=req.content[:60000],  # limitar armazenamento
        prompt_used=req.custom_prompt,
        status=AIAnalysisStatus.RUNNING,
    )
    db.add(analysis)
    await db.commit()

    # Executar análise
    success, result_text, tokens, duration_ms = await analyze_with_ai(
        content=req.content,
        analysis_type=req.analysis_type,
        provider=provider,
        model=model,
        api_key=api_key,
        custom_prompt=req.custom_prompt,
        max_tokens=config.max_tokens,
        temperature=config.temperature,
        context=req.context,
    )

    # Atualizar registro
    analysis.status = AIAnalysisStatus.SUCCESS if success else AIAnalysisStatus.ERROR
    analysis.result = result_text if success else None
    analysis.error_message = result_text if not success else None
    analysis.tokens_used = tokens
    analysis.duration_ms = duration_ms
    analysis.finished_at = datetime.utcnow()

    await db.commit()
    await db.refresh(analysis)
    return _analysis_to_dict(analysis)


@ai_router.post("/analyze/file")
async def analyze_file(
    file: UploadFile = File(...),
    analysis_type: str = Form("custom"),
    provider: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    custom_prompt: Optional[str] = Form(None),
    context: Optional[str] = Form(None),
    device_name: Optional[str] = Form(None),
    client_name: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analisa um arquivo de log/texto enviado via upload."""
    # Ler conteúdo do arquivo
    content_bytes = await file.read()
    try:
        content = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            content = content_bytes.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="Arquivo não é texto legível (UTF-8 ou Latin-1).")

    if not content.strip():
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    # Reutilizar o endpoint de análise de texto
    req = AIAnalyzeRequest(
        content=content,
        analysis_type=analysis_type,
        provider=provider,
        model=model,
        custom_prompt=custom_prompt,
        context=context or f"Arquivo: {file.filename}",
        source_type="file_upload",
        source_id=file.filename,
        device_name=device_name,
        client_name=client_name,
    )
    return await analyze_content(req, db, current_user)


@ai_router.get("/analyses")
async def list_analyses(
    limit: int = 50,
    analysis_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista o histórico de análises de IA."""
    query = select(AIAnalysis).order_by(AIAnalysis.created_at.desc()).limit(limit)
    if analysis_type:
        query = query.where(AIAnalysis.analysis_type == analysis_type)
    result = await db.execute(query)
    analyses = result.scalars().all()
    return [_analysis_to_dict(a) for a in analyses]


@ai_router.get("/analyses/{analysis_id}")
async def get_analysis(
    analysis_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(AIAnalysis).where(AIAnalysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="Análise não encontrada.")
    return _analysis_to_dict(analysis)


@ai_router.post("/providers/{provider}/test")
async def test_ai_provider(
    provider: str,
    req: AIProviderTestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Testa a conectividade com um provider de IA.
    Envia uma mensagem simples e verifica se a resposta é válida.
    """
    import time
    if provider not in AI_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Provider '{provider}' não suportado.")

    provider_info = AI_PROVIDERS[provider]

    # Determinar a chave de API a usar
    api_key = None
    if req.api_key and req.api_key.strip() and req.api_key.strip() != '___keep___':
        # Usar a chave fornecida na requisição (antes de salvar)
        api_key = req.api_key.strip()
    else:
        # Buscar a chave salva no banco
        result = await db.execute(
            select(AIProviderConfig).where(AIProviderConfig.provider == provider)
        )
        config = result.scalar_one_or_none()
        if config and config.api_key_encrypted:
            api_key = decrypt_field(config.api_key_encrypted)

    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Nenhuma chave de API disponível. Insira a chave no campo acima."
        )

    model = req.model or provider_info["default_model"]
    start = time.time()

    try:
        from openai import AsyncOpenAI
        base_url = provider_info.get("base_url")
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url

        client = AsyncOpenAI(**client_kwargs)
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Responda apenas: OK"}],
            max_tokens=10,
            timeout=15,
        )
        elapsed_ms = int((time.time() - start) * 1000)
        reply = response.choices[0].message.content.strip() if response.choices else "(sem resposta)"
        tokens = response.usage.total_tokens if response.usage else None

        return {
            "success": True,
            "provider": provider,
            "model": model,
            "response": reply,
            "tokens_used": tokens,
            "latency_ms": elapsed_ms,
            "message": f"Conexão bem-sucedida com {provider_info['display_name']} ({model}) em {elapsed_ms}ms",
        }
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        error_msg = str(e)
        # Simplificar mensagens de erro comuns
        if "401" in error_msg or "Unauthorized" in error_msg or "invalid_api_key" in error_msg:
            error_msg = "Chave de API inválida ou sem permissão."
        elif "404" in error_msg and "model" in error_msg.lower():
            error_msg = f"Modelo '{model}' não encontrado. Tente outro modelo."
        elif "429" in error_msg or "rate_limit" in error_msg:
            error_msg = "Limite de requisições atingido. Aguarde alguns segundos."
        elif "Connection" in error_msg or "timeout" in error_msg.lower():
            error_msg = "Erro de conexão. Verifique a rede do servidor."
        return {
            "success": False,
            "provider": provider,
            "model": model,
            "response": None,
            "tokens_used": None,
            "latency_ms": elapsed_ms,
            "message": error_msg,
        }


@ai_router.delete("/analyses/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_analysis(
    analysis_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(AIAnalysis).where(AIAnalysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if analysis:
        await db.delete(analysis)
        await db.commit()


@ai_router.get("/meta/analysis-types")
async def get_analysis_types(current_user: User = Depends(get_current_user)):
    """Retorna os tipos de análise disponíveis."""
    return [
        {"type": "alarms", "label": "Alarmes de Rede", "description": "Análise de alarmes e eventos críticos"},
        {"type": "bgp", "label": "BGP / Roteamento", "description": "Análise de sessões BGP e tabela de rotas"},
        {"type": "olt", "label": "OLT / PON", "description": "Análise de ONUs, sinal óptico e alarmes PON"},
        {"type": "system_log", "label": "Log de Sistema", "description": "Análise de logs gerais do equipamento"},
        {"type": "interfaces", "label": "Interfaces", "description": "Análise de erros e status de interfaces"},
        {"type": "routing", "label": "Tabela de Rotas", "description": "Análise da tabela de roteamento IP"},
        {"type": "backup", "label": "Arquivo de Backup", "description": "Análise de arquivo de configuração"},
        {"type": "custom", "label": "Análise Personalizada", "description": "Análise com prompt personalizado"},
    ]

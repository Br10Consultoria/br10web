"""
BR10 NetManager - Modelos de Playbooks e Análise de IA
Playbooks: sequências de passos com suporte a Telnet interativo, FTP e variáveis.
AIAnalysis: análise de logs/outputs via LLM (OpenAI, Gemini, Anthropic).
"""
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Integer, Boolean, DateTime,
    ForeignKey, Enum as SAEnum, Float
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.models.base import Base


# ─── Enums ────────────────────────────────────────────────────────────────────

class PlaybookStatus(str, enum.Enum):
    DRAFT    = "draft"
    ACTIVE   = "active"
    DISABLED = "disabled"


class PlaybookStepType(str, enum.Enum):
    # Conectividade
    TELNET_CONNECT = "telnet_connect"   # Conectar via Telnet
    SSH_CONNECT    = "ssh_connect"      # Conectar via SSH
    DISCONNECT     = "disconnect"       # Encerrar conexão

    # Interação com dispositivo
    SEND_COMMAND   = "send_command"     # Enviar comando e aguardar prompt
    WAIT_FOR       = "wait_for"         # Aguardar string específica
    SEND_STRING    = "send_string"      # Enviar string sem aguardar

    # Transferência de arquivos
    FTP_DOWNLOAD   = "ftp_download"     # Baixar arquivo do FTP para o servidor
    FTP_UPLOAD     = "ftp_upload"       # Enviar arquivo para FTP
    SCP_DOWNLOAD   = "scp_download"     # Baixar arquivo do dispositivo via SCP

    # Notificações
    TELEGRAM_SEND_FILE    = "telegram_send_file"     # Enviar arquivo ao Telegram
    TELEGRAM_SEND_MESSAGE = "telegram_send_message"  # Enviar mensagem de texto ao Telegram

    # Automação avançada
    RUN_SCRIPT = "run_script"  # Executar script Python diretamente no container

    # Utilitários
    SLEEP          = "sleep"            # Aguardar N segundos
    LOG            = "log"              # Registrar mensagem no log da execução


class PlaybookRunStatus(str, enum.Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    SUCCESS   = "success"
    ERROR     = "error"
    TIMEOUT   = "timeout"
    CANCELLED = "cancelled"


class AIProvider(str, enum.Enum):
    OPENAI    = "openai"     # GPT-4o, GPT-4.1, GPT-3.5
    GEMINI    = "gemini"     # Google Gemini 2.5 Flash / Pro
    ANTHROPIC = "anthropic"  # Claude 3.5 Sonnet / Haiku


class AIAnalysisStatus(str, enum.Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    SUCCESS   = "success"
    ERROR     = "error"


# ─── Helper para criar SAEnum compatível com PostgreSQL ───────────────────────
# Usa native_enum=False para armazenar como VARCHAR, evitando conflito entre
# o .name (maiúsculo) e o .value (minúsculo) dos enums Python.

def _enum_col(enum_class, **kwargs):
    """Cria um Column SAEnum que armazena o .value (minúsculo) como VARCHAR."""
    return Column(
        SAEnum(
            enum_class,
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
        ),
        **kwargs,
    )


# ─── Playbook ─────────────────────────────────────────────────────────────────

class Playbook(Base):
    """
    Receita de automação com múltiplos passos sequenciais.
    Suporta variáveis substituídas em runtime (ex: {FTP_HOST}, {CLIENT_NAME}).
    """
    __tablename__ = "playbooks"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category    = Column(String(100), default="backup", nullable=False)  # backup, diagnostics, config

    # Variáveis configuráveis (chave → valor padrão)
    variables   = Column(JSONB, default=dict, nullable=False)

    # Agendamento (cron expression, ex: "0 2 * * *" = todo dia às 02:00)
    schedule_cron    = Column(String(100), nullable=True)
    schedule_enabled = Column(Boolean, default=False, nullable=False)

    # Metadados
    status      = _enum_col(PlaybookStatus, default=PlaybookStatus.ACTIVE, nullable=False)
    is_global   = Column(Boolean, default=True, nullable=False)
    created_by  = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relacionamentos
    steps       = relationship("PlaybookStep", back_populates="playbook",
                               cascade="all, delete-orphan", order_by="PlaybookStep.order",
                               lazy="selectin")
    executions  = relationship("PlaybookExecution", back_populates="playbook",
                               cascade="all, delete-orphan", lazy="noload")
    creator     = relationship("User", foreign_keys=[created_by])

    def __repr__(self):
        return f"<Playbook {self.name}>"


class PlaybookStep(Base):
    """
    Um passo individual dentro de um Playbook.
    Cada passo tem um tipo e parâmetros específicos em JSON.
    """
    __tablename__ = "playbook_steps"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    playbook_id = Column(UUID(as_uuid=True), ForeignKey("playbooks.id", ondelete="CASCADE"),
                         nullable=False, index=True)

    # Ordenação
    order       = Column(Integer, nullable=False, default=0)

    # Tipo do passo
    step_type   = _enum_col(PlaybookStepType, nullable=False)

    # Parâmetros específicos do tipo (JSON livre)
    params      = Column(JSONB, default=dict, nullable=False)

    # Metadados
    label       = Column(String(200), nullable=True)
    on_error    = Column(String(20), default="stop", nullable=False)  # stop | continue | retry

    # Relacionamento
    playbook    = relationship("Playbook", back_populates="steps")

    def __repr__(self):
        return f"<PlaybookStep {self.order}: {self.step_type}>"


class PlaybookExecution(Base):
    """
    Histórico de execuções de um Playbook em um dispositivo.
    Registra o log passo a passo e o resultado final.
    """
    __tablename__ = "playbook_executions"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    playbook_id = Column(UUID(as_uuid=True), ForeignKey("playbooks.id", ondelete="SET NULL"),
                         nullable=True, index=True)
    device_id   = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
                         nullable=True)

    # Cache de nomes
    playbook_name = Column(String(200), nullable=True)
    device_name   = Column(String(200), nullable=True)
    device_ip     = Column(String(45), nullable=True)
    client_name   = Column(String(200), nullable=True)

    # Variáveis usadas nesta execução (snapshot)
    variables_used = Column(JSONB, default=dict, nullable=False)

    # Resultado
    status        = _enum_col(PlaybookRunStatus, default=PlaybookRunStatus.PENDING, nullable=False)
    current_step  = Column(Integer, default=0, nullable=False)
    total_steps   = Column(Integer, default=0, nullable=False)

    # Log detalhado passo a passo (lista de dicts)
    step_logs     = Column(JSONB, default=list, nullable=False)

    # Arquivos gerados (ex: backups baixados)
    output_files  = Column(JSONB, default=list, nullable=False)

    error_message = Column(Text, nullable=True)
    duration_ms   = Column(Integer, nullable=True)

    # Timestamps
    started_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at   = Column(DateTime(timezone=True), nullable=True)

    # Relacionamentos
    playbook = relationship("Playbook", back_populates="executions")
    device   = relationship("Device", foreign_keys=[device_id])
    user     = relationship("User", foreign_keys=[user_id])

    def __repr__(self):
        return f"<PlaybookExecution {self.playbook_name} @ {self.device_name} - {self.status}>"


# ─── AI Analysis ──────────────────────────────────────────────────────────────

class AIProviderConfig(Base):
    """
    Configuração de um provider de IA (OpenAI, Gemini, Anthropic).
    Armazena a chave de API criptografada e o modelo padrão.
    """
    __tablename__ = "ai_provider_configs"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider     = _enum_col(AIProvider, nullable=False, unique=True)
    display_name = Column(String(100), nullable=False)

    # Chave de API criptografada com Fernet
    api_key_encrypted = Column(Text, nullable=True)

    # Modelo padrão para este provider
    default_model = Column(String(100), nullable=False)

    # Modelos disponíveis (lista JSON)
    available_models = Column(JSONB, default=list, nullable=False)

    # Configurações
    is_active    = Column(Boolean, default=False, nullable=False)
    max_tokens   = Column(Integer, default=4096, nullable=False)
    temperature  = Column(Float, default=0.3, nullable=False)

    # Prompt de sistema padrão para análise de rede
    system_prompt = Column(Text, nullable=True)

    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relacionamentos
    analyses     = relationship("AIAnalysis", back_populates="provider_config",
                                cascade="all, delete-orphan", lazy="noload")

    def __repr__(self):
        return f"<AIProviderConfig {self.provider} - {'ativo' if self.is_active else 'inativo'}>"


class AIAnalysis(Base):
    """
    Histórico de análises de IA realizadas sobre outputs de comandos ou arquivos.
    """
    __tablename__ = "ai_analyses"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_config_id = Column(UUID(as_uuid=True),
                                ForeignKey("ai_provider_configs.id", ondelete="SET NULL"),
                                nullable=True, index=True)
    user_id         = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
                             nullable=True)

    # Origem da análise
    source_type     = Column(String(50), nullable=False)
    source_id       = Column(String(200), nullable=True)

    # Contexto
    device_name     = Column(String(200), nullable=True)
    client_name     = Column(String(200), nullable=True)
    analysis_type   = Column(String(100), nullable=False)

    # Provider e modelo usados
    provider        = Column(String(50), nullable=True)
    model_used      = Column(String(100), nullable=True)

    # Conteúdo
    input_text      = Column(Text, nullable=False)
    prompt_used     = Column(Text, nullable=True)
    result          = Column(Text, nullable=True)
    tokens_used     = Column(Integer, nullable=True)

    # Status
    status          = _enum_col(AIAnalysisStatus, default=AIAnalysisStatus.PENDING, nullable=False)
    error_message   = Column(Text, nullable=True)
    duration_ms     = Column(Integer, nullable=True)

    # Timestamps
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at     = Column(DateTime(timezone=True), nullable=True)

    # Relacionamentos
    provider_config = relationship("AIProviderConfig", back_populates="analyses")
    user            = relationship("User", foreign_keys=[user_id])

    def __repr__(self):
        return f"<AIAnalysis {self.analysis_type} - {self.status}>"

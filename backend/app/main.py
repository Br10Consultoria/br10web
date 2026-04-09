"""
BR10 NetManager - Main Application
Aplicação FastAPI principal com segurança, CORS e todos os routers.
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.database import init_db
from app.core.scheduler import start_scheduler, stop_scheduler
from app.api.v1.auth import router as auth_router
from app.api.v1.devices import router as devices_router
from app.api.v1.vpn import router as vpn_router, routes_router
from app.api.v1.terminal import router as terminal_router
from app.api.v1.backup import router as backup_router
from app.api.v1.audit import router as audit_router
from app.api.v1.clients import router as clients_router, vendor_groups_router, vendors_router, vendor_models_router
from app.api.v1.automation import router as automation_router
from app.api.v1.playbooks import playbooks_router, ai_router
from app.api.v1.network_tools import router as network_tools_router
from app.api.v1.device_inspector import router as device_inspector_router
from app.api.v1.inspector_commands import router as inspector_commands_router
from app.api.v1.device_backup import router as device_backup_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicialização e encerramento da aplicação."""
    logger.info("Iniciando BR10 NetManager...")

    # Criar diretórios necessários
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(settings.BACKUP_DIR, exist_ok=True)
    os.makedirs(os.path.join(settings.UPLOAD_DIR, "devices"), exist_ok=True)

    # Inicializar banco de dados
    try:
        await init_db()
        logger.info("Banco de dados inicializado com sucesso")
    except Exception as e:
        logger.warning(f"Banco de dados não disponível: {e}")

    # Iniciar scheduler de background tasks
    try:
        start_scheduler()
        logger.info("Scheduler iniciado — verificação de status a cada 5 minutos")
    except Exception as e:
        logger.warning(f"Scheduler não pôde ser iniciado: {e}")

    yield

    # Encerrar scheduler graciosamente
    stop_scheduler()
    logger.info("Encerrando BR10 NetManager...")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
## BR10 NetManager API

Sistema profissional de gerenciamento de dispositivos de rede.

### Funcionalidades
- **Autenticação** com JWT e 2FA (TOTP)
- **Dispositivos**: Huawei NE8000, Huawei 6730, Datacom, VSOL OLT, Mikrotik
- **Terminal Web**: SSH e Telnet interativo via WebSocket
- **VPN L2TP**: Configuração e gerenciamento com rotas estáticas
- **VLANs e Portas**: Gerenciamento completo de configurações
- **Backup**: Automático e manual dos dados
- **API REST**: Documentação completa com OpenAPI
    """,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ─── Middlewares ──────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Page", "X-Per-Page"],
)

# ─── Debug Auth Middleware (temporário) ─────────────────────────────────────
@app.middleware("http")
async def debug_auth_headers(request: Request, call_next):
    """Middleware temporário de diagnóstico — loga headers de auth."""
    path = request.url.path
    if any(p in path for p in ["/device-backup", "/devices", "/playbooks"]):
        auth = request.headers.get("authorization", "*** AUSENTE ***")
        auth_preview = auth[:40] + "..." if len(auth) > 40 else auth
        logger.warning(f"[DEBUG-AUTH] {request.method} {path} | Authorization: {auth_preview}")
    response = await call_next(request)
    if any(p in path for p in ["/device-backup", "/devices", "/playbooks"]):
        logger.warning(f"[DEBUG-AUTH] -> Status: {response.status_code}")
    return response

# Security headers middleware
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if not settings.DEBUG:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# ─── Exception Handlers ───────────────────────────────────────────────────────
@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return JSONResponse(
        status_code=404,
        content={"detail": "Recurso não encontrado", "path": str(request.url.path)},
    )


@app.exception_handler(500)
async def internal_error_handler(request: Request, exc):
    logger.error(f"Erro interno: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Erro interno do servidor"},
    )


# ─── Routers ─────────────────────────────────────────────────────────────────
API_PREFIX = settings.API_V1_STR

app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(devices_router, prefix=API_PREFIX)
app.include_router(vpn_router, prefix=API_PREFIX)
app.include_router(routes_router, prefix=API_PREFIX)
app.include_router(terminal_router, prefix=API_PREFIX)
app.include_router(backup_router, prefix=API_PREFIX)
app.include_router(audit_router, prefix=API_PREFIX)
app.include_router(clients_router, prefix=API_PREFIX)
app.include_router(vendor_groups_router, prefix=API_PREFIX)
app.include_router(vendors_router, prefix=API_PREFIX)
app.include_router(vendor_models_router, prefix=API_PREFIX)
app.include_router(automation_router, prefix=API_PREFIX)
app.include_router(playbooks_router, prefix=API_PREFIX)
app.include_router(ai_router, prefix=API_PREFIX)
app.include_router(network_tools_router, prefix=API_PREFIX)
app.include_router(device_inspector_router, prefix=API_PREFIX)
app.include_router(inspector_commands_router, prefix=API_PREFIX)
app.include_router(device_backup_router, prefix=API_PREFIX)

# ─── Static Files ─────────────────────────────────────────────────────────────
uploads_dir = settings.UPLOAD_DIR
if os.path.exists(uploads_dir):
    app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


# ─── Health Check ─────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }


@app.get("/", tags=["System"])
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/api/docs",
        "health": "/health",
    }

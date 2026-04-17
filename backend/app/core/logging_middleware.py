import time
import logging
import json
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.audit_helper import log_audit
from app.models.audit import AuditAction
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "unknown")
        
        # Tentar obter user_id do estado (se já autenticado)
        user_id = getattr(request.state, "user_id", None)
        
        try:
            response = await call_next(request)
            process_time = (time.time() - start_time) * 1000
            
            # Logar apenas requisições importantes ou erros
            if response.status_code >= 400 or request.method in ["POST", "PUT", "DELETE", "PATCH"]:
                async with AsyncSessionLocal() as db:
                    await log_audit(
                        db,
                        action=AuditAction.ACCESS_LOG,
                        description=f"{request.method} {request.url.path} - {response.status_code}",
                        status="success" if response.status_code < 400 else "failure",
                        user_id=user_id,
                        ip_address=client_ip,
                        user_agent=user_agent,
                        extra_data={
                            "method": request.method,
                            "path": request.url.path,
                            "status_code": response.status_code,
                            "process_time_ms": round(process_time, 2),
                            "query_params": str(request.query_params)
                        }
                    )
            
            return response
            
        except Exception as e:
            process_time = (time.time() - start_time) * 1000
            logger.error(f"Erro na requisição {request.method} {request.url.path}: {str(e)}", exc_info=True)
            
            async with AsyncSessionLocal() as db:
                await log_audit(
                    db,
                    action=AuditAction.BACKEND_ERROR,
                    description=f"Erro em {request.method} {request.url.path}: {str(e)}",
                    status="failure",
                    user_id=user_id,
                    ip_address=client_ip,
                    user_agent=user_agent,
                    error_message=str(e),
                    extra_data={
                        "method": request.method,
                        "path": request.url.path,
                        "process_time_ms": round(process_time, 2)
                    }
                )
            raise e

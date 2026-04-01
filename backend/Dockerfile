FROM python:3.11-slim

LABEL maintainer="BR10 Consultoria <ti@br10consultoria.com.br>"
LABEL description="BR10 Network Manager - Backend API"

# Variáveis de ambiente
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    postgresql-client \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Criar usuário não-root
RUN groupadd -r br10 && useradd -r -g br10 br10

# Diretório de trabalho
WORKDIR /app

# Instalar dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY . .

# Criar diretórios necessários
RUN mkdir -p /app/backups /app/uploads /app/logs && \
    chown -R br10:br10 /app

# Mudar para usuário não-root
USER br10

# Expor porta
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Comando de inicialização
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers --forwarded-allow-ips='*'"]

FROM python:3.11-slim

LABEL maintainer="BR10 Consultoria <ti@br10consultoria.com.br>"
LABEL description="BR10 Network Manager - Backend API"

# Variáveis de ambiente
ENV PYTHONDONTWRITEBYTECODE=1 \
    TZ=America/Bahia \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VPN_BASE_DIR=/app/vpn

# Dependências do sistema (incluindo xl2tpd e ppp para VPN L2TP)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    postgresql-client \
    openssh-client \
    tzdata \
    iputils-ping \
    traceroute \
    dnsutils \
    mtr-tiny \
    xl2tpd \
    ppp \
    iproute2 \
    iptables \
    procps \
    nmap \
    && ln -snf /usr/share/zoneinfo/America/Bahia /etc/localtime \
    && echo 'America/Bahia' > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# Criar usuário não-root com acesso ao grupo dialout (/dev/ppp)
RUN groupadd -r br10 && useradd -r -g br10 br10 \
    && usermod -aG dialout br10 2>/dev/null || true

# Diretório de trabalho
WORKDIR /app

# Instalar dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY . .

# Criar todos os diretórios necessários (incluindo VPN) com ownership do br10
RUN mkdir -p \
    /app/backups \
    /app/uploads \
    /app/logs \
    /app/vpn/xl2tpd \
    /app/vpn/ppp/peers \
    /app/vpn/run \
    /app/vpn/log \
    && chown -R br10:br10 /app

# Copiar e configurar entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown br10:br10 /entrypoint.sh

# Mudar para usuário não-root
USER br10

# Expor porta
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

# Usar entrypoint robusto
ENTRYPOINT ["/entrypoint.sh"]

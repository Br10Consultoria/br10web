#!/bin/bash
# ─── BR10 Network Manager - Script de Instalação ─────────────────────────────
# Suporte: Ubuntu 22.04 LTS e Debian 12
# Uso: sudo bash install.sh

set -euo pipefail

DOMAIN="br10web.br10consultoria.com.br"
EMAIL="ti@br10consultoria.com.br"
APP_DIR="/opt/br10web"
REPO_URL="https://github.com/Br10Consultoria/br10web.git"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')] $1${NC}"; }
warn() { echo -e "${YELLOW}[WARN] $1${NC}"; }
error(){ echo -e "${RED}[ERROR] $1${NC}"; exit 1; }

# ─── Verificar root ──────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Execute como root: sudo bash install.sh"

# Detectar distribuição
OS_ID=$(grep -oP '(?<=^ID=).+' /etc/os-release | tr -d '"' || echo "unknown")
OS_VERSION=$(grep -oP '(?<=^VERSION_ID=).+' /etc/os-release | tr -d '"' || echo "0")
log "Sistema detectado: $OS_ID $OS_VERSION"

log "═══════════════════════════════════════════════════"
log "   BR10 Network Manager - Instalação"
log "   Domínio: $DOMAIN"
log "═══════════════════════════════════════════════════"

# ─── 1. Atualizar sistema ────────────────────────────────────────────────────
log "1/10 Atualizando sistema..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

# ─── 2. Instalar dependências ────────────────────────────────────────────────
log "2/10 Instalando dependências..."
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl wget git unzip \
    ca-certificates gnupg lsb-release \
    ufw fail2ban net-tools lsof \
    certbot

# ─── 3. Liberar portas 80 e 443 ─────────────────────────────────────────────
log "3/10 Liberando portas 80 e 443..."

for SVC in apache2 nginx lighttpd httpd; do
    if systemctl is-active --quiet "$SVC" 2>/dev/null; then
        warn "Serviço '$SVC' detectado em execução. Parando e desabilitando..."
        systemctl stop "$SVC" 2>/dev/null || true
        systemctl disable "$SVC" 2>/dev/null || true
        log "Serviço '$SVC' parado."
    fi
done

# Forçar liberação das portas 80 e 443 se ainda ocupadas
for PORT in 80 443; do
    PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        for PID in $PIDS; do
            PROC=$(ps -p "$PID" -o comm= 2>/dev/null || echo "desconhecido")
            warn "Porta $PORT em uso por '$PROC' (PID $PID). Encerrando..."
            kill -9 "$PID" 2>/dev/null || true
        done
        sleep 1
    fi
done
log "Portas 80 e 443 liberadas."

# ─── 4. Instalar Docker ──────────────────────────────────────────────────────
log "4/10 Instalando Docker..."
if ! command -v docker &>/dev/null; then
    # Método oficial para Ubuntu e Debian
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} $(lsb_release -cs) stable" \
        | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    systemctl enable docker
    systemctl start docker
    log "Docker instalado: $(docker --version)"
else
    log "Docker já instalado: $(docker --version)"
fi

# ─── 5. Configurar Docker Compose ───────────────────────────────────────────
log "5/10 Configurando Docker Compose..."
# Verificar se docker compose (plugin) funciona
if docker compose version &>/dev/null 2>&1; then
    log "Docker Compose plugin disponível: $(docker compose version)"
    # Criar alias para compatibilidade com docker-compose
    if ! command -v docker-compose &>/dev/null; then
        ln -sf /usr/bin/docker /usr/local/bin/docker-compose 2>/dev/null || true
        cat > /usr/local/bin/docker-compose << 'DCEOF'
#!/bin/bash
exec docker compose "$@"
DCEOF
        chmod +x /usr/local/bin/docker-compose
    fi
elif ! command -v docker-compose &>/dev/null; then
    # Instalar docker-compose standalone como fallback
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest \
        | grep '"tag_name"' | cut -d'"' -f4 || echo "v2.24.5")
    curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    log "Docker Compose instalado: $(docker-compose --version)"
fi

# ─── 6. Configurar Firewall ──────────────────────────────────────────────────
log "6/10 Configurando firewall (UFW)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
log "Firewall configurado: SSH, 80/tcp e 443/tcp liberados."

# ─── 7. Clonar repositório ───────────────────────────────────────────────────
log "7/10 Clonando repositório..."
if [ -d "$APP_DIR/.git" ]; then
    warn "Repositório já existe em $APP_DIR. Atualizando..."
    cd "$APP_DIR" && git pull origin main || true
elif [ -d "$APP_DIR" ]; then
    warn "Diretório $APP_DIR já existe (sem git). Fazendo backup..."
    mv "$APP_DIR" "${APP_DIR}.bak.$(date +%Y%m%d_%H%M%S)"
    git clone "$REPO_URL" "$APP_DIR"
else
    git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ─── 8. Configurar variáveis de ambiente ────────────────────────────────────
log "8/10 Configurando variáveis de ambiente..."
if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"

    SECRET_KEY=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+' | head -c 24)
    REDIS_PASSWORD=$(openssl rand -base64 16 | tr -d '=/+' | head -c 16)
    BACKUP_API_KEY=$(openssl rand -hex 16)

    sed -i "s/CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32/$SECRET_KEY/"    "$APP_DIR/.env"
    sed -i "s/CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32/$ENCRYPTION_KEY/" "$APP_DIR/.env"
    sed -i "s/CHANGE_ME_STRONG_PASSWORD_HERE/$DB_PASSWORD/"                 "$APP_DIR/.env"
    sed -i "s/CHANGE_ME_REDIS_PASSWORD/$REDIS_PASSWORD/"                    "$APP_DIR/.env"
    sed -i "s/CHANGE_ME_BACKUP_API_KEY/$BACKUP_API_KEY/"                    "$APP_DIR/.env"

    log "Arquivo .env gerado com chaves seguras."
    warn "IMPORTANTE: Guarde as credenciais abaixo em local seguro!"
    echo -e "${BLUE}  DB_PASSWORD:    $DB_PASSWORD${NC}"
    echo -e "${BLUE}  REDIS_PASSWORD: $REDIS_PASSWORD${NC}"
    echo -e "${BLUE}  BACKUP_API_KEY: $BACKUP_API_KEY${NC}"
else
    log "Arquivo .env já existe. Mantendo configuração atual."
fi

# ─── 9. Certificado SSL ──────────────────────────────────────────────────────
log "9/10 Obtendo certificado SSL (Let's Encrypt)..."
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    # Garantir que porta 80 está livre para o certbot standalone
    for PID in $(lsof -ti :80 2>/dev/null || true); do
        kill -9 "$PID" 2>/dev/null || true
    done
    sleep 1

    certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        -d "$DOMAIN" \
        --preferred-challenges http \
        && log "Certificado SSL obtido com sucesso!" \
        || warn "Falha ao obter certificado SSL. Verifique se o DNS '$DOMAIN' aponta para este servidor. O sistema funcionará em HTTP por enquanto."
else
    log "Certificado SSL já existe para $DOMAIN."
fi

# Renovação automática
echo "0 12 * * * root certbot renew --quiet --deploy-hook 'cd $APP_DIR && docker compose restart nginx 2>/dev/null || docker-compose restart nginx 2>/dev/null'" \
    > /etc/cron.d/certbot-renew
log "Renovação automática de SSL configurada."

# ─── 10. Iniciar serviços ────────────────────────────────────────────────────
log "10/10 Iniciando serviços com Docker Compose..."
cd "$APP_DIR"

# Usar docker compose (plugin) ou docker-compose (standalone)
DC_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    DC_CMD="docker-compose"
fi

# Remover containers antigos se existirem
$DC_CMD down --remove-orphans 2>/dev/null || true

# Build e iniciar
$DC_CMD up -d --build

# Aguardar inicialização
log "Aguardando todos os serviços ficarem prontos (45s)..."
sleep 45

# Verificar status
if $DC_CMD ps | grep -qE "Up|running"; then
    log "═══════════════════════════════════════════════════"
    log "   Instalação concluída com sucesso!"
    if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
        log "   Acesse: https://$DOMAIN"
    else
        log "   Acesse: http://$DOMAIN (SSL pendente)"
    fi
    log "   Usuário padrão: admin"
    log "   Senha padrão:   Admin@BR10!"
    log "   MUDE A SENHA E ATIVE O 2FA NO PRIMEIRO ACESSO!"
    log "═══════════════════════════════════════════════════"
    log "Logs: $DC_CMD -f $APP_DIR/docker-compose.yml logs -f"
else
    warn "Alguns serviços podem não ter iniciado. Verifique:"
    $DC_CMD ps
    warn "Logs: cd $APP_DIR && $DC_CMD logs"
fi

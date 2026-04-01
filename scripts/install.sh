#!/bin/bash
# ─── BR10 Network Manager - Script de Instalação ─────────────────────────────
# Uso: sudo bash install.sh
# Testado em: Ubuntu 22.04 LTS

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

log "═══════════════════════════════════════════════════"
log "   BR10 Network Manager - Instalação"
log "   Domínio: $DOMAIN"
log "═══════════════════════════════════════════════════"

# ─── 1. Atualizar sistema ────────────────────────────────────────────────────
log "1/10 Atualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# ─── 2. Instalar dependências ────────────────────────────────────────────────
log "2/10 Instalando dependências..."
apt-get install -y -qq \
    curl wget git unzip \
    ca-certificates gnupg lsb-release \
    ufw fail2ban net-tools lsof \
    certbot python3-certbot-nginx

# ─── 3. Liberar portas 80 e 443 ─────────────────────────────────────────────
log "3/10 Liberando portas 80 e 443..."

# Parar e desabilitar Apache2 (instalado por padrão em algumas VPS)
if systemctl is-active --quiet apache2 2>/dev/null; then
    warn "Apache2 detectado e em execução. Parando e desabilitando..."
    systemctl stop apache2
    systemctl disable apache2
    log "Apache2 parado e desabilitado."
fi

# Parar e desabilitar Nginx nativo do Ubuntu (se existir)
if systemctl is-active --quiet nginx 2>/dev/null; then
    warn "Nginx nativo detectado e em execução. Parando e desabilitando..."
    systemctl stop nginx
    systemctl disable nginx
    log "Nginx nativo parado e desabilitado."
fi

# Verificar se as portas ainda estão em uso por outro processo
for PORT in 80 443; do
    PID=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$PID" ]; then
        PROC=$(ps -p "$PID" -o comm= 2>/dev/null || echo "desconhecido")
        warn "Porta $PORT ainda em uso pelo processo '$PROC' (PID $PID). Encerrando..."
        kill -9 "$PID" 2>/dev/null || true
        sleep 1
        log "Processo na porta $PORT encerrado."
    fi
done

log "Portas 80 e 443 liberadas com sucesso."

# ─── 4. Instalar Docker ──────────────────────────────────────────────────────
log "4/10 Instalando Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    log "Docker já instalado: $(docker --version)"
fi

# ─── 5. Instalar Docker Compose ─────────────────────────────────────────────
log "5/10 Instalando Docker Compose..."
if ! command -v docker-compose &>/dev/null; then
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
    curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    log "Docker Compose já instalado: $(docker-compose --version)"
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
if [ -d "$APP_DIR" ]; then
    warn "Diretório $APP_DIR já existe. Fazendo backup..."
    mv "$APP_DIR" "${APP_DIR}.bak.$(date +%Y%m%d_%H%M%S)"
fi
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"

# ─── 8. Configurar variáveis de ambiente ────────────────────────────────────
log "8/10 Configurando variáveis de ambiente..."
if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"

    # Gerar chaves seguras
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
fi

# ─── 9. Certificado SSL ──────────────────────────────────────────────────────
log "9/10 Obtendo certificado SSL (Let's Encrypt)..."
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    # Porta 80 já está livre (liberamos acima), usar modo standalone
    certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        -d "$DOMAIN" \
        --preferred-challenges http \
        || warn "Falha ao obter certificado SSL. Verifique se o DNS do domínio aponta para este servidor. O sistema funcionará sem HTTPS por enquanto."
fi

# Renovação automática
echo "0 12 * * * root certbot renew --quiet --post-hook 'docker-compose -f $APP_DIR/docker-compose.yml restart nginx'" > /etc/cron.d/certbot-renew
log "Renovação automática de SSL configurada."

# ─── 10. Iniciar serviços ────────────────────────────────────────────────────
log "10/10 Iniciando serviços com Docker Compose..."
cd "$APP_DIR"
docker-compose pull 2>/dev/null || true
docker-compose up -d --build

# Aguardar inicialização completa
log "Aguardando todos os serviços ficarem prontos (30s)..."
sleep 30

# Verificar status final
if docker-compose ps | grep -q "Up"; then
    log "═══════════════════════════════════════════════════"
    log "   Instalação concluída com sucesso!"
    log "   Acesse: https://$DOMAIN"
    log "   Usuário padrão: admin"
    log "   Senha padrão:   Admin@BR10!"
    log "   MUDE A SENHA E ATIVE O 2FA NO PRIMEIRO ACESSO!"
    log "═══════════════════════════════════════════════════"
    log "Para verificar os logs: docker-compose -f $APP_DIR/docker-compose.yml logs -f"
else
    warn "Alguns serviços podem não ter iniciado corretamente."
    warn "Verifique com: docker-compose -f $APP_DIR/docker-compose.yml ps"
    warn "Logs:          docker-compose -f $APP_DIR/docker-compose.yml logs"
fi

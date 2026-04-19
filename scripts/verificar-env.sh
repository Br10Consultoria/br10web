#!/bin/bash
# ─── BR10 NetManager — Verificação de .env de Produção ───────────────────────
# Verifica se as variáveis críticas estão definidas no .env
# Uso: bash scripts/verificar-env.sh [caminho_do_env]
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="${1:-.env}"
ERRORS=0
WARNINGS=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  BR10 NetManager — Verificação de Ambiente de Produção${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}[ERRO] Arquivo $ENV_FILE não encontrado!${NC}"
    echo ""
    echo "Crie o arquivo .env a partir do .env.example:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    echo ""
    echo "Variáveis obrigatórias:"
    echo "  SECRET_KEY=\$(openssl rand -hex 32)"
    echo "  ENCRYPTION_KEY=\$(openssl rand -hex 32)"
    echo "  DB_PASSWORD=<senha_forte>"
    echo "  REDIS_PASSWORD=<senha_forte>"
    exit 1
fi

echo -e "Verificando: ${BLUE}$ENV_FILE${NC}"
echo ""

check_var() {
    local VAR_NAME="$1"
    local REQUIRED="$2"
    local MIN_LEN="${3:-0}"
    local VALUE
    VALUE=$(grep "^${VAR_NAME}=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")

    if [ -z "$VALUE" ]; then
        if [ "$REQUIRED" = "true" ]; then
            echo -e "  ${RED}[ERRO]${NC} $VAR_NAME — NÃO DEFINIDA (obrigatória)"
            ERRORS=$((ERRORS + 1))
        else
            echo -e "  ${YELLOW}[AVISO]${NC} $VAR_NAME — não definida (opcional)"
            WARNINGS=$((WARNINGS + 1))
        fi
        return
    fi

    if [ "$VALUE" = "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32" ] || \
       [ "$VALUE" = "CHANGE_ME_STRONG_PASSWORD_HERE" ] || \
       [ "$VALUE" = "CHANGE_ME_REDIS_PASSWORD" ] || \
       [ "$VALUE" = "CHANGE_ME_BACKUP_API_KEY" ]; then
        echo -e "  ${RED}[ERRO]${NC} $VAR_NAME — ainda com valor padrão do .env.example! Altere antes de usar em produção."
        ERRORS=$((ERRORS + 1))
        return
    fi

    local LEN=${#VALUE}
    if [ "$MIN_LEN" -gt 0 ] && [ "$LEN" -lt "$MIN_LEN" ]; then
        echo -e "  ${YELLOW}[AVISO]${NC} $VAR_NAME — definida mas muito curta ($LEN chars, mínimo $MIN_LEN)"
        WARNINGS=$((WARNINGS + 1))
        return
    fi

    echo -e "  ${GREEN}[OK]${NC} $VAR_NAME — definida (${LEN} chars)"
}

echo -e "${BLUE}── Segurança ──────────────────────────────────────────────────${NC}"
check_var "SECRET_KEY"      "true"  32
check_var "ENCRYPTION_KEY"  "true"  32
echo ""

echo -e "${BLUE}── Banco de Dados ─────────────────────────────────────────────${NC}"
check_var "DB_PASSWORD"     "true"  8
check_var "DB_USER"         "false"
check_var "DB_NAME"         "false"
echo ""

echo -e "${BLUE}── Redis ──────────────────────────────────────────────────────${NC}"
check_var "REDIS_PASSWORD"  "true"  8
echo ""

echo -e "${BLUE}── Aplicação ──────────────────────────────────────────────────${NC}"
check_var "ALLOWED_ORIGINS" "false"
check_var "ENVIRONMENT"     "false"
check_var "LOG_LEVEL"       "false"
echo ""

# ─── Verificação crítica: SECRET_KEY é estática? ─────────────────────────────
echo -e "${BLUE}── Verificação Crítica: SECRET_KEY persistente ────────────────${NC}"
SECRET_KEY_VALUE=$(grep "^SECRET_KEY=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [ -n "$SECRET_KEY_VALUE" ]; then
    echo -e "  ${GREEN}[OK]${NC} SECRET_KEY está definida no .env — os tokens JWT serão válidos após restart do container."
    echo -e "  ${BLUE}[INFO]${NC} Se SECRET_KEY NÃO estivesse no .env, o Python geraria uma chave ALEATÓRIA a cada restart,"
    echo -e "         invalidando todos os tokens e forçando novo login após cada reinicialização do container."
else
    echo -e "  ${RED}[CRÍTICO]${NC} SECRET_KEY ausente! Cada restart do container vai invalidar TODOS os tokens JWT."
    echo -e "  ${RED}         ${NC} Isso causa exatamente o sintoma: 'não consigo logar após reiniciar o container'."
    echo ""
    echo -e "  Gere uma chave segura e adicione ao .env:"
    echo -e "  ${YELLOW}  echo \"SECRET_KEY=\$(openssl rand -hex 32)\" >> .env${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# ─── Resumo ───────────────────────────────────────────────────────────────────
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
if [ "$ERRORS" -gt 0 ]; then
    echo -e "${RED}  RESULTADO: $ERRORS erro(s) encontrado(s), $WARNINGS aviso(s)${NC}"
    echo -e "${RED}  Corrija os erros antes de iniciar o sistema em produção.${NC}"
    echo ""
    echo "  Após corrigir o .env, reinicie os containers:"
    echo "    docker compose up -d --force-recreate backend"
    exit 1
elif [ "$WARNINGS" -gt 0 ]; then
    echo -e "${YELLOW}  RESULTADO: 0 erros, $WARNINGS aviso(s) — sistema pode iniciar${NC}"
    exit 0
else
    echo -e "${GREEN}  RESULTADO: Tudo OK — ambiente configurado corretamente${NC}"
    exit 0
fi

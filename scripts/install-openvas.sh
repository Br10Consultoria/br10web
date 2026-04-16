#!/bin/bash
# =============================================================================
# BR10 NetManager — Instalação do OpenVAS / Greenbone Community Edition
# =============================================================================
# Este script instala o Greenbone Community Edition (OpenVAS) de forma
# INDEPENDENTE dos containers principais do BR10.
#
# O OpenVAS roda em seus próprios containers separados e expõe a API GVM
# na porta 9390 do host, que o backend BR10 usa para executar varreduras.
#
# Uso:
#   chmod +x scripts/install-openvas.sh
#   sudo ./scripts/install-openvas.sh
#
# Após a instalação, configure o .env do BR10:
#   OPENVAS_HOST=127.0.0.1
#   OPENVAS_PORT=9390
#   OPENVAS_USER=admin
#   OPENVAS_PASSWORD=<senha definida abaixo>
# =============================================================================

set -e

# ─── Configurações ────────────────────────────────────────────────────────────
OPENVAS_ADMIN_PASSWORD="${OPENVAS_PASSWORD:-Admin@BR10!}"
OPENVAS_DIR="/opt/openvas-greenbone"
COMPOSE_FILE="$OPENVAS_DIR/docker-compose.yml"

echo ""
echo "============================================================"
echo "  BR10 NetManager — Instalação do OpenVAS (Greenbone CE)"
echo "============================================================"
echo ""
echo "Diretório de instalação: $OPENVAS_DIR"
echo "Senha do admin OpenVAS:  $OPENVAS_ADMIN_PASSWORD"
echo ""

# ─── Verificar dependências ───────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "[ERRO] Docker não encontrado. Instale o Docker primeiro."
    exit 1
fi

if ! docker compose version &>/dev/null; then
    echo "[ERRO] Docker Compose v2 não encontrado."
    exit 1
fi

# ─── Criar diretório ──────────────────────────────────────────────────────────
mkdir -p "$OPENVAS_DIR"
cd "$OPENVAS_DIR"

# ─── Baixar docker-compose oficial do Greenbone ──────────────────────────────
echo "[1/4] Baixando configuração oficial do Greenbone Community Edition..."
curl -fsSL https://greenbone.github.io/docs/latest/_static/setup-and-start-greenbone-community-edition.sh \
    -o setup-greenbone.sh && chmod +x setup-greenbone.sh

# ─── Criar docker-compose.yml do OpenVAS ─────────────────────────────────────
echo "[2/4] Criando docker-compose.yml do OpenVAS..."
cat > "$COMPOSE_FILE" << 'COMPOSE_EOF'
# Greenbone Community Edition — Docker Compose
# Independente do BR10 NetManager
# Porta 9390: GVM API (usada pelo backend BR10)
# Porta 9392: Interface web Greenbone Security Assistant (GSA)

services:
  vulnerability-tests:
    image: greenbone/vulnerability-tests
    environment:
      STORAGE_PATH: /var/lib/openvas/22.04/vt-data/nasl
    volumes:
      - vt_data_vol:/mnt

  notus-data:
    image: greenbone/notus-data
    volumes:
      - notus_data_vol:/mnt

  scap-data:
    image: greenbone/scap-data
    volumes:
      - scap_data_vol:/mnt

  cert-bund-data:
    image: greenbone/cert-bund-data
    volumes:
      - cert_data_vol:/mnt

  dfn-cert-data:
    image: greenbone/dfn-cert-data
    volumes:
      - cert_data_vol:/mnt
    depends_on:
      - cert-bund-data

  data-objects:
    image: greenbone/data-objects
    volumes:
      - data_objects_vol:/mnt

  report-formats:
    image: greenbone/report-formats
    volumes:
      - data_objects_vol:/mnt
    depends_on:
      - data-objects

  gpg-data:
    image: greenbone/gpg-data
    volumes:
      - gpg_data_vol:/mnt

  redis-server:
    image: greenbone/redis-server
    restart: on-failure
    volumes:
      - redis_socket_vol:/run/redis/

  pg-gvm:
    image: greenbone/pg-gvm:stable
    restart: on-failure
    volumes:
      - psql_data_vol:/var/lib/postgresql
      - psql_socket_vol:/var/run/postgresql

  gvmd:
    image: greenbone/gvmd:stable
    restart: on-failure
    volumes:
      - gvmd_data_vol:/var/lib/gvm
      - scap_data_vol:/var/lib/gvm/scap-data/
      - cert_data_vol:/var/lib/gvm/cert-data
      - data_objects_vol:/var/lib/gvm/data-objects/gvmd
      - vt_data_vol:/var/lib/openvas/plugins
      - psql_data_vol:/var/lib/postgresql
      - gvmd_socket_vol:/run/gvmd
      - ospd_openvas_socket_vol:/run/ospd
      - notus_data_vol:/var/lib/notus
      - gpg_data_vol:/etc/openvas/gnupg
      - psql_socket_vol:/var/run/postgresql
    depends_on:
      pg-gvm:
        condition: service_started

  gsa:
    image: greenbone/gsa:stable
    restart: on-failure
    ports:
      - "127.0.0.1:9392:80"
    volumes:
      - gvmd_socket_vol:/run/gvmd
    depends_on:
      - gvmd

  ospd-openvas:
    image: greenbone/ospd-openvas:stable
    restart: on-failure
    init: true
    hostname: ospd-openvas
    cap_add:
      - NET_ADMIN
      - NET_RAW
    security_opt:
      - seccomp=unconfined
      - apparmor=unconfined
    command:
      [
        "ospd-openvas",
        "-f",
        "--config", "/etc/gvm/ospd-openvas.conf",
        "--notus-feed-dir", "/var/lib/notus/advisories",
        "-m", "666"
      ]
    volumes:
      - gpg_data_vol:/etc/openvas/gnupg
      - vt_data_vol:/var/lib/openvas/plugins
      - notus_data_vol:/var/lib/notus
      - ospd_openvas_socket_vol:/run/ospd
      - redis_socket_vol:/run/redis/

  mqtt-broker:
    restart: on-failure
    image: greenbone/mqtt-broker
    ports:
      - "127.0.0.1:1883:1883"
    networks:
      default:
        aliases:
          - mqtt-broker
          - broker

  notus-scanner:
    restart: on-failure
    image: greenbone/notus-scanner:stable
    volumes:
      - notus_data_vol:/var/lib/notus
      - gpg_data_vol:/etc/openvas/gnupg
    environment:
      NOTUS_SCANNER_MQTT_NAME: notus-scanner
      NOTUS_SCANNER_DAEMON_MODE: "true"
    depends_on:
      - mqtt-broker
      - redis-server

  gvm-tools:
    image: greenbone/gvm-tools
    volumes:
      - gvmd_socket_vol:/run/gvmd
      - ospd_openvas_socket_vol:/run/ospd
    depends_on:
      - gvmd
      - ospd-openvas

volumes:
  gpg_data_vol:
  scap_data_vol:
  cert_data_vol:
  data_objects_vol:
  gvmd_data_vol:
  psql_data_vol:
  vt_data_vol:
  notus_data_vol:
  ospd_openvas_socket_vol:
  redis_socket_vol:
  gvmd_socket_vol:
  psql_socket_vol:
COMPOSE_EOF

# ─── Criar script de configuração da senha admin ─────────────────────────────
cat > "$OPENVAS_DIR/set-admin-password.sh" << SETPWD_EOF
#!/bin/bash
# Aguarda o gvmd estar pronto e configura a senha do admin
echo "Aguardando gvmd inicializar (pode levar até 5 minutos)..."
for i in \$(seq 1 60); do
    if docker compose -f "$COMPOSE_FILE" exec -T gvmd gvmd --get-users 2>/dev/null | grep -q admin; then
        echo "gvmd pronto! Configurando senha do admin..."
        docker compose -f "$COMPOSE_FILE" exec -T gvmd gvmd --user=admin --new-password="$OPENVAS_ADMIN_PASSWORD"
        echo ""
        echo "✅ Senha do admin OpenVAS configurada com sucesso!"
        echo "   Usuário: admin"
        echo "   Senha:   $OPENVAS_ADMIN_PASSWORD"
        echo ""
        echo "Interface web: http://localhost:9392"
        echo "API GVM:       localhost:9390"
        echo ""
        echo "Configure o .env do BR10:"
        echo "  OPENVAS_HOST=127.0.0.1"
        echo "  OPENVAS_PORT=9390"
        echo "  OPENVAS_USER=admin"
        echo "  OPENVAS_PASSWORD=$OPENVAS_ADMIN_PASSWORD"
        exit 0
    fi
    echo "  Tentativa \$i/60 — aguardando..."
    sleep 10
done
echo "[AVISO] Timeout aguardando gvmd. Execute manualmente:"
echo "  docker compose -f $COMPOSE_FILE exec gvmd gvmd --user=admin --new-password='$OPENVAS_ADMIN_PASSWORD'"
SETPWD_EOF
chmod +x "$OPENVAS_DIR/set-admin-password.sh"

# ─── Criar script de controle ─────────────────────────────────────────────────
cat > "$OPENVAS_DIR/openvas-control.sh" << 'CTRL_EOF'
#!/bin/bash
COMPOSE_FILE="/opt/openvas-greenbone/docker-compose.yml"
case "$1" in
    start)   docker compose -f "$COMPOSE_FILE" up -d ;;
    stop)    docker compose -f "$COMPOSE_FILE" down ;;
    status)  docker compose -f "$COMPOSE_FILE" ps ;;
    logs)    docker compose -f "$COMPOSE_FILE" logs -f --tail=50 ;;
    restart) docker compose -f "$COMPOSE_FILE" restart ;;
    *)
        echo "Uso: $0 {start|stop|status|logs|restart}"
        exit 1
        ;;
esac
CTRL_EOF
chmod +x "$OPENVAS_DIR/openvas-control.sh"
ln -sf "$OPENVAS_DIR/openvas-control.sh" /usr/local/bin/openvas-control 2>/dev/null || true

# ─── Iniciar containers ───────────────────────────────────────────────────────
echo "[3/4] Iniciando containers do OpenVAS em background..."
echo "      (primeira execução baixa ~3-5GB de imagens e dados de CVEs)"
echo ""
docker compose -f "$COMPOSE_FILE" up -d

# ─── Configurar senha em background ──────────────────────────────────────────
echo "[4/4] Configurando senha do admin em background..."
nohup bash "$OPENVAS_DIR/set-admin-password.sh" > /var/log/openvas-setup.log 2>&1 &
echo "      Log: tail -f /var/log/openvas-setup.log"

echo ""
echo "============================================================"
echo "  OpenVAS instalação iniciada!"
echo "============================================================"
echo ""
echo "Os containers do OpenVAS estão subindo em background."
echo "A sincronização inicial de CVEs pode levar 30-60 minutos."
echo ""
echo "Comandos úteis:"
echo "  openvas-control status   — ver status dos containers"
echo "  openvas-control logs     — ver logs em tempo real"
echo "  openvas-control stop     — parar OpenVAS"
echo "  openvas-control start    — iniciar OpenVAS"
echo ""
echo "Acompanhe a configuração da senha:"
echo "  tail -f /var/log/openvas-setup.log"
echo ""
echo "Após concluir, adicione ao .env do BR10 e reinicie o backend:"
echo "  OPENVAS_HOST=127.0.0.1"
echo "  OPENVAS_PORT=9390"
echo "  OPENVAS_USER=admin"
echo "  OPENVAS_PASSWORD=$OPENVAS_ADMIN_PASSWORD"
echo ""

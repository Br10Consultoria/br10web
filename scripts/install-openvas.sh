#!/usr/bin/env bash
# =============================================================
#  BR10 NetManager — Instalação do OpenVAS (Greenbone CE)
#  Usa o registry oficial: registry.community.greenbone.net
#  Roda completamente separado do BR10 (porta 9392)
# =============================================================
set -e

INSTALL_DIR="/opt/openvas-greenbone"
OPENVAS_PASSWORD="${OPENVAS_PASSWORD:-admin123}"
COMPOSE_PROJECT="greenbone-community-edition"

echo ""
echo "============================================================"
echo "  BR10 NetManager — Instalação do OpenVAS (Greenbone CE)"
echo "============================================================"
echo ""
echo "  Diretório de instalação: $INSTALL_DIR"
echo "  Senha do admin OpenVAS:  $OPENVAS_PASSWORD"
echo ""

# ── 1. Criar diretório ──────────────────────────────────────
echo "[1/5] Criando diretório de instalação..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ── 2. Criar docker-compose.yml com imagens corretas ────────
echo "[2/5] Criando docker-compose.yml do OpenVAS..."
cat > "$INSTALL_DIR/docker-compose.yml" << 'COMPOSE_EOF'
name: greenbone-community-edition

services:
  vulnerability-tests:
    image: registry.community.greenbone.net/community/vulnerability-tests
    environment:
      FEED_RELEASE: "24.10"
      KEEP_ALIVE: 1
    volumes:
      - vt_data_vol:/mnt

  notus-data:
    image: registry.community.greenbone.net/community/notus-data
    environment:
      KEEP_ALIVE: 1
    volumes:
      - notus_data_vol:/mnt

  scap-data:
    image: registry.community.greenbone.net/community/scap-data
    environment:
      KEEP_ALIVE: 1
    volumes:
      - scap_data_vol:/mnt

  cert-bund-data:
    image: registry.community.greenbone.net/community/cert-bund-data
    environment:
      KEEP_ALIVE: 1
    volumes:
      - cert_data_vol:/mnt

  dfn-cert-data:
    image: registry.community.greenbone.net/community/dfn-cert-data
    environment:
      KEEP_ALIVE: 1
    volumes:
      - cert_data_vol:/mnt
    depends_on:
      cert-bund-data:
        condition: service_healthy

  data-objects:
    image: registry.community.greenbone.net/community/data-objects
    environment:
      FEED_RELEASE: "24.10"
      KEEP_ALIVE: 1
    volumes:
      - data_objects_vol:/mnt

  report-formats:
    image: registry.community.greenbone.net/community/report-formats
    environment:
      FEED_RELEASE: "24.10"
      KEEP_ALIVE: 1
    volumes:
      - data_objects_vol:/mnt
    depends_on:
      data-objects:
        condition: service_healthy

  gpg-data:
    image: registry.community.greenbone.net/community/gpg-data
    volumes:
      - gpg_data_vol:/mnt

  redis-server:
    image: registry.community.greenbone.net/community/redis-server
    restart: unless-stopped
    volumes:
      - redis_socket_vol:/run/redis/

  pg-gvm-migrator:
    image: registry.community.greenbone.net/community/pg-gvm-migrator:stable
    restart: "no"
    volumes:
      - psql_data_vol:/var/lib/postgresql
      - psql_socket_vol:/var/run/postgresql

  pg-gvm:
    image: registry.community.greenbone.net/community/pg-gvm:stable
    restart: unless-stopped
    volumes:
      - psql_data_vol:/var/lib/postgresql
      - psql_socket_vol:/var/run/postgresql
    depends_on:
      pg-gvm-migrator:
        condition: service_completed_successfully

  gvmd:
    image: registry.community.greenbone.net/community/gvmd:stable
    restart: unless-stopped
    volumes:
      - gvmd_data_vol:/var/lib/gvm
      - scap_data_vol:/var/lib/gvm/scap-data/
      - cert_data_vol:/var/lib/gvm/cert-data
      - data_objects_vol:/var/lib/gvm/data-objects/gvmd
      - vt_data_vol:/var/lib/openvas/plugins
      - psql_data_vol:/var/lib/postgresql
      - gvmd_socket_vol:/run/gvmd
      - ospd_openvas_socket_vol:/run/ospd
      - psql_socket_vol:/var/run/postgresql
    depends_on:
      pg-gvm:
        condition: service_started
      scap-data:
        condition: service_healthy
      cert-bund-data:
        condition: service_healthy
      dfn-cert-data:
        condition: service_healthy
      data-objects:
        condition: service_healthy
      report-formats:
        condition: service_healthy

  gsa:
    image: registry.community.greenbone.net/community/gsa:stable-slim
    environment:
      MOUNT_PATH: "/mnt/web"
      KEEP_ALIVE: 1
    healthcheck:
      test: ["CMD-SHELL", "test -e /run/gsa/copying.done"]
      start_period: 5s
    volumes:
      - gsa_data_vol:/mnt/web

  gsad:
    image: registry.community.greenbone.net/community/gsad:stable
    restart: unless-stopped
    ports:
      - "9392:80"
    environment:
      GSAD_ARGS: "--listen=0.0.0.0 --http-only --no-redirect"
    volumes:
      - gsa_data_vol:/usr/share/gvm/gsad/web/
      - gsad_socket_vol:/run/gsad
    depends_on:
      gvmd:
        condition: service_started
      gsa:
        condition: service_healthy

  ospd-openvas:
    image: registry.community.greenbone.net/community/ospd-openvas:stable
    restart: unless-stopped
    init: true
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
    depends_on:
      redis-server:
        condition: service_started
      gpg-data:
        condition: service_completed_successfully
      vulnerability-tests:
        condition: service_healthy

  mqtt-broker:
    image: registry.community.greenbone.net/community/mqtt-broker
    restart: unless-stopped
    volumes:
      - mqtt_socket_vol:/run/mqtt

  notus-scanner:
    image: registry.community.greenbone.net/community/notus-scanner:stable
    restart: unless-stopped
    volumes:
      - notus_data_vol:/var/lib/notus
      - gpg_data_vol:/etc/openvas/gnupg
    environment:
      NOTUS_SCANNER_MQTT_NAME: notus-scanner
      NOTUS_SCANNER_PRODUCTS_DIRECTORY: /var/lib/notus/products
    depends_on:
      mqtt-broker:
        condition: service_started
      gpg-data:
        condition: service_completed_successfully
      notus-data:
        condition: service_healthy

  gvm-tools:
    image: registry.community.greenbone.net/community/gvm-tools
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
  gvmd_socket_vol:
  psql_socket_vol:
  redis_socket_vol:
  mqtt_socket_vol:
  gsad_socket_vol:
  gsa_data_vol:
COMPOSE_EOF

# ── 3. Baixar imagens ────────────────────────────────────────
echo "[3/5] Baixando imagens do Greenbone Community Edition..."
echo "      (primeira execução baixa ~3-5GB — pode levar vários minutos)"
docker compose -f "$INSTALL_DIR/docker-compose.yml" -p "$COMPOSE_PROJECT" pull

# ── 4. Subir containers em background ───────────────────────
echo "[4/5] Iniciando containers do OpenVAS em background..."
docker compose -f "$INSTALL_DIR/docker-compose.yml" -p "$COMPOSE_PROJECT" up -d

# ── 5. Aguardar gvmd e criar usuário admin ───────────────────
echo "[5/5] Aguardando gvmd inicializar (pode levar 2-5 minutos)..."
CONTAINER_GVMD="${COMPOSE_PROJECT}-gvmd-1"
TIMEOUT=300
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker exec "$CONTAINER_GVMD" gvmd --get-users 2>/dev/null | grep -q admin; then
        echo "      Usuário admin já existe."
        break
    fi
    STATUS=$(docker exec "$CONTAINER_GVMD" gvmd --get-users 2>&1 || true)
    if echo "$STATUS" | grep -q "admin"; then
        break
    fi
    sleep 10
    ELAPSED=$((ELAPSED + 10))
    echo "      Aguardando... ($ELAPSED s)"
done

# Criar/atualizar senha do admin
echo "      Configurando senha do admin..."
docker exec "$CONTAINER_GVMD" gvmd --create-user=admin --password="$OPENVAS_PASSWORD" 2>/dev/null || \
docker exec "$CONTAINER_GVMD" gvmd --user=admin --new-password="$OPENVAS_PASSWORD" 2>/dev/null || \
echo "      (Usuário admin já configurado — senha pode precisar ser definida manualmente)"

# ── Criar script de controle ─────────────────────────────────
cat > /usr/local/bin/openvas-control << CTRL_EOF
#!/usr/bin/env bash
INSTALL_DIR="$INSTALL_DIR"
PROJECT="$COMPOSE_PROJECT"
CMD="\${1:-status}"
case "\$CMD" in
  start)   docker compose -f "\$INSTALL_DIR/docker-compose.yml" -p "\$PROJECT" up -d ;;
  stop)    docker compose -f "\$INSTALL_DIR/docker-compose.yml" -p "\$PROJECT" stop ;;
  restart) docker compose -f "\$INSTALL_DIR/docker-compose.yml" -p "\$PROJECT" restart ;;
  status)  docker compose -f "\$INSTALL_DIR/docker-compose.yml" -p "\$PROJECT" ps ;;
  logs)    docker compose -f "\$INSTALL_DIR/docker-compose.yml" -p "\$PROJECT" logs -f --tail=50 ;;
  update)  docker compose -f "\$INSTALL_DIR/docker-compose.yml" -p "\$PROJECT" pull && \
           docker compose -f "\$INSTALL_DIR/docker-compose.yml" -p "\$PROJECT" up -d ;;
  *)       echo "Uso: openvas-control {start|stop|restart|status|logs|update}" ;;
esac
CTRL_EOF
chmod +x /usr/local/bin/openvas-control

echo ""
echo "============================================================"
echo "  OpenVAS instalado com sucesso!"
echo "============================================================"
echo ""
echo "  Interface web: http://$(hostname -I | awk '{print $1}'):9392"
echo "  Usuário:       admin"
echo "  Senha:         $OPENVAS_PASSWORD"
echo ""
echo "  Comandos de controle:"
echo "    openvas-control status   — ver status dos containers"
echo "    openvas-control start    — iniciar OpenVAS"
echo "    openvas-control stop     — parar OpenVAS"
echo "    openvas-control logs     — ver logs em tempo real"
echo "    openvas-control update   — atualizar feeds e imagens"
echo ""
echo "  IMPORTANTE: Configure o .env do BR10 com:"
echo "    OPENVAS_HOST=127.0.0.1"
echo "    OPENVAS_PORT=9390"
echo "    OPENVAS_USER=admin"
echo "    OPENVAS_PASSWORD=$OPENVAS_PASSWORD"
echo ""
echo "  Depois reinicie o backend:"
echo "    cd /opt/br10web && docker compose restart backend"
echo ""

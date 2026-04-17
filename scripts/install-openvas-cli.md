# OpenVAS / GVM — Instalação Mínima (CLI Only, sem Interface Web)

> **Objetivo:** Rodar o OpenVAS como um serviço de varredura acessível via socket Unix
> (`/run/gvmd/gvmd.sock`) ou TCP, consumido pelo BR10 via `python-gvm`, **sem** subir
> a interface web GSA/nginx. Isso mantém o consumo de recursos menor e não interfere
> nos demais serviços do servidor.

---

## Requisitos de Hardware

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disco | 20 GB livres | 60 GB livres |

> O banco de NVTs (vulnerabilidades) ocupa ~15 GB após sincronização completa.
> O OpenVAS roda em um **stack Docker separado** do BR10, sem compartilhar rede ou volumes.

---

## Arquitetura dos Serviços Necessários

Para uso exclusivo via CLI/API (sem interface web), apenas os seguintes containers
precisam estar em execução:

```
redis-server       → cache de dados VT e resultados de scan
pg-gvm             → banco PostgreSQL do gvmd
pg-gvm-migrator    → migração de schema (roda uma vez e para)
gpg-data           → chaves GPG para verificar feeds
vulnerability-tests → feed de plugins NVT (~140k testes)
notus-data         → feed de advisories Notus (LSC)
scap-data          → dados SCAP/CVE
cert-bund-data     → dados CERT-Bund
dfn-cert-data      → dados DFN-CERT
data-objects       → objetos de configuração
report-formats     → formatos de relatório
configure-openvas  → configura openvas.conf (roda uma vez e para)
openvasd           → daemon do scanner (modo service_notus)
ospd-openvas       → protocolo OSP entre gvmd e openvas
gvmd               → gerenciador central (expõe o socket GMP)
gvm-tools          → container com gvm-cli para testes manuais
```

**Containers que NÃO precisam subir (interface web):**
- `gsa` — frontend React da interface web
- `gsad` — servidor HTTP da interface web
- `gvm-config` — gera certificados TLS para nginx
- `nginx` — proxy reverso da interface web

---

## Instalação

### 1. Instalar Docker (se ainda não instalado)

```bash
# Ubuntu 22.04 / 24.04
sudo apt update
sudo apt install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

### 2. Criar diretório e baixar o compose oficial

```bash
export OPENVAS_DIR=/opt/openvas-gvm
sudo mkdir -p $OPENVAS_DIR
cd $OPENVAS_DIR

curl -fsSL https://greenbone.github.io/docs/latest/_static/compose.yaml \
  -o compose.yaml
```

### 3. Criar o compose mínimo (sem interface web)

Crie o arquivo `/opt/openvas-gvm/compose-cli-only.yml` com o conteúdo abaixo.
Este arquivo **omite** `gsa`, `gsad`, `gvm-config` e `nginx`.

```yaml
# /opt/openvas-gvm/compose-cli-only.yml
# OpenVAS GVM — Stack mínimo para uso via CLI/API (sem interface web)
# Compatível com BR10 NetManager via python-gvm

name: openvas-cli

services:

  # ── Feeds de dados ─────────────────────────────────────────────────────────
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

  # ── Infraestrutura ─────────────────────────────────────────────────────────
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

  # ── Scanner ────────────────────────────────────────────────────────────────
  configure-openvas:
    image: registry.community.greenbone.net/community/openvas-scanner:stable
    volumes:
      - openvas_data_vol:/mnt
      - openvas_log_data_vol:/var/log/openvas
    command:
      - /bin/sh
      - -c
      - |
        printf "table_driven_lsc = yes\nopenvasd_server = http://openvasd:80\n" > /mnt/openvas.conf
        sed "s/127/128/" /etc/openvas/openvas_log.conf | sed 's/gvm/openvas/' > /mnt/openvas_log.conf
        chmod 644 /mnt/openvas.conf /mnt/openvas_log.conf
        touch /var/log/openvas/openvas.log
        chmod 666 /var/log/openvas/openvas.log

  openvasd:
    image: registry.community.greenbone.net/community/openvas-scanner:stable
    restart: unless-stopped
    environment:
      OPENVASD_MODE: service_notus
      GNUPGHOME: /etc/openvas/gnupg
      LISTENING: 0.0.0.0:80
    volumes:
      - openvas_data_vol:/etc/openvas
      - openvas_log_data_vol:/var/log/openvas
      - gpg_data_vol:/etc/openvas/gnupg
      - notus_data_vol:/var/lib/notus
    depends_on:
      vulnerability-tests:
        condition: service_healthy
      notus-data:
        condition: service_healthy
      configure-openvas:
        condition: service_completed_successfully
      gpg-data:
        condition: service_completed_successfully
    networks:
      default:
        aliases:
          - openvasd

  ospd-openvas:
    image: registry.community.greenbone.net/community/ospd-openvas:stable
    restart: unless-stopped
    hostname: ospd-openvas.local
    cap_add:
      - NET_ADMIN
      - NET_RAW
    security_opt:
      - seccomp=unconfined
      - apparmor=unconfined
    command:
      - ospd-openvas
      - -f
      - --config
      - /etc/gvm/ospd-openvas.conf
      - --notus-feed-dir
      - /var/lib/notus/advisories
      - -m
      - "666"
    volumes:
      - gpg_data_vol:/etc/openvas/gnupg
      - vt_data_vol:/var/lib/openvas/plugins
      - notus_data_vol:/var/lib/notus
      - ospd_openvas_socket_vol:/run/ospd
      - redis_socket_vol:/run/redis/
      - openvas_data_vol:/etc/openvas/
      - openvas_log_data_vol:/var/log/openvas
    depends_on:
      redis-server:
        condition: service_started
      gpg-data:
        condition: service_completed_successfully
      configure-openvas:
        condition: service_completed_successfully
      vulnerability-tests:
        condition: service_healthy
      notus-data:
        condition: service_healthy

  # ── Gerenciador GVM (expõe o socket GMP) ───────────────────────────────────
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
      - gvmd_socket_vol:/run/gvmd          # ← socket GMP usado pelo BR10
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

  # ── Ferramentas CLI (opcional, para testes manuais) ────────────────────────
  gvm-tools:
    image: registry.community.greenbone.net/community/gvm-tools
    volumes:
      - gvmd_socket_vol:/run/gvmd
      - ospd_openvas_socket_vol:/run/ospd
    depends_on:
      - gvmd
      - ospd-openvas
    profiles:
      - tools   # só sobe com: docker compose --profile tools up gvm-tools

volumes:
  gpg_data_vol:
  scap_data_vol:
  cert_data_vol:
  data_objects_vol:
  gvmd_data_vol:
  psql_data_vol:
  vt_data_vol:
  notus_data_vol:
  psql_socket_vol:
  gvmd_socket_vol:
  ospd_openvas_socket_vol:
  redis_socket_vol:
  openvas_data_vol:
  openvas_log_data_vol:
```

### 4. Subir o stack

```bash
cd /opt/openvas-gvm

# Primeira vez: baixar imagens e sincronizar feeds (~15 GB, pode demorar 30-60 min)
docker compose -f compose-cli-only.yml up -d

# Acompanhar sincronização dos feeds
docker compose -f compose-cli-only.yml logs -f vulnerability-tests notus-data scap-data
```

### 5. Criar usuário admin

```bash
# Aguardar gvmd estar pronto (pode levar 2-5 min na primeira vez)
docker compose -f compose-cli-only.yml exec -u gvmd gvmd \
  gvmd --create-user=admin --password=SUA_SENHA_AQUI

# Verificar que o usuário foi criado
docker compose -f compose-cli-only.yml exec -u gvmd gvmd \
  gvmd --get-users
```

### 6. Expor o socket GMP para o BR10

O socket `/run/gvmd/gvmd.sock` fica dentro do volume Docker `openvas-cli_gvmd_socket_vol`.
Para que o backend do BR10 acesse via `python-gvm`, há duas opções:

**Opção A — Socket Unix compartilhado (recomendado, mais seguro):**

Adicione ao `docker-compose.yml` do BR10 (serviço `backend`):

```yaml
# No docker-compose.yml do BR10, serviço backend:
volumes:
  - openvas-cli_gvmd_socket_vol:/run/gvmd   # volume externo do OpenVAS
```

E no `.env` do BR10:
```env
GVM_SOCKET=/run/gvmd/gvmd.sock
OPENVAS_USER=admin
OPENVAS_PASSWORD=SUA_SENHA_AQUI
```

**Opção B — TCP (quando OpenVAS está em outro servidor):**

Adicione ao serviço `gvmd` no compose do OpenVAS:
```yaml
ports:
  - "127.0.0.1:9390:9390"
```

E no `.env` do BR10:
```env
OPENVAS_HOST=127.0.0.1
OPENVAS_PORT=9390
OPENVAS_USER=admin
OPENVAS_PASSWORD=SUA_SENHA_AQUI
```

### 7. Instalar python-gvm no container do BR10

```bash
# No servidor, dentro do container backend do BR10:
docker compose exec backend pip install python-gvm

# Ou adicionar ao requirements.txt do backend:
echo "python-gvm>=23.0.0" >> /opt/br10web/backend/requirements.txt
docker compose up -d --build backend
```

### 8. Testar a conexão via CLI

```bash
# Usar o container gvm-tools para testar
docker compose -f /opt/openvas-gvm/compose-cli-only.yml \
  --profile tools run --rm gvm-tools \
  gvm-cli --gmp-username admin --gmp-password SUA_SENHA_AQUI \
  socket --socketpath /run/gvmd/gvmd.sock \
  --xml "<get_version/>"
```

Resposta esperada:
```xml
<get_version_response status="200" status_text="OK">
  <version>22.x</version>
</get_version_response>
```

---

## Controle do Stack OpenVAS

```bash
# Iniciar
docker compose -f /opt/openvas-gvm/compose-cli-only.yml up -d

# Parar (sem remover dados)
docker compose -f /opt/openvas-gvm/compose-cli-only.yml stop

# Status
docker compose -f /opt/openvas-gvm/compose-cli-only.yml ps

# Logs em tempo real
docker compose -f /opt/openvas-gvm/compose-cli-only.yml logs -f gvmd ospd-openvas

# Atualizar feeds de vulnerabilidades
docker compose -f /opt/openvas-gvm/compose-cli-only.yml \
  run --rm vulnerability-tests
```

---

## Verificação de Disponibilidade pelo BR10

Após subir o stack, o painel do BR10 mostrará o botão **OpenVAS** como ativo
(verde) na tela de Nova Varredura. Você pode verificar manualmente via API:

```bash
curl -s http://localhost:8000/api/v1/vuln-scanner/openvas/status \
  -H "Authorization: Bearer SEU_TOKEN"
```

Resposta esperada:
```json
{"available": true, "version": "22.x"}
```

---

## Isolamento — Não Interfere nos Demais Serviços

| Recurso | BR10 | OpenVAS CLI |
|---|---|---|
| Rede Docker | `br10web_default` | `openvas-cli_default` |
| Banco de dados | MySQL/TiDB (porta 3306) | PostgreSQL interno (socket) |
| Redis | Redis do BR10 (porta 6379) | Redis próprio (socket) |
| Portas expostas | 80/443 (nginx) | **Nenhuma** (socket Unix) |
| Interface web | Painel BR10 | **Nenhuma** |

O OpenVAS CLI não expõe nenhuma porta na rede do host por padrão.
A comunicação com o BR10 é feita exclusivamente via socket Unix compartilhado.

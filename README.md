# BR10 NetManager

> Sistema profissional de gerenciamento de dispositivos de rede — BR10 Consultoria

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11-blue)](https://python.org)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)](https://docker.com)

---

## Visão Geral

O **BR10 NetManager** é um sistema web completo para gerenciamento centralizado de dispositivos de rede. Oferece interface responsiva para mobile e desktop, terminal web interativo (SSH/Telnet), gerenciamento de VPN L2TP com rotas estáticas, e backup automático de dados.

### Dispositivos Suportados

| Dispositivo | SSH | Telnet | Web | Winbox | Console |
|---|---|---|---|---|---|
| Huawei NE8000 | ✅ | ✅ | — | — | ✅ |
| Huawei 6730 | ✅ | ✅ | — | — | ✅ |
| Datacom | ✅ | ✅ | — | — | ✅ |
| VSOL OLT | ✅ | ✅ | ✅ | — | ✅ |
| Mikrotik | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cisco / Juniper | ✅ | ✅ | — | — | ✅ |
| Genérico | ✅ | ✅ | — | — | — |

---

## Funcionalidades

### Segurança
- Autenticação JWT com refresh token automático
- Autenticação em dois fatores (TOTP — Google Authenticator, Authy)
- Senhas com hash Argon2/bcrypt (rounds configuráveis)
- Senhas de dispositivos criptografadas com Fernet (AES-128)
- Rate limiting por IP (login: 5/min, API: 30/min)
- Headers de segurança (HSTS, CSP, X-Frame-Options)
- Auditoria completa de ações dos usuários
- Controle de acesso por função (Admin, Técnico, Visualizador)

### Dispositivos
- Cadastro completo: IP, hostname, tipo, fabricante, modelo, firmware
- Gerenciamento de VLANs com IP, gateway e status
- Gerenciamento de portas com tipo, velocidade e VLAN
- Upload de fotos e documentação
- Credenciais adicionais por dispositivo (SSH, Telnet, SNMP, API, Web, Winbox)
- Tags e notas personalizadas
- Monitoramento: uptime, CPU, memória, último acesso

### Terminal Web
- SSH interativo via WebSocket (xterm.js)
- Telnet interativo via WebSocket
- Suporte a redimensionamento de janela
- Histórico de sessões

### VPN L2TP
- Configuração completa de túneis L2TP
- Suporte a IPSec (PSK e certificados)
- Rotas estáticas por conexão VPN ativa
- Autenticação PAP/CHAP/MS-CHAPv2

### Backup
- Backup automático diário (02:00)
- Backup manual sob demanda
- Download de backups
- Restauração de backups
- Limpeza automática por retenção configurável

### API REST
- Documentação OpenAPI/Swagger em `/api/docs`
- ReDoc em `/api/redoc`
- Autenticação via Bearer Token
- Paginação, filtros e ordenação

---

## Arquitetura

```
br10web/
├── backend/                # FastAPI + SQLAlchemy + PostgreSQL
│   ├── app/
│   │   ├── api/v1/         # Endpoints REST + WebSocket
│   │   ├── core/           # Config, Database, Security
│   │   ├── models/         # Modelos SQLAlchemy
│   │   ├── schemas/        # Schemas Pydantic
│   │   └── services/       # Lógica de negócio (Terminal, Backup)
│   ├── alembic/            # Migrations do banco de dados
│   └── requirements.txt
├── frontend/               # React + TypeScript + TailwindCSS
│   ├── src/
│   │   ├── pages/          # Páginas da aplicação
│   │   ├── components/     # Componentes reutilizáveis
│   │   ├── store/          # Estado global (Zustand)
│   │   └── utils/          # API client, helpers
│   └── package.json
├── nginx/                  # Configuração do proxy reverso
│   ├── nginx.conf
│   └── conf.d/
├── scripts/                # Scripts de instalação e manutenção
│   ├── install.sh          # Instalação completa
│   ├── backup.sh           # Backup manual
│   ├── deploy.sh           # Deploy/atualização
│   └── create_admin.py     # Criar usuário admin inicial
└── docker-compose.yml      # Orquestração de containers
```

---

## Instalação Rápida (Produção)

### Pré-requisitos
- Ubuntu 22.04 LTS
- Domínio apontando para o servidor: `br10web.br10consultoria.com.br`
- Acesso root ao servidor

### 1. Clonar e instalar

```bash
git clone https://github.com/Br10Consultoria/br10web.git /opt/br10web
cd /opt/br10web
sudo bash scripts/install.sh
```

O script de instalação realiza automaticamente:
1. Atualização do sistema
2. Instalação do Docker e Docker Compose
3. Configuração do firewall (UFW)
4. Geração de chaves seguras
5. Configuração do SSL/TLS (Let's Encrypt)
6. Inicialização dos containers
7. Criação do usuário administrador inicial

### 2. Configuração manual (alternativa)

```bash
# Copiar e editar variáveis de ambiente
cp backend/.env.example .env
nano .env

# Gerar chaves seguras
python3 -c "import secrets; print(secrets.token_hex(32))"  # SECRET_KEY
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # ENCRYPTION_KEY

# Iniciar containers
docker-compose up -d

# Criar usuário admin
docker-compose exec backend python scripts/create_admin.py
```

---

## Variáveis de Ambiente

| Variável | Descrição | Exemplo |
|---|---|---|
| `SECRET_KEY` | Chave JWT (mín. 32 chars) | `abc123...` |
| `ENCRYPTION_KEY` | Chave Fernet para senhas | `base64key==` |
| `DB_PASSWORD` | Senha do PostgreSQL | `senha_segura` |
| `REDIS_PASSWORD` | Senha do Redis | `redis_pass` |
| `ALLOWED_ORIGINS` | Origens CORS permitidas | `https://br10web...` |
| `BACKUP_RETENTION_DAYS` | Dias de retenção de backup | `30` |
| `BCRYPT_ROUNDS` | Rounds do bcrypt (10-14) | `12` |

---

## Perfis de Usuário

| Perfil | Visualizar | Criar/Editar | Remover | Admin |
|---|---|---|---|---|
| **Visualizador** | ✅ | ❌ | ❌ | ❌ |
| **Técnico** | ✅ | ✅ | ❌ | ❌ |
| **Administrador** | ✅ | ✅ | ✅ | ✅ |

---

## API Endpoints

### Autenticação
```
POST   /api/v1/auth/login          # Login com 2FA
POST   /api/v1/auth/refresh        # Renovar token
POST   /api/v1/auth/logout         # Logout
GET    /api/v1/auth/me             # Dados do usuário atual
POST   /api/v1/auth/2fa/setup      # Configurar 2FA
POST   /api/v1/auth/2fa/verify     # Verificar e ativar 2FA
POST   /api/v1/auth/2fa/disable    # Desativar 2FA
POST   /api/v1/auth/change-password
GET    /api/v1/auth/users          # Listar usuários (admin)
POST   /api/v1/auth/users          # Criar usuário (admin)
PUT    /api/v1/auth/users/{id}     # Atualizar usuário (admin)
DELETE /api/v1/auth/users/{id}     # Remover usuário (admin)
```

### Dispositivos
```
GET    /api/v1/devices             # Listar dispositivos
POST   /api/v1/devices             # Criar dispositivo
GET    /api/v1/devices/{id}        # Detalhes do dispositivo
PUT    /api/v1/devices/{id}        # Atualizar dispositivo
DELETE /api/v1/devices/{id}        # Remover dispositivo
GET    /api/v1/devices/stats       # Estatísticas
GET    /api/v1/devices/{id}/vlans  # VLANs do dispositivo
POST   /api/v1/devices/{id}/vlans
GET    /api/v1/devices/{id}/ports  # Portas do dispositivo
POST   /api/v1/devices/{id}/ports
GET    /api/v1/devices/{id}/photos # Fotos
POST   /api/v1/devices/{id}/photos # Upload de foto
GET    /api/v1/devices/{id}/credentials
POST   /api/v1/devices/{id}/credentials
```

### VPN e Rotas
```
GET    /api/v1/devices/{id}/vpn    # Configurações VPN
POST   /api/v1/devices/{id}/vpn    # Nova VPN L2TP
PUT    /api/v1/devices/{id}/vpn/{vpn_id}
DELETE /api/v1/devices/{id}/vpn/{vpn_id}
GET    /api/v1/devices/{id}/routes # Rotas estáticas
POST   /api/v1/devices/{id}/routes
PUT    /api/v1/devices/{id}/routes/{route_id}
DELETE /api/v1/devices/{id}/routes/{route_id}
```

### Terminal
```
WS     /api/v1/terminal/ws/{device_id}?protocol=ssh&token=...
```

### Backup
```
GET    /api/v1/backup              # Listar backups
POST   /api/v1/backup/create       # Criar backup
GET    /api/v1/backup/download/{filename}
POST   /api/v1/backup/restore/{filename}
DELETE /api/v1/backup/{filename}
```

---

## Manutenção

### Backup manual
```bash
docker-compose exec backend python -c "
from app.services.backup import BackupService
import asyncio
asyncio.run(BackupService.create_backup())
"
```

### Atualizar sistema
```bash
cd /opt/br10web
sudo bash scripts/deploy.sh
```

### Logs
```bash
docker-compose logs -f backend    # Logs do backend
docker-compose logs -f nginx      # Logs do Nginx
docker-compose logs -f db         # Logs do PostgreSQL
```

### Acesso ao banco de dados
```bash
docker-compose exec db psql -U br10user -d br10netmanager
```

---

## Segurança — Boas Práticas

1. **Altere as senhas padrão** imediatamente após a instalação
2. **Ative o 2FA** para todos os usuários administradores
3. **Mantenha o sistema atualizado** com `sudo bash scripts/deploy.sh`
4. **Configure backups externos** além do backup local
5. **Monitore os logs de auditoria** regularmente
6. **Use senhas fortes** para dispositivos (mínimo 12 caracteres)
7. **Restrinja o acesso** ao servidor via firewall (portas 80, 443 e SSH apenas)

---

## Suporte

- **E-mail**: ti@br10consultoria.com.br
- **Site**: https://br10consultoria.com.br
- **Domínio do sistema**: https://br10web.br10consultoria.com.br

---

## Licença

Copyright © 2025 BR10 Consultoria. Todos os direitos reservados.

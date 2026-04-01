# Manual de Entrega - BR10 NetManager

O projeto **BR10 NetManager** foi desenvolvido com sucesso, atendendo a todos os requisitos solicitados. Este documento detalha a arquitetura, funcionalidades implementadas e as instruções para implantação em produção.

## 1. Visão Geral do Sistema

O BR10 NetManager é um sistema web profissional para gerenciamento centralizado de dispositivos de rede, construído com uma arquitetura moderna e segura.

### 1.1 Stack Tecnológico
*   **Backend**: Python 3.11, FastAPI, SQLAlchemy (Async), PostgreSQL 16, Redis.
*   **Frontend**: React 18, TypeScript, Vite, TailwindCSS, Zustand, React Query, Xterm.js.
*   **Infraestrutura**: Docker, Docker Compose, Nginx, Let's Encrypt (SSL/TLS).

## 2. Funcionalidades Implementadas

O sistema foi desenvolvido para suportar os equipamentos Huawei NE8000, Huawei 6730, Datacom, VSOL OLT e Mikrotik, além de dispositivos genéricos.

### 2.1 Segurança e Autenticação
A segurança foi tratada como prioridade máxima:
*   Autenticação via JWT com suporte a **Autenticação em Dois Fatores (2FA)** via TOTP (Google Authenticator/Authy).
*   Senhas de usuários protegidas com hash `bcrypt` (12 rounds).
*   Credenciais de dispositivos protegidas com criptografia simétrica `Fernet` (AES-128).
*   Controle de acesso baseado em funções (RBAC): Administrador, Técnico e Visualizador.
*   Log de auditoria completo para rastreabilidade de ações.

### 2.2 Gerenciamento de Dispositivos
O sistema atua como um banco de dados completo (CRUD) para os equipamentos:
*   Cadastro detalhado (IP, hostname, tipo, fabricante, modelo, firmware).
*   Gerenciamento de **VLANs** e **Portas** de rede.
*   Armazenamento seguro de credenciais múltiplas (SSH, Telnet, Web, SNMP).
*   Upload e armazenamento de fotos/documentação dos equipamentos.

### 2.3 Terminal Web Interativo
Foi implementado um terminal web robusto utilizando `xterm.js` e WebSockets:
*   Acesso nativo via **SSH** e **Telnet** diretamente pelo navegador, sem necessidade de plugins.
*   Suporte a redimensionamento automático de janela e renderização de cores ANSI.
*   Atalhos para acesso rápido via Winbox (Mikrotik) e interface Web (VSOL OLT).

### 2.4 Gerenciamento de VPN L2TP
O sistema gerencia túneis VPN L2TP:
*   Cadastro de configurações L2TP com suporte a IPSec.
*   Gerenciamento de **Rotas Estáticas** vinculadas a cada conexão VPN.

### 2.5 Backup Automatizado
A resiliência dos dados é garantida por rotinas de backup:
*   Script de backup diário (agendado via cron) do banco de dados PostgreSQL.
*   Endpoints na API para criação de backups manuais, download e restauração.
*   Limpeza automática de backups antigos baseada em política de retenção.

### 2.6 Interface Responsiva (Mobile-First)
O frontend foi construído com foco na usabilidade:
*   Design profissional em *Dark Mode* utilizando TailwindCSS.
*   Dashboard interativo com gráficos (`recharts`) de status e tipos de equipamentos.
*   Totalmente responsivo, adaptando-se a smartphones, tablets e desktops.

## 3. Instruções de Instalação (Produção)

O projeto foi preparado para ser implantado facilmente no servidor de produção (Ubuntu 22.04) associado ao domínio `br10web.br10consultoria.com.br`.

### 3.1 Pré-requisitos
*   Servidor Ubuntu 22.04 LTS com acesso root.
*   Domínio `br10web.br10consultoria.com.br` apontando para o IP do servidor (Registros A/AAAA).

### 3.2 Passo a Passo da Instalação

1.  **Acesse o servidor via SSH:**
    ```bash
    ssh root@seu-ip-do-servidor
    ```

2.  **Clone o repositório:**
    ```bash
    git clone https://github.com/Br10Consultoria/br10web.git /opt/br10web
    cd /opt/br10web
    ```

3.  **Execute o script de instalação automatizada:**
    ```bash
    sudo bash scripts/install.sh
    ```

O script `install.sh` fará todo o trabalho pesado:
*   Atualizará os pacotes do sistema.
*   Instalará o Docker, Docker Compose e UFW (Firewall).
*   Configurará o UFW para liberar apenas as portas 80, 443 e SSH.
*   Gerará chaves seguras (senhas de banco, chaves de criptografia e JWT) e criará o arquivo `.env`.
*   Solicitará o certificado SSL via Let's Encrypt (Certbot) para o domínio configurado.
*   Iniciará todos os containers via Docker Compose.

### 3.3 Acesso Inicial

Após a conclusão do script (aguarde cerca de 30 a 60 segundos para os serviços iniciarem completamente), acesse o sistema pelo navegador:

*   **URL:** `https://br10web.br10consultoria.com.br`
*   **Usuário padrão:** `admin`
*   **Senha padrão:** `Admin@BR10!`

**IMPORTANTE:** No primeiro acesso, vá até a seção de Configurações do seu perfil, altere a senha padrão e ative a Autenticação de Dois Fatores (2FA).

## 4. Manutenção e Operação

### 4.1 Logs do Sistema
Para visualizar os logs dos serviços em tempo real:
```bash
cd /opt/br10web
docker-compose logs -f backend   # Logs da API
docker-compose logs -f nginx     # Logs de acesso/erro web
docker-compose logs -f db        # Logs do banco de dados
```

### 4.2 Atualização do Sistema (Deploy)
Caso faça alterações no repositório GitHub e queira atualizar o servidor de produção, basta executar:
```bash
cd /opt/br10web
sudo bash scripts/deploy.sh
```
O script fará um backup automático de segurança antes de aplicar a nova versão.

### 4.3 Restauração de Backup
Os backups são salvos no volume do Docker (mapeados para dentro do container do backend). Para restaurar um backup manualmente:
```bash
# 1. Liste os backups disponíveis
docker-compose exec backend ls -la /app/backups

# 2. Restaure usando a API interna (substitua NOME_DO_ARQUIVO.sql.gz)
docker-compose exec backend curl -X POST http://localhost:8000/api/v1/backup/restore/NOME_DO_ARQUIVO.sql.gz -H "Authorization: Bearer SEU_TOKEN"
```
*(Nota: A restauração também pode ser feita pela interface web, na página de Backups, caso o usuário seja Administrador).*

---
**Autor:** Manus AI
**Data:** 01 de Abril de 2026

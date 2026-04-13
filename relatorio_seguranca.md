# Relatório de Segurança e Hardening: BR10 NetManager

Este documento apresenta uma análise técnica da postura de segurança atual do sistema BR10 NetManager, identificando vetores de ataque potenciais e recomendando medidas de mitigação. A análise é baseada na inspeção direta do código-fonte do backend (FastAPI), configurações de rede, mecanismos de autenticação e manipulação de dados sensíveis.

## 1. Postura de Segurança Atual

O sistema BR10 NetManager já implementa diversas camadas de proteção fundamentais que o colocam acima da média em termos de segurança base. Entre as proteções já ativas, destacam-se:

**Autenticação e Autorização Fortes**
O sistema utiliza autenticação baseada em tokens JWT (JSON Web Tokens) de curta duração, complementada por tokens de atualização (refresh tokens) de longa duração. O armazenamento de senhas é realizado utilizando o algoritmo `bcrypt` com *salt* dinâmico, o que protege contra ataques de dicionário e *rainbow tables*. Além disso, a implementação recente do controle de acesso granular permite restringir as ações dos usuários por módulo e por escopo de clientes, minimizando o impacto de contas comprometidas. A autenticação de dois fatores (2FA) via TOTP já está integrada e funcional.

**Proteção contra Ataques de Força Bruta**
O módulo de autenticação implementa um mecanismo de bloqueio de contas (*account lockout*). Após cinco tentativas de login malsucedidas consecutivas, a conta é bloqueada por 30 minutos, mitigando ataques automatizados de adivinhação de senhas.

**Criptografia de Dados Sensíveis em Repouso**
As credenciais dos dispositivos de rede (senhas de SSH, Telnet, SNMP) não são armazenadas em texto plano no banco de dados. O sistema utiliza criptografia simétrica AES (via biblioteca `cryptography.fernet`) para proteger esses campos sensíveis, garantindo que um vazamento direto do banco de dados não exponha as credenciais dos equipamentos de infraestrutura.

**Proteções no Nível HTTP**
O `main.py` configura *security headers* importantes em todas as respostas HTTP, incluindo `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` (prevenindo *Clickjacking*), e `X-XSS-Protection: 1; mode=block`. Em ambientes de produção, o sistema também ativa o cabeçalho *Strict-Transport-Security* (HSTS) para forçar o uso de HTTPS.

## 2. Vetores de Ataque e Vulnerabilidades Identificadas

Apesar das boas práticas implementadas, a arquitetura atual apresenta algumas superfícies de ataque que podem ser exploradas caso um invasor obtenha acesso inicial ou intercepte tráfego de rede.

### 2.1. Exposição do Terminal Web e Tokens na URL

A funcionalidade de Terminal Web (SSH/Telnet via navegador) utiliza WebSockets para estabelecer a conexão interativa. No código atual (`/api/v1/terminal.py`), o token JWT de autenticação é passado via parâmetro de *query string* (`?token=...`) em vez de cabeçalho de autorização.

Esta prática é considerada um risco de segurança significativo. Tokens passados em URLs frequentemente acabam registrados em logs de acesso de servidores web (como Nginx ou Apache), proxies reversos, firewalls corporativos e no histórico do navegador do usuário. Se um invasor obtiver acesso a qualquer um desses logs, ele poderá extrair o token JWT e personificar o usuário, ganhando acesso direto ao terminal dos equipamentos de rede.

### 2.2. Acesso Direto a Diretórios Estáticos de Upload

O arquivo `main.py` monta o diretório de uploads diretamente como uma rota estática: `app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")`.

Isso significa que qualquer arquivo salvo neste diretório pode ser acessado diretamente por qualquer pessoa na internet que conheça (ou adivinhe) o caminho do arquivo, sem passar por nenhuma verificação de autenticação ou autorização. Se o sistema armazenar backups, relatórios exportados, configurações de dispositivos ou outros documentos sensíveis nesta pasta, eles estão suscetíveis a vazamento direto.

### 2.3. Execução de Comandos em Dispositivos (Command Injection e SSRF)

O sistema possui capacidades extensas de execução de comandos em dispositivos remotos (módulos de Playbooks, Terminal e Network Tools). Embora o módulo `device_inspector.py` implemente uma lista de comandos permitidos (whitelist) para leitura, outras áreas do sistema permitem a injeção de comandos arbitrários.

Se um usuário com permissões de execução tiver sua conta comprometida, o invasor poderá utilizar o BR10 NetManager como uma plataforma de salto (*jump host*) para atacar a infraestrutura interna da rede. Além disso, as ferramentas de diagnóstico (Ping, Traceroute) podem ser abusadas para realizar reconhecimento de rede interna (*Server-Side Request Forgery* - SSRF), mapeando servidores que não deveriam ser acessíveis externamente.

### 2.4. Ausência de Validação de Host Keys SSH

No módulo `command_runner.py` e nos conectores de terminal, a biblioteca Paramiko é configurada com `AutoAddPolicy()`. Isso significa que o sistema aceita automaticamente a chave de host de qualquer servidor SSH ao qual se conecta, sem verificar se a chave é autêntica.

Essa configuração deixa as conexões do sistema vulneráveis a ataques *Man-in-the-Middle* (MITM). Um invasor na mesma rede que o servidor do BR10 NetManager poderia interceptar a conexão SSH direcionada a um roteador, apresentar uma chave falsa, capturar as credenciais descriptografadas enviadas pelo sistema e, em seguida, repassá-las ao roteador real, obtendo controle total sem ser detectado.

### 2.5. Exposição da Documentação da API

A documentação interativa da API (Swagger UI em `/api/docs` e ReDoc em `/api/redoc`) está exposta publicamente. Embora a documentação em si não seja uma vulnerabilidade, ela fornece a um potencial invasor um mapa completo de todos os *endpoints*, parâmetros aceitos e estruturas de dados do sistema, facilitando enormemente a descoberta de vetores de ataque.

## 3. Recomendações de Hardening e Mitigação

Para elevar a segurança do sistema a um padrão de grau corporativo e proteger os dados dos clientes contra vazamentos, recomenda-se a implementação das seguintes medidas.

### 3.1. Restrição de Acesso por IP (Whitelist)

Conforme mencionado na solicitação, limitar o acesso ao servidor apenas a endereços IP confiáveis é uma das defesas mais eficazes contra ataques externos.

**Como implementar:**
A restrição de IP não deve ser feita na aplicação FastAPI, mas sim na camada de infraestrutura (Firewall ou Proxy Reverso). Se o sistema utiliza Nginx como proxy reverso, a configuração deve incluir blocos `allow` e `deny`:

```nginx
server {
    listen 443 ssl;
    server_name br10web.br10consultoria.com.br;

    # Permitir apenas IPs específicos (Escritório, VPN, etc.)
    allow 203.0.113.50;  # Exemplo de IP fixo do escritório
    allow 198.51.100.0/24; # Exemplo de bloco de IPs da VPN corporativa
    deny all; # Bloquear todo o resto

    location / {
        proxy_pass http://localhost:8000;
        # ... outras configurações de proxy
    }
}
```

Alternativamente, essa restrição pode ser aplicada diretamente no firewall do servidor (UFW ou iptables) ou no *Security Group* do provedor de nuvem (AWS, DigitalOcean, etc.), bloqueando o acesso à porta 443 para todos, exceto os IPs autorizados.

### 3.2. Proteção de Rotas WebSocket e Estáticas

Para mitigar o risco de vazamento de tokens nas URLs do Terminal Web, a arquitetura deve ser alterada para utilizar *Tickets de Sessão de Uso Único*. Em vez de enviar o JWT de longa duração na URL, o frontend deve solicitar um *ticket* temporário (válido por 10 segundos) via POST autenticado, e então usar esse ticket descartável na URL do WebSocket.

Para os arquivos estáticos, a montagem direta do diretório `/uploads` deve ser removida. O acesso aos arquivos deve ser mediado por um *endpoint* da API (ex: `GET /api/v1/files/{filename}`) que verifica a autenticação e as permissões do usuário antes de retornar o arquivo utilizando `FileResponse`.

### 3.3. Ocultação da Documentação em Produção

A documentação da API deve ser desativada no ambiente de produção. Isso pode ser feito ajustando a inicialização do FastAPI no `main.py` para condicionar a exibição da documentação à variável de ambiente `DEBUG`:

```python
app = FastAPI(
    title=settings.APP_NAME,
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url="/api/redoc" if settings.DEBUG else None,
    openapi_url="/api/openapi.json" if settings.DEBUG else None,
    # ...
)
```

### 3.4. Reforço nas Conexões SSH

Para proteger contra ataques MITM, o sistema deve abandonar a política `AutoAddPolicy()`. Deve ser implementado um mecanismo de *Trust on First Use* (TOFU) armazenado no banco de dados, ou o sistema deve exigir que o administrador cadastre a *fingerprint* da chave do host do dispositivo no momento do cadastro. A conexão só deve prosseguir se a chave apresentada pelo roteador coincidir com a chave armazenada.

### 3.5. Imposição de 2FA Global

Atualmente, o sistema permite que o administrador crie usuários sem o 2FA habilitado, e o usuário só configura o TOTP no primeiro login. Para garantir a segurança máxima, a aplicação deve ser configurada para forçar a configuração do 2FA. O middleware de autenticação deve interceptar qualquer requisição de um usuário que ainda não configurou o 2FA e retornar um erro `403 Forbidden`, redirecionando-o obrigatoriamente para a tela de configuração do TOTP antes de permitir o acesso a qualquer outro módulo do sistema.

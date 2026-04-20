"""
BR10 NetManager - Script Importer
Converte scripts de backup/automação (Python, Shell, Expect) em Playbooks estruturados.

Padrões reconhecidos:
  - Conexão Telnet / SSH (telnetlib, paramiko, netmiko, pexpect, subprocess)
  - Envio de comandos interativos (send, write, sendline, expect)
  - Aguardar strings / prompts
  - Download FTP (ftplib, tftp)
  - Sleep / delay
  - Variáveis de configuração (HOST, IP, USER, PASSWORD, FTP_HOST, etc.)
  - Comentários descritivos → labels dos passos
"""
import re
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ─── Mapeamento de padrões → tipos de passo ───────────────────────────────────

# Padrões de CONEXÃO TELNET
_TELNET_PATTERNS = [
    # telnetlib.Telnet(host, port)
    r'telnetlib\.Telnet\s*\(\s*([^\)]+)\)',
    # Telnet(host, port)
    r'\bTelnet\s*\(\s*([^\)]+)\)',
    # pexpect.spawn("telnet host")
    r'pexpect\.spawn\s*\(\s*["\']telnet\s+([^"\']+)["\']',
    # subprocess / os.system("telnet host")
    r'(?:subprocess|os\.system)\s*.*?["\']telnet\s+([^"\']+)["\']',
    # connect("host") genérico
    r'\.connect\s*\(\s*["\']([^"\']+)["\']',
]

# Padrões de CONEXÃO SSH
_SSH_PATTERNS = [
    # paramiko.SSHClient().connect(host)
    r'\.connect\s*\(\s*([^\)]+)\)',
    # pexpect.spawn("ssh user@host")
    r'pexpect\.spawn\s*\(\s*["\']ssh\s+([^"\']+)["\']',
    # netmiko ConnectHandler(host=...)
    r'ConnectHandler\s*\(\s*([^\)]+)\)',
    # fabric Connection(host)
    r'Connection\s*\(\s*["\']([^"\']+)["\']',
]

# Padrões de ENVIO DE COMANDO
_SEND_CMD_PATTERNS = [
    # tn.write(b"command\n") ou tn.write("command\n")
    r'\.write\s*\(\s*(?:b)?["\']([^"\'\\]+)(?:\\n)?["\']',
    # tn.sendline("command") / child.sendline("command")
    r'\.sendline\s*\(\s*["\']([^"\']+)["\']',
    # tn.send("command") / conn.send("command")
    r'\.send\s*\(\s*["\']([^"\']+)["\']',
    # send_command("command") netmiko
    r'\.send_command\s*\(\s*["\']([^"\']+)["\']',
    # execute("command")
    r'\.execute\s*\(\s*["\']([^"\']+)["\']',
    # stdin.write("command\n")
    r'stdin\.write\s*\(\s*["\']([^"\']+)["\']',
]

# Padrões de WAIT_FOR / EXPECT
_WAIT_PATTERNS = [
    # tn.read_until(b"string") / tn.read_until("string")
    r'\.read_until\s*\(\s*(?:b)?["\']([^"\']+)["\']',
    # child.expect("string") / child.expect(["string"])
    r'\.expect\s*\(\s*(?:\[)?["\']([^"\']+)["\']',
    # wait_for("string")
    r'wait_for\s*\(\s*["\']([^"\']+)["\']',
    # read_very_eager / read_all (sem argumento → aguarda prompt genérico)
    r'\.(read_very_eager|read_all)\s*\(\s*\)',
]

# Padrões de FTP DOWNLOAD
_FTP_PATTERNS = [
    # ftp.retrbinary("RETR filename", ...)
    r'\.retrbinary\s*\(\s*["\']RETR\s+([^"\']+)["\']',
    # ftp.retrlines("RETR filename")
    r'\.retrlines\s*\(\s*["\']RETR\s+([^"\']+)["\']',
    # tftp get
    r'tftp.*?get\s+([^\s]+)',
    # wget / curl download
    r'(?:wget|curl)\s+.*?(?:ftp://[^\s]+/([^\s]+))',
]

# Padrões de SCP DOWNLOAD
_SCP_PATTERNS = [
    # copy file scp://host filename (Datacom DmOS)
    r'copy\s+file\s+scp://([^\s]+)\s+([^\s]+)',
    # copy file filename scp://host (Datacom DmOS inverso)
    r'copy\s+file\s+([^\s]+)\s+scp://([^\s]+)',
    # scp user@host:/path /local/path
    r'scp\s+([^\s]+@[^\s:]+:[^\s]+)\s+([^\s]+)',
    # sftp.get(remote, local)
    r'sftp\.get\s*\(\s*["\']([^"\']+)["\']',
    # paramiko SFTPClient / open_sftp
    r'open_sftp|SFTPClient',
    # send_telnet_command(tn, f"copy file {filename} tftp://...") — Datacom via TFTP
    r'copy\s+file\s+([^\s]+)\s+tftp://([^\s]+)',
]

# Padrões de SLEEP
_SLEEP_PATTERNS = [
    r'time\.sleep\s*\(\s*([0-9.]+)\s*\)',
    r'sleep\s*\(\s*([0-9.]+)\s*\)',
    r'asyncio\.sleep\s*\(\s*([0-9.]+)\s*\)',
]

# Padrões de variáveis de configuração
_VAR_PATTERNS = {
    # HOST / IP
    r'(?:HOST|IP|DEVICE_IP|OLT_IP|ROUTER_IP|NE_IP)\s*=\s*["\']([^"\']+)["\']': 'HOST',
    r'(?:HOST|IP|DEVICE_IP|OLT_IP|ROUTER_IP|NE_IP)\s*=\s*([0-9.]+)': 'HOST',
    # PORT
    r'(?:PORT|TELNET_PORT|SSH_PORT)\s*=\s*([0-9]+)': 'PORT',
    # USERNAME / USER
    r'(?:USERNAME|USER|LOGIN)\s*=\s*["\']([^"\']+)["\']': 'USERNAME',
    # PASSWORD / PASS
    r'(?:PASSWORD|PASS|SENHA)\s*=\s*["\']([^"\']+)["\']': 'PASSWORD',
    # FTP_HOST
    r'(?:FTP_HOST|FTP_SERVER|FTP_IP)\s*=\s*["\']([^"\']+)["\']': 'FTP_HOST',
    # FTP_USER
    r'(?:FTP_USER|FTP_USERNAME|FTP_LOGIN)\s*=\s*["\']([^"\']+)["\']': 'FTP_USER',
    # FTP_PASS
    r'(?:FTP_PASS|FTP_PASSWORD|FTP_SENHA)\s*=\s*["\']([^"\']+)["\']': 'FTP_PASS',
    # FTP_DIR / PATH
    r'(?:FTP_DIR|FTP_PATH|BACKUP_DIR|BACKUP_PATH)\s*=\s*["\']([^"\']+)["\']': 'FTP_DIR',
    # CLIENT / NOME
    r'(?:CLIENT|CLIENT_NAME|CLIENTE|NOME)\s*=\s*["\']([^"\']+)["\']': 'CLIENT_NAME',
}

# Palavras-chave que indicam conexão SSH vs Telnet
_SSH_KEYWORDS = {'ssh', 'paramiko', 'netmiko', 'fabric', 'ConnectHandler', 'SSHClient'}
_TELNET_KEYWORDS = {'telnet', 'telnetlib', 'Telnet'}

# Palavras-chave que indicam transferência SCP/SFTP vs FTP/TFTP
_SCP_KEYWORDS = {'scp', 'sftp', 'open_sftp', 'SFTPClient', 'scp://'}
_FTP_KEYWORDS = {'ftp', 'ftplib', 'tftp', 'tftp://', 'ftp://'}


# ─── Funções auxiliares ────────────────────────────────────────────────────────

def _extract_variables(content: str) -> Dict[str, str]:
    """Extrai variáveis de configuração do script."""
    variables: Dict[str, str] = {}
    for pattern, var_name in _VAR_PATTERNS.items():
        m = re.search(pattern, content, re.IGNORECASE)
        if m:
            value = m.group(1).strip()
            # Substitui valores literais por placeholders se parecerem sensíveis
            if var_name in ('PASSWORD', 'FTP_PASS'):
                variables[var_name] = ''  # nunca importar senhas reais
            else:
                variables[var_name] = value
    # Garantir variáveis mínimas
    if 'HOST' not in variables:
        variables['HOST'] = ''
    if 'USERNAME' not in variables:
        variables['USERNAME'] = ''
    if 'PASSWORD' not in variables:
        variables['PASSWORD'] = ''
    return variables


def _detect_protocol(content: str) -> str:
    """Detecta se o script usa SSH ou Telnet."""
    content_lower = content.lower()
    ssh_score = sum(1 for kw in _SSH_KEYWORDS if kw.lower() in content_lower)
    telnet_score = sum(1 for kw in _TELNET_KEYWORDS if kw.lower() in content_lower)
    return 'ssh' if ssh_score >= telnet_score else 'telnet'


def _get_comment_before(lines: List[str], idx: int) -> Optional[str]:
    """Retorna o comentário imediatamente antes da linha idx, se existir."""
    if idx > 0:
        prev = lines[idx - 1].strip()
        if prev.startswith('#'):
            return prev.lstrip('#').strip()
        if prev.startswith('//'):
            return prev.lstrip('/').strip()
    return None


def _clean_command(cmd: str) -> str:
    """Limpa um comando extraído de aspas/bytes."""
    cmd = cmd.strip().strip('"\'').strip()
    cmd = cmd.replace('\\n', '').replace('\\r', '').strip()
    return cmd


def _is_login_command(cmd: str) -> bool:
    """Verifica se o comando parece ser um login/senha (não deve virar passo send_command)."""
    cmd_lower = cmd.lower()
    return any(kw in cmd_lower for kw in ('password', 'senha', 'login', 'username', 'user:'))


def _parse_lines(content: str) -> List[Dict[str, Any]]:
    """
    Analisa o script linha a linha e retorna uma lista de passos detectados.
    Cada passo é um dict com: step_type, params, label, confidence.
    """
    lines = content.splitlines()
    steps: List[Dict[str, Any]] = []

    for idx, line in enumerate(lines):
        stripped = line.strip()

        # Ignorar linhas vazias, comentários puros e imports
        if not stripped or stripped.startswith('#') or stripped.startswith('//'):
            continue
        if stripped.startswith(('import ', 'from ', 'require ')):
            continue

        label = _get_comment_before(lines, idx)
        matched = False

        # ── SLEEP ────────────────────────────────────────────────────────────────────
        if not matched:
            for pat in _SLEEP_PATTERNS:
                m = re.search(pat, stripped)
                if m:
                    secs = float(m.group(1))
                    steps.append({
                        'step_type': 'sleep',
                        'params': {'seconds': secs},
                        'label': label or f'Aguardar {secs}s',
                        'confidence': 'high',
                    })
                    matched = True
                    break

        # ── WAIT_FOR / EXPECT ───────────────────────────────────────────────────────
        if not matched:
            for pat in _WAIT_PATTERNS:
                m = re.search(pat, stripped)
                if m:
                    if m.lastindex and m.group(1) in ('read_very_eager', 'read_all'):
                        wait_str = '#'
                    else:
                        wait_str = _clean_command(m.group(1)) if m.lastindex else '#'
                    steps.append({
                        'step_type': 'wait_for',
                        'params': {'wait_string': wait_str, 'timeout': 30},
                        'label': label or f'Aguardar: {wait_str[:40]}',
                        'confidence': 'high',
                    })
                    matched = True
                    break

        # ── SCP DOWNLOAD ──────────────────────────────────────────────────────────
        if not matched:
            for pat in _SCP_PATTERNS:
                m = re.search(pat, stripped)
                if m:
                    fname = 'backup_{DEVICE_NAME}_{DATETIME}.cfg'
                    if m.lastindex and m.lastindex >= 1:
                        candidate = m.group(m.lastindex).strip()
                        if '/' not in candidate and '://' not in candidate:
                            fname = candidate
                    steps.append({
                        'step_type': 'scp_download',
                        'params': {
                            'host': '{DEVICE_IP}',
                            'port': 22,
                            'username': '{USERNAME}',
                            'password': '{PASSWORD}',
                            'remote_path': f'/{fname}',
                            'local_dir': '/app/backups/devices/{CLIENT_NAME}/{DATE}',
                            'filename': fname,
                            'timeout': 120,
                        },
                        'label': label or f'Download SCP: {fname}',
                        'confidence': 'medium',
                    })
                    matched = True
                    break

        # ── FTP DOWNLOAD ──────────────────────────────────────────────────────────
        if not matched:
            for pat in _FTP_PATTERNS:
                m = re.search(pat, stripped)
                if m:
                    filename = m.group(1).strip() if m.lastindex else 'backup.cfg'
                    steps.append({
                        'step_type': 'ftp_download',
                        'params': {
                            'ftp_host': '{FTP_HOST}',
                            'ftp_user': '{FTP_USER}',
                            'ftp_pass': '{FTP_PASS}',
                            'remote_path': f'{{FTP_DIR}}/{filename}',
                            'local_filename': filename,
                        },
                        'label': label or f'Download FTP: {filename}',
                        'confidence': 'medium',
                    })
                    matched = True
                    break

        # ── SEND_COMMAND ───────────────────────────────────────────────────────────
        if not matched:
            for pat in _SEND_CMD_PATTERNS:
                m = re.search(pat, stripped)
                if m:
                    cmd = _clean_command(m.group(1))
                    if not cmd:
                        break
                    if _is_login_command(cmd):
                        steps.append({
                            'step_type': 'send_string',
                            'params': {'text': '{PASSWORD}' if 'password' in cmd.lower() else cmd},
                            'label': label or 'Enviar credencial',
                            'confidence': 'medium',
                        })
                    else:
                        steps.append({
                            'step_type': 'send_command',
                            'params': {
                                'command': cmd,
                                'wait_string': '#',
                                'timeout': 30,
                            },
                            'label': label or f'Executar: {cmd[:50]}',
                            'confidence': 'high',
                        })
                    matched = True
                    break

    return steps


def _infer_connect_step(content: str, variables: Dict[str, str]) -> Dict[str, Any]:
    """Cria o passo de conexão (telnet ou ssh) baseado no protocolo detectado."""
    protocol = _detect_protocol(content)
    port_default = '22' if protocol == 'ssh' else '23'
    port = variables.get('PORT', port_default)

    if protocol == 'ssh':
        return {
            'step_type': 'ssh_connect',
            'params': {
                'host': '{HOST}',
                'port': int(port) if str(port).isdigit() else 22,
                'username': '{USERNAME}',
                'password': '{PASSWORD}',
            },
            'label': 'Conectar via SSH',
            'confidence': 'high',
        }
    else:
        return {
            'step_type': 'telnet_connect',
            'params': {
                'host': '{HOST}',
                'port': int(port) if str(port).isdigit() else 23,
                'username': '{USERNAME}',
                'password': '{PASSWORD}',
                'login_prompt': 'Username:',
                'password_prompt': 'Password:',
            },
            'label': 'Conectar via Telnet',
            'confidence': 'high',
        }


def _infer_category(content: str, filename: str) -> str:
    """Infere a categoria do playbook pelo conteúdo e nome do arquivo."""
    text = (content + ' ' + filename).lower()
    if any(kw in text for kw in ('backup', 'bkp', 'config', 'configuracao', 'configuração')):
        return 'backup'
    if any(kw in text for kw in ('monitor', 'check', 'status', 'health')):
        return 'diagnostics'
    if any(kw in text for kw in ('deploy', 'push', 'apply', 'update', 'upgrade')):
        return 'config'
    return 'backup'


def _infer_name(content: str, filename: str) -> str:
    """Infere o nome do playbook pelo arquivo ou primeiro comentário descritivo."""
    # Tentar extrair do primeiro comentário de bloco
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith('#') and len(stripped) > 3:
            candidate = stripped.lstrip('#').strip()
            if len(candidate) > 5 and not candidate.startswith('!'):
                return candidate[:100]
        if stripped.startswith('"""') or stripped.startswith("'''"):
            candidate = stripped.strip('"\'').strip()
            if len(candidate) > 5:
                return candidate[:100]

    # Usar nome do arquivo sem extensão
    name = re.sub(r'\.(py|sh|bash|expect|tcl|txt)$', '', filename, flags=re.IGNORECASE)
    name = re.sub(r'[_\-]+', ' ', name).strip().title()
    return name or 'Playbook Importado'


def _deduplicate_steps(steps: List[Dict]) -> List[Dict]:
    """Remove passos duplicados consecutivos (ex: wait_for '#' repetidos)."""
    result = []
    for step in steps:
        if result:
            prev = result[-1]
            if (prev['step_type'] == step['step_type'] and
                    prev.get('params') == step.get('params')):
                continue  # pular duplicata
        result.append(step)
    return result


def _add_disconnect_step(steps: List[Dict]) -> List[Dict]:
    """Adiciona passo de desconexão ao final se não existir."""
    if steps and steps[-1]['step_type'] != 'disconnect':
        steps.append({
            'step_type': 'disconnect',
            'params': {},
            'label': 'Encerrar conexão',
            'confidence': 'high',
        })
    return steps


# ─── Templates de playbook por vendor ────────────────────────────────────────────────

def _build_datacom_template(protocol: str = 'telnet') -> List[Dict[str, Any]]:
    """
    Gera o playbook template para Datacom DmOS.

    Fluxo Telnet + TFTP:
      1. Conectar via Telnet → login → config
      2. save {BACKUP_FILENAME}
      3. copy file {BACKUP_FILENAME} tftp://{TFTP_IP}
      4. exit
      5. Aguardar arquivo chegar via TFTP
      6. Enviar ao Telegram

    Fluxo SSH + SCP:
      1. Conectar via SSH
      2. show running-config | save overwrite {BACKUP_FILENAME}
      3. copy file scp://{SCP_SERVER} {BACKUP_FILENAME}
      4. exit
      5. Baixar via SCP
      6. Enviar ao Telegram
    """
    if protocol == 'ssh':
        return [
            {
                'step_type': 'ssh_connect',
                'params': {
                    'host': '{DEVICE_IP}',
                    'port': 22,
                    'username': '{USERNAME}',
                    'password': '{PASSWORD}',
                },
                'label': 'Conectar via SSH (Datacom DmOS)',
                'order': 0,
            },
            {
                'step_type': 'send_command',
                'params': {
                    'command': 'show running-config | save overwrite {BACKUP_FILENAME}',
                    'wait_for': ['#'],
                    'timeout': 120,
                },
                'label': 'Salvar configuração na OLT',
                'order': 1,
            },
            {
                'step_type': 'sleep',
                'params': {'seconds': 5},
                'label': 'Aguardar gravação',
                'order': 2,
            },
            {
                'step_type': 'send_command',
                'params': {
                    'command': 'copy file {BACKUP_FILENAME} scp://{SCP_SERVER}',
                    'wait_for': ['#', 'Transfer complete', 'bytes copied'],
                    'timeout': 180,
                },
                'label': 'Copiar backup via SCP para o servidor',
                'order': 3,
            },
            {
                'step_type': 'sleep',
                'params': {'seconds': 10},
                'label': 'Aguardar transferência SCP',
                'order': 4,
            },
            {
                'step_type': 'scp_download',
                'params': {
                    'host': '{DEVICE_IP}',
                    'port': 22,
                    'username': '{USERNAME}',
                    'password': '{PASSWORD}',
                    'remote_path': '/{BACKUP_FILENAME}',
                    'local_dir': '/app/backups/devices/{CLIENT_NAME}/{DATE}',
                    'filename': '{BACKUP_FILENAME}',
                    'timeout': 120,
                },
                'label': 'Baixar backup via SCP',
                'order': 5,
            },
            {
                'step_type': 'disconnect',
                'params': {},
                'label': 'Encerrar conexão',
                'order': 6,
            },
        ]
    else:
        # Telnet + TFTP (fluxo original do script Datacom)
        return [
            {
                'step_type': 'telnet_connect',
                'params': {
                    'host': '{DEVICE_IP}',
                    'port': 23,
                    'username': '{USERNAME}',
                    'password': '{PASSWORD}',
                    'login_prompt': 'login:',
                    'password_prompt': 'Password:',
                },
                'label': 'Conectar via Telnet (Datacom DmOS)',
                'order': 0,
            },
            {
                'step_type': 'wait_for',
                'params': {
                    'pattern': 'Welcome to the DmOS CLI',
                    'timeout': 20,
                },
                'label': 'Aguardar banner DmOS',
                'order': 1,
            },
            {
                'step_type': 'send_command',
                'params': {
                    'command': 'config',
                    'wait_for': ['#'],
                    'timeout': 10,
                },
                'label': 'Entrar em modo config',
                'order': 2,
            },
            {
                'step_type': 'send_command',
                'params': {
                    'command': 'save {BACKUP_FILENAME}',
                    'wait_for': ['#'],
                    'timeout': 120,
                },
                'label': 'Salvar backup na OLT',
                'order': 3,
            },
            {
                'step_type': 'sleep',
                'params': {'seconds': 90},
                'label': 'Aguardar gravação interna (90s)',
                'order': 4,
            },
            {
                'step_type': 'send_command',
                'params': {
                    'command': 'copy file {BACKUP_FILENAME} tftp://{TFTP_IP}',
                    'wait_for': ['#', 'Transfer complete', 'bytes copied'],
                    'timeout': 180,
                },
                'label': 'Enviar backup para servidor TFTP',
                'order': 5,
            },
            {
                'step_type': 'send_command',
                'params': {
                    'command': 'exit',
                    'wait_for': ['#', '>'],
                    'timeout': 10,
                },
                'label': 'Sair do modo config',
                'order': 6,
            },
            {
                'step_type': 'disconnect',
                'params': {},
                'label': 'Encerrar conexão Telnet',
                'order': 7,
            },
            {
                'step_type': 'sleep',
                'params': {'seconds': 30},
                'label': 'Aguardar arquivo chegar via TFTP (30s)',
                'order': 8,
            },
        ]


# ─── Templates completos por vendor ─────────────────────────────────────────────────────


def _build_huawei_template() -> List[Dict[str, Any]]:
    """
    Huawei OLT — Telnet + FTP
    Fluxo: login → enable → backup configuration ftp → confirmação y → sleep 30s → exit → ftp_download → telegram
    """
    return [
        {
            'step_type': 'telnet_connect',
            'params': {
                'host': '{DEVICE_IP}',
                'port': 23,
                'username': '{USERNAME}',
                'password': '{PASSWORD}',
                'login_prompt': 'username:',
                'password_prompt': 'password:',
            },
            'label': 'Conectar via Telnet (Huawei OLT)',
            'order': 0,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'enable',
                'wait_for': ['#'],
                'timeout': 15,
            },
            'label': 'Entrar em modo privilegiado',
            'order': 1,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'backup configuration ftp {FTP_IP} backup_{DEVICE_NAME}_{DATE}.cfg',
                'wait_for': ['Are you sure to continue?', 'y/n'],
                'timeout': 30,
            },
            'label': 'Executar backup configuration ftp',
            'order': 2,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'y',
                'wait_for': ['#', 'succeeded', 'complete'],
                'timeout': 60,
            },
            'label': 'Confirmar envio do backup (y)',
            'order': 3,
        },
        {
            'step_type': 'sleep',
            'params': {'seconds': 30},
            'label': 'Aguardar upload FTP concluir (30s)',
            'order': 4,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'exit',
                'wait_for': ['>', '#', 'closed'],
                'timeout': 10,
            },
            'label': 'Encerrar sessão Telnet',
            'order': 5,
        },
        {
            'step_type': 'disconnect',
            'params': {},
            'label': 'Desconectar',
            'order': 6,
        },
        {
            'step_type': 'ftp_download',
            'params': {
                'host': '{FTP_IP}',
                'username': '{FTP_USER}',
                'password': '{FTP_PASSWORD}',
                'remote_file': 'backup_{DEVICE_NAME}_{DATE}.cfg',
                'local_dir': '/app/backups/devices/{CLIENT_NAME}/{DATE}',
                'timeout': 60,
            },
            'label': 'Baixar backup do servidor FTP',
            'order': 7,
        },
        {
            'step_type': 'telegram_send_file',
            'params': {
                'caption': 'Backup {DEVICE_NAME} — {DATETIME}',
            },
            'label': 'Enviar backup ao Telegram',
            'order': 8,
        },
    ]


def _build_zte_template(titan: bool = False) -> List[Dict[str, Any]]:
    """
    ZTE OLT — Telnet + FTP
    Dois subtipos:
      - Padrão: configure terminal → file upload cfg-startup startrun.dat ftp ...
      - Titan:  copy ftp root: /datadisk0/DATA0/startrun.dat //<IP>/startrun.dat@user:pass
    """
    if titan:
        backup_cmd = 'copy ftp root: /datadisk0/DATA0/startrun.dat //{FTP_IP}/startrun.dat@{FTP_USER}:{FTP_PASSWORD}'
        steps_before_backup = []
    else:
        backup_cmd = 'file upload cfg-startup startrun.dat ftp ipaddress {FTP_IP} user {FTP_USER} password {FTP_PASSWORD}'
        steps_before_backup = [
            {
                'step_type': 'send_command',
                'params': {
                    'command': 'configure terminal',
                    'wait_for': ['#', '>'],
                    'timeout': 10,
                },
                'label': 'Entrar em modo configure terminal',
                'order': 2,
            },
        ]

    label_prefix = 'ZTE Titan' if titan else 'ZTE'
    base = [
        {
            'step_type': 'telnet_connect',
            'params': {
                'host': '{DEVICE_IP}',
                'port': 23,
                'username': '{USERNAME}',
                'password': '{PASSWORD}',
                'login_prompt': 'login:',
                'password_prompt': 'Password:',
            },
            'label': f'Conectar via Telnet ({label_prefix})',
            'order': 0,
        },
        {
            'step_type': 'sleep',
            'params': {'seconds': 3},
            'label': 'Aguardar estabilização do prompt',
            'order': 1,
        },
    ]

    middle = steps_before_backup + [
        {
            'step_type': 'send_command',
            'params': {
                'command': backup_cmd,
                'wait_for': ['#', '>', 'complete', 'success'],
                'timeout': 30,
            },
            'label': f'Executar backup {label_prefix} via FTP',
            'order': len(base) + len(steps_before_backup),
        },
        {
            'step_type': 'sleep',
            'params': {'seconds': 60},
            'label': 'Aguardar upload FTP concluir (60s)',
            'order': len(base) + len(steps_before_backup) + 1,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'exit',
                'wait_for': ['>', '#', 'closed'],
                'timeout': 10,
            },
            'label': 'Encerrar sessão',
            'order': len(base) + len(steps_before_backup) + 2,
        },
        {
            'step_type': 'disconnect',
            'params': {},
            'label': 'Desconectar',
            'order': len(base) + len(steps_before_backup) + 3,
        },
        {
            'step_type': 'ftp_download',
            'params': {
                'host': '{FTP_IP}',
                'username': '{FTP_USER}',
                'password': '{FTP_PASSWORD}',
                'remote_file': 'startrun.dat',
                'local_dir': '/app/backups/devices/{CLIENT_NAME}/{DATE}',
                'rename_to': '{DEVICE_NAME}_{DATE}.dat',
                'timeout': 60,
            },
            'label': 'Baixar startrun.dat do servidor FTP',
            'order': len(base) + len(steps_before_backup) + 4,
        },
        {
            'step_type': 'telegram_send_file',
            'params': {
                'caption': f'Backup {label_prefix} {{DEVICE_NAME}} — {{DATETIME}}',
            },
            'label': 'Enviar backup ao Telegram',
            'order': len(base) + len(steps_before_backup) + 5,
        },
    ]

    # Renumerar orders
    all_steps = base + middle
    for i, s in enumerate(all_steps):
        s['order'] = i
    return all_steps


def _build_fiberhome_template() -> List[Dict[str, Any]]:
    """
    Fiberhome OLT — Telnet + FTP
    Fluxo: Login: → User> → enable → Password: (2ª vez) → Admin# → upload ftp system ...
    """
    return [
        {
            'step_type': 'telnet_connect',
            'params': {
                'host': '{DEVICE_IP}',
                'port': 23,
                'username': '{USERNAME}',
                'password': '{PASSWORD}',
                'login_prompt': 'Login:',
                'password_prompt': 'Password:',
            },
            'label': 'Conectar via Telnet (Fiberhome)',
            'order': 0,
        },
        {
            'step_type': 'wait_for',
            'params': {
                'pattern': 'User>',
                'timeout': 20,
            },
            'label': 'Aguardar prompt User>',
            'order': 1,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'enable',
                'wait_for': ['Password:'],
                'timeout': 10,
            },
            'label': 'Entrar em modo enable',
            'order': 2,
        },
        {
            'step_type': 'send_string',
            'params': {
                'text': '{PASSWORD}',
            },
            'label': 'Enviar senha do enable',
            'order': 3,
        },
        {
            'step_type': 'wait_for',
            'params': {
                'pattern': 'Admin#',
                'timeout': 20,
            },
            'label': 'Aguardar prompt Admin#',
            'order': 4,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'upload ftp system {FTP_IP} {FTP_USER} {FTP_PASSWORD} backup_{DEVICE_NAME}_{DATE}.cfg',
                'wait_for': ['Admin#', 'Finished', 'successfully'],
                'timeout': 60,
            },
            'label': 'Executar upload FTP (Fiberhome)',
            'order': 5,
        },
        {
            'step_type': 'sleep',
            'params': {'seconds': 30},
            'label': 'Aguardar upload FTP concluir (30s)',
            'order': 6,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'exit',
                'wait_for': ['>', '#', 'closed'],
                'timeout': 10,
            },
            'label': 'Encerrar sessão',
            'order': 7,
        },
        {
            'step_type': 'disconnect',
            'params': {},
            'label': 'Desconectar',
            'order': 8,
        },
        {
            'step_type': 'ftp_download',
            'params': {
                'host': '{FTP_IP}',
                'username': '{FTP_USER}',
                'password': '{FTP_PASSWORD}',
                'remote_file': 'backup_{DEVICE_NAME}_{DATE}.cfg',
                'local_dir': '/app/backups/devices/{CLIENT_NAME}/{DATE}',
                'timeout': 60,
            },
            'label': 'Baixar backup do servidor FTP',
            'order': 9,
        },
        {
            'step_type': 'telegram_send_file',
            'params': {
                'caption': 'Backup Fiberhome {DEVICE_NAME} — {DATETIME}',
            },
            'label': 'Enviar backup ao Telegram',
            'order': 10,
        },
    ]


def _build_intelbras_g16_template(method: str = 'ftp') -> List[Dict[str, Any]]:
    """
    Intelbras G16 — Telnet + FTP/TFTP/Local
    Prompt: GPON#
    Método: ftp (padrão), tftp ou local
    """
    if method == 'local':
        backup_cmd = 'copy running-config startup-config'
        wait_for = ['GPON#', 'OK', 'success']
        download_steps: List[Dict[str, Any]] = []
    elif method == 'tftp':
        backup_cmd = 'upload configuration tftp inet {TFTP_IP} backup_{DEVICE_NAME}_{DATE}.cfg'
        wait_for = ['GPON#', 'success', 'complete']
        download_steps = [
            {
                'step_type': 'sleep',
                'params': {'seconds': 30},
                'label': 'Aguardar upload TFTP concluir (30s)',
                'order': 6,
            },
            {
                'step_type': 'telegram_send_file',
                'params': {
                    'caption': 'Backup Intelbras G16 {DEVICE_NAME} — {DATETIME}',
                },
                'label': 'Enviar backup ao Telegram',
                'order': 7,
            },
        ]
    else:  # ftp
        backup_cmd = 'upload configuration ftp inet {FTP_IP} backup_{DEVICE_NAME}_{DATE}.cfg'
        wait_for = ['GPON#', 'success', 'complete']
        download_steps = [
            {
                'step_type': 'sleep',
                'params': {'seconds': 30},
                'label': 'Aguardar upload FTP concluir (30s)',
                'order': 6,
            },
            {
                'step_type': 'ftp_download',
                'params': {
                    'host': '{FTP_IP}',
                    'username': '{FTP_USER}',
                    'password': '{FTP_PASSWORD}',
                    'remote_file': 'backup_{DEVICE_NAME}_{DATE}.cfg',
                    'local_dir': '/app/backups/devices/{CLIENT_NAME}/{DATE}',
                    'timeout': 60,
                },
                'label': 'Baixar backup do servidor FTP',
                'order': 7,
            },
            {
                'step_type': 'telegram_send_file',
                'params': {
                    'caption': 'Backup Intelbras G16 {DEVICE_NAME} — {DATETIME}',
                },
                'label': 'Enviar backup ao Telegram',
                'order': 8,
            },
        ]

    base = [
        {
            'step_type': 'telnet_connect',
            'params': {
                'host': '{DEVICE_IP}',
                'port': 23,
                'username': '{USERNAME}',
                'password': '{PASSWORD}',
                'login_prompt': 'Username:',
                'password_prompt': 'Password:',
            },
            'label': 'Conectar via Telnet (Intelbras G16)',
            'order': 0,
        },
        {
            'step_type': 'wait_for',
            'params': {
                'pattern': 'GPON#',
                'timeout': 20,
            },
            'label': 'Aguardar prompt GPON#',
            'order': 1,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': backup_cmd,
                'wait_for': wait_for,
                'timeout': 60,
            },
            'label': f'Executar backup Intelbras G16 (método: {method.upper()})',
            'order': 2,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'exit',
                'wait_for': ['>', '#', 'closed'],
                'timeout': 10,
            },
            'label': 'Encerrar sessão',
            'order': 3,
        },
        {
            'step_type': 'disconnect',
            'params': {},
            'label': 'Desconectar',
            'order': 4,
        },
    ]

    all_steps = base + download_steps
    for i, s in enumerate(all_steps):
        s['order'] = i
    return all_steps


def _build_parks_template() -> List[Dict[str, Any]]:
    """
    Parks OLT — Telnet + FTP
    Fluxo especial: aguardar "Press <RETURN>" → ENTER → Username: → Password:
    Comando: copy startup-config ftp://{FTP_IP}/{filename} {FTP_USER} {FTP_PASSWORD}
    """
    return [
        {
            'step_type': 'telnet_connect',
            'params': {
                'host': '{DEVICE_IP}',
                'port': 23,
                'username': '{USERNAME}',
                'password': '{PASSWORD}',
                'login_prompt': 'Username:',
                'password_prompt': 'Password:',
            },
            'label': 'Conectar via Telnet (Parks)',
            'order': 0,
        },
        {
            'step_type': 'wait_for',
            'params': {
                'pattern': 'Press <RETURN> to get started',
                'timeout': 20,
            },
            'label': 'Aguardar banner Parks',
            'order': 1,
        },
        {
            'step_type': 'send_string',
            'params': {
                'text': '',
            },
            'label': 'Pressionar ENTER para iniciar sessão',
            'order': 2,
        },
        {
            'step_type': 'sleep',
            'params': {'seconds': 3},
            'label': 'Aguardar estabilização do prompt',
            'order': 3,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'copy startup-config ftp://{FTP_IP}/backup_{DEVICE_NAME}_{DATETIME}.bin {FTP_USER} {FTP_PASSWORD}',
                'wait_for': ['#', '>', 'complete', 'success'],
                'timeout': 30,
            },
            'label': 'Executar backup Parks via FTP',
            'order': 4,
        },
        {
            'step_type': 'sleep',
            'params': {'seconds': 30},
            'label': 'Aguardar upload FTP concluir (30s)',
            'order': 5,
        },
        {
            'step_type': 'send_command',
            'params': {
                'command': 'exit',
                'wait_for': ['>', '#', 'closed'],
                'timeout': 10,
            },
            'label': 'Encerrar sessão',
            'order': 6,
        },
        {
            'step_type': 'disconnect',
            'params': {},
            'label': 'Desconectar',
            'order': 7,
        },
        {
            'step_type': 'ftp_download',
            'params': {
                'host': '{FTP_IP}',
                'username': '{FTP_USER}',
                'password': '{FTP_PASSWORD}',
                'remote_file': 'backup_{DEVICE_NAME}_{DATETIME}.bin',
                'local_dir': '/app/backups/devices/{CLIENT_NAME}/{DATE}',
                'timeout': 60,
            },
            'label': 'Baixar backup do servidor FTP',
            'order': 8,
        },
        {
            'step_type': 'telegram_send_file',
            'params': {
                'caption': 'Backup Parks {DEVICE_NAME} — {DATETIME}',
            },
            'label': 'Enviar backup ao Telegram',
            'order': 9,
        },
    ]


# ─── Template ZTE GPON — Remoção de ONUs Offline/LOS via run_script ────────────────────

_ZTE_GPON_REMOVE_OFFLINE_SCRIPT = '''
import os
import sys
import time

try:
    from netmiko import ConnectHandler
except ImportError:
    print("[ERRO] netmiko não instalado. Execute: pip install netmiko")
    sys.exit(1)

# ─ Configuração — lida de variáveis de ambiente injetadas pelo BR10 ─
HOST     = os.environ.get("HOST",     os.environ.get("DEVICE_IP", ""))
USER     = os.environ.get("USERNAME", os.environ.get("USER", ""))
PASS     = os.environ.get("PASSWORD", os.environ.get("PASS", ""))

# Slots e PONs a varrer (pode ser sobrescrito via variáveis do playbook)
SLOT_START = int(os.environ.get("SLOT_START", "1"))
SLOT_END   = int(os.environ.get("SLOT_END",   "2"))
PON_START  = int(os.environ.get("PON_START",  "1"))
PON_END    = int(os.environ.get("PON_END",    "16"))
DRY_RUN    = os.environ.get("DRY_RUN", "false").lower() == "true"

if not HOST or not USER:
    print("[ERRO] HOST, USERNAME e PASSWORD devem estar configurados nas variáveis do playbook.")
    sys.exit(1)

print(f"[BR10] Conectando em {HOST} como {USER}...")
print(f"[BR10] Slots: {SLOT_START}–{SLOT_END}, PONs: {PON_START}–{PON_END}")
if DRY_RUN:
    print("[BR10] MODO DRY-RUN ativado — nenhuma ONU será removida.")

device = {
    "device_type": "zte_zxros",
    "host":        HOST,
    "username":    USER,
    "password":    PASS,
    "timeout":     60,
    "session_log": None,
}

total_removed = 0
total_errors  = 0
to_remove = {}  # {"1/1/1": [1, 5, 12], ...}

try:
    conn = ConnectHandler(**device)
    conn.enable()
    print(f"[BR10] Conectado com sucesso em {HOST}")
except Exception as e:
    print(f"[ERRO] Falha ao conectar: {e}")
    sys.exit(1)

# ─ Fase 1: Coletar ONUs offline/LOS ─
print("\n[BR10] === Fase 1: Coletando ONUs Offline/LOS ===")
for slot in range(SLOT_START, SLOT_END + 1):
    for pon in range(PON_START, PON_END + 1):
        pon_id = f"{slot}/1/{pon}"
        cmd = f"show gpon onu state gpon-olt_{pon_id}"
        try:
            output = conn.send_command(cmd, expect_string=r"#", read_timeout=30)
            candidates = []
            for line in output.splitlines():
                parts = line.split()
                if len(parts) >= 4 and ("OffLine" in line or "LOS" in line):
                    try:
                        onu_id = int(parts[0])
                        candidates.append(onu_id)
                    except (ValueError, IndexError):
                        pass
            if candidates:
                to_remove[pon_id] = candidates
                print(f"  PON {pon_id}: {len(candidates)} ONU(s) offline/LOS → {candidates}")
            else:
                print(f"  PON {pon_id}: nenhuma ONU offline")
        except Exception as e:
            print(f"  PON {pon_id}: erro ao consultar — {e}")
            total_errors += 1
        time.sleep(0.2)

if not to_remove:
    print("\n[BR10] Nenhuma ONU offline/LOS encontrada. Nada a remover.")
    conn.disconnect()
    print("[BR10] Concluído com sucesso.")
    sys.exit(0)

print(f"\n[BR10] Total de PONs com ONUs a remover: {len(to_remove)}")

# ─ Fase 2: Remover ONUs ─
print("\n[BR10] === Fase 2: Removendo ONUs ===")
for pon_id, onu_ids in to_remove.items():
    try:
        conn.send_command(f"configure terminal", expect_string=r"#")
        conn.send_command(f"interface gpon-olt_{pon_id}", expect_string=r"#")
        for onu_id in onu_ids:
            if DRY_RUN:
                print(f"  [DRY-RUN] Removeria ONU {onu_id} em {pon_id}")
            else:
                out = conn.send_command(f"no onu {onu_id}", expect_string=r"#", read_timeout=15)
                print(f"  Removida ONU {onu_id} em {pon_id}: {out.strip()[:80]}")
                total_removed += 1
        conn.send_command("exit", expect_string=r"#")
        conn.send_command("exit", expect_string=r"#")
    except Exception as e:
        print(f"  ERRO ao remover ONUs em {pon_id}: {e}")
        total_errors += 1

# ─ Salvar configuração ─
if not DRY_RUN and total_removed > 0:
    try:
        print("\n[BR10] Salvando configuração...")
        conn.send_command("do write", expect_string=r"#", read_timeout=30)
        print("[BR10] Configuração salva com sucesso.")
    except Exception as e:
        print(f"[AVISO] Erro ao salvar configuração: {e}")

conn.disconnect()
print(f"\n[BR10] === Resumo ===")
print(f"  ONUs removidas : {total_removed}")
print(f"  Erros          : {total_errors}")
print(f"  PONs afetadas  : {len(to_remove)}")
if total_errors > 0:
    sys.exit(1)
'''


def _build_zte_gpon_remove_offline_template() -> List[Dict[str, Any]]:
    """Template de Playbook para remoção de ONUs offline/LOS em OLT ZTE via run_script."""
    return [
        {
            'step_type': 'log',
            'params': {'message': 'Iniciando varredura de ONUs offline/LOS na OLT ZTE {DEVICE_NAME} ({DEVICE_IP})'},
            'label': 'Log de início',
            'order': 0,
        },
        {
            'step_type': 'run_script',
            'params': {
                'script_content': _ZTE_GPON_REMOVE_OFFLINE_SCRIPT.strip(),
                'timeout': 600,
                'inject_vars': True,
            },
            'label': 'Varrer PONs e remover ONUs offline/LOS (ZTE GPON)',
            'order': 1,
            'on_error': 'stop',
        },
        {
            'step_type': 'telegram_send_message',
            'params': {
                'message': 'OLT {DEVICE_NAME} ({DEVICE_IP}): remoção de ONUs offline/LOS concluída em {DATETIME}.',
            },
            'label': 'Notificar Telegram',
            'order': 2,
            'on_error': 'continue',
        },
    ]


# ─── Mapeamento de vendor (bkpolts) para label amigável ────────────────────────────────────
VENDOR_LABELS: Dict[str, str] = {
    "huawei":             "Huawei",
    "zte":                "ZTE",
    "zte_gpon_remove":    "ZTE GPON — Remover ONUs Offline",
    "fiberhome":          "Fiberhome",
    "datacom":            "Datacom",
    "parks":              "Parks",
    "intelbras_g16":      "Intelbras G16",
}
def import_script_to_playbook(
    content: str,
    filename: str = 'script.py',
    vendor: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Converte um script de automação em um Playbook estruturado.

    Parâmetros:
      content  : conteúdo do script
      filename : nome do arquivo original
      vendor   : vendor selecionado pelo usuário (opcional, ex: 'huawei', 'intelbras_g16')

    Retorna um dict com:
      - name: str
      - description: str
      - category: str
      - vendor: str | None
      - variables: dict
      - steps: list[dict]  (prontos para PlaybookStepCreate)
      - warnings: list[str]  (avisos sobre conversão parcial)
      - protocol: str  (ssh | telnet)
    """
    warnings: List[str] = []

    # 1. Extrair variáveis
    variables = _extract_variables(content)

    # 2. Detectar protocolo e criar passo de conexão
    protocol = _detect_protocol(content)
    connect_step = _infer_connect_step(content, variables)

    # 3. Analisar linhas e extrair passos
    raw_steps = _parse_lines(content)

    # 4. Remover passos de conexão duplicados (já temos o connect_step)
    body_steps = [
        s for s in raw_steps
        if s['step_type'] not in ('telnet_connect', 'ssh_connect')
    ]

    # 5. Montar sequência final
    all_steps = [connect_step] + body_steps
    all_steps = _deduplicate_steps(all_steps)
    all_steps = _add_disconnect_step(all_steps)

    # 6. Numerar os passos
    for i, step in enumerate(all_steps):
        step['order'] = i
        step.pop('confidence', None)  # remover campo interno

    # 7. Inferir nome e categoria
    name = _infer_name(content, filename)
    category = _infer_category(content, filename)

    # 7b. Ajustar nome e categoria com base no vendor selecionado
    vendor_label = VENDOR_LABELS.get(vendor or '', '') if vendor else ''
    if vendor_label and vendor_label.lower() not in name.lower():
        name = f'Backup {vendor_label}'
    # ── Ajustes específicos por vendor: usar templates completos e fieis ao script original ──
    if vendor == 'datacom':
        protocol = _detect_protocol(content)
        all_steps = _build_datacom_template(protocol)
        variables.setdefault('TFTP_IP', '')
        variables.setdefault('FTP_HOST', '')
        name = 'Backup Datacom DmOS'

    elif vendor == 'huawei':
        all_steps = _build_huawei_template()
        variables.setdefault('FTP_IP', '')
        variables.setdefault('FTP_USER', '')
        variables.setdefault('FTP_PASSWORD', '')
        name = 'Backup Huawei OLT'
        protocol = 'telnet'

    elif vendor == 'zte':
        # Detectar se é ZTE Titan pelo conteúdo do script
        is_titan = 'titan' in content.lower() or 'datadisk0' in content.lower() or 'ZTE_TITAN' in content
        all_steps = _build_zte_template(titan=is_titan)
        variables.setdefault('FTP_IP', '')
        variables.setdefault('FTP_USER', '')
        variables.setdefault('FTP_PASSWORD', '')
        name = 'Backup ZTE Titan OLT' if is_titan else 'Backup ZTE OLT'
        protocol = 'telnet'

    elif vendor == 'fiberhome':
        all_steps = _build_fiberhome_template()
        variables.setdefault('FTP_IP', '')
        variables.setdefault('FTP_USER', '')
        variables.setdefault('FTP_PASSWORD', '')
        name = 'Backup Fiberhome OLT'
        protocol = 'telnet'

    elif vendor == 'intelbras_g16':
        # O script suporta ftp/tftp/local via var de ambiente INTELBRAS_BACKUP_METHOD.
        # Usar ftp como padrão (mais comum). O usuário pode ajustar no playbook.
        method = 'ftp'
        all_steps = _build_intelbras_g16_template(method=method)
        variables.setdefault('FTP_IP', '')
        variables.setdefault('FTP_USER', '')
        variables.setdefault('FTP_PASSWORD', '')
        variables.setdefault('TFTP_IP', '')
        name = 'Backup Intelbras G16'
        protocol = 'telnet'

    elif vendor == 'parks':
        all_steps = _build_parks_template()
        variables.setdefault('FTP_IP', '')
        variables.setdefault('FTP_USER', '')
        variables.setdefault('FTP_PASSWORD', '')
        name = 'Backup Parks OLT'
        protocol = 'telnet'

    elif vendor == 'zte_gpon_remove':
        all_steps = _build_zte_gpon_remove_offline_template()
        variables.setdefault('SLOT_START', '1')
        variables.setdefault('SLOT_END', '2')
        variables.setdefault('PON_START', '1')
        variables.setdefault('PON_END', '16')
        variables.setdefault('DRY_RUN', 'false')
        name = 'Remover ONUs Offline/LOS — ZTE GPON'
        category = 'diagnostics'
        protocol = 'script'

    # 8. Gerar descrição automática
    n_cmds = sum(1 for s in all_steps if s['step_type'] == 'send_command')
    n_ftp = sum(1 for s in all_steps if s['step_type'] == 'ftp_download')
    n_scp = sum(1 for s in all_steps if s['step_type'] == 'scp_download')
    desc_parts = [f'Importado de: {filename}', f'Protocolo: {protocol.upper()}']
    if vendor_label:
        desc_parts.insert(0, f'Vendor: {vendor_label}')
    if n_cmds:
        desc_parts.append(f'{n_cmds} comando(s) detectado(s)')
    if n_ftp:
        desc_parts.append(f'{n_ftp} download(s) FTP')
    if n_scp:
        desc_parts.append(f'{n_scp} download(s) SCP')
    description = ' | '.join(desc_parts)

    # 9. Avisos
    if not variables.get('HOST'):
        warnings.append('HOST/IP do dispositivo não detectado automaticamente — preencha a variável HOST.')
    if not variables.get('USERNAME'):
        warnings.append('USERNAME não detectado — preencha a variável USERNAME.')
    low_conf = [s for s in all_steps if s.get('confidence') == 'medium']
    if low_conf:
        warnings.append(f'{len(low_conf)} passo(s) com confiança média — revise antes de executar.')

    # Remover campo confidence que pode ter sobrado
    for step in all_steps:
        step.pop('confidence', None)

    return {
        'name': name,
        'description': description,
        'category': category,
        'vendor': vendor,
        'variables': variables,
        'steps': all_steps,
        'warnings': warnings,
        'protocol': protocol,
        'total_steps': len(all_steps),
    }

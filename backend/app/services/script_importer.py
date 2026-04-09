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
    seen_connect = False

    for idx, line in enumerate(lines):
        stripped = line.strip()

        # Ignorar linhas vazias, comentários puros e imports
        if not stripped or stripped.startswith('#') or stripped.startswith('//'):
            continue
        if stripped.startswith(('import ', 'from ', 'require ')):
            continue

        label = _get_comment_before(lines, idx)

        # ── SLEEP ──────────────────────────────────────────────────────────────
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
                break
        else:
            # ── WAIT_FOR / EXPECT ───────────────────────────────────────────────
            for pat in _WAIT_PATTERNS:
                m = re.search(pat, stripped)
                if m:
                    if m.lastindex and m.group(1) in ('read_very_eager', 'read_all'):
                        wait_str = '#'  # aguardar prompt genérico
                    else:
                        wait_str = _clean_command(m.group(1)) if m.lastindex else '#'
                    steps.append({
                        'step_type': 'wait_for',
                        'params': {'wait_string': wait_str, 'timeout': 30},
                        'label': label or f'Aguardar: {wait_str[:40]}',
                        'confidence': 'high',
                    })
                    break
            else:
                # ── SEND_COMMAND ────────────────────────────────────────────────
                for pat in _SEND_CMD_PATTERNS:
                    m = re.search(pat, stripped)
                    if m:
                        cmd = _clean_command(m.group(1))
                        if not cmd:
                            break
                        # Credenciais → send_string (sem aguardar prompt)
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
                        break
                else:
                    # ── FTP DOWNLOAD ────────────────────────────────────────────
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


# ─── Função principal ──────────────────────────────────────────────────────────

# Mapeamento de vendor (bkpolts) para label amigável
VENDOR_LABELS: Dict[str, str] = {
    "huawei":        "Huawei",
    "zte":           "ZTE",
    "fiberhome":     "Fiberhome",
    "datacom":       "Datacom",
    "parks":         "Parks",
    "intelbras_g16": "Intelbras G16",
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
    # Ajustes específicos por vendor
    if vendor == 'intelbras_g16':
        # Intelbras G16 usa prompt GPON# — ajustar o passo de conexão telnet
        for step in all_steps:
            if step['step_type'] == 'telnet_connect':
                step['params']['login_prompt'] = 'Username:'
                step['params']['password_prompt'] = 'Password:'
                step['label'] = 'Conectar via Telnet (Intelbras G16)'
            if step['step_type'] == 'wait_for' and step['params'].get('wait_string') == '#':
                step['params']['wait_string'] = 'GPON#'
    elif vendor == 'huawei':
        for step in all_steps:
            if step['step_type'] == 'wait_for' and step['params'].get('wait_string') == '#':
                step['params']['wait_string'] = '#'
    elif vendor == 'zte':
        for step in all_steps:
            if step['step_type'] == 'telnet_connect':
                step['params']['login_prompt'] = 'login:'
                step['params']['password_prompt'] = 'Password:'
    elif vendor == 'fiberhome':
        for step in all_steps:
            if step['step_type'] == 'telnet_connect':
                step['params']['login_prompt'] = 'Login:'
                step['params']['password_prompt'] = 'Password:'

    # 8. Gerar descrição automática
    n_cmds = sum(1 for s in all_steps if s['step_type'] == 'send_command')
    n_ftp = sum(1 for s in all_steps if s['step_type'] == 'ftp_download')
    desc_parts = [f'Importado de: {filename}', f'Protocolo: {protocol.upper()}']
    if vendor_label:
        desc_parts.insert(0, f'Vendor: {vendor_label}')
    if n_cmds:
        desc_parts.append(f'{n_cmds} comando(s) detectado(s)')
    if n_ftp:
        desc_parts.append(f'{n_ftp} download(s) FTP')
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

"""
BR10 NetManager - Playbook Runner
Motor de execução de playbooks com suporte a:
- Telnet interativo (login automático, aguardar prompts, enviar comandos)
- SSH interativo
- Download FTP (do servidor FTP Mikrotik para o servidor BR10)
- Download SCP (do dispositivo para o servidor BR10 via Paramiko/SFTP)
- Envio de arquivo ao Telegram (sendDocument)
- Substituição de variáveis em runtime ({FTP_HOST}, {CLIENT_NAME}, {DATE}, etc.)
- Log passo a passo com status por passo
"""
import asyncio
import ftplib
import logging
import os
import re
import select as sel
import socket
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import paramiko

logger = logging.getLogger(__name__)

# Prompts que indicam que o dispositivo está pronto
READY_PROMPTS = [b">", b"#", b"$", b"%", b"# ", b"> ", b"$ ", b"]", b"] "]
PAGER_PROMPTS = [b"---- More ----", b"--More--", b"-- More --", b"<--- More --->", b"[Q]uit"]

# Diretório base para backups de dispositivos
DEVICE_BACKUP_DIR = os.environ.get("BACKUP_DIR", "/app/backups")


def _resolve_vars(text: str, variables: Dict[str, str]) -> str:
    """Substitui {VAR_NAME} pelo valor correspondente no dicionário de variáveis."""
    for key, value in variables.items():
        text = text.replace(f"{{{key}}}", str(value))
    return text


def _build_runtime_vars(
    device_name: str,
    device_ip: str,
    client_name: str,
    extra_vars: Dict[str, str],
) -> Dict[str, str]:
    """Constrói o dicionário de variáveis de runtime com valores automáticos."""
    now = datetime.now()
    base = {
        "DEVICE_NAME": device_name,
        "DEVICE_IP": device_ip,
        "CLIENT_NAME": client_name,
        "DATE": now.strftime("%Y-%m-%d"),
        "DATETIME": now.strftime("%Y%m%d_%H%M%S"),
        "YEAR": now.strftime("%Y"),
        "MONTH": now.strftime("%m"),
        "DAY": now.strftime("%d"),
    }
    base.update(extra_vars)
    return base


# ─── Telnet Helper ────────────────────────────────────────────────────────────

class TelnetSession:
    """Sessão Telnet interativa com suporte a login automático e aguardar prompts."""

    def __init__(self, host: str, port: int, timeout: int = 30):
        self.host = host
        self.port = port
        self.timeout = timeout
        self._sock: Optional[socket.socket] = None

    def connect(self) -> None:
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.settimeout(self.timeout)
        self._sock.connect((self.host, self.port))
        self._sock.setblocking(False)
        time.sleep(0.5)

    def recv(self, timeout: float = 3.0) -> bytes:
        """Recebe dados disponíveis com timeout."""
        if not self._sock:
            return b""
        buffer = b""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                ready, _, _ = sel.select([self._sock], [], [], 0.2)
                if ready:
                    chunk = self._sock.recv(4096)
                    if not chunk:
                        break
                    # Filtrar bytes de negociação Telnet (IAC sequences)
                    chunk = _strip_telnet_iac(chunk)
                    buffer += chunk
                else:
                    # Sem dados por 0.5s após ter recebido algo → provavelmente terminou
                    if buffer and time.time() - (deadline - timeout) > 0.5:
                        break
            except (BlockingIOError, socket.timeout):
                time.sleep(0.05)
            except Exception:
                break
        return buffer

    def send(self, data: str) -> None:
        """Envia string com CRLF."""
        if self._sock:
            self._sock.send((data + "\r\n").encode("utf-8", errors="replace"))

    def send_raw(self, data: bytes) -> None:
        if self._sock:
            self._sock.send(data)

    def wait_for(self, patterns: List[str], timeout: float = 30.0) -> Tuple[bool, str]:
        """
        Aguarda até que um dos padrões apareça na saída.
        Retorna (encontrado, buffer_completo).
        """
        buffer = b""
        deadline = time.time() + timeout
        while time.time() < deadline:
            chunk = self.recv(timeout=min(1.0, deadline - time.time()))
            if chunk:
                buffer += chunk
                text = buffer.decode("utf-8", errors="replace")
                for pattern in patterns:
                    if pattern in text:
                        return True, text
                # Responder paginadores automaticamente
                for pager in PAGER_PROMPTS:
                    if pager in buffer[-50:]:
                        self.send_raw(b" ")
                        time.sleep(0.1)
                        break
        return False, buffer.decode("utf-8", errors="replace")

    def close(self) -> None:
        if self._sock:
            try:
                self._sock.send(b"quit\r\n")
                time.sleep(0.2)
            except Exception:
                pass
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None


def _strip_telnet_iac(data: bytes) -> bytes:
    """Remove sequências IAC (Telnet option negotiation) dos dados recebidos."""
    result = bytearray()
    i = 0
    while i < len(data):
        if data[i] == 0xFF:  # IAC
            if i + 1 < len(data):
                cmd = data[i + 1]
                if cmd in (0xFB, 0xFC, 0xFD, 0xFE):  # WILL/WONT/DO/DONT
                    i += 3
                    continue
                elif cmd == 0xFF:
                    result.append(0xFF)
                    i += 2
                    continue
                else:
                    i += 2
                    continue
        result.append(data[i])
        i += 1
    return bytes(result)


# ─── SSH Helper ───────────────────────────────────────────────────────────────

class SSHSession:
    """Sessão SSH interativa para playbooks."""

    def __init__(self, host: str, port: int, username: str, password: str, timeout: int = 30):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.timeout = timeout
        self._client: Optional[paramiko.SSHClient] = None
        self._channel = None

    def connect(self) -> None:
        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self._client.connect(
            hostname=self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            timeout=self.timeout,
            allow_agent=False,
            look_for_keys=False,
        )
        self._channel = self._client.invoke_shell(term="vt100", width=220, height=50)
        self._channel.settimeout(2.0)
        time.sleep(0.5)

    def recv(self, timeout: float = 3.0) -> bytes:
        if not self._channel:
            return b""
        buffer = b""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                chunk = self._channel.recv(4096)
                if chunk:
                    buffer += chunk
                    time.sleep(0.05)
                else:
                    break
            except Exception:
                time.sleep(0.1)
        return buffer

    def wait_for(self, patterns: List[str], timeout: float = 30.0) -> Tuple[bool, str]:
        buffer = b""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                chunk = self._channel.recv(4096)
                if chunk:
                    buffer += chunk
                    text = buffer.decode("utf-8", errors="replace")
                    for pattern in patterns:
                        if pattern in text:
                            return True, text
                    for pager in PAGER_PROMPTS:
                        if pager in buffer[-50:]:
                            self._channel.send(" ")
                            time.sleep(0.1)
                            break
            except Exception:
                time.sleep(0.1)
        return False, buffer.decode("utf-8", errors="replace")

    def send(self, data: str) -> None:
        if self._channel:
            self._channel.send(data + "\n")

    def close(self) -> None:
        if self._channel:
            try:
                self._channel.send("quit\n")
                time.sleep(0.2)
                self._channel.close()
            except Exception:
                pass
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass


# ─── FTP Helper ───────────────────────────────────────────────────────────────

def ftp_download(
    host: str,
    port: int,
    username: str,
    password: str,
    remote_path: str,
    local_path: str,
    timeout: int = 60,
) -> Tuple[bool, str]:
    """
    Baixa um arquivo do servidor FTP (Mikrotik ou outro) para o servidor BR10.
    Cria os diretórios locais necessários automaticamente.
    """
    try:
        local_dir = os.path.dirname(local_path)
        os.makedirs(local_dir, exist_ok=True)

        ftp = ftplib.FTP()
        ftp.connect(host, port, timeout=timeout)
        ftp.login(username, password)

        with open(local_path, "wb") as f:
            ftp.retrbinary(f"RETR {remote_path}", f.write)

        ftp.quit()

        file_size = os.path.getsize(local_path)
        return True, f"Arquivo baixado: {local_path} ({file_size} bytes)"

    except ftplib.error_perm as e:
        return False, f"Erro FTP (permissão): {str(e)}"
    except ftplib.error_temp as e:
        return False, f"Erro FTP (temporário): {str(e)}"
    except Exception as e:
        return False, f"Erro FTP: {str(e)}"


# ─── Playbook Runner ──────────────────────────────────────────────────────────

class PlaybookRunner:
    """
    Executa um playbook passo a passo em um dispositivo.
    Suporta Telnet interativo, SSH, FTP download e variáveis de runtime.
    """

    def __init__(
        self,
        steps: List[Dict],
        variables: Dict[str, str],
        device_name: str,
        device_ip: str,
        device_username: str,
        device_password: str,
        device_telnet_port: int = 23,
        device_ssh_port: int = 22,
        client_name: str = "",
    ):
        self.steps = steps
        self.device_name = device_name
        self.device_ip = device_ip
        self.device_username = device_username
        self.device_password = device_password
        self.device_telnet_port = device_telnet_port
        self.device_ssh_port = device_ssh_port
        self.client_name = client_name

        # Construir variáveis de runtime
        self.variables = _build_runtime_vars(
            device_name=device_name,
            device_ip=device_ip,
            client_name=client_name,
            extra_vars=variables,
        )

        # Estado da sessão
        self._telnet: Optional[TelnetSession] = None
        self._ssh: Optional[SSHSession] = None
        self._step_logs: List[Dict] = []
        self._output_files: List[str] = []

    def _rv(self, text: str) -> str:
        """Resolve variáveis no texto."""
        return _resolve_vars(text, self.variables)

    def _log_step(
        self,
        step_index: int,
        step_type: str,
        label: str,
        status: str,
        output: str = "",
        duration_ms: int = 0,
        error: str = "",
    ) -> Dict:
        entry = {
            "step": step_index + 1,
            "type": step_type,
            "label": label or step_type,
            "status": status,
            "output": output[:2000] if output else "",  # limitar tamanho
            "error": error,
            "duration_ms": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }
        self._step_logs.append(entry)
        return entry

    def run(self) -> Dict[str, Any]:
        """
        Executa todos os passos do playbook de forma síncrona.
        Retorna um dicionário com status, step_logs e output_files.
        """
        start_total = time.time()
        overall_status = "success"
        error_message = ""

        for i, step in enumerate(self.steps):
            step_type = step.get("step_type", "")
            params = step.get("params", {})
            label = step.get("label", "") or step_type
            on_error = step.get("on_error", "stop")

            # Resolver variáveis nos parâmetros
            resolved_params = {
                k: self._rv(str(v)) if isinstance(v, str) else v
                for k, v in params.items()
            }

            step_start = time.time()
            success, output, err = self._execute_step(step_type, resolved_params)
            duration = int((time.time() - step_start) * 1000)

            self._log_step(
                step_index=i,
                step_type=step_type,
                label=label,
                status="success" if success else "error",
                output=output,
                duration_ms=duration,
                error=err,
            )

            if not success:
                if on_error == "stop":
                    overall_status = "error"
                    error_message = f"Passo {i+1} ({label}) falhou: {err}"
                    break
                # on_error == "continue" → segue para o próximo passo

        # Fechar conexões abertas
        self._close_connections()

        total_duration = int((time.time() - start_total) * 1000)

        return {
            "status": overall_status,
            "step_logs": self._step_logs,
            "output_files": self._output_files,
            "error_message": error_message,
            "duration_ms": total_duration,
        }

    def _execute_step(self, step_type: str, params: Dict) -> Tuple[bool, str, str]:
        """
        Executa um passo individual.
        Retorna (sucesso, output, mensagem_de_erro).
        """
        try:
            if step_type == "telnet_connect":
                return self._step_telnet_connect(params)
            elif step_type == "ssh_connect":
                return self._step_ssh_connect(params)
            elif step_type == "disconnect":
                self._close_connections()
                return True, "Conexão encerrada.", ""
            elif step_type == "send_command":
                return self._step_send_command(params)
            elif step_type == "wait_for":
                return self._step_wait_for(params)
            elif step_type == "send_string":
                return self._step_send_string(params)
            elif step_type == "ftp_download":
                return self._step_ftp_download(params)
            elif step_type == "ftp_upload":
                return False, "", "FTP upload ainda não implementado."
            elif step_type == "scp_download":
                return self._step_scp_download(params)
            elif step_type == "telegram_send_file":
                return self._step_telegram_send_file(params)
            elif step_type == "sleep":
                seconds = float(params.get("seconds", 1))
                time.sleep(seconds)
                return True, f"Aguardou {seconds}s.", ""
            elif step_type == "log":
                msg = params.get("message", "")
                return True, msg, ""
            else:
                return False, "", f"Tipo de passo desconhecido: {step_type}"
        except Exception as e:
            logger.exception(f"Erro no passo {step_type}")
            return False, "", f"Exceção: {str(e)}"

    # ─── Passos individuais ───────────────────────────────────────────────────

    def _step_telnet_connect(self, params: Dict) -> Tuple[bool, str, str]:
        host = params.get("host", self.device_ip)
        port = int(params.get("port", self.device_telnet_port))
        username = params.get("username", self.device_username)
        password = params.get("password", self.device_password)
        timeout = int(params.get("timeout", 30))

        try:
            self._telnet = TelnetSession(host, port, timeout)
            self._telnet.connect()

            # Aguardar banner inicial
            banner = self._telnet.recv(timeout=3.0).decode("utf-8", errors="replace")

            # Login automático — aguardar prompt de usuário
            login_prompts = ["Username:", "Login:", "User:", "login:"]
            found, buf = self._telnet.wait_for(login_prompts + [">", "#"], timeout=10.0)

            if any(p.lower() in buf.lower() for p in ["username:", "login:", "user:"]):
                self._telnet.send(username)
                time.sleep(0.5)
                # Aguardar prompt de senha
                _, buf2 = self._telnet.wait_for(["Password:", "password:"], timeout=10.0)
                self._telnet.send(password)
                time.sleep(1.0)
                # Aguardar prompt de comando
                _, buf3 = self._telnet.wait_for([">", "#", "$"], timeout=15.0)
                return True, f"Conectado via Telnet em {host}:{port}", ""
            elif any(buf.endswith(p.decode()) for p in [b">", b"#", b"$"]):
                # Já está no prompt (sem autenticação ou já autenticado)
                return True, f"Conectado via Telnet em {host}:{port} (sem login)", ""
            else:
                # Tentar enviar credenciais mesmo assim
                self._telnet.send(username)
                time.sleep(0.5)
                self._telnet.send(password)
                time.sleep(1.0)
                return True, f"Conectado via Telnet em {host}:{port}", ""

        except Exception as e:
            return False, "", f"Falha ao conectar Telnet em {host}:{port}: {str(e)}"

    def _step_ssh_connect(self, params: Dict) -> Tuple[bool, str, str]:
        host = params.get("host", self.device_ip)
        port = int(params.get("port", self.device_ssh_port))
        username = params.get("username", self.device_username)
        password = params.get("password", self.device_password)
        timeout = int(params.get("timeout", 30))

        try:
            self._ssh = SSHSession(host, port, username, password, timeout)
            self._ssh.connect()
            # Aguardar prompt inicial
            self._ssh.wait_for([">", "#", "$"], timeout=10.0)
            return True, f"Conectado via SSH em {host}:{port}", ""
        except Exception as e:
            return False, "", f"Falha ao conectar SSH em {host}:{port}: {str(e)}"

    def _step_send_command(self, params: Dict) -> Tuple[bool, str, str]:
        command = params.get("command", "")
        wait_patterns = params.get("wait_for", [">", "#", "$"])
        timeout = float(params.get("timeout", 30))

        if isinstance(wait_patterns, str):
            wait_patterns = [wait_patterns]

        if not command:
            return False, "", "Comando vazio."

        if self._telnet:
            self._telnet.send(command)
            found, output = self._telnet.wait_for(wait_patterns, timeout=timeout)
            if not found and not output:
                return False, "", f"Timeout aguardando resposta após '{command}'"
            return True, output, ""
        elif self._ssh:
            self._ssh.send(command)
            found, output = self._ssh.wait_for(wait_patterns, timeout=timeout)
            return True, output, ""
        else:
            return False, "", "Nenhuma conexão ativa. Use telnet_connect ou ssh_connect primeiro."

    def _step_wait_for(self, params: Dict) -> Tuple[bool, str, str]:
        patterns = params.get("patterns", params.get("pattern", []))
        timeout = float(params.get("timeout", 30))

        if isinstance(patterns, str):
            patterns = [patterns]

        if self._telnet:
            found, output = self._telnet.wait_for(patterns, timeout=timeout)
        elif self._ssh:
            found, output = self._ssh.wait_for(patterns, timeout=timeout)
        else:
            return False, "", "Nenhuma conexão ativa."

        if found:
            return True, output, ""
        return False, output, f"Timeout aguardando padrão(ões): {patterns}"

    def _step_send_string(self, params: Dict) -> Tuple[bool, str, str]:
        """Envia uma string sem aguardar resposta."""
        text = params.get("text", "")
        if self._telnet:
            self._telnet.send(text)
        elif self._ssh:
            self._ssh.send(text)
        else:
            return False, "", "Nenhuma conexão ativa."
        time.sleep(float(params.get("delay", 0.3)))
        return True, f"Enviado: {text}", ""

    def _step_ftp_download(self, params: Dict) -> Tuple[bool, str, str]:
        host = params.get("host", "")
        port = int(params.get("port", 21))
        username = params.get("user", params.get("username", ""))
        password = params.get("pass", params.get("password", ""))
        remote_path = params.get("remote_path", "")
        local_dir = params.get("local_dir", os.path.join(DEVICE_BACKUP_DIR, "devices",
                                                           self.client_name, self.variables.get("DATE", "")))
        filename = params.get("filename", os.path.basename(remote_path))
        timeout = int(params.get("timeout", 60))

        if not host:
            return False, "", "FTP host não configurado."
        if not remote_path:
            return False, "", "Caminho remoto FTP não configurado."

        local_path = os.path.join(local_dir, filename)

        success, msg = ftp_download(
            host=host,
            port=port,
            username=username,
            password=password,
            remote_path=remote_path,
            local_path=local_path,
            timeout=timeout,
        )

        if success:
            self._output_files.append(local_path)

        return success, msg, "" if success else msg

    def _step_scp_download(self, params: Dict) -> Tuple[bool, str, str]:
        """
        Baixa um arquivo do dispositivo remoto via SCP (SFTP do Paramiko).
        Pode usar a conexão SSH já aberta ou criar uma nova.

        Parâmetros:
          host         — IP do dispositivo (default: DEVICE_IP)
          port         — porta SSH (default: 22)
          username     — usuário SSH
          password     — senha SSH
          remote_path  — caminho do arquivo no dispositivo (ex: /backup.cfg)
          local_dir    — diretório local de destino
          filename     — nome do arquivo local (default: basename do remote_path)
          timeout      — timeout em segundos
        """
        host = params.get("host", self.device_ip)
        port = int(params.get("port", self.device_ssh_port))
        username = params.get("username", self.device_username)
        password = params.get("password", self.device_password)
        remote_path = params.get("remote_path", "")
        local_dir = params.get("local_dir", os.path.join(
            DEVICE_BACKUP_DIR, "devices", self.client_name, self.variables.get("DATE", "")
        ))
        filename = params.get("filename", os.path.basename(remote_path) if remote_path else "backup.cfg")
        timeout = int(params.get("timeout", 120))

        if not remote_path:
            return False, "", "Caminho remoto SCP não configurado."

        try:
            os.makedirs(local_dir, exist_ok=True)
            local_path = os.path.join(local_dir, filename)

            # Tentar reutilizar a conexão SSH aberta
            ssh_client = None
            created_new = False

            if self._ssh and self._ssh._client:
                ssh_client = self._ssh._client
            else:
                # Criar conexão SSH temporária apenas para o SCP
                ssh_client = paramiko.SSHClient()
                ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                ssh_client.connect(
                    hostname=host,
                    port=port,
                    username=username,
                    password=password,
                    timeout=timeout,
                    allow_agent=False,
                    look_for_keys=False,
                )
                created_new = True

            # Usar SFTP (protocolo subjacente do SCP no Paramiko)
            sftp = ssh_client.open_sftp()
            sftp.get(remote_path, local_path)
            sftp.close()

            if created_new:
                ssh_client.close()

            file_size = os.path.getsize(local_path)
            self._output_files.append(local_path)
            return True, f"Arquivo baixado via SCP: {local_path} ({file_size} bytes)", ""

        except FileNotFoundError:
            return False, "", f"Arquivo não encontrado no dispositivo: {remote_path}"
        except Exception as e:
            return False, "", f"Erro SCP: {str(e)}"

    def _step_telegram_send_file(self, params: Dict) -> Tuple[bool, str, str]:
        """
        Envia um arquivo ao Telegram via API sendDocument.

        Parâmetros:
          token    — Bot token do Telegram
          chat_id  — Chat ID do Telegram
          file     — caminho do arquivo local (ou 'latest' para usar o último output_file)
          caption  — legenda do arquivo (suporta variáveis)
        """
        import requests as req_lib

        token = params.get("token", self.variables.get("TELEGRAM_TOKEN", ""))
        chat_id = params.get("chat_id", self.variables.get("TELEGRAM_CHAT_ID", ""))
        file_path = params.get("file", "latest")
        caption = params.get("caption", f"Backup {self.device_name} - {self.variables.get('DATETIME', '')}")

        if not token or not chat_id:
            return False, "", "Token ou Chat ID do Telegram não configurado."

        # 'latest' = usar o último arquivo gerado pelo playbook
        if file_path == "latest":
            if not self._output_files:
                return False, "", "Nenhum arquivo de backup gerado para enviar ao Telegram."
            file_path = self._output_files[-1]

        if not os.path.exists(file_path):
            return False, "", f"Arquivo não encontrado: {file_path}"

        try:
            url = f"https://api.telegram.org/bot{token}/sendDocument"
            with open(file_path, "rb") as f:
                resp = req_lib.post(
                    url,
                    data={"chat_id": chat_id, "caption": caption[:1024]},
                    files={"document": (os.path.basename(file_path), f)},
                    timeout=60,
                )

            data = resp.json()
            if resp.status_code == 200 and data.get("ok"):
                return True, f"Arquivo enviado ao Telegram: {os.path.basename(file_path)}", ""
            else:
                err = data.get("description", f"HTTP {resp.status_code}")
                return False, "", f"Erro Telegram: {err}"

        except Exception as e:
            return False, "", f"Erro ao enviar para Telegram: {str(e)}"

    def _close_connections(self) -> None:
        if self._telnet:
            try:
                self._telnet.close()
            except Exception:
                pass
            self._telnet = None
        if self._ssh:
            try:
                self._ssh.close()
            except Exception:
                pass
            self._ssh = None

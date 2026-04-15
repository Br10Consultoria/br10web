"""
BR10 NetManager - Terminal Service
Serviço de terminal web com suporte a SSH e Telnet via WebSocket.
"""
import asyncio
import logging
import socket
import time
from typing import Optional, Dict
from enum import Enum

import paramiko

logger = logging.getLogger(__name__)


class TerminalProtocol(str, Enum):
    SSH = "ssh"
    TELNET = "telnet"


class SSHTerminalSession:
    """Sessão SSH interativa via WebSocket."""

    def __init__(
        self,
        host: str,
        port: int = 22,
        username: str = "",
        password: Optional[str] = None,
        private_key: Optional[str] = None,
        timeout: int = 30,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.private_key = private_key
        self.timeout = timeout
        self.client: Optional[paramiko.SSHClient] = None
        self.channel: Optional[paramiko.Channel] = None
        self.connected = False

    def connect(self) -> bool:
        """Estabelece conexão SSH."""
        # ── Validação prévia de credenciais ──────────────────────────────────
        # Verificar se há pelo menos um método de autenticação disponível
        # antes de tentar conectar para evitar "No authentication methods available"
        has_password = bool(self.password and str(self.password).strip())
        has_key = bool(self.private_key and str(self.private_key).strip())

        if not has_password and not has_key:
            raise ValueError(
                "Nenhuma credencial de autenticação configurada para este dispositivo. "
                "Cadastre a senha ou chave SSH privada nas configurações do dispositivo."
            )

        if not self.username or not str(self.username).strip():
            raise ValueError(
                "Nome de usuário não configurado para este dispositivo. "
                "Cadastre o usuário nas configurações do dispositivo."
            )

        try:
            self.client = paramiko.SSHClient()
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs = {
                "hostname": self.host,
                "port": self.port,
                "username": self.username,
                "timeout": self.timeout,
                "allow_agent": False,
                "look_for_keys": False,
            }

            # Adicionar chave privada se disponível
            if has_key:
                import io
                key_file = io.StringIO(self.private_key)
                pkey = None
                # Tentar RSA
                try:
                    pkey = paramiko.RSAKey.from_private_key(key_file)
                except Exception:
                    pass
                # Tentar Ed25519
                if pkey is None:
                    try:
                        key_file.seek(0)
                        pkey = paramiko.Ed25519Key.from_private_key(key_file)
                    except Exception:
                        pass
                # Tentar ECDSA
                if pkey is None:
                    try:
                        key_file.seek(0)
                        pkey = paramiko.ECDSAKey.from_private_key(key_file)
                    except Exception:
                        pass
                if pkey:
                    connect_kwargs["pkey"] = pkey

            # Adicionar senha se disponível
            if has_password:
                connect_kwargs["password"] = self.password

            # Conectar via SSH — tenta password, depois keyboard-interactive
            auth_ok = False
            last_auth_error = None

            # Tentativa 1: password auth direto via Transport (mais confiável)
            if has_password:
                try:
                    transport = paramiko.Transport((self.host, self.port))
                    transport.connect()
                    transport.auth_password(self.username, self.password)
                    self.client._transport = transport
                    auth_ok = True
                    logger.debug(f"SSH password auth OK em {self.host}:{self.port}")
                except paramiko.AuthenticationException as e:
                    last_auth_error = e
                    logger.debug(f"SSH password auth falhou em {self.host}:{self.port}: {e}")
                except Exception as e:
                    last_auth_error = e
                    logger.debug(f"SSH transport password erro em {self.host}:{self.port}: {e}")

            # Tentativa 2: keyboard-interactive (PAM / servidores Linux)
            if not auth_ok and has_password:
                try:
                    transport = paramiko.Transport((self.host, self.port))
                    transport.connect()
                    _pwd = self.password
                    def _ki_handler(title, instructions, prompt_list):
                        return [_pwd for _ in prompt_list]
                    transport.auth_interactive(self.username, _ki_handler)
                    self.client._transport = transport
                    auth_ok = True
                    logger.debug(f"SSH keyboard-interactive auth OK em {self.host}:{self.port}")
                except paramiko.AuthenticationException as e:
                    logger.debug(f"SSH keyboard-interactive falhou em {self.host}:{self.port}: {e}")
                    last_auth_error = e
                except Exception as e:
                    logger.debug(f"SSH keyboard-interactive erro em {self.host}:{self.port}: {e}")

            # Tentativa 3: client.connect padrão (fallback)
            if not auth_ok:
                try:
                    self.client = paramiko.SSHClient()
                    self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    self.client.connect(**connect_kwargs)
                    auth_ok = True
                    logger.debug(f"SSH client.connect padrão OK em {self.host}:{self.port}")
                except paramiko.AuthenticationException as e:
                    last_auth_error = e
                except Exception as e:
                    last_auth_error = e

            if not auth_ok:
                raise paramiko.AuthenticationException(
                    str(last_auth_error) if last_auth_error else "Authentication failed"
                )

            self.channel = self.client.invoke_shell(
                term="xterm-256color",
                width=220,
                height=50,
            )
            self.channel.settimeout(0.1)
            self.connected = True
            logger.info(f"SSH conectado: {self.host}:{self.port} (usuário: {self.username})")
            return True

        except paramiko.AuthenticationException as e:
            logger.error(f"SSH auth falhou: {self.host} - {e}")
            raise ValueError(
                "Falha na autenticação SSH. Verifique usuário e senha/chave do dispositivo."
            )
        except paramiko.SSHException as e:
            logger.error(f"SSH erro: {e}")
            raise ValueError(f"Erro SSH: {str(e)}")
        except socket.timeout:
            raise ValueError(f"Timeout ao conectar em {self.host}:{self.port}")
        except ConnectionRefusedError:
            raise ValueError(f"Conexão recusada em {self.host}:{self.port} — verifique se o SSH está ativo.")
        except OSError as e:
            logger.error(f"SSH OSError: {e}")
            raise ValueError(f"Erro de rede ao conectar em {self.host}:{self.port}: {str(e)}")
        except Exception as e:
            logger.error(f"SSH conexão falhou: {e}")
            raise ValueError(f"Erro de conexão: {str(e)}")

    def send(self, data: str):
        """Envia dados para o canal SSH."""
        if self.channel and self.connected:
            self.channel.send(data)

    def recv(self, size: int = 4096) -> Optional[str]:
        """Recebe dados do canal SSH."""
        if not self.channel or not self.connected:
            return None
        try:
            if self.channel.recv_ready():
                data = self.channel.recv(size)
                return data.decode("utf-8", errors="replace")
        except Exception:
            pass
        return None

    def resize(self, width: int, height: int):
        """Redimensiona terminal."""
        if self.channel:
            self.channel.resize_pty(width=width, height=height)

    def close(self):
        """Fecha conexão SSH."""
        self.connected = False
        if self.channel:
            try:
                self.channel.close()
            except Exception:
                pass
        if self.client:
            try:
                self.client.close()
            except Exception:
                pass
        logger.info(f"SSH desconectado: {self.host}")


class TelnetTerminalSession:
    """Sessão Telnet interativa via WebSocket."""

    def __init__(
        self,
        host: str,
        port: int = 23,
        username: str = "",
        password: Optional[str] = None,
        timeout: int = 30,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.timeout = timeout
        self.sock: Optional[socket.socket] = None
        self.connected = False
        self._buffer = b""

    def connect(self) -> bool:
        """Estabelece conexão Telnet."""
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect((self.host, self.port))
            self.sock.setblocking(False)
            self.connected = True

            # Aguardar banner inicial
            time.sleep(0.5)
            banner = self._raw_recv()

            # Auto-login básico
            if self.username:
                time.sleep(0.3)
                self.sock.send((self.username + "\r\n").encode())
                time.sleep(0.5)

            if self.password:
                time.sleep(0.3)
                self.sock.send((self.password + "\r\n").encode())
                time.sleep(0.5)

            logger.info(f"Telnet conectado: {self.host}:{self.port}")
            return True

        except socket.timeout:
            raise ValueError(f"Timeout ao conectar em {self.host}:{self.port}")
        except ConnectionRefusedError:
            raise ValueError(f"Conexão recusada em {self.host}:{self.port} — verifique se o Telnet está ativo.")
        except Exception as e:
            raise ValueError(f"Erro Telnet: {str(e)}")

    def _raw_recv(self, size: int = 4096) -> bytes:
        """Recebe dados brutos do socket."""
        try:
            return self.sock.recv(size)
        except BlockingIOError:
            return b""
        except Exception:
            return b""

    def send(self, data: str):
        """Envia dados via Telnet."""
        if self.sock and self.connected:
            try:
                self.sock.send(data.encode("utf-8", errors="replace"))
            except Exception as e:
                logger.error(f"Telnet send error: {e}")
                self.connected = False

    def recv(self, size: int = 4096) -> Optional[str]:
        """Recebe dados do Telnet."""
        if not self.sock or not self.connected:
            return None
        try:
            data = self._raw_recv(size)
            if data:
                # Filtrar comandos IAC do protocolo Telnet
                cleaned = self._strip_telnet_commands(data)
                return cleaned.decode("utf-8", errors="replace") if cleaned else None
        except Exception:
            pass
        return None

    def _strip_telnet_commands(self, data: bytes) -> bytes:
        """Remove comandos de controle do protocolo Telnet."""
        result = bytearray()
        i = 0
        while i < len(data):
            if data[i] == 255:  # IAC
                if i + 1 < len(data):
                    cmd = data[i + 1]
                    if cmd in (251, 252, 253, 254):  # WILL, WONT, DO, DONT
                        i += 3
                        continue
                    elif cmd == 250:  # SB (subnegotiation)
                        j = i + 2
                        while j < len(data) - 1:
                            if data[j] == 255 and data[j + 1] == 240:
                                i = j + 2
                                break
                            j += 1
                        continue
                    else:
                        i += 2
                        continue
            result.append(data[i])
            i += 1
        return bytes(result)

    def close(self):
        """Fecha conexão Telnet."""
        self.connected = False
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
        logger.info(f"Telnet desconectado: {self.host}")


# Gerenciador de sessões ativas
class SessionManager:
    """Gerencia sessões de terminal ativas."""

    def __init__(self):
        self._sessions: Dict[str, object] = {}

    def add(self, session_id: str, session):
        self._sessions[session_id] = session

    def get(self, session_id: str):
        return self._sessions.get(session_id)

    def remove(self, session_id: str):
        session = self._sessions.pop(session_id, None)
        if session:
            session.close()

    def count(self) -> int:
        return len(self._sessions)

    def cleanup_inactive(self):
        """Remove sessões inativas."""
        inactive = [
            sid for sid, s in self._sessions.items()
            if not getattr(s, "connected", False)
        ]
        for sid in inactive:
            self._sessions.pop(sid, None)


session_manager = SessionManager()

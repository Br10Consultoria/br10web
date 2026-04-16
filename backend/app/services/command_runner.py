"""
BR10 NetManager - Command Runner Service
Executa comandos em dispositivos via SSH ou Telnet e captura a saída completa.
Reutiliza as classes SSHTerminalSession e TelnetTerminalSession do terminal.py.
"""
import asyncio
import logging
import time
from typing import Optional, Tuple
import paramiko

from app.services.terminal import SSHTerminalSession, TelnetTerminalSession

logger = logging.getLogger(__name__)

# Prompts que indicam que o dispositivo está pronto para receber comandos
READY_PROMPTS = [
    b">", b"#", b"$", b"%",
    b"# ", b"> ", b"$ ",
    b"]", b"] ",
]

# Prompts que indicam paginação (More, --More--, etc.)
PAGER_PROMPTS = [
    b"---- More ----", b"--More--", b"-- More --",
    b"<--- More --->", b"more", b"More",
    b"Press any key", b"[Q]uit",
]


class CommandRunner:
    """
    Executa um ou mais comandos em um dispositivo via SSH ou Telnet,
    capturando toda a saída e retornando como string.
    """

    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: Optional[str],
        protocol: str = "ssh",
        timeout: int = 30,
        private_key: Optional[str] = None,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.protocol = protocol.lower()
        self.timeout = timeout
        self.private_key = private_key

    def _validate_ssh_credentials(self):
        """
        Valida se há credenciais suficientes para autenticação SSH.
        Lança ValueError com mensagem clara se não houver.
        """
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

    def _build_ssh_connect_kwargs(self) -> dict:
        """Monta os kwargs de conexão SSH com os métodos de autenticação disponíveis."""
        connect_kwargs = {
            "hostname": self.host,
            "port": self.port,
            "username": self.username,
            "timeout": self.timeout,
            "allow_agent": False,
            "look_for_keys": False,
        }

        has_key = bool(self.private_key and str(self.private_key).strip())
        has_password = bool(self.password and str(self.password).strip())

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

        if has_password:
            connect_kwargs["password"] = self.password

        return connect_kwargs

    # ─── SSH ──────────────────────────────────────────────────────────────────

    def _run_ssh(self, commands: list[str]) -> Tuple[bool, str]:
        """Executa comandos via SSH usando exec_command (não interativo)."""
        # Validar credenciais antes de tentar conectar
        self._validate_ssh_credentials()

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        output_parts = []

        try:
            connect_kwargs = self._build_ssh_connect_kwargs()
            client.connect(**connect_kwargs)

            for cmd in commands:
                cmd = cmd.strip()
                if not cmd:
                    continue

                stdin, stdout, stderr = client.exec_command(cmd, timeout=self.timeout)
                out = stdout.read().decode("utf-8", errors="replace")
                err = stderr.read().decode("utf-8", errors="replace")

                if len(commands) > 1:
                    output_parts.append(f"$ {cmd}")
                if out:
                    output_parts.append(out)
                if err:
                    output_parts.append(f"[stderr] {err}")

            return True, "\n".join(output_parts)

        except paramiko.AuthenticationException:
            return False, "Falha na autenticação SSH. Verifique usuário/senha."
        except paramiko.SSHException as e:
            return False, f"Erro SSH: {str(e)}"
        except ValueError as e:
            return False, str(e)
        except Exception as e:
            return False, f"Erro de conexão SSH: {str(e)}"
        finally:
            try:
                client.close()
            except Exception:
                pass

    def _run_ssh_interactive(self, commands: list[str]) -> Tuple[bool, str]:
        """
        Executa comandos via SSH em modo interativo (shell).
        Útil para dispositivos que não suportam exec_command (ex: Huawei, ZTE).
        """
        # Validar credenciais antes de tentar conectar
        self._validate_ssh_credentials()

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            connect_kwargs = self._build_ssh_connect_kwargs()
            client.connect(**connect_kwargs)
            channel = client.invoke_shell(term="vt100", width=220, height=50)
            channel.settimeout(2.0)

            # Aguardar prompt inicial
            self._wait_for_prompt(channel, timeout=10)

            output_parts = []

            for cmd in commands:
                cmd = cmd.strip()
                if not cmd:
                    continue

                # Enviar comando
                channel.send(cmd + "\n")
                time.sleep(0.3)

                # Coletar saída até o próximo prompt
                cmd_output = self._collect_output(channel, timeout=self.timeout)
                if len(commands) > 1:
                    output_parts.append(f"\n--- {cmd} ---")
                output_parts.append(cmd_output)

            # Fechar sessão
            try:
                channel.send("quit\n")
            except Exception:
                pass

            channel.close()
            return True, "\n".join(output_parts)

        except paramiko.AuthenticationException:
            return False, "Falha na autenticação SSH. Verifique usuário/senha."
        except ValueError as e:
            return False, str(e)
        except Exception as e:
            return False, f"Erro SSH interativo: {str(e)}"
        finally:
            try:
                client.close()
            except Exception:
                pass

    def _wait_for_prompt(self, channel, timeout: int = 10) -> str:
        """
        Aguarda um prompt de comando no canal SSH.
        Trata automaticamente prompts de senha adicionais (AAA/RADIUS Huawei)
        e prompts de confirmação (Y/N).
        """
        buffer = b""
        start = time.time()
        password_sent = False
        while time.time() - start < timeout:
            try:
                chunk = channel.recv(4096)
                if chunk:
                    buffer += chunk
                    tail = buffer[-200:].lower()

                    # Tratar prompt de senha adicional (AAA/RADIUS Huawei)
                    if not password_sent and (b"password:" in tail or b"senha:" in tail):
                        if self.password:
                            channel.send(self.password + "\n")
                            password_sent = True
                            time.sleep(0.5)
                            buffer = b""  # limpar buffer após enviar senha
                            continue

                    # Tratar prompt de confirmação (Y/N)
                    if b"[y/n]" in tail or b"(y/n)" in tail:
                        channel.send("y\n")
                        time.sleep(0.3)
                        continue

                    # Verificar se chegou ao prompt pronto
                    if any(buffer.endswith(p) or buffer.endswith(p + b" ") for p in READY_PROMPTS):
                        return buffer.decode("utf-8", errors="replace")
            except Exception:
                pass
            time.sleep(0.1)
        return buffer.decode("utf-8", errors="replace")

    def _collect_output(self, channel, timeout: int = 30) -> str:
        """Coleta saída do canal SSH até encontrar um prompt ou timeout."""
        buffer = b""
        start = time.time()
        last_data = time.time()

        while time.time() - start < timeout:
            try:
                chunk = channel.recv(4096)
                if chunk:
                    buffer += chunk
                    last_data = time.time()
                    tail = buffer[-200:].lower()

                    # Responder a paginadores automaticamente
                    for pager in PAGER_PROMPTS:
                        if pager in buffer[-100:]:
                            channel.send(" ")  # espaço avança a página
                            time.sleep(0.2)
                            break

                    # Tratar prompt de senha inesperado durante execução
                    if b"password:" in tail or b"senha:" in tail:
                        if self.password:
                            channel.send(self.password + "\n")
                            time.sleep(0.5)
                            continue

                    # Verificar se chegou ao prompt final
                    stripped = buffer.rstrip()
                    if any(stripped.endswith(p) for p in READY_PROMPTS):
                        break
                else:
                    # Sem dados — verificar idle timeout
                    if time.time() - last_data > 3.0:
                        break
            except Exception:
                if time.time() - last_data > 2.0:
                    break
                time.sleep(0.1)

        return buffer.decode("utf-8", errors="replace")

    # ─── Telnet ───────────────────────────────────────────────────────────────

    def _run_telnet(self, commands: list[str]) -> Tuple[bool, str]:
        """Executa comandos via Telnet."""
        import socket

        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(self.timeout)
            sock.connect((self.host, self.port))
            sock.setblocking(False)

            output_parts = []

            # Aguardar banner e fazer login
            time.sleep(1.0)
            banner = self._telnet_recv(sock, timeout=5)

            # Login automático
            if self.username:
                sock.send((self.username + "\r\n").encode())
                time.sleep(0.8)
                self._telnet_recv(sock, timeout=3)

            if self.password:
                sock.send((self.password + "\r\n").encode())
                time.sleep(1.0)
                self._telnet_recv(sock, timeout=5)  # consumir resposta do login

            # Executar cada comando
            for cmd in commands:
                cmd = cmd.strip()
                if not cmd:
                    continue

                sock.send((cmd + "\r\n").encode())
                time.sleep(0.5)

                cmd_output = self._telnet_collect(sock, timeout=self.timeout)
                if len(commands) > 1:
                    output_parts.append(f"\n--- {cmd} ---")
                output_parts.append(cmd_output)

            # Logout
            try:
                sock.send(b"quit\r\n")
                time.sleep(0.3)
            except Exception:
                pass

            return True, "\n".join(output_parts)

        except socket.timeout:
            return False, f"Timeout ao conectar em {self.host}:{self.port}"
        except ConnectionRefusedError:
            return False, f"Conexão recusada em {self.host}:{self.port}"
        except Exception as e:
            return False, f"Erro Telnet: {str(e)}"
        finally:
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass

    def _telnet_recv(self, sock, timeout: int = 3) -> bytes:
        """Recebe dados do socket Telnet com timeout."""
        import select as sel
        buffer = b""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                ready, _, _ = sel.select([sock], [], [], 0.2)
                if ready:
                    chunk = sock.recv(4096)
                    if chunk:
                        buffer += chunk
                    else:
                        break
            except BlockingIOError:
                pass
            except Exception:
                break
        return self._strip_telnet_iac(buffer)

    def _telnet_collect(self, sock, timeout: int = 30) -> str:
        """Coleta saída Telnet até prompt ou timeout."""
        import select as sel
        buffer = b""
        start = time.time()
        last_data = time.time()

        while time.time() - start < timeout:
            try:
                ready, _, _ = sel.select([sock], [], [], 0.3)
                if ready:
                    chunk = sock.recv(4096)
                    if chunk:
                        buffer += chunk
                        last_data = time.time()

                        clean = self._strip_telnet_iac(buffer)

                        # Responder paginadores
                        for pager in PAGER_PROMPTS:
                            if pager in clean[-100:]:
                                sock.send(b" ")
                                time.sleep(0.2)
                                break

                        # Verificar prompt final
                        stripped = clean.rstrip()
                        if any(stripped.endswith(p) for p in READY_PROMPTS):
                            break
                    else:
                        break
                else:
                    if time.time() - last_data > 3.0:
                        break
            except Exception:
                if time.time() - last_data > 2.0:
                    break

        clean = self._strip_telnet_iac(buffer)
        return clean.decode("utf-8", errors="replace")

    def _strip_telnet_iac(self, data: bytes) -> bytes:
        """Remove comandos IAC do protocolo Telnet."""
        result = bytearray()
        i = 0
        while i < len(data):
            if data[i] == 255:  # IAC
                if i + 1 < len(data):
                    cmd = data[i + 1]
                    if cmd in (251, 252, 253, 254):
                        i += 3
                        continue
                    elif cmd == 250:
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

    # ─── Interface pública ────────────────────────────────────────────────────

    async def run(self, command: str, interactive: bool = False) -> Tuple[bool, str, int]:
        """
        Executa um ou mais comandos (separados por \\n) no dispositivo.
        Retorna (sucesso, saída, duração_ms).
        """
        commands = [c for c in command.strip().splitlines() if c.strip()]
        if not commands:
            return False, "Nenhum comando fornecido", 0

        start = time.time()
        loop = asyncio.get_event_loop()

        try:
            if self.protocol == "ssh":
                if interactive:
                    success, output = await loop.run_in_executor(
                        None, self._run_ssh_interactive, commands
                    )
                else:
                    success, output = await loop.run_in_executor(
                        None, self._run_ssh, commands
                    )
            else:
                success, output = await loop.run_in_executor(
                    None, self._run_telnet, commands
                )
        except Exception as e:
            success = False
            output = f"Erro inesperado: {str(e)}"

        duration_ms = int((time.time() - start) * 1000)
        return success, output, duration_ms

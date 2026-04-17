"""
BR10 NetManager - Command Runner Service
Executa comandos em dispositivos via SSH ou Telnet e captura a saída completa.

CORREÇÕES v2:
- Telnet: tratamento correto de negociação IAC (responde WONT/DONT para evitar Broken pipe)
- Telnet: reconexão automática com até 2 tentativas em caso de BrokenPipeError/ConnectionReset
- Telnet: timeout de socket separado para connect vs. read
- Telnet: logging detalhado de erros (aparece nos logs do container)
- Telnet: keep-alive via SO_KEEPALIVE para conexões longas
- Geral: todos os erros são logados com logger.error() para aparecer nos logs do backend
"""
import asyncio
import logging
import select as sel
import socket
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

# Comandos IAC do protocolo Telnet
IAC  = 255  # Interpret As Command
DONT = 254
DO   = 253
WONT = 252
WILL = 251
SB   = 250  # Subnegotiation Begin
SE   = 240  # Subnegotiation End


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
            for KeyClass in (paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey):
                try:
                    key_file.seek(0)
                    pkey = KeyClass.from_private_key(key_file)
                    break
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
            msg = "Falha na autenticação SSH. Verifique usuário/senha."
            logger.error("[CommandRunner] SSH auth failed for %s:%s — %s", self.host, self.port, msg)
            return False, msg
        except paramiko.SSHException as e:
            msg = f"Erro SSH: {str(e)}"
            logger.error("[CommandRunner] SSHException for %s:%s — %s", self.host, self.port, msg)
            return False, msg
        except ValueError as e:
            logger.error("[CommandRunner] Validation error for %s — %s", self.host, str(e))
            return False, str(e)
        except Exception as e:
            msg = f"Erro de conexão SSH: {str(e)}"
            logger.error("[CommandRunner] SSH error for %s:%s — %s", self.host, self.port, msg, exc_info=True)
            return False, msg
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

                channel.send(cmd + "\n")
                time.sleep(0.3)

                cmd_output = self._collect_output(channel, timeout=self.timeout)
                if len(commands) > 1:
                    output_parts.append(f"\n--- {cmd} ---")
                output_parts.append(cmd_output)

            try:
                channel.send("quit\n")
            except Exception:
                pass

            channel.close()
            return True, "\n".join(output_parts)

        except paramiko.AuthenticationException:
            msg = "Falha na autenticação SSH. Verifique usuário/senha."
            logger.error("[CommandRunner] SSH interactive auth failed for %s:%s", self.host, self.port)
            return False, msg
        except ValueError as e:
            logger.error("[CommandRunner] Validation error for %s — %s", self.host, str(e))
            return False, str(e)
        except Exception as e:
            msg = f"Erro SSH interativo: {str(e)}"
            logger.error("[CommandRunner] SSH interactive error for %s:%s — %s", self.host, self.port, msg, exc_info=True)
            return False, msg
        finally:
            try:
                client.close()
            except Exception:
                pass

    def _wait_for_prompt(self, channel, timeout: int = 10) -> str:
        """Aguarda um prompt de comando no canal SSH."""
        buffer = b""
        start = time.time()
        password_sent = False
        while time.time() - start < timeout:
            try:
                chunk = channel.recv(4096)
                if chunk:
                    buffer += chunk
                    tail = buffer[-200:].lower()

                    if not password_sent and (b"password:" in tail or b"senha:" in tail):
                        if self.password:
                            channel.send(self.password + "\n")
                            password_sent = True
                            time.sleep(0.5)
                            buffer = b""
                            continue

                    if b"[y/n]" in tail or b"(y/n)" in tail:
                        channel.send("y\n")
                        time.sleep(0.3)
                        continue

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

                    for pager in PAGER_PROMPTS:
                        if pager in buffer[-100:]:
                            channel.send(" ")
                            time.sleep(0.2)
                            break

                    if b"password:" in tail or b"senha:" in tail:
                        if self.password:
                            channel.send(self.password + "\n")
                            time.sleep(0.5)
                            continue

                    stripped = buffer
                    if any(stripped.rstrip().endswith(p) for p in READY_PROMPTS):
                        break
                else:
                    if time.time() - last_data > 3.0:
                        break
            except Exception:
                if time.time() - last_data > 2.0:
                    break
                time.sleep(0.1)

        return buffer.decode("utf-8", errors="replace")

    # ─── Telnet ───────────────────────────────────────────────────────────────

    def _telnet_negotiate(self, sock: socket.socket, data: bytes) -> bytes:
        """
        Processa e responde à negociação IAC do protocolo Telnet.

        CAUSA DO BROKEN PIPE:
        O equipamento Huawei envia opções IAC (WILL ECHO, DO SUPPRESS-GO-AHEAD, etc.)
        durante o handshake. Se o cliente não responder, o equipamento fecha a conexão
        com BrokenPipeError/Errno 32 após alguns segundos.

        SOLUÇÃO:
        - Para WILL X → responder DONT X (não aceitar a opção)
        - Para DO X   → responder WONT X (não oferecer a opção)
        - Exceções: ECHO (1) e SUPPRESS-GO-AHEAD (3) são aceitos (WILL/DO)
        """
        result = bytearray()
        i = 0
        response = bytearray()

        while i < len(data):
            b = data[i]
            if b == IAC and i + 1 < len(data):
                cmd = data[i + 1]

                if cmd == SB:
                    # Subnegotiation — consumir até SE
                    j = i + 2
                    while j < len(data) - 1:
                        if data[j] == IAC and data[j + 1] == SE:
                            i = j + 2
                            break
                        j += 1
                    else:
                        i = len(data)
                    continue

                elif cmd in (WILL, WONT, DO, DONT) and i + 2 < len(data):
                    opt = data[i + 2]
                    # Aceitar ECHO (1) e SUPPRESS-GO-AHEAD (3); rejeitar o resto
                    if cmd == WILL:
                        if opt in (1, 3):
                            response.extend([IAC, DO, opt])
                        else:
                            response.extend([IAC, DONT, opt])
                    elif cmd == DO:
                        if opt in (1, 3):
                            response.extend([IAC, WILL, opt])
                        else:
                            response.extend([IAC, WONT, opt])
                    # WONT e DONT não precisam de resposta
                    i += 3
                    continue

                elif cmd == IAC:
                    # Escaped IAC — byte literal 255
                    result.append(255)
                    i += 2
                    continue
                else:
                    i += 2
                    continue
            else:
                result.append(b)
                i += 1

        # Enviar respostas de negociação acumuladas
        if response:
            try:
                sock.sendall(bytes(response))
            except Exception as e:
                logger.debug("[Telnet] Erro ao enviar negociação IAC: %s", e)

        return bytes(result)

    def _telnet_connect(self) -> socket.socket:
        """
        Cria e conecta o socket Telnet com configurações robustas.
        Retorna o socket após o handshake IAC inicial.
        """
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

        # Keep-alive para detectar conexões mortas
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, 10)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 5)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 3)
        except (AttributeError, OSError):
            pass  # Não disponível em todos os sistemas

        # Timeout de conexão
        sock.settimeout(min(self.timeout, 15))
        sock.connect((self.host, self.port))

        # Após conectar, usar modo não-bloqueante com select()
        sock.setblocking(False)

        # Aguardar e processar negociação IAC inicial (banner + opções)
        time.sleep(0.5)
        raw = self._telnet_raw_recv(sock, timeout=4)
        if raw:
            self._telnet_negotiate(sock, raw)

        return sock

    def _telnet_raw_recv(self, sock: socket.socket, timeout: float = 3.0) -> bytes:
        """Recebe dados brutos do socket Telnet (incluindo IAC)."""
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
                        break  # Conexão fechada
            except BlockingIOError:
                pass
            except Exception:
                break
        return buffer

    def _telnet_recv(self, sock: socket.socket, timeout: float = 3.0) -> bytes:
        """Recebe dados do socket Telnet, processando negociação IAC."""
        raw = self._telnet_raw_recv(sock, timeout)
        if raw:
            return self._telnet_negotiate(sock, raw)
        return b""

    def _telnet_send(self, sock: socket.socket, data: bytes) -> None:
        """Envia dados pelo socket Telnet com tratamento de BrokenPipe."""
        try:
            sock.sendall(data)
        except BrokenPipeError as e:
            logger.error(
                "[Telnet] BrokenPipeError ao enviar para %s:%s — %s. "
                "Verifique se o equipamento aceita Telnet e se as credenciais estão corretas.",
                self.host, self.port, e
            )
            raise
        except Exception as e:
            logger.error("[Telnet] Erro ao enviar dados para %s:%s — %s", self.host, self.port, e)
            raise

    def _telnet_collect(self, sock: socket.socket, timeout: int = 30) -> str:
        """Coleta saída Telnet até prompt ou timeout, processando IAC."""
        buffer = b""
        start = time.time()
        last_data = time.time()

        while time.time() - start < timeout:
            try:
                ready, _, _ = sel.select([sock], [], [], 0.3)
                if ready:
                    chunk = sock.recv(4096)
                    if chunk:
                        # Processar IAC e acumular texto limpo
                        clean_chunk = self._telnet_negotiate(sock, chunk)
                        buffer += clean_chunk
                        last_data = time.time()

                        # Responder paginadores
                        tail = buffer[-100:]
                        for pager in PAGER_PROMPTS:
                            if pager in tail:
                                try:
                                    sock.sendall(b" ")
                                except Exception:
                                    pass
                                time.sleep(0.2)
                                break

                        # Verificar prompt final
                        stripped = buffer.rstrip()
                        if any(stripped.endswith(p) for p in READY_PROMPTS):
                            break
                    else:
                        # Conexão fechada pelo equipamento
                        logger.debug("[Telnet] Conexão fechada pelo equipamento %s", self.host)
                        break
                else:
                    # Sem dados — verificar idle timeout
                    if time.time() - last_data > 3.0:
                        break
            except BrokenPipeError as e:
                logger.error("[Telnet] BrokenPipeError durante coleta de %s:%s — %s", self.host, self.port, e)
                break
            except Exception as e:
                logger.debug("[Telnet] Erro durante coleta de %s — %s", self.host, e)
                if time.time() - last_data > 2.0:
                    break

        return buffer.decode("utf-8", errors="replace")

    def _run_telnet(self, commands: list[str]) -> Tuple[bool, str]:
        """
        Executa comandos via Telnet com reconexão automática.
        Tenta até 2 vezes em caso de BrokenPipeError ou ConnectionReset.
        """
        max_attempts = 2
        last_error = ""

        for attempt in range(1, max_attempts + 1):
            sock = None
            try:
                logger.info(
                    "[Telnet] Conectando em %s:%s (tentativa %d/%d)",
                    self.host, self.port, attempt, max_attempts
                )

                sock = self._telnet_connect()
                output_parts = []

                # Login: username
                if self.username:
                    # Aguardar prompt de login
                    login_prompt = self._telnet_recv(sock, timeout=5)
                    logger.debug("[Telnet] Banner/login prompt: %r", login_prompt[:100])
                    self._telnet_send(sock, (self.username + "\r\n").encode())
                    time.sleep(0.8)

                # Login: password
                if self.password:
                    pass_prompt = self._telnet_recv(sock, timeout=5)
                    logger.debug("[Telnet] Password prompt: %r", pass_prompt[:100])
                    self._telnet_send(sock, (self.password + "\r\n").encode())
                    time.sleep(1.2)
                    # Consumir resposta do login (pode ter mais IAC aqui)
                    login_resp = self._telnet_recv(sock, timeout=5)
                    logger.debug("[Telnet] Login response: %r", login_resp[:200])

                    # Verificar falha de autenticação
                    resp_lower = login_resp.lower()
                    if any(x in resp_lower for x in (b"fail", b"invalid", b"denied", b"error", b"incorrect")):
                        msg = "Falha na autenticação Telnet. Verifique usuário/senha."
                        logger.error("[Telnet] Auth failed for %s:%s — response: %r", self.host, self.port, login_resp[:200])
                        return False, msg

                # Executar cada comando
                for cmd in commands:
                    cmd = cmd.strip()
                    if not cmd:
                        continue

                    logger.debug("[Telnet] Enviando comando: %s", cmd)
                    self._telnet_send(sock, (cmd + "\r\n").encode())
                    time.sleep(0.5)

                    cmd_output = self._telnet_collect(sock, timeout=self.timeout)
                    logger.debug("[Telnet] Saída do comando (%d chars)", len(cmd_output))

                    if len(commands) > 1:
                        output_parts.append(f"\n--- {cmd} ---")
                    output_parts.append(cmd_output)

                # Logout
                try:
                    sock.sendall(b"quit\r\n")
                    time.sleep(0.3)
                except Exception:
                    pass

                logger.info("[Telnet] Comandos executados com sucesso em %s:%s", self.host, self.port)
                return True, "\n".join(output_parts)

            except BrokenPipeError as e:
                last_error = f"Erro Telnet: [Errno 32] Broken pipe"
                logger.error(
                    "[Telnet] BrokenPipeError em %s:%s (tentativa %d) — "
                    "Equipamento fechou a conexão. Possíveis causas: "
                    "(1) Credenciais incorretas, "
                    "(2) Equipamento não aceita Telnet, "
                    "(3) Timeout de negociação IAC, "
                    "(4) Máximo de sessões VTY atingido.",
                    self.host, self.port, attempt
                )
                if attempt < max_attempts:
                    logger.info("[Telnet] Aguardando 2s antes de reconectar...")
                    time.sleep(2)

            except ConnectionResetError as e:
                last_error = f"Erro Telnet: Conexão reiniciada pelo equipamento ({e})"
                logger.error("[Telnet] ConnectionResetError em %s:%s (tentativa %d) — %s", self.host, self.port, attempt, e)
                if attempt < max_attempts:
                    time.sleep(2)

            except socket.timeout:
                last_error = f"Timeout ao conectar em {self.host}:{self.port} (>{self.timeout}s)"
                logger.error("[Telnet] Timeout em %s:%s", self.host, self.port)
                break  # Timeout não adianta tentar de novo

            except ConnectionRefusedError:
                last_error = f"Conexão recusada em {self.host}:{self.port} — Telnet desabilitado?"
                logger.error("[Telnet] ConnectionRefused em %s:%s", self.host, self.port)
                break  # Recusada não adianta tentar de novo

            except Exception as e:
                last_error = f"Erro Telnet: {str(e)}"
                logger.error(
                    "[Telnet] Erro inesperado em %s:%s (tentativa %d) — %s",
                    self.host, self.port, attempt, e, exc_info=True
                )
                if attempt < max_attempts:
                    time.sleep(1)

            finally:
                if sock:
                    try:
                        sock.close()
                    except Exception:
                        pass

        logger.error("[Telnet] Todas as tentativas falharam para %s:%s — %s", self.host, self.port, last_error)
        return False, last_error

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
            logger.error(
                "[CommandRunner] Erro inesperado ao executar comando em %s (%s) — %s",
                self.host, self.protocol, e, exc_info=True
            )

        duration_ms = int((time.time() - start) * 1000)
        logger.info(
            "[CommandRunner] %s://%s:%s — sucesso=%s, duração=%dms, cmds=%d",
            self.protocol, self.host, self.port, success, duration_ms, len(commands)
        )
        return success, output, duration_ms

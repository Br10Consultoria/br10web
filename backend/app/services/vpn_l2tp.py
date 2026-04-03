"""
BR10 NetManager - Serviço de Gerenciamento VPN L2TP
Gerencia conexões L2TP reais no servidor Linux usando xl2tpd + pppd.

Todos os arquivos de configuração são gravados em /app/vpn/ (propriedade do
usuário br10), e o xl2tpd é iniciado apontando explicitamente para esses
caminhos — sem necessidade de escrever em /etc.

Fluxo:
  1. write_configs()      → gera /app/vpn/xl2tpd/xl2tpd.conf e /app/vpn/ppp/peers/<name>
  2. connect()            → inicia xl2tpd com -c e -C apontando para /app/vpn
  3. _wait_for_interface()→ aguarda interface PPP subir (timeout: 30s)
  4. add_route()          → adiciona rota estática via `ip route add`
  5. disconnect()         → envia comando de desconexão e remove rotas
  6. get_status()         → verifica se a interface PPP está ativa
"""
import asyncio
import logging
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Base dir gravável pelo usuário br10 dentro do container
VPN_BASE = os.environ.get("VPN_BASE_DIR", "/app/vpn")

XL2TPD_CONF_DIR = f"{VPN_BASE}/xl2tpd"
XL2TPD_CONF     = f"{VPN_BASE}/xl2tpd/xl2tpd.conf"
PPP_DIR         = f"{VPN_BASE}/ppp"
PPP_PEERS_DIR   = f"{VPN_BASE}/ppp/peers"
PPP_CHAP_FILE   = f"{VPN_BASE}/ppp/chap-secrets"
PPP_PAP_FILE    = f"{VPN_BASE}/ppp/pap-secrets"
XL2TPD_RUN_DIR  = f"{VPN_BASE}/run"
XL2TPD_CONTROL  = f"{VPN_BASE}/run/l2tp-control"
XL2TPD_PID_FILE = f"{VPN_BASE}/run/xl2tpd.pid"
XL2TPD_LOG_FILE = f"{VPN_BASE}/log/xl2tpd.log"


class L2TPManager:
    """Gerencia conexões VPN L2TP no servidor Linux."""

    def __init__(self, vpn_id: str, vpn_name: str, server_ip: str, server_port: int,
                 username: str, password: str, preshared_key: Optional[str] = None,
                 authentication_type: str = "chap", mtu: int = 1460, mru: int = 1460,
                 ipsec_enabled: bool = False):
        self.vpn_id = vpn_id
        # Nome sanitizado para uso em arquivos de configuração
        self.conn_name = re.sub(r'[^a-zA-Z0-9_-]', '_', vpn_name)
        self.server_ip = server_ip
        self.server_port = server_port
        self.username = username
        self.password = password
        self.preshared_key = preshared_key
        self.auth_type = authentication_type.lower()
        self.mtu = mtu
        self.mru = mru
        self.ipsec_enabled = ipsec_enabled

    # ─── Geração de Configurações ─────────────────────────────────────────────

    def _generate_xl2tpd_conf(self) -> str:
        """Conteúdo do xl2tpd.conf para esta conexão."""
        return (
            f"[global]\n"
            f"port = 1701\n"
            f"\n"
            f"[lac {self.conn_name}]\n"
            f"lns = {self.server_ip}\n"
            f"ppp debug = no\n"
            f"pppoptfile = {PPP_PEERS_DIR}/{self.conn_name}\n"
            f"length bit = yes\n"
        )

    def _generate_ppp_peer(self) -> str:
        """Arquivo de opções PPP para esta conexão."""
        auth_map = {
            "chap":     "require-chap\nnoauth",
            "pap":      "require-pap\nnoauth",
            "mschapv2": "require-mschap-v2\nnoauth",
            "mschap":   "require-mschap-v2\nnoauth",
        }
        auth_options = auth_map.get(self.auth_type, "noauth")

        return (
            f"ipcp-accept-local\n"
            f"ipcp-accept-remote\n"
            f"refuse-eap\n"
            f"noccp\n"
            f"nodefaultroute\n"
            f"debug\n"
            f"lock\n"
            f"connect-delay 5000\n"
            f"name {self.username}\n"
            f"password {self.password}\n"
            f"mtu {self.mtu}\n"
            f"mru {self.mru}\n"
            f"{auth_options}\n"
        )

    # ─── Escrita de Configurações ─────────────────────────────────────────────

    def write_configs(self) -> None:
        """Escreve todos os arquivos de configuração em /app/vpn/."""
        # Garantir que os diretórios existem
        for d in [XL2TPD_CONF_DIR, PPP_PEERS_DIR, XL2TPD_RUN_DIR,
                  f"{VPN_BASE}/log"]:
            os.makedirs(d, exist_ok=True)

        # xl2tpd.conf
        self._write_xl2tpd_conf()

        # PPP peer file
        peer_file = Path(f"{PPP_PEERS_DIR}/{self.conn_name}")
        peer_file.write_text(self._generate_ppp_peer())
        peer_file.chmod(0o600)

        # Secrets
        self._update_secrets_file(PPP_CHAP_FILE, f"{self.username} * {self.password} *")
        self._update_secrets_file(PPP_PAP_FILE,  f"{self.username} * {self.password} *")

        logger.info(f"[VPN {self.conn_name}] Configurações escritas em {VPN_BASE}")

    def _write_xl2tpd_conf(self) -> None:
        """Escreve o xl2tpd.conf preservando outras conexões existentes."""
        conf_path = Path(XL2TPD_CONF)
        existing = conf_path.read_text() if conf_path.exists() else ""

        # Remover seção existente desta conexão
        pattern = rf'\[lac {re.escape(self.conn_name)}\].*?(?=\[lac |\Z)'
        existing_clean = re.sub(pattern, '', existing, flags=re.DOTALL).strip()

        # Garantir bloco [global]
        if "[global]" not in existing_clean:
            existing_clean = "[global]\nport = 1701\n\n" + existing_clean

        new_conf = existing_clean.rstrip() + "\n\n" + self._generate_xl2tpd_conf()
        conf_path.write_text(new_conf)
        conf_path.chmod(0o644)

    def _update_secrets_file(self, filepath: str, new_entry: str) -> None:
        """Adiciona ou atualiza entrada no arquivo de secrets."""
        path = Path(filepath)
        existing = path.read_text() if path.exists() else "# Secrets file\n"
        lines = [l for l in existing.splitlines()
                 if not l.startswith(self.username + " ")]
        lines.append(new_entry.strip())
        path.write_text("\n".join(lines) + "\n")
        path.chmod(0o600)

    def remove_configs(self) -> None:
        """Remove as configurações desta conexão."""
        peer_file = Path(f"{PPP_PEERS_DIR}/{self.conn_name}")
        if peer_file.exists():
            peer_file.unlink()

        conf_path = Path(XL2TPD_CONF)
        if conf_path.exists():
            content = conf_path.read_text()
            pattern = rf'\[lac {re.escape(self.conn_name)}\].*?(?=\[lac |\Z)'
            content = re.sub(pattern, '', content, flags=re.DOTALL).strip() + "\n"
            conf_path.write_text(content)

        logger.info(f"[VPN {self.conn_name}] Configurações removidas")

    # ─── Controle do xl2tpd ───────────────────────────────────────────────────

    def _is_xl2tpd_running(self) -> bool:
        try:
            result = subprocess.run(["pgrep", "-x", "xl2tpd"],
                                    capture_output=True, timeout=5)
            return result.returncode == 0
        except Exception:
            return False

    def _start_xl2tpd(self) -> bool:
        """Inicia o daemon xl2tpd apontando para os diretórios em /app/vpn."""
        try:
            os.makedirs(XL2TPD_RUN_DIR, exist_ok=True)
            os.makedirs(f"{VPN_BASE}/log", exist_ok=True)

            cmd = [
                "xl2tpd",
                "-c", XL2TPD_CONF,
                "-p", XL2TPD_PID_FILE,
                "-C", XL2TPD_CONTROL,
                "-l",                   # log para syslog/stderr
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=10)
            if result.returncode not in (0, None):
                logger.warning(f"[VPN {self.conn_name}] xl2tpd retornou {result.returncode}: "
                                f"{result.stderr.decode(errors='replace')}")

            # Aguardar o socket de controle aparecer (até 5s)
            for _ in range(10):
                time.sleep(0.5)
                if Path(XL2TPD_CONTROL).exists() or self._is_xl2tpd_running():
                    return True
            return self._is_xl2tpd_running()
        except Exception as e:
            logger.error(f"[VPN {self.conn_name}] Erro ao iniciar xl2tpd: {e}")
            return False

    def _send_xl2tpd_command(self, command: str) -> bool:
        """Envia comando para o socket de controle do xl2tpd."""
        control_path = Path(XL2TPD_CONTROL)
        if not control_path.exists():
            logger.error(f"[VPN {self.conn_name}] Socket de controle não encontrado: {XL2TPD_CONTROL}")
            return False
        try:
            with open(XL2TPD_CONTROL, "w") as f:
                f.write(command + "\n")
            return True
        except Exception as e:
            logger.error(f"[VPN {self.conn_name}] Erro ao enviar comando xl2tpd: {e}")
            return False

    # ─── Interface PPP ────────────────────────────────────────────────────────

    def get_ppp_interface(self) -> Optional[str]:
        """Retorna o nome da interface PPP ativa, ou None."""
        try:
            result = subprocess.run(["ip", "link", "show"],
                                    capture_output=True, text=True, timeout=5)
            # Interfaces ppp* com estado UP
            matches = re.findall(r'(ppp\d+).*?state UP', result.stdout)
            if matches:
                return matches[0]
            # Fallback: qualquer interface ppp* (pode estar em UNKNOWN state)
            matches = re.findall(r'\d+:\s+(ppp\d+):', result.stdout)
            if matches:
                return matches[0]
            return None
        except Exception as e:
            logger.error(f"[VPN {self.conn_name}] Erro ao verificar interface PPP: {e}")
            return None

    def get_ppp_ip(self, interface: str) -> Optional[str]:
        """Retorna o IP local da interface PPP."""
        try:
            result = subprocess.run(["ip", "addr", "show", interface],
                                    capture_output=True, text=True, timeout=5)
            match = re.search(r'inet (\d+\.\d+\.\d+\.\d+)', result.stdout)
            return match.group(1) if match else None
        except Exception:
            return None

    # ─── Operações de Conexão ─────────────────────────────────────────────────

    async def connect(self) -> Tuple[bool, str]:
        """Conecta a VPN L2TP. Retorna (sucesso, mensagem)."""
        try:
            # 1. Escrever configurações em /app/vpn/
            self.write_configs()

            # 2. Iniciar xl2tpd se não estiver rodando
            if not self._is_xl2tpd_running():
                logger.info(f"[VPN {self.conn_name}] Iniciando xl2tpd...")
                if not self._start_xl2tpd():
                    return False, "Falha ao iniciar o daemon xl2tpd. Verifique se o container tem NET_ADMIN."
                await asyncio.sleep(1)

            # 3. Enviar comando de discagem
            if not self._send_xl2tpd_command(f"c {self.conn_name}"):
                return False, "Falha ao enviar comando de discagem para xl2tpd"

            logger.info(f"[VPN {self.conn_name}] Discando para {self.server_ip}:{self.server_port}...")

            # 4. Aguardar interface PPP subir (timeout: 30s)
            interface = await self._wait_for_interface(timeout=30)
            if not interface:
                return False, (
                    "Timeout: interface PPP não subiu em 30 segundos. "
                    "Verifique IP/usuário/senha do servidor L2TP."
                )

            local_ip = self.get_ppp_ip(interface)
            msg = f"Conectado via {interface}"
            if local_ip:
                msg += f" (IP local: {local_ip})"

            logger.info(f"[VPN {self.conn_name}] {msg}")
            return True, msg

        except Exception as e:
            logger.exception(f"[VPN {self.conn_name}] Erro ao conectar: {e}")
            return False, f"Erro inesperado: {str(e)}"

    async def _wait_for_interface(self, timeout: int = 30) -> Optional[str]:
        """Aguarda a interface PPP subir, com timeout em segundos."""
        start = time.time()
        while time.time() - start < timeout:
            iface = self.get_ppp_interface()
            if iface:
                return iface
            await asyncio.sleep(1)
        return None

    async def disconnect(self) -> Tuple[bool, str]:
        """Desconecta a VPN L2TP. Retorna (sucesso, mensagem)."""
        try:
            self._send_xl2tpd_command(f"d {self.conn_name}")
            await asyncio.sleep(2)
            logger.info(f"[VPN {self.conn_name}] Desconectado")
            return True, "VPN desconectada com sucesso"
        except Exception as e:
            logger.exception(f"[VPN {self.conn_name}] Erro ao desconectar: {e}")
            return False, f"Erro ao desconectar: {str(e)}"

    # ─── Gerenciamento de Rotas ───────────────────────────────────────────────

    def add_route(self, network: str, interface: Optional[str] = None,
                  gateway: Optional[str] = None, metric: int = 1) -> Tuple[bool, str]:
        """Adiciona rota estática via `ip route add`."""
        if not interface:
            interface = self.get_ppp_interface()
        if not interface and not gateway:
            return False, "Nenhuma interface PPP ativa e nenhum gateway fornecido"

        try:
            cmd = ["ip", "route", "add", network]
            if gateway:
                cmd += ["via", gateway]
            if interface:
                cmd += ["dev", interface]
            cmd += ["metric", str(metric)]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                return True, f"Rota {network} adicionada com sucesso"
            if "File exists" in result.stderr or "RTNETLINK" in result.stderr:
                return True, f"Rota {network} já existe"
            return False, f"Erro ao adicionar rota: {result.stderr.strip()}"
        except Exception as e:
            return False, f"Erro ao adicionar rota: {str(e)}"

    def remove_route(self, network: str, interface: Optional[str] = None,
                     gateway: Optional[str] = None) -> Tuple[bool, str]:
        """Remove rota estática."""
        try:
            cmd = ["ip", "route", "del", network]
            if gateway:
                cmd += ["via", gateway]
            if interface:
                cmd += ["dev", interface]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                return True, f"Rota {network} removida"
            return False, f"Erro ao remover rota: {result.stderr.strip()}"
        except Exception as e:
            return False, f"Erro ao remover rota: {str(e)}"

    # ─── Status ───────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Retorna o status atual da conexão VPN."""
        interface = self.get_ppp_interface()
        is_connected = interface is not None
        local_ip = self.get_ppp_ip(interface) if interface else None

        return {
            "connected": is_connected,
            "interface": interface,
            "local_ip": local_ip,
            "xl2tpd_running": self._is_xl2tpd_running(),
            "conn_name": self.conn_name,
        }


def build_manager_from_vpn(vpn, password: str,
                            preshared_key: Optional[str] = None) -> L2TPManager:
    """Constrói um L2TPManager a partir de um objeto VpnConfig do banco."""
    return L2TPManager(
        vpn_id=str(vpn.id),
        vpn_name=vpn.name,
        server_ip=vpn.server_ip,
        server_port=vpn.server_port or 1701,
        username=vpn.username or "",
        password=password,
        preshared_key=preshared_key,
        authentication_type=vpn.authentication_type or "chap",
        mtu=vpn.mtu or 1460,
        mru=vpn.mru or 1460,
        ipsec_enabled=vpn.ipsec_enabled or False,
    )

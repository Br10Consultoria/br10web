"""
BR10 NetManager - Serviço de Gerenciamento VPN L2TP
Gerencia conexões L2TP reais no servidor Linux usando xl2tpd + pppd.

Fluxo:
  1. create_connection()  → gera /etc/xl2tpd/xl2tpd.conf e /etc/ppp/peers/<name>
  2. connect()            → inicia xl2tpd (se não rodando) e envia comando de discagem
  3. wait_for_interface() → aguarda a interface PPP subir (ex: ppp0)
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

# Diretórios de configuração
XL2TPD_CONF = "/etc/xl2tpd/xl2tpd.conf"
PPP_PEERS_DIR = "/etc/ppp/peers"
PPP_OPTIONS_FILE = "/etc/ppp/options.l2tpd"
XL2TPD_CONTROL = "/var/run/xl2tpd/l2tp-control"
XL2TPD_PID_FILE = "/var/run/xl2tpd/xl2tpd.pid"


class L2TPManager:
    """Gerencia conexões VPN L2TP no servidor Linux."""

    def __init__(self, vpn_id: str, vpn_name: str, server_ip: str, server_port: int,
                 username: str, password: str, preshared_key: Optional[str] = None,
                 authentication_type: str = "chap", mtu: int = 1460, mru: int = 1460,
                 ipsec_enabled: bool = False):
        self.vpn_id = vpn_id
        # Nome sanitizado para uso em arquivos de configuração (sem espaços/caracteres especiais)
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
        """Gera o conteúdo do arquivo xl2tpd.conf para esta conexão."""
        return f"""[global]
port = 1701

[lac {self.conn_name}]
lns = {self.server_ip}
ppp debug = no
pppoptfile = {PPP_PEERS_DIR}/{self.conn_name}
length bit = yes
"""

    def _generate_ppp_peer(self) -> str:
        """Gera o arquivo de opções PPP para esta conexão."""
        auth_options = ""
        if self.auth_type == "chap":
            auth_options = "require-chap\nnoauth"
        elif self.auth_type == "pap":
            auth_options = "require-pap\nnoauth"
        elif self.auth_type in ("mschapv2", "mschap"):
            auth_options = "require-mschap-v2\nnoauth"
        else:
            auth_options = "noauth"

        return f"""ipcp-accept-local
ipcp-accept-remote
refuse-eap
noccp
nodefaultroute
debug
lock
connect-delay 5000
name {self.username}
password {self.password}
mtu {self.mtu}
mru {self.mru}
{auth_options}
"""

    def _generate_chap_secrets(self) -> str:
        """Entrada para /etc/ppp/chap-secrets."""
        return f'{self.username} * {self.password} *\n'

    def _generate_pap_secrets(self) -> str:
        """Entrada para /etc/ppp/pap-secrets."""
        return f'{self.username} * {self.password} *\n'

    # ─── Escrita de Configurações ─────────────────────────────────────────────

    def write_configs(self) -> None:
        """Escreve todos os arquivos de configuração necessários."""
        # Garantir que os diretórios existem
        os.makedirs(PPP_PEERS_DIR, exist_ok=True)
        os.makedirs("/etc/xl2tpd", exist_ok=True)
        os.makedirs("/var/run/xl2tpd", exist_ok=True)

        # xl2tpd.conf — lê o existente e adiciona/substitui a seção desta conexão
        self._write_xl2tpd_conf()

        # PPP peer file
        peer_file = f"{PPP_PEERS_DIR}/{self.conn_name}"
        with open(peer_file, "w") as f:
            f.write(self._generate_ppp_peer())
        os.chmod(peer_file, 0o600)

        # Secrets — adiciona linha se não existir
        self._update_secrets_file("/etc/ppp/chap-secrets", self._generate_chap_secrets())
        self._update_secrets_file("/etc/ppp/pap-secrets", self._generate_pap_secrets())

        logger.info(f"[VPN {self.conn_name}] Configurações escritas com sucesso")

    def _write_xl2tpd_conf(self) -> None:
        """Escreve o xl2tpd.conf, preservando outras conexões existentes."""
        conf_path = Path(XL2TPD_CONF)
        existing = ""
        if conf_path.exists():
            existing = conf_path.read_text()

        # Remover seção existente desta conexão (se houver)
        pattern = rf'\[lac {re.escape(self.conn_name)}\].*?(?=\[|$)'
        existing_clean = re.sub(pattern, '', existing, flags=re.DOTALL).strip()

        # Garantir que o bloco [global] existe
        if "[global]" not in existing_clean:
            existing_clean = "[global]\nport = 1701\n\n" + existing_clean

        # Adicionar nova seção desta conexão
        new_conf = existing_clean.rstrip() + "\n\n" + self._generate_xl2tpd_conf()
        conf_path.write_text(new_conf)
        os.chmod(XL2TPD_CONF, 0o644)

    def _update_secrets_file(self, filepath: str, new_entry: str) -> None:
        """Adiciona ou atualiza entrada no arquivo de secrets."""
        path = Path(filepath)
        existing = path.read_text() if path.exists() else "# Secrets file\n"

        # Remover linha existente deste usuário
        lines = [l for l in existing.splitlines()
                 if not l.startswith(self.username + " ")]
        lines.append(new_entry.strip())
        path.write_text("\n".join(lines) + "\n")
        os.chmod(filepath, 0o600)

    def remove_configs(self) -> None:
        """Remove as configurações desta conexão."""
        # Remover peer file
        peer_file = Path(f"{PPP_PEERS_DIR}/{self.conn_name}")
        if peer_file.exists():
            peer_file.unlink()

        # Remover seção do xl2tpd.conf
        conf_path = Path(XL2TPD_CONF)
        if conf_path.exists():
            content = conf_path.read_text()
            pattern = rf'\[lac {re.escape(self.conn_name)}\].*?(?=\[lac |\Z)'
            content = re.sub(pattern, '', content, flags=re.DOTALL).strip() + "\n"
            conf_path.write_text(content)

        logger.info(f"[VPN {self.conn_name}] Configurações removidas")

    # ─── Controle do xl2tpd ───────────────────────────────────────────────────

    def _is_xl2tpd_running(self) -> bool:
        """Verifica se o processo xl2tpd está rodando."""
        try:
            result = subprocess.run(
                ["pgrep", "-x", "xl2tpd"],
                capture_output=True, timeout=5
            )
            return result.returncode == 0
        except Exception:
            return False

    def _start_xl2tpd(self) -> bool:
        """Inicia o daemon xl2tpd."""
        try:
            os.makedirs("/var/run/xl2tpd", exist_ok=True)
            result = subprocess.run(
                ["xl2tpd", "-D", "-c", XL2TPD_CONF, "-p", XL2TPD_PID_FILE,
                 "-C", XL2TPD_CONTROL],
                capture_output=True, timeout=10
            )
            time.sleep(1)
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
        """
        Retorna o nome da interface PPP ativa para esta conexão, ou None.
        Verifica /proc/net/dev para interfaces ppp* e tenta correlacionar
        com a conexão via /proc/net/if_inet6 ou verificando a rota.
        """
        try:
            result = subprocess.run(
                ["ip", "link", "show"],
                capture_output=True, text=True, timeout=5
            )
            # Encontrar interfaces ppp ativas
            ppp_ifaces = re.findall(r'(ppp\d+).*?state UP', result.stdout)
            if ppp_ifaces:
                return ppp_ifaces[0]  # Retorna a primeira interface PPP ativa

            # Verificar também interfaces com o nome da conexão (alguns sistemas)
            if self.conn_name in result.stdout:
                match = re.search(rf'(\S*{re.escape(self.conn_name)}\S*)', result.stdout)
                if match:
                    return match.group(1)

            return None
        except Exception as e:
            logger.error(f"[VPN {self.conn_name}] Erro ao verificar interface PPP: {e}")
            return None

    def get_ppp_ip(self, interface: str) -> Optional[str]:
        """Retorna o IP local da interface PPP."""
        try:
            result = subprocess.run(
                ["ip", "addr", "show", interface],
                capture_output=True, text=True, timeout=5
            )
            match = re.search(r'inet (\d+\.\d+\.\d+\.\d+)', result.stdout)
            return match.group(1) if match else None
        except Exception:
            return None

    # ─── Operações de Conexão ─────────────────────────────────────────────────

    async def connect(self) -> Tuple[bool, str]:
        """
        Conecta a VPN L2TP.
        Retorna (sucesso, mensagem).
        """
        try:
            # 1. Escrever configurações
            self.write_configs()

            # 2. Iniciar xl2tpd se não estiver rodando
            if not self._is_xl2tpd_running():
                logger.info(f"[VPN {self.conn_name}] Iniciando xl2tpd...")
                if not self._start_xl2tpd():
                    return False, "Falha ao iniciar o daemon xl2tpd"
                await asyncio.sleep(2)

            # 3. Enviar comando de discagem
            cmd = f"c {self.conn_name}"
            if not self._send_xl2tpd_command(cmd):
                return False, "Falha ao enviar comando de discagem para xl2tpd"

            logger.info(f"[VPN {self.conn_name}] Comando de discagem enviado, aguardando interface PPP...")

            # 4. Aguardar a interface PPP subir (timeout: 30s)
            interface = await self._wait_for_interface(timeout=30)
            if not interface:
                return False, "Timeout: interface PPP não subiu em 30 segundos"

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
        """
        Desconecta a VPN L2TP.
        Retorna (sucesso, mensagem).
        """
        try:
            # Obter interface antes de desconectar
            interface = self.get_ppp_interface()

            # Enviar comando de desconexão
            cmd = f"d {self.conn_name}"
            self._send_xl2tpd_command(cmd)

            # Aguardar interface baixar
            if interface:
                await asyncio.sleep(3)

            logger.info(f"[VPN {self.conn_name}] Desconectado")
            return True, "VPN desconectada com sucesso"

        except Exception as e:
            logger.exception(f"[VPN {self.conn_name}] Erro ao desconectar: {e}")
            return False, f"Erro ao desconectar: {str(e)}"

    # ─── Gerenciamento de Rotas ───────────────────────────────────────────────

    def add_route(self, network: str, interface: Optional[str] = None,
                  gateway: Optional[str] = None, metric: int = 1) -> Tuple[bool, str]:
        """
        Adiciona rota estática via `ip route add`.
        Se interface não for fornecida, usa a interface PPP ativa desta conexão.
        """
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
                logger.info(f"[VPN {self.conn_name}] Rota adicionada: {network} dev {interface}")
                return True, f"Rota {network} adicionada com sucesso"
            else:
                # Rota já existe não é erro crítico
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
            else:
                return False, f"Erro ao remover rota: {result.stderr.strip()}"
        except Exception as e:
            return False, f"Erro ao remover rota: {str(e)}"

    # ─── Status ───────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """
        Retorna o status atual da conexão VPN.
        """
        interface = self.get_ppp_interface()
        is_connected = interface is not None
        local_ip = self.get_ppp_ip(interface) if interface else None
        xl2tpd_running = self._is_xl2tpd_running()

        return {
            "connected": is_connected,
            "interface": interface,
            "local_ip": local_ip,
            "xl2tpd_running": xl2tpd_running,
            "conn_name": self.conn_name,
        }


def build_manager_from_vpn(vpn, password: str, preshared_key: Optional[str] = None) -> L2TPManager:
    """
    Constrói um L2TPManager a partir de um objeto VpnConfig do banco de dados.
    As senhas devem ser descriptografadas antes de passar para esta função.
    """
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

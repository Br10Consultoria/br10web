"""
BR10 NetManager - Scheduler
Background tasks agendados usando APScheduler.
"""
import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.device import Device, DeviceStatus

logger = logging.getLogger(__name__)

# Instância global do scheduler
scheduler = AsyncIOScheduler(timezone="America/Bahia")


async def tcp_connect(ip: str, port: int, timeout: float = 2.0) -> bool:
    """Tenta uma conexão TCP simples. Retorna True se conectar."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout
        )
        writer.close()
        try:
            await asyncio.wait_for(writer.wait_closed(), timeout=1.0)
        except Exception:
            pass
        return True
    except Exception:
        return False


async def check_device_reachable(ip: str, ports: list = None) -> bool:
    """
    Verifica se um dispositivo está acessível testando todas as portas
    em PARALELO com timeout curto (2s por porta).
    Sem ICMP/ping — não funciona em containers Docker sem NET_ADMIN.
    """
    if not ports:
        ports = [22, 23, 80, 443, 8291]

    # Remove duplicatas e portas inválidas
    ports = list(set(p for p in ports if p and 1 <= p <= 65535))
    if not ports:
        ports = [22, 23, 80, 443, 8291]

    # Testa todas as portas em paralelo — timeout de 2s por porta
    tasks = [tcp_connect(ip, port, timeout=2.0) for port in ports]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return any(r is True for r in results)


async def run_device_status_check():
    """
    Task agendada: verifica o status de todos os dispositivos via ping
    e atualiza o banco de dados. Executada a cada 5 minutos.
    """
    start_time = datetime.now(timezone.utc)
    logger.info("[Scheduler] Iniciando verificação de status dos dispositivos...")

    try:
        async with AsyncSessionLocal() as db:
            # Busca todos os dispositivos que não estão em manutenção
            result = await db.execute(
                select(Device).where(Device.status != DeviceStatus.MAINTENANCE)
            )
            devices = result.scalars().all()

            if not devices:
                logger.info("[Scheduler] Nenhum dispositivo encontrado para verificar.")
                return

            logger.info(f"[Scheduler] Verificando {len(devices)} dispositivos...")

            # Verifica todos em paralelo (TCP connect nas portas de gerência)
            def get_device_ports(d: Device) -> list:
                ports = []
                if d.ssh_port: ports.append(d.ssh_port)
                if d.telnet_port: ports.append(d.telnet_port)
                if d.http_port: ports.append(d.http_port)
                if d.https_port: ports.append(d.https_port)
                return ports or [22, 23, 80, 443, 8291]
            
            # Cada dispositivo tem timeout global de 8s
            async def check_with_timeout(device: Device) -> bool:
                try:
                    return await asyncio.wait_for(
                        check_device_reachable(device.management_ip, get_device_ports(device)),
                        timeout=8.0
                    )
                except asyncio.TimeoutError:
                    logger.warning(f"[Scheduler] Timeout ao verificar {device.name} ({device.management_ip})")
                    return False
                except Exception as e:
                    logger.warning(f"[Scheduler] Erro ao verificar {device.name}: {e}")
                    return False

            tasks = [check_with_timeout(device) for device in devices]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Atualiza status no banco
            online_count = 0
            offline_count = 0
            updated_count = 0

            for device, is_online in zip(devices, results):
                if isinstance(is_online, Exception):
                    is_online = False

                new_status = DeviceStatus.ONLINE if is_online else DeviceStatus.OFFLINE

                if device.status != new_status:
                    old_status = device.status.value
                    device.status = new_status
                    if is_online:
                        device.last_seen = datetime.now(timezone.utc)
                    updated_count += 1
                    logger.info(
                        f"[Scheduler] {device.name} ({device.management_ip}): "
                        f"{old_status} → {new_status.value}"
                    )
                elif is_online:
                    device.last_seen = datetime.now(timezone.utc)

                if is_online:
                    online_count += 1
                else:
                    offline_count += 1

            await db.commit()

            elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
            logger.info(
                f"[Scheduler] Verificação concluída em {elapsed:.1f}s — "
                f"Online: {online_count}, Offline: {offline_count}, "
                f"Atualizados: {updated_count}/{len(devices)}"
            )

    except Exception as e:
        logger.error(f"[Scheduler] Erro na verificação de status: {e}", exc_info=True)


def start_scheduler():
    """Inicia o scheduler com todos os jobs agendados."""
    # Verificação de status a cada 5 minutos
    scheduler.add_job(
        run_device_status_check,
        trigger=IntervalTrigger(minutes=5),
        id="check_device_status",
        name="Verificação de Status dos Dispositivos",
        replace_existing=True,
        max_instances=1,  # Garante que apenas uma instância roda por vez
        misfire_grace_time=60,  # Tolera até 60s de atraso antes de pular
    )

    scheduler.start()
    logger.info("[Scheduler] Iniciado — verificação de status a cada 5 minutos.")


def stop_scheduler():
    """Para o scheduler graciosamente."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[Scheduler] Encerrado.")

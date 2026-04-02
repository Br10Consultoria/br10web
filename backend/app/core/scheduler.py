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


async def check_device_reachable(ip: str, ports: list = None) -> bool:
    """Verifica se um dispositivo está acessível via TCP connect nas portas de gerência."""
    if ports is None:
        ports = [22, 23, 80, 443, 8291]
    
    # Tenta TCP connect em cada porta
    for port in ports:
        try:
            conn = asyncio.open_connection(ip, port)
            reader, writer = await asyncio.wait_for(conn, timeout=3)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return True
        except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
            continue
        except Exception:
            continue
    
    # Fallback: tenta ICMP ping
    try:
        process = await asyncio.create_subprocess_exec(
            'ping', '-c', '1', '-W', '2', ip,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(process.communicate(), timeout=4)
        return process.returncode == 0
    except Exception:
        return False


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
            
            tasks = [check_device_reachable(device.management_ip, get_device_ports(device)) for device in devices]
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
                    updated_count += 1
                    logger.info(
                        f"[Scheduler] {device.name} ({device.management_ip}): "
                        f"{old_status} → {new_status.value}"
                    )

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

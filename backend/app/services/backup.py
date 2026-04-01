"""
BR10 NetManager - Backup Service
Serviço de backup automático do banco de dados e configurações.
"""
import asyncio
import gzip
import hashlib
import logging
import os
import shutil
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class BackupService:
    """Serviço de backup do banco de dados e arquivos."""

    def __init__(self):
        self.backup_dir = Path(settings.BACKUP_DIR)
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    def _get_backup_filename(self, backup_type: str = "auto") -> str:
        """Gera nome único para o arquivo de backup."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"br10netmanager_{backup_type}_{timestamp}.sql.gz"

    def _calculate_checksum(self, file_path: str) -> str:
        """Calcula SHA256 do arquivo de backup."""
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256.update(chunk)
        return sha256.hexdigest()

    def create_database_backup(self, backup_type: str = "manual") -> Optional[dict]:
        """
        Cria backup completo do banco de dados PostgreSQL.
        Retorna informações do backup criado.
        """
        try:
            from urllib.parse import urlparse
            db_url = settings.DATABASE_URL_SYNC
            parsed = urlparse(db_url)

            db_host = parsed.hostname or "localhost"
            db_port = str(parsed.port or 5432)
            db_name = parsed.path.lstrip("/")
            db_user = parsed.username or "postgres"
            db_pass = parsed.password or ""

            filename = self._get_backup_filename(backup_type)
            backup_path = self.backup_dir / filename
            temp_path = str(backup_path) + ".tmp"

            env = os.environ.copy()
            env["PGPASSWORD"] = db_pass

            # Executar pg_dump
            cmd = [
                "pg_dump",
                "-h", db_host,
                "-p", db_port,
                "-U", db_user,
                "-d", db_name,
                "--format=plain",
                "--no-password",
                "--verbose",
            ]

            with open(temp_path, "w") as f:
                result = subprocess.run(
                    cmd,
                    stdout=f,
                    stderr=subprocess.PIPE,
                    env=env,
                    timeout=300,
                )

            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="replace")
                logger.error(f"pg_dump falhou: {error_msg}")
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                return None

            # Comprimir com gzip
            with open(temp_path, "rb") as f_in:
                with gzip.open(str(backup_path), "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)

            os.remove(temp_path)

            file_size = os.path.getsize(str(backup_path))
            checksum = self._calculate_checksum(str(backup_path))

            logger.info(f"Backup criado: {filename} ({file_size} bytes)")

            return {
                "filename": filename,
                "path": str(backup_path),
                "size": file_size,
                "checksum": checksum,
                "created_at": datetime.now().isoformat(),
                "backup_type": backup_type,
            }

        except subprocess.TimeoutExpired:
            logger.error("Backup timeout após 5 minutos")
            return None
        except Exception as e:
            logger.error(f"Erro ao criar backup: {e}")
            return None

    def list_backups(self) -> list:
        """Lista todos os backups disponíveis."""
        backups = []
        for f in sorted(self.backup_dir.glob("*.sql.gz"), reverse=True):
            stat = f.stat()
            backups.append({
                "filename": f.name,
                "path": str(f),
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        return backups

    def cleanup_old_backups(self, retention_days: int = None):
        """Remove backups mais antigos que o período de retenção."""
        if retention_days is None:
            retention_days = settings.BACKUP_RETENTION_DAYS

        cutoff = datetime.now() - timedelta(days=retention_days)
        removed = 0

        for f in self.backup_dir.glob("*.sql.gz"):
            file_time = datetime.fromtimestamp(f.stat().st_mtime)
            if file_time < cutoff:
                f.unlink()
                removed += 1
                logger.info(f"Backup antigo removido: {f.name}")

        logger.info(f"Limpeza de backups: {removed} arquivo(s) removido(s)")
        return removed

    def restore_backup(self, filename: str) -> bool:
        """Restaura backup do banco de dados."""
        backup_path = self.backup_dir / filename
        if not backup_path.exists():
            logger.error(f"Arquivo de backup não encontrado: {filename}")
            return False

        try:
            from urllib.parse import urlparse
            db_url = settings.DATABASE_URL_SYNC
            parsed = urlparse(db_url)

            db_host = parsed.hostname or "localhost"
            db_port = str(parsed.port or 5432)
            db_name = parsed.path.lstrip("/")
            db_user = parsed.username or "postgres"
            db_pass = parsed.password or ""

            env = os.environ.copy()
            env["PGPASSWORD"] = db_pass

            # Descomprimir e restaurar
            temp_path = str(backup_path) + ".restore.sql"
            with gzip.open(str(backup_path), "rb") as f_in:
                with open(temp_path, "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)

            cmd = [
                "psql",
                "-h", db_host,
                "-p", db_port,
                "-U", db_user,
                "-d", db_name,
                "-f", temp_path,
            ]

            result = subprocess.run(cmd, env=env, timeout=600, capture_output=True)
            os.remove(temp_path)

            if result.returncode != 0:
                logger.error(f"Restauração falhou: {result.stderr.decode()}")
                return False

            logger.info(f"Backup restaurado com sucesso: {filename}")
            return True

        except Exception as e:
            logger.error(f"Erro ao restaurar backup: {e}")
            return False


backup_service = BackupService()


async def scheduled_backup():
    """Task de backup agendado para executar diariamente."""
    while True:
        try:
            logger.info("Iniciando backup agendado...")
            result = backup_service.create_database_backup("scheduled")
            if result:
                logger.info(f"Backup agendado concluído: {result['filename']}")
                backup_service.cleanup_old_backups()
            else:
                logger.error("Backup agendado falhou")
        except Exception as e:
            logger.error(f"Erro no backup agendado: {e}")

        # Aguardar 24 horas
        await asyncio.sleep(86400)

#!/bin/bash
# =============================================
# BR10 NetManager - Backup Script
# Backup automático do banco de dados PostgreSQL
# =============================================

set -euo pipefail

# Configurações
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
DB_NAME="${DB_NAME:-br10netmanager}"
DB_USER="${DB_USER:-br10user}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/db_backup_${TIMESTAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Criar diretório de backup
mkdir -p "${BACKUP_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

log "=== Iniciando backup BR10 NetManager ==="
log "Banco: ${DB_NAME} | Host: ${DB_HOST}:${DB_PORT}"

# Executar backup
if PGPASSWORD="${DB_PASSWORD:-br10password}" pg_dump \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --no-password \
    --format=plain \
    --verbose \
    2>>"${LOG_FILE}" | gzip > "${BACKUP_FILE}"; then

    SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
    log "Backup criado com sucesso: ${BACKUP_FILE} (${SIZE})"
else
    log "ERRO: Falha ao criar backup!"
    exit 1
fi

# Remover backups antigos
log "Removendo backups com mais de ${RETENTION_DAYS} dias..."
find "${BACKUP_DIR}" -name "db_backup_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
REMAINING=$(ls -1 "${BACKUP_DIR}"/db_backup_*.sql.gz 2>/dev/null | wc -l)
log "Backups mantidos: ${REMAINING}"

# Verificar integridade do backup
if gzip -t "${BACKUP_FILE}" 2>/dev/null; then
    log "Verificação de integridade: OK"
else
    log "AVISO: Falha na verificação de integridade do backup"
fi

log "=== Backup concluído com sucesso ==="
echo "${BACKUP_FILE}"

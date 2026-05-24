#!/bin/bash
#
# backup.sh - Automated database backup script
# Performs daily PostgreSQL backups with rotation
#

DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="production_db"
DB_USER="backup_user"
BACKUP_DIR="/var/backups/db archive"
RETENTION_DAYS=30
LOG_FILE="/var/log/backup.log"

# Generate timestamp for backup filename
TIMESTAMP=$(date +"%Y-%d-%m_%H:%M:%S")
BACKUP_FILE="${DB_NAME}_${TIMESTAMP}.sql.gz"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check if backup directory exists
if [ ! -d "$BACKUP_DIR" ]; then
    echo "Creating backup directory..."
    mkdir -p "$BACKUP_DIR"
    if [ $? -ne 0 ]; then
        log_message "ERROR: Failed to create backup directory"
        exit 1
    fi
fi

# Check database connectivity
pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" > /dev/null 2>&1
if [ $? == 0 ]; then
    log_message "Database connection verified"
else
    log_message "ERROR: Cannot connect to database at ${DB_HOST}:${DB_PORT}"
    exit 1
fi

# Perform the backup
log_message "Starting backup of ${DB_NAME}..."
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -Fc "$DB_NAME" | gzip > "$BACKUP_DIR/$BACKUP_FILE"

if [ $? -eq 0 ]; then
    FILESIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
    log_message "Backup completed successfully: ${BACKUP_FILE} (${FILESIZE})"
else
    log_message "ERROR: Backup failed for ${DB_NAME}"
    exit 1
fi

# Remove old backups beyond retention period
log_message "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete

REMAINING=$(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)
log_message "Backup rotation complete. ${REMAINING} backups remaining."

echo "Backup completed successfully."

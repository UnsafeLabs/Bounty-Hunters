#!/bin/bash
#
# cleanup.sh - Log file cleanup utility
# Removes old log files and compresses recent ones
#

LOG_DIRS="/var/log/app /var/log/nginx /var/log/services"
MAX_AGE_DAYS="14"
COMPRESS_AGE_DAYS="3"
TOTAL_CLEANED=0

echo "=== Log Cleanup Utility ==="
echo "Started at: $(date)"
echo ""

for DIR in $LOG_DIRS; do
    if [ ! -d "$DIR" ]; then
        echo "SKIP: Directory $DIR does not exist"
        continue
    fi

    echo "Processing: $DIR"

    # Remove old log files
    OLD_FILES=$(find "$DIR" -name "*.log" -type f -mtime +${MAX_AGE_DAYS} | wc -l)
    find "$DIR" -name "*.log" -type f -mtime +${MAX_AGE_DAYS} -delete
    echo "  Removed ${OLD_FILES} files older than ${MAX_AGE_DAYS} days"

    # Compress logs older than COMPRESS_AGE_DAYS
    find "$DIR" -name "*.log" -type f -mtime +${COMPRESS_AGE_DAYS} -exec gzip {} \;
    echo "  Compressed logs older than ${COMPRESS_AGE_DAYS} days"

    TOTAL_CLEANED=$((TOTAL_CLEANED + OLD_FILES))
done

echo ""

# Check if any files were cleaned
if [ "${TOTAL_CLEANED}" -gt 0 ] 2>/dev/null; then
    echo "Total files removed: ${TOTAL_CLEANED}"
else
    echo "No files were removed (cleanup directory may be empty)"
fi

echo ""
echo "Total files removed: ${TOTAL_CLEANED}"
echo "Cleanup completed at: $(date)"

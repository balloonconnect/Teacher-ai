#!/usr/bin/env bash
# Daily backup for the single-server setup: database dump + textbook/upload files. Keeps the last 14 days.
#   ./scripts/backup.sh            (run from the project folder; add to cron: 0 2 * * * cd /srv/karkai && ./scripts/backup.sh)
# Copy the backups folder OFF the server too (another disk or object storage), or a dead server takes the backups with it.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-./backups}"; STAMP="$(date +%F-%H%M)"; C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
mkdir -p "$DEST"
$C exec -T db pg_dump -U karkai karkai | gzip > "$DEST/db-$STAMP.sql.gz"
$C exec -T app tar -C /data -czf - . > "$DEST/files-$STAMP.tar.gz"
find "$DEST" -type f \( -name 'db-*.sql.gz' -o -name 'files-*.tar.gz' \) -mtime +14 -delete
echo "Backup written to $DEST ($STAMP)"
# Restore: gunzip -c db-*.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U karkai karkai
#          docker compose -f docker-compose.prod.yml exec -T app tar -C /data -xzf - < files-*.tar.gz

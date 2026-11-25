#!/usr/bin/env bash
set -euo pipefail

# Bezpieczny backup bazy SQLite (WAL) z wolumenu Dockera.
# Zachowuje ostatnie 7 kopii w katalogu ./backups/.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/backups"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="${BACKUP_DIR}/kilometr-delays-${STAMP}.db.gz"

echo "Tworze kopie zapasowa bazy SQLite do ${OUT_FILE}..."
docker compose -f "${SCRIPT_DIR}/docker-compose.yml" exec -T api \
  sh -c 'cat /data/kilometr-delays.db' | gzip -9 > "$OUT_FILE"

# Retencja: zostawiamy 7 najnowszych kopii.
ls -1t "${BACKUP_DIR}"/kilometr-delays-*.db.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "Gotowe: $(du -h "$OUT_FILE" | cut -f1)"

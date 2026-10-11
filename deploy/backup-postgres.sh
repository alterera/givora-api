#!/usr/bin/env bash
set -euo pipefail
DEST="${1:-/var/backups/givora}"
mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump --format=custom --file="$DEST/givora-$STAMP.dump" "${DATABASE_URL:?DATABASE_URL is required}"
find "$DEST" -name 'givora-*.dump' -mtime +14 -delete
echo "Wrote $DEST/givora-$STAMP.dump"
echo "Restore drill: createdb givora_restore && pg_restore --dbname=givora_restore $DEST/givora-$STAMP.dump"

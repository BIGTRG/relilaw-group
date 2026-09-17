#!/bin/bash
# Nightly logical backup of one PostgreSQL database (custom format, compressed).
#
# Usage: pg-backup.sh <dbname> <backup_dir> [port] [retention_days]
# Runs as the postgres OS user over the unix socket (no password needed).
# Files are written 0600 inside a 0700 directory and pruned after <retention_days>.
set -euo pipefail

DB="${1:?dbname required}"
DIR="${2:?backup dir required}"
PORT="${3:-5432}"
KEEP_DAYS="${4:-14}"

# Debian pg_wrapper picks a binary version by the default cluster, not by port.
# On a host with several major versions, address the right bin dir explicitly.
PGBIN="$(pg_lsclusters -h 2>/dev/null | awk -v p="$PORT" '$3==p {print "/usr/lib/postgresql/" $1 "/bin"; exit}')"
if [ -n "$PGBIN" ] && [ -x "$PGBIN/pg_dump" ]; then PATH="$PGBIN:$PATH"; fi

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
OUT="$DIR/${DB}_${STAMP}.dump"
TMP="$OUT.partial"

pg_dump --host=/var/run/postgresql --port="$PORT" --format=custom --compress=6 \
  --no-owner --no-privileges --file="$TMP" "$DB"
chmod 600 "$TMP"
mv "$TMP" "$OUT"

# Sanity: the archive must list at least one table entry.
pg_restore --list "$OUT" | grep -q "TABLE DATA" || { echo "backup $OUT has no table data" >&2; exit 2; }

# Retention.
find "$DIR" -maxdepth 1 -type f -name "${DB}_*.dump" -mtime +"$KEEP_DAYS" -print -delete

SIZE="$(stat -c %s "$OUT")"
echo "[$(date -u +%FT%TZ)] backup ok db=$DB file=$OUT bytes=$SIZE retention_days=$KEEP_DAYS"

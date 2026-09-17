#!/bin/bash
# Backup restore drill.
#
# Restores the newest custom-format dump of <dbname> into a scratch database,
# compares row counts of the listed tables against the live database, prints a
# table, and drops the scratch database. Exit code 0 only if every count matches.
#
# Usage (as postgres, over the unix socket):
#   restore-drill.sh <dbname> <backup_dir> [port] [table ...]
# Examples:
#   sudo -u postgres /opt/relilaw/ops/restore-drill.sh reli /var/backups/relilaw 5432 \
#       app_user entitlement content_version review_item credential_link
#   sudo -u postgres restore-drill.sh learning_core /var/backups/learning-core 5433 \
#       tenant learner course attempt credential
#
# Notes
# - The scratch database is <dbname>_restore_check. It is dropped at the start
#   (if a previous drill was interrupted) and at the end.
# - Counts are taken from the live database AFTER the restore finishes, so a
#   row written during the drill shows up as a difference. Re-run if that happens
#   at a quiet moment; a difference of a handful of rows in a busy table is
#   expected on a live system and is reported, not hidden.
# - Extensions and roles are not part of the dump (--no-owner --no-privileges),
#   so the scratch restore runs as the postgres superuser; RLS policies restore
#   but do not apply to a superuser, which is what we want for counting.
set -uo pipefail

DB="${1:?dbname required}"
DIR="${2:?backup dir required}"
PORT="${3:-5432}"
shift 3 || shift $#
TABLES=("$@")
SCRATCH="${DB}_restore_check"
PGBIN="$(pg_lsclusters -h 2>/dev/null | awk -v p="$PORT" '$3==p {print "/usr/lib/postgresql/" $1 "/bin"; exit}')"
if [ -n "$PGBIN" ] && [ -x "$PGBIN/pg_restore" ]; then PATH="$PGBIN:$PATH"; fi
PSQL=(psql --host=/var/run/postgresql --port="$PORT" -X -q -v ON_ERROR_STOP=1)

LATEST="$(ls -1t "$DIR"/"${DB}"_*.dump 2>/dev/null | head -n 1 || true)"
if [ -z "$LATEST" ]; then
  echo "no dump found in $DIR for $DB" >&2
  exit 2
fi

echo "== restore drill: db=$DB port=$PORT"
echo "== dump: $LATEST ($(stat -c %s "$LATEST") bytes, $(date -u -r "$LATEST" +%FT%TZ))"

cleanup() {
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
"${PSQL[@]}" -d postgres -c "CREATE DATABASE \"$SCRATCH\" TEMPLATE template0 ENCODING 'UTF8';"
START=$(date +%s)
# --exit-on-error would abort on harmless "extension already exists" notices; we
# capture warnings and fail only on real errors.
if ! pg_restore --host=/var/run/postgresql --port="$PORT" --dbname="$SCRATCH" \
     --no-owner --no-privileges --single-transaction "$LATEST" 2>/tmp/restore-drill.$$.err; then
  echo "pg_restore failed:" >&2
  cat /tmp/restore-drill.$$.err >&2
  rm -f /tmp/restore-drill.$$.err
  exit 3
fi
rm -f /tmp/restore-drill.$$.err
echo "== restored into $SCRATCH in $(( $(date +%s) - START ))s"

if [ ${#TABLES[@]} -eq 0 ]; then
  mapfile -t TABLES < <("${PSQL[@]}" -d "$DB" -tA -c \
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")
fi

printf '%-28s %14s %14s  %s\n' "table" "live" "restored" "result"
FAIL=0
for t in "${TABLES[@]}"; do
  live="$("${PSQL[@]}" -d "$DB" -tA -c "select count(*) from public.\"$t\"" 2>/dev/null || echo ERR)"
  rest="$("${PSQL[@]}" -d "$SCRATCH" -tA -c "select count(*) from public.\"$t\"" 2>/dev/null || echo ERR)"
  if [ "$live" = "$rest" ] && [ "$live" != "ERR" ]; then res="match"; else res="MISMATCH"; FAIL=1; fi
  printf '%-28s %14s %14s  %s\n' "$t" "$live" "$rest" "$res"
done

SCHEMA_LIVE="$("${PSQL[@]}" -d "$DB" -tA -c "select count(*) from information_schema.tables where table_schema='public'")"
SCHEMA_REST="$("${PSQL[@]}" -d "$SCRATCH" -tA -c "select count(*) from information_schema.tables where table_schema='public'")"
echo "== public tables: live=$SCHEMA_LIVE restored=$SCHEMA_REST"

cleanup
trap - EXIT
if "${PSQL[@]}" -d postgres -tA -c "select 1 from pg_database where datname='$SCRATCH'" | grep -q 1; then
  echo "scratch database still present" >&2; exit 4
fi
echo "== scratch database $SCRATCH dropped"

if [ "$FAIL" -eq 0 ]; then
  echo "== RESULT: PASS (all counts match)"
else
  echo "== RESULT: FAIL (see MISMATCH rows)"
fi
exit "$FAIL"

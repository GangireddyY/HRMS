#!/bin/sh
# Proves a backup restores: checks its checksum, restores it into a scratch database, and compares the schema version
# and row counts of key tables with the source database (when it is reachable). The scratch database is dropped after.
#
#   DB_HOST=… DB_PORT=5432 DB_NAME=hrms DB_USER=… PGPASSWORD=… scripts/db-restore-verify.sh backups/hrms-20261111T010000Z.dump
#
# Optional:
#   MIGRATIONS_DIR   backend/src/database/migrations: every *.up.sql must be recorded as applied in the restore
#   COMPARE_SOURCE   0 to skip the row-count comparison (restoring a production dump elsewhere)
#   KEEP_RESTORE     1 to keep the scratch database for inspection
set -eu

dump=${1:?usage: db-restore-verify.sh <dump file>}
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
scratch="${DB_NAME}_restore_check"
conn="--host=$DB_HOST --port=$DB_PORT --username=$DB_USER --no-password"

if [ -f "$dump.sha256" ]; then
  (cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256" >/dev/null)
  echo "checksum ok"
fi

case "$dump" in
  *.gpg)
    plain="${dump%.gpg}.restore-tmp"
    gpg --batch --yes --output "$plain" --decrypt "$dump"
    trap 'rm -f "$plain"' EXIT
    dump="$plain"
    ;;
esac

# shellcheck disable=SC2086
dropdb $conn --if-exists "$scratch"
# shellcheck disable=SC2086
createdb $conn "$scratch"
# shellcheck disable=SC2086
pg_restore $conn --dbname="$scratch" --no-owner --no-acl --exit-on-error "$dump"
echo "restored into $scratch"

q() {
  # shellcheck disable=SC2086
  psql $conn --dbname="$1" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command="$2"
}

applied=$(q "$scratch" "SELECT count(*) FROM schema_migrations")
echo "migrations applied: $applied"
if [ -n "${MIGRATIONS_DIR:-}" ]; then
  expected=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.up.sql' | wc -l | tr -d ' ')
  [ "$applied" = "$expected" ] || { echo "restore has $applied migrations, expected $expected" >&2; exit 1; }
fi

status=0
for table in organizations users organization_memberships employees audit_logs payroll_runs leave_requests; do
  restored=$(q "$scratch" "SELECT count(*) FROM \"$table\"")
  if [ "${COMPARE_SOURCE:-1}" = "1" ]; then
    source=$(q "$DB_NAME" "SELECT count(*) FROM \"$table\"")
    if [ "$restored" != "$source" ]; then
      echo "$table: $restored rows restored, $source in the source" >&2
      status=1
    else
      echo "$table: $restored rows"
    fi
  else
    echo "$table: $restored rows"
  fi
done

if [ "${KEEP_RESTORE:-0}" != "1" ]; then
  # shellcheck disable=SC2086
  dropdb $conn "$scratch"
fi
[ "$status" = 0 ] && echo "restore verified"
exit "$status"

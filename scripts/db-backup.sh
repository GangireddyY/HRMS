#!/bin/sh
# Full PostgreSQL backup (custom format) with a SHA-256 checksum; optionally encrypted and copied to S3.
#
#   DB_HOST=… DB_PORT=5432 DB_NAME=hrms DB_USER=… PGPASSWORD=… scripts/db-backup.sh [output-dir]
#
# Optional:
#   BACKUP_GPG_RECIPIENT  encrypt the dump for this GPG key (the plain dump is removed)
#   BACKUP_S3_URI         copy the dump and its checksum there, e.g. s3://hrms-backups/prod/ (aws CLI, SSE-KMS)
#   BACKUP_KEEP_DAYS      delete local dumps older than this many days (default 7)
#
# Prints the path of the dump. Run daily from cron / a scheduled job, next to continuous WAL archiving
# (see docs/SECURITY.md §6), and test restores with scripts/db-restore-verify.sh.
set -eu

: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
out_dir=${1:-backups}
keep_days=${BACKUP_KEEP_DAYS:-7}

mkdir -p "$out_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$out_dir/$DB_NAME-$stamp.dump"

pg_dump --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$DB_NAME" \
  --format=custom --compress=6 --no-password --file="$file"

# The dump must be readable before it counts as a backup.
pg_restore --list "$file" >/dev/null

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --output "$file.gpg" --encrypt "$file"
  rm -f "$file"
  file="$file.gpg"
fi

(cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")

if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$file" "$BACKUP_S3_URI" --sse aws:kms --only-show-errors
  aws s3 cp "$file.sha256" "$BACKUP_S3_URI" --sse aws:kms --only-show-errors
fi

find "$out_dir" -maxdepth 1 -name "$DB_NAME-*.dump*" -mtime +"$keep_days" -exec rm -f {} + 2>/dev/null || true

echo "$file"

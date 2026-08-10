#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_directory}/common.sh"

environment="${1:-}"
release_sha="${2:-}"
backup_path="${3:-}"
configure_release "${environment}" "${release_sha}"
[[ -f "${backup_path}" ]] || { printf 'Backup file does not exist.\n' >&2; exit 2; }
gzip -t "${backup_path}"

drill_id="$(date -u +%Y%m%d%H%M%S)-$$"
drill_database="waflo_restore_drill_${drill_id//-/_}"
report_directory="${PLATFORM_ROOT}/backups/${environment}/restore-drills"
report_path="${report_directory}/${drill_id}.txt"
mkdir -p "${report_directory}"

cleanup() {
  compose exec -T postgres sh -ec \
    'dropdb --if-exists --force --username="$POSTGRES_USER" "$1"' sh "${drill_database}" >/dev/null
}
trap cleanup EXIT

compose exec -T postgres sh -ec \
  'createdb --template=template0 --username="$POSTGRES_USER" "$1"' sh "${drill_database}"
gzip -dc "${backup_path}" | compose exec -T postgres sh -ec \
  'pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$1"' \
  sh "${drill_database}"

migration_count="$(compose exec -T postgres sh -ec \
  'psql --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$1" --command="SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"' \
  sh "${drill_database}")"
table_count="$(compose exec -T postgres sh -ec \
  'psql --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$1" --command="SELECT count(*) FROM pg_tables WHERE schemaname = '\''public'\''"' \
  sh "${drill_database}")"

{
  printf 'status=PASS\n'
  printf 'environment=%s\n' "${environment}"
  printf 'backup=%s\n' "${backup_path}"
  printf 'release=%s\n' "${release_sha}"
  printf 'completed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'completed_migrations=%s\n' "${migration_count}"
  printf 'public_tables=%s\n' "${table_count}"
} >"${report_path}"

printf 'Restore drill passed; report: %s. The disposable drill database will now be removed.\n' "${report_path}"

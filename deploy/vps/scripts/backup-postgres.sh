#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_directory}/common.sh"

environment="${1:-}"
release_sha="${2:-}"
configure_release "${environment}" "${release_sha}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_directory="${PLATFORM_ROOT}/backups/${environment}/postgres"
backup_path="${backup_directory}/${environment}-${timestamp}.dump.gz"
retention_days="${POSTGRES_BACKUP_RETENTION_DAYS:-14}"
mkdir -p "${backup_directory}"

compose exec -T postgres sh -ec \
  'exec pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip -9 >"${backup_path}"
gzip -t "${backup_path}"
sha256sum "${backup_path}" >"${backup_path}.sha256"
find "${backup_directory}" -maxdepth 1 -type f -name '*.dump.gz*' -mtime "+${retention_days}" -delete

printf 'Created and checksummed %s. Copy it to encrypted off-server storage now.\n' "${backup_path}"

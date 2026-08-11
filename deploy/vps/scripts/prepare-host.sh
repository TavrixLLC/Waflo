#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_directory}/common.sh"

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this host-directory preparation script with sudo.\n' >&2
  exit 2
fi

install -d -m 0755 \
  "${PLATFORM_ROOT}" \
  "${PLATFORM_ROOT}/releases" \
  "${PLATFORM_ROOT}/current" \
  "${PLATFORM_ROOT}/env" \
  "${PLATFORM_ROOT}/backups" \
  "${PLATFORM_ROOT}/deploy-logs" \
  "${PLATFORM_ROOT}/scripts"

for environment in staging production; do
  install -d -m 0750 "${PLATFORM_ROOT}/env/${environment}"
  install -d -m 0700 "${PLATFORM_ROOT}/secrets/${environment}"
  install -d -o root -g 10001 -m 0750 \
    "${PLATFORM_ROOT}/secrets/${environment}/provider-files"
  prepare_postgres_bind "${environment}"
  install -d -m 0750 \
    "${PLATFORM_ROOT}/data/${environment}/redis" \
    "${PLATFORM_ROOT}/data/${environment}/object-storage" \
    "${PLATFORM_ROOT}/backups/${environment}/postgres" \
    "${PLATFORM_ROOT}/backups/${environment}/restore-drills"
  install -d -m 0700 "${PLATFORM_ROOT}/deploy-logs/${environment}"
done

printf 'Prepared %s without changing Docker, host ports, or unrelated services.\n' "${PLATFORM_ROOT}"

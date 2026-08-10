#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_directory}/common.sh"

environment="${1:-}"
release_sha="${2:-}"
configure_release "${environment}" "${release_sha}"
assert_secret_permissions

exec 9>"${PLATFORM_ROOT}/deploy-${environment}.lock"
flock -n 9 || { printf 'Another %s deployment is active.\n' "${environment}" >&2; exit 3; }

compose config --quiet
compose up -d --no-build postgres redis minio
compose up --no-build minio-init

printf 'Executing exactly one forward migration job.\n'
compose run --rm migrate

compose up -d --no-build --wait --wait-timeout 240 \
  api merchant-web customer-web marketing-web operational-worker wallet-worker cloudflared

compose exec -T api node -e \
  "fetch('http://127.0.0.1:4000/ready').then(async r=>{if(!r.ok)throw new Error(await r.text())}).catch(()=>process.exit(1))"

ln -sfn "${RELEASE_DIRECTORY}" "${PLATFORM_ROOT}/current/${environment}"
compose ps
printf 'Application release %s is current for %s. Database schemas were not made rollback-aware.\n' \
  "${release_sha}" "${environment}"

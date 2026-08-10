#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_directory}/common.sh"

environment="${1:-}"
target_release_sha="${2:-}"
configure_release "${environment}" "${target_release_sha}"
assert_legal_release_state
assert_secret_permissions

exec 9>"${PLATFORM_ROOT}/deploy-${environment}.lock"
flock -n 9 || { printf 'Another %s deployment is active.\n' "${environment}" >&2; exit 3; }

rollback_failed() {
  local status=$?
  trap - ERR
  capture_deployment_logs "${environment}" "${target_release_sha}"
  exit "${status}"
}
trap rollback_failed ERR

printf 'Rolling application images back to %s; no database rollback will run.\n' "${target_release_sha}"
compose config --quiet
compose pull --policy always "${APPLICATION_SERVICES[@]}"
compose up -d --no-build --wait --wait-timeout 240 \
  api merchant-web customer-web marketing-web operational-worker wallet-worker cloudflared
compose exec -T api node -e \
  "fetch('http://127.0.0.1:4000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
assert_public_health
ln -sfn "${RELEASE_DIRECTORY}" "${PLATFORM_ROOT}/current/${environment}"
compose ps

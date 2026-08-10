#!/usr/bin/env bash
set -Eeuo pipefail

readonly PLATFORM_ROOT="${PLATFORM_ROOT:-/opt/waflo-platform}"

require_environment() {
  case "${1:-}" in
    staging|production) ;;
    *) printf 'Environment must be staging or production.\n' >&2; return 2 ;;
  esac
}
require_release_sha() {
  if [[ ! "${1:-}" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'Release must be a full 40-character lowercase Git SHA.\n' >&2
    return 2
  fi
}

configure_release() {
  local environment="$1"
  local release_sha="$2"
  require_environment "${environment}"
  require_release_sha "${release_sha}"

  export DEPLOYMENT_ENVIRONMENT="${environment}"
  export RELEASE_SHA="${release_sha}"
  export PLATFORM_ROOT
  export RELEASE_DIRECTORY="${PLATFORM_ROOT}/releases/${release_sha}"
  export COMPOSE_FILE="${RELEASE_DIRECTORY}/deploy/vps/compose.yml"
  export COMPOSE_ENV_FILE="${PLATFORM_ROOT}/env/${environment}/compose.env"
  export WAFLO_ENV_FILE="${PLATFORM_ROOT}/env/${environment}/application.env"
  export WAFLO_SECRET_ENV_FILE="${PLATFORM_ROOT}/secrets/${environment}/application.env"

  [[ -f "${COMPOSE_FILE}" ]] || { printf 'Missing release compose file: %s\n' "${COMPOSE_FILE}" >&2; return 2; }
  [[ -f "${COMPOSE_ENV_FILE}" ]] || { printf 'Missing Compose environment: %s\n' "${COMPOSE_ENV_FILE}" >&2; return 2; }
  [[ -f "${WAFLO_ENV_FILE}" ]] || { printf 'Missing application environment: %s\n' "${WAFLO_ENV_FILE}" >&2; return 2; }
  [[ -f "${WAFLO_SECRET_ENV_FILE}" ]] || { printf 'Missing application secrets: %s\n' "${WAFLO_SECRET_ENV_FILE}" >&2; return 2; }
}

compose() {
  docker compose --env-file "${COMPOSE_ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

assert_secret_permissions() {
  local secret_directory="${PLATFORM_ROOT}/secrets/${DEPLOYMENT_ENVIRONMENT}"
  local provider_directory="${secret_directory}/provider-files"
  local insecure
  insecure="$(find "${secret_directory}" -maxdepth 1 -type f ! -perm 0600 -print)"
  if [[ -n "${insecure}" ]]; then
    printf 'Secret files must be mode 0600:\n%s\n' "${insecure}" >&2
    return 2
  fi
  if [[ "$(stat -c '%a:%u:%g' "${provider_directory}")" != "750:0:10001" ]]; then
    printf 'Provider secret directory must be mode 0750 and owned by root:10001.\n' >&2
    return 2
  fi
  insecure="$(find "${provider_directory}" -maxdepth 1 -type f \
    \( ! -perm 0440 -o ! -uid 0 -o ! -gid 10001 \) -print)"
  if [[ -n "${insecure}" ]]; then
    printf 'Provider secret files must be mode 0440 and owned by root:10001:\n%s\n' "${insecure}" >&2
    return 2
  fi
  if grep -qx 'GOOGLE_WALLET_MODE=REAL' "${WAFLO_ENV_FILE}" && \
    [[ ! -f "${provider_directory}/google-wallet-service-account.json" ]]; then
    printf 'Real Google Wallet requires google-wallet-service-account.json.\n' >&2
    return 2
  fi
  if grep -qx 'APPLE_WALLET_MODE=REAL' "${WAFLO_ENV_FILE}"; then
    for required in apple-wallet-pass.p12 apple-wwdr.pem; do
      if [[ ! -f "${provider_directory}/${required}" ]]; then
        printf 'Real Apple Wallet requires %s.\n' "${required}" >&2
        return 2
      fi
    done
  fi
}

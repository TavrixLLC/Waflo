#!/usr/bin/env bash
set -Eeuo pipefail

readonly PLATFORM_ROOT="${PLATFORM_ROOT:-/opt/waflo-platform}"
readonly POSTGRES_CONTAINER_UID=70
readonly POSTGRES_CONTAINER_GID=70
readonly CLOUDFLARED_CONTAINER_UID=65532
readonly CLOUDFLARED_CONTAINER_GID=65532
readonly -a INFRASTRUCTURE_SERVICES=(postgres redis minio minio-init)
readonly -a APPLICATION_SERVICES=(
  api
  merchant-web
  customer-web
  marketing-web
  operational-worker
  wallet-worker
  cloudflared
)
readonly -a RELEASE_PULL_SERVICES=(migrate "${APPLICATION_SERVICES[@]}")

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

prepare_postgres_bind() {
  local environment="${1:-}"
  local postgres_bind
  local pgdata

  require_environment "${environment}"
  if [[ "${EUID}" -ne 0 ]]; then
    printf 'PostgreSQL bind preparation must run as root.\n' >&2
    return 2
  fi

  postgres_bind="${PLATFORM_ROOT}/data/${environment}/postgres"
  pgdata="${postgres_bind}/pgdata"
  if [[ -L "${postgres_bind}" ]]; then
    printf 'PostgreSQL bind path may not be a symbolic link: %s\n' "${postgres_bind}" >&2
    return 2
  fi

  install -d -o "${POSTGRES_CONTAINER_UID}" -g "${POSTGRES_CONTAINER_GID}" -m 0750 \
    "${postgres_bind}"
  if [[ -L "${pgdata}" || ( -e "${pgdata}" && ! -d "${pgdata}" ) ]]; then
    printf 'PostgreSQL PGDATA must be a real directory: %s\n' "${pgdata}" >&2
    return 2
  fi
  install -d -o "${POSTGRES_CONTAINER_UID}" -g "${POSTGRES_CONTAINER_GID}" -m 0700 \
    "${pgdata}"

  # PostgreSQL owns every cluster entry. -xdev and --no-dereference keep this
  # repair inside the dedicated bind even if it contains a mount or symlink.
  find "${postgres_bind}" -xdev \
    \( ! -user "${POSTGRES_CONTAINER_UID}" -o ! -group "${POSTGRES_CONTAINER_GID}" \) \
    -exec chown --no-dereference \
      "${POSTGRES_CONTAINER_UID}:${POSTGRES_CONTAINER_GID}" {} +
  chmod 0750 "${postgres_bind}"
  chmod 0700 "${pgdata}"
  printf 'PostgreSQL bind is prepared for container identity %s:%s at %s.\n' \
    "${POSTGRES_CONTAINER_UID}" "${POSTGRES_CONTAINER_GID}" "${postgres_bind}"
}

cloudflare_tunnel_token_path() {
  local environment="${1:-}"
  require_environment "${environment}"
  printf '%s' "${PLATFORM_ROOT}/secrets/${environment}/cloudflare_tunnel_token"
}

assert_cloudflare_tunnel_token_permissions() {
  local environment="${1:-}"
  local secret_root="${PLATFORM_ROOT}/secrets"
  local secret_directory
  local token_file

  require_environment "${environment}"
  secret_directory="${secret_root}/${environment}"
  token_file="$(cloudflare_tunnel_token_path "${environment}")"

  for directory in "${PLATFORM_ROOT}" "${secret_root}" "${secret_directory}"; do
    if [[ -L "${directory}" || ! -d "${directory}" ]]; then
      printf 'Cloudflare token parent must be a real directory: %s\n' "${directory}" >&2
      return 2
    fi
  done
  if [[ -L "${token_file}" || ! -f "${token_file}" ]]; then
    printf 'Cloudflare tunnel token must be a regular, non-symlink file: %s\n' \
      "${token_file}" >&2
    return 2
  fi
  if [[ "$(stat -c '%a:%u:%g' "${token_file}")" != \
    "440:0:${CLOUDFLARED_CONTAINER_GID}" ]]; then
    printf 'Cloudflare tunnel token must be mode 0440 and owned by root:%s.\n' \
      "${CLOUDFLARED_CONTAINER_GID}" >&2
    return 2
  fi
}

prepare_cloudflare_tunnel_token() {
  local environment="${1:-}"
  local token_file

  require_environment "${environment}"
  if [[ "${EUID}" -ne 0 ]]; then
    printf 'Cloudflare tunnel token preparation must run as root.\n' >&2
    return 2
  fi
  token_file="$(cloudflare_tunnel_token_path "${environment}")"

  # Validate every expected path before changing metadata. In particular, never
  # follow a substituted token symlink or operate outside this environment.
  if [[ -L "${PLATFORM_ROOT}" || ! -d "${PLATFORM_ROOT}" || \
    -L "${PLATFORM_ROOT}/secrets" || ! -d "${PLATFORM_ROOT}/secrets" || \
    -L "${PLATFORM_ROOT}/secrets/${environment}" || \
    ! -d "${PLATFORM_ROOT}/secrets/${environment}" || \
    -L "${token_file}" || ! -f "${token_file}" ]]; then
    printf 'Cloudflare tunnel token path must contain only real directories and a regular file: %s\n' \
      "${token_file}" >&2
    return 2
  fi
  if [[ "$(stat -c '%a' "${token_file}")" == *[1-7] ]]; then
    printf 'Cloudflare tunnel token may not grant permissions to other users: %s\n' \
      "${token_file}" >&2
    return 2
  fi

  chown --no-dereference "0:${CLOUDFLARED_CONTAINER_GID}" -- "${token_file}"
  if [[ -L "${token_file}" || ! -f "${token_file}" ]]; then
    printf 'Cloudflare tunnel token changed file type during preparation: %s\n' \
      "${token_file}" >&2
    return 2
  fi
  chmod 0440 -- "${token_file}"
  assert_cloudflare_tunnel_token_permissions "${environment}"
  printf 'Cloudflare tunnel token metadata is prepared for container identity %s:%s.\n' \
    "${CLOUDFLARED_CONTAINER_UID}" "${CLOUDFLARED_CONTAINER_GID}"
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
  export CLOUDFLARE_TUNNEL_TOKEN_FILE="$(cloudflare_tunnel_token_path "${environment}")"

  [[ -f "${COMPOSE_FILE}" ]] || { printf 'Missing release compose file: %s\n' "${COMPOSE_FILE}" >&2; return 2; }
  [[ -f "${COMPOSE_ENV_FILE}" ]] || { printf 'Missing Compose environment: %s\n' "${COMPOSE_ENV_FILE}" >&2; return 2; }
  [[ -f "${WAFLO_ENV_FILE}" ]] || { printf 'Missing application environment: %s\n' "${WAFLO_ENV_FILE}" >&2; return 2; }
  [[ -f "${WAFLO_SECRET_ENV_FILE}" ]] || { printf 'Missing application secrets: %s\n' "${WAFLO_SECRET_ENV_FILE}" >&2; return 2; }
}

compose() {
  docker compose --env-file "${COMPOSE_ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

application_config_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${WAFLO_ENV_FILE}" | tail -n 1 || true)"
  printf '%s' "${line#*=}" | tr -d '\r'
}

is_iso_calendar_date() {
  local value="$1"
  local normalized
  [[ "${value}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || return 1
  normalized="$(date --date="${value}" +%F 2>/dev/null)" || return 1
  [[ "${normalized}" == "${value}" ]]
}

assert_legal_release_state() {
  local legal_effective_date
  legal_effective_date="$(application_config_value LEGAL_EFFECTIVE_DATE)"

  if [[ "${DEPLOYMENT_ENVIRONMENT}" == "staging" ]]; then
    case "${legal_effective_date}" in
      ""|LEGAL_REVIEW_REQUIRED|"To be confirmed after legal review"|REPLACE_*)
        printf 'Legal review is pending; staging will render the explicit draft-review notice.\n'
        return 0
        ;;
    esac
    if is_iso_calendar_date "${legal_effective_date}"; then
      printf 'Staging has an operator-supplied legal effective date.\n'
      return 0
    fi
    printf 'Staging LEGAL_EFFECTIVE_DATE must be empty, a review sentinel, or YYYY-MM-DD.\n' >&2
    return 2
  fi

  if ! is_iso_calendar_date "${legal_effective_date}"; then
    printf 'Production requires the counsel-approved LEGAL_EFFECTIVE_DATE in YYYY-MM-DD format.\n' >&2
    return 2
  fi
  printf 'Production legal effective-date gate passed.\n'
}

pull_release_images() {
  printf 'Pulling immutable release and pinned infrastructure images.\n'
  compose --profile tools pull --policy always \
    "${INFRASTRUCTURE_SERVICES[@]}" "${RELEASE_PULL_SERVICES[@]}"
}

capture_deployment_logs() {
  local environment="$1"
  local release_sha="$2"
  local log_directory="${PLATFORM_ROOT}/deploy-logs/${environment}"
  local log_file="${log_directory}/${release_sha}.log"
  install -d -m 0700 "${log_directory}"
  {
    printf 'Waflo deployment failure for %s at %s\n' "${release_sha}" "$(date --iso-8601=seconds)"
    compose ps
    compose logs --no-color --tail 500 "${APPLICATION_SERVICES[@]}"
  } >"${log_file}" 2>&1 || true
  chmod 0600 "${log_file}"
  printf 'Failure diagnostics were preserved on the VPS at %s.\n' "${log_file}" >&2
}

wait_for_public_url() {
  local url="$1"
  local attempts="${2:-24}"
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl --fail --silent --show-error --location --max-time 10 --output /dev/null "${url}"; then
      printf 'Public health check passed: %s\n' "${url}"
      return 0
    fi
    sleep 5
  done
  printf 'Public health check failed: %s\n' "${url}" >&2
  return 1
}

assert_public_health() {
  case "${DEPLOYMENT_ENVIRONMENT}" in
    staging)
      wait_for_public_url "https://api.staging.waflo.app/health"
      wait_for_public_url "https://api.staging.waflo.app/ready"
      wait_for_public_url "https://app.staging.waflo.app/en/login"
      wait_for_public_url "https://card.staging.waflo.app/"
      ;;
    production)
      wait_for_public_url "https://api.waflo.app/health"
      wait_for_public_url "https://api.waflo.app/ready"
      wait_for_public_url "https://app.waflo.app/en/login"
      wait_for_public_url "https://card.waflo.app/"
      wait_for_public_url "https://waflo.app/en"
      ;;
  esac
}

assert_secret_permissions() {
  local secret_directory="${PLATFORM_ROOT}/secrets/${DEPLOYMENT_ENVIRONMENT}"
  local provider_directory="${secret_directory}/provider-files"
  local insecure
  assert_cloudflare_tunnel_token_permissions "${DEPLOYMENT_ENVIRONMENT}" || return 2
  insecure="$(find "${secret_directory}" -maxdepth 1 -type f \
    ! -name cloudflare_tunnel_token ! -perm 0600 -print)"
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

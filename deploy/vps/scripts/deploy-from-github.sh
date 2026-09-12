#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../../.." && pwd)"
source "${script_directory}/common.sh"

environment="${1:-}"
release_sha="${2:-}"
require_environment "${environment}"
require_release_sha "${release_sha}"

: "${VPS_HOST:?VPS_HOST is required}"
: "${VPS_USER:?VPS_USER is required}"
: "${VPS_SSH_PRIVATE_KEY:?VPS_SSH_PRIVATE_KEY is required}"
: "${VPS_SSH_HOST_KEY:?VPS_SSH_HOST_KEY is required}"
vps_port="${VPS_SSH_PORT:-22}"

[[ "${VPS_HOST}" =~ ^[A-Za-z0-9.-]+$ ]] || { printf 'Invalid VPS_HOST.\n' >&2; exit 2; }
[[ "${VPS_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]] || { printf 'Invalid VPS_USER.\n' >&2; exit 2; }
[[ "${vps_port}" =~ ^[0-9]{1,5}$ ]] || { printf 'Invalid VPS_SSH_PORT.\n' >&2; exit 2; }
if [[ "$(git -C "${repository_root}" rev-parse HEAD)" != "${release_sha}" ]]; then
  printf 'Deployment SHA must equal the checked-out Git commit.\n' >&2
  exit 2
fi

ssh_directory="$(mktemp -d)"
trap 'rm -rf -- "${ssh_directory}"' EXIT
private_key="${ssh_directory}/deploy-key"
known_hosts="${ssh_directory}/known_hosts"
printf '%s\n' "${VPS_SSH_PRIVATE_KEY}" >"${private_key}"
printf '%s\n' "${VPS_SSH_HOST_KEY}" >"${known_hosts}"
chmod 0600 "${private_key}" "${known_hosts}"

ssh_options=(
  -i "${private_key}"
  -p "${vps_port}"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=${known_hosts}"
  -o LogLevel=ERROR
)

printf 'Streaming the non-secret release descriptor for %s to the dedicated deploy identity.\n' \
  "${release_sha}"
tar --create --gzip --file - --directory "${repository_root}" deploy/vps | \
  ssh "${ssh_options[@]}" "${VPS_USER}@${VPS_HOST}" \
    "sudo /usr/local/sbin/waflo-release-deploy '${environment}' '${release_sha}'"

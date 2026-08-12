#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Cloudflare token permission regression must run as root.\n' >&2
  exit 2
fi

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf -- "${scratch}"' EXIT
export PLATFORM_ROOT="${scratch}/platform"
source "${repository_root}/deploy/vps/scripts/common.sh"

for environment in staging production; do
  install -d -m 0700 "${PLATFORM_ROOT}/secrets/${environment}"
  install -d -o 0 -g 10001 -m 0750 \
    "${PLATFORM_ROOT}/secrets/${environment}/provider-files"
done

token_file="${PLATFORM_ROOT}/secrets/staging/cloudflare_tunnel_token"
token_snapshot="${scratch}/token.snapshot"
application_secret="${PLATFORM_ROOT}/secrets/staging/application.env"
printf 'exact-dummy-token-bytes-without-a-trailing-newline' >"${token_file}"
cp -- "${token_file}" "${token_snapshot}"
chown 0:0 -- "${token_file}"
chmod 0600 -- "${token_file}"
printf 'DATABASE_URL=dummy\n' >"${application_secret}"
chown 0:0 -- "${application_secret}"
chmod 0600 -- "${application_secret}"

prepare_cloudflare_tunnel_token staging
[[ "$(stat -c '%a:%u:%g' "${token_file}")" == '440:0:65532' ]]
cmp --silent "${token_file}" "${token_snapshot}"
[[ "$(stat -c '%a:%u:%g' "${application_secret}")" == '600:0:0' ]]

export DEPLOYMENT_ENVIRONMENT=staging
export WAFLO_ENV_FILE="${PLATFORM_ROOT}/env-not-used-by-this-test"
touch "${WAFLO_ENV_FILE}"
assert_secret_permissions
chmod 0444 -- "${token_file}"
if prepare_cloudflare_tunnel_token staging >/dev/null 2>&1; then
  printf 'World-readable Cloudflare token was accepted.\n' >&2
  exit 1
fi
[[ "$(stat -c '%a:%u:%g' "${token_file}")" == '444:0:65532' ]]
chmod 0440 -- "${token_file}"

chmod 0640 -- "${application_secret}"
if assert_secret_permissions >/dev/null 2>&1; then
  printf 'Unrelated application secret permission regression was accepted.\n' >&2
  exit 1
fi
chmod 0600 -- "${application_secret}"

outside="${scratch}/outside-token"
production_token="${PLATFORM_ROOT}/secrets/production/cloudflare_tunnel_token"
printf 'outside-must-not-change' >"${outside}"
chown 0:0 -- "${outside}"
chmod 0600 -- "${outside}"
ln -s -- "${outside}" "${production_token}"
if prepare_cloudflare_tunnel_token production >/dev/null 2>&1; then
  printf 'Cloudflare token symlink substitution was accepted.\n' >&2
  exit 1
fi
[[ "$(stat -c '%a:%u:%g' "${outside}")" == '600:0:0' ]]

printf 'Cloudflare token permission regression passed.\n'

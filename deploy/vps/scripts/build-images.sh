#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_directory}/common.sh"

environment="${1:-}"
release_sha="${2:-}"
configure_release "${environment}" "${release_sha}"
assert_secret_permissions

compose config --quiet

# Build sequentially. BuildKit reuses the single frozen-lockfile dependency and
# workspace build layers, while avoiding concurrent memory spikes on the VPS.
for service in migrate api merchant-web customer-web marketing-web operational-worker wallet-worker; do
  printf 'Building %s for %s (%s)\n' "${service}" "${environment}" "${release_sha}"
  compose build --pull "${service}"
done

printf 'Immutable environment-qualified images are built for %s-%s.\n' "${release_sha}" "${environment}"

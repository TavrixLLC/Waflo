#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_directory}/common.sh"

environment="${1:-}"
release_sha="${2:-}"
registry="${IMAGE_REGISTRY:-}"
require_environment "${environment}"
require_release_sha "${release_sha}"

if [[ ! "${registry}" =~ ^ghcr\.io/[a-z0-9][a-z0-9._/-]*$ ]]; then
  printf 'IMAGE_REGISTRY must be a lowercase ghcr.io namespace.\n' >&2
  exit 2
fi

marker="${registry}/waflo-release-manifest:${release_sha}-${environment}"
if ! docker pull --quiet "${marker}" >/dev/null; then
  printf 'Verified release marker is unavailable: %s\n' "${marker}" >&2
  exit 4
fi

label() {
  docker image inspect --format "{{ index .Config.Labels \"$2\" }}" "$1"
}

[[ "$(label "${marker}" org.waflo.release.verified)" == "true" ]] || {
  printf 'Release marker does not attest verification: %s\n' "${marker}" >&2
  exit 4
}
[[ "$(label "${marker}" org.waflo.release.sha)" == "${release_sha}" ]] || {
  printf 'Release marker SHA does not match: %s\n' "${marker}" >&2
  exit 4
}
[[ "$(label "${marker}" org.waflo.release.environment)" == "${environment}" ]] || {
  printf 'Release marker environment does not match: %s\n' "${marker}" >&2
  exit 4
}
printf 'Verified trusted base release marker: %s\n' "${marker}"

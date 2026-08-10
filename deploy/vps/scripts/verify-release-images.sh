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

for package in migrate api merchant customer marketing operational-worker wallet-worker; do
  reference="${registry}/waflo-${package}:${release_sha}-${environment}"
  if ! docker buildx imagetools inspect "${reference}" >/dev/null 2>&1; then
    printf 'Missing immutable release image: %s\n' "${reference}" >&2
    exit 4
  fi
  digest="$(docker buildx imagetools inspect "${reference}" --format '{{json .Manifest.digest}}' | tr -d '"')"
  [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    printf 'Release image did not resolve to an OCI digest: %s\n' "${reference}" >&2
    exit 4
  }
  printf 'Verified %s at %s\n' "${reference}" "${digest}"
done

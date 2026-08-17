#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../../.." && pwd)"
source "${script_directory}/common.sh"

release_sha="${RELEASE_SHA:-}"
registry="${IMAGE_REGISTRY:-}"

require_release_sha "${release_sha}"
if [[ "$(git -C "${repository_root}" rev-parse HEAD)" != "${release_sha}" ]]; then
  printf 'RELEASE_SHA must equal the checked-out Git commit.\n' >&2
  exit 2
fi
if [[ -n "$(git -C "${repository_root}" status --porcelain)" ]]; then
  printf 'Release images require a clean checkout.\n' >&2
  exit 2
fi
if [[ ! "${registry}" =~ ^ghcr\.io/[a-z0-9][a-z0-9._/-]*$ ]]; then
  printf 'IMAGE_REGISTRY must be a lowercase ghcr.io namespace.\n' >&2
  exit 2
fi
if [[ ! "${IMAGE_PLATFORM:-linux/amd64}" =~ ^linux/(amd64|arm64)$ ]]; then
  printf 'IMAGE_PLATFORM must be linux/amd64 or linux/arm64.\n' >&2
  exit 2
fi

for token_name in MAPBOX_STAGING_PUBLIC_TOKEN MAPBOX_PRODUCTION_PUBLIC_TOKEN; do
  token_value="${!token_name:-}"
  if [[ -z "${token_value}" ]]; then
    printf '%s=UNSET; configure a URL-restricted public Mapbox token before publishing.\n' "${token_name}" >&2
    exit 2
  fi
  if [[ ! "${token_value}" =~ ^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
    printf '%s=INVALID_FORMAT; expected a Mapbox public token.\n' "${token_name}" >&2
    exit 2
  fi
done

export OCI_CREATED="${OCI_CREATED:-$(git -C "${repository_root}" show -s --format=%cI "${release_sha}")}"
export OCI_SOURCE="${OCI_SOURCE:-}"
if [[ ! "${OCI_SOURCE}" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  printf 'OCI_SOURCE must be the HTTPS GitHub repository URL.\n' >&2
  exit 2
fi
export IMAGE_PLATFORM="${IMAGE_PLATFORM:-linux/amd64}"

image_exists() {
  docker buildx imagetools inspect "$1" >/dev/null 2>&1
}

image_digest() {
  local manifest_json
  local digest
  manifest_json="$(
    docker buildx imagetools inspect "$1" --format '{{json .Manifest}}'
  )" || return 4
  digest="$(printf '%s' "${manifest_json}" | jq -er '.digest')" || return 4
  [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || return 4
  printf '%s\n' "${digest}"
}

mirror_invariant_tag() {
  local package="$1"
  local staging="${registry}/waflo-${package}:${release_sha}-staging"
  local production="${registry}/waflo-${package}:${release_sha}-production"
  if image_exists "${staging}" && ! image_exists "${production}"; then
    docker buildx imagetools create --tag "${production}" "${staging}"
  elif image_exists "${production}" && ! image_exists "${staging}"; then
    docker buildx imagetools create --tag "${staging}" "${production}"
  fi
}

for package in migrate api operational-worker wallet-worker; do
  mirror_invariant_tag "${package}"
  staging_reference="${registry}/waflo-${package}:${release_sha}-staging"
  production_reference="${registry}/waflo-${package}:${release_sha}-production"
  if image_exists "${staging_reference}" && image_exists "${production_reference}"; then
    staging_digest="$(image_digest "${staging_reference}")" || {
      printf 'Staging image did not resolve to an OCI digest: %s.\n' "${staging_reference}" >&2
      exit 4
    }
    production_digest="$(image_digest "${production_reference}")" || {
      printf 'Production image did not resolve to an OCI digest: %s.\n' "${production_reference}" >&2
      exit 4
    }
    if [[ "${staging_digest}" != "${production_digest}" ]]; then
      printf 'Invariant image tags resolve to different manifests for %s.\n' "${package}" >&2
      exit 4
    fi
  fi
done

declare -a missing_targets=()
declare -A target_references=(
  [migrate]="${registry}/waflo-migrate:${release_sha}-staging"
  [api]="${registry}/waflo-api:${release_sha}-staging"
  [operational-worker]="${registry}/waflo-operational-worker:${release_sha}-staging"
  [wallet-worker]="${registry}/waflo-wallet-worker:${release_sha}-staging"
  [merchant-staging]="${registry}/waflo-merchant:${release_sha}-staging"
  [customer-staging]="${registry}/waflo-customer:${release_sha}-staging"
  [marketing-staging]="${registry}/waflo-marketing:${release_sha}-staging"
  [merchant-production]="${registry}/waflo-merchant:${release_sha}-production"
  [customer-production]="${registry}/waflo-customer:${release_sha}-production"
  [marketing-production]="${registry}/waflo-marketing:${release_sha}-production"
)

for target in \
  migrate api operational-worker wallet-worker \
  merchant-staging customer-staging marketing-staging \
  merchant-production customer-production marketing-production; do
  if image_exists "${target_references[${target}]}"; then
    printf 'Reusing existing immutable image for %s.\n' "${target}"
  else
    missing_targets+=("${target}")
  fi
done

if (( ${#missing_targets[@]} > 0 )); then
  printf 'Building missing release targets sequentially on one Buildx runner: %s\n' \
    "${missing_targets[*]}"
  for target in "${missing_targets[@]}"; do
    docker buildx bake \
      --file "${repository_root}/deploy/vps/docker-bake.hcl" \
      --push \
      "${target}"
  done
else
  printf 'All SHA-qualified images already exist; no Docker build is required.\n'
fi

"${script_directory}/verify-release-images.sh" staging "${release_sha}"
"${script_directory}/smoke-node-release-images.sh" staging "${release_sha}"
"${script_directory}/verify-release-images.sh" production "${release_sha}"

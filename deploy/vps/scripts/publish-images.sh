#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../../.." && pwd)"
source "${script_directory}/common.sh"

release_sha="${RELEASE_SHA:-}"
registry="${IMAGE_REGISTRY:-}"
release_scope="${RELEASE_IMAGE_SCOPE:-staging}"

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
if [[ ! "${release_scope}" =~ ^(staging|production)$ ]]; then
  printf 'RELEASE_IMAGE_SCOPE must be staging or production.\n' >&2
  exit 2
fi

for token_name in MAPBOX_STAGING_PUBLIC_TOKEN MAPBOX_PRODUCTION_PUBLIC_TOKEN; do
  token_value="${!token_name:-}"
  if [[ -n "${token_value}" && ! "${token_value}" =~ ^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
    printf '%s=INVALID_FORMAT; expected a Mapbox public token.\n' "${token_name}" >&2
    exit 2
  fi
done

if [[ "${release_scope}" == "staging" && -z "${MAPBOX_STAGING_PUBLIC_TOKEN:-}" ]]; then
  printf 'MAPBOX_STAGING_PUBLIC_TOKEN is required to publish staging frontend images.\n' >&2
  exit 2
fi
if [[ "${release_scope}" == "production" && -z "${MAPBOX_PRODUCTION_PUBLIC_TOKEN:-}" ]]; then
  printf 'MAPBOX_PRODUCTION_PUBLIC_TOKEN is required to publish production frontend images.\n' >&2
  exit 2
fi

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

if [[ "${release_scope}" == "staging" ]]; then
  targets=(
    migrate api operational-worker wallet-worker
    merchant-staging customer-staging marketing-staging
  )
else
  targets=(
    migrate api operational-worker wallet-worker
    merchant-production customer-production marketing-production
  )
fi

for target in "${targets[@]}"; do
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
      --set "${target}.tags=${target_references[${target}]}" \
      --push \
      "${target}"
  done
else
  printf 'All SHA-qualified images already exist; no Docker build is required.\n'
fi

"${script_directory}/verify-release-images.sh" "${release_scope}" "${release_sha}"
if [[ "${release_scope}" == "staging" ]]; then
  "${script_directory}/smoke-node-release-images.sh" staging "${release_sha}"
fi

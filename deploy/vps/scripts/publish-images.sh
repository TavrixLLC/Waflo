#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../../.." && pwd)"
source "${script_directory}/common.sh"

release_sha="${RELEASE_SHA:-}"
registry="${IMAGE_REGISTRY:-}"
release_scope="${RELEASE_IMAGE_SCOPE:-staging}"
release_base_sha="${RELEASE_BASE_SHA:-}"
release_build_targets="${RELEASE_BUILD_TARGETS:-}"

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

publish_release_marker() {
  local marker="${registry}/waflo-release-manifest:${release_sha}-${release_scope}"
  docker buildx build \
    --file "${repository_root}/deploy/vps/release-marker.Dockerfile" \
    --build-arg "RELEASE_SHA=${release_sha}" \
    --build-arg "RELEASE_ENVIRONMENT=${release_scope}" \
    --platform "${IMAGE_PLATFORM}" \
    --provenance=false \
    --sbom=false \
    --tag "${marker}" \
    --push \
    "${repository_root}"
  printf 'Published verified release marker: %s\n' "${marker}"
}

apple_swift_source_fingerprint() {
  # This is observability only. Keep it limited to the stage that fetches and
  # compiles the pinned Apple Pass Builder source, rather than unrelated Waflo
  # Node sources that share the wider Docker build context.
  {
    printf 'waflo-apple-swift-build-inputs-v1\0'
    awk '/^FROM node:/{exit} {print}' \
      "${repository_root}/apps/apple-pass-builder-service/Dockerfile"
    sha256sum \
      "${repository_root}/apps/apple-pass-builder-service/Package.resolved" \
      "${repository_root}/apps/apple-pass-builder-service/patches/8908b955-swift-6.3-linux-pointer.patch"
  } | sha256sum | cut -c1-16
}

build_missing_target() {
  local target="$1"
  local reference="$2"
  local build_log
  local compile_step

  if [[ "${target}" != "apple-pass-builder" ]]; then
    docker buildx bake \
      --file "${repository_root}/deploy/vps/docker-bake.hcl" \
      --set "${target}.tags=${reference}" \
      --push \
      "${target}"
    return
  fi

  printf 'Apple Swift source fingerprint: %s\n' "$(apple_swift_source_fingerprint)"
  build_log="$(mktemp)"
  if ! docker buildx bake \
    --file "${repository_root}/deploy/vps/docker-bake.hcl" \
    --set "${target}.tags=${reference}" \
    --push \
    "${target}" 2>&1 | tee "${build_log}"; then
    rm -f "${build_log}"
    return 1
  fi

  compile_step="$({
    sed -nE 's/.*#([0-9]+) \[pass-builder-build [^]]+\] RUN.*swift build -c release.*/\1/p' "${build_log}"
  } | head -n 1)"
  if [[ -n "${compile_step}" ]] && grep -Fq "#${compile_step} CACHED" "${build_log}"; then
    printf 'Apple Swift compile layer: CACHE HIT\n'
  elif grep -Fq 'swift build -c release' "${build_log}"; then
    printf 'Apple Swift compile layer: BUILT\n'
  else
    printf 'Apple Swift compile layer: UNKNOWN (BuildKit did not emit a recognizable compile step)\n'
  fi
  rm -f "${build_log}"
}

declare -a invariant_targets=(
  migrate api apple-pass-builder operational-worker wallet-worker
)
declare -A staging_target_references=(
  [migrate]="${registry}/waflo-migrate:${release_sha}-staging"
  [api]="${registry}/waflo-api:${release_sha}-staging"
  [apple-pass-builder]="${registry}/waflo-apple-pass-builder:${release_sha}-staging"
  [operational-worker]="${registry}/waflo-operational-worker:${release_sha}-staging"
  [wallet-worker]="${registry}/waflo-wallet-worker:${release_sha}-staging"
  [merchant-staging]="${registry}/waflo-merchant:${release_sha}-staging"
  [customer-staging]="${registry}/waflo-customer:${release_sha}-staging"
  [admin-staging]="${registry}/waflo-admin:${release_sha}-staging"
  [marketing-staging]="${registry}/waflo-marketing:${release_sha}-staging"
)
declare -A production_frontend_references=(
  [merchant-production]="${registry}/waflo-merchant:${release_sha}-production"
  [customer-production]="${registry}/waflo-customer:${release_sha}-production"
  [admin-production]="${registry}/waflo-admin:${release_sha}-production"
  [marketing-production]="${registry}/waflo-marketing:${release_sha}-production"
)

publish_staging_images() {
  local -a staging_targets=(
    "${invariant_targets[@]}"
    merchant-staging customer-staging admin-staging marketing-staging
  )
  local -a missing_targets=()
  local -a parsed_targets=()
  local source_reference
  local source_digest
  local target
  declare -A requested_targets=()

  if [[ -n "${release_build_targets}" ]]; then
    [[ "${release_base_sha}" =~ ^[0-9a-f]{40}$ ]] || {
      printf 'Selective image publication requires RELEASE_BASE_SHA.\n' >&2
      exit 2
    }
    IFS=',' read -r -a parsed_targets <<<"${release_build_targets}"
    for target in "${parsed_targets[@]}"; do
      [[ -n "${target}" ]] || continue
      requested_targets["${target}"]=1
    done
  fi

  for target in "${!requested_targets[@]}"; do
    if [[ ! " ${staging_targets[*]} " =~ " ${target} " ]]; then
      printf 'Selective image publication includes an unknown target: %s\n' "${target}" >&2
      exit 2
    fi
  done

  if (( ${#requested_targets[@]} == ${#staging_targets[@]} )); then
    # FULL is represented in workflow outputs as the complete target list for
    # observability. It is not selective publication and must not rely on a
    # previously verified base release.
    requested_targets=()
  fi

  if (( ${#requested_targets[@]} > 0 )); then
    IMAGE_REGISTRY="${registry}" bash "${script_directory}/verify-release-marker.sh" \
      staging "${release_base_sha}"
  fi

  for target in "${staging_targets[@]}"; do
    if (( ${#requested_targets[@]} > 0 )) && [[ -z "${requested_targets[${target}]:-}" ]]; then
      source_reference="${staging_target_references[${target}]//${release_sha}/${release_base_sha}}"
      source_digest="$(image_digest "${source_reference}")" || {
        printf 'Trusted base image is unavailable for %s: %s\n' "${target}" "${source_reference}" >&2
        exit 4
      }
      docker buildx imagetools create \
        --tag "${staging_target_references[${target}]}" \
        "${source_reference}@${source_digest}"
      printf 'Reused immutable image for %s from %s at %s\n' \
        "${target}" "${source_reference}" "${source_digest}"
      continue
    fi
    if image_exists "${staging_target_references[${target}]}"; then
      printf 'Reusing existing immutable image for %s.\n' "${target}"
    else
      missing_targets+=("${target}")
    fi
  done

  if (( ${#missing_targets[@]} > 0 )); then
    printf 'Building missing release targets sequentially on one Buildx runner: %s\n' \
      "${missing_targets[*]}"
    for target in "${missing_targets[@]}"; do
      build_missing_target "${target}" "${staging_target_references[${target}]}"
    done
  else
    printf 'All SHA-qualified staging images already exist; no Docker build is required.\n'
  fi
}

promote_invariant_image() {
  local target="$1"
  local source_reference="${staging_target_references[${target}]}"
  local destination_reference="${source_reference%-staging}-production"
  local source_digest
  local destination_digest

  source_digest="$(image_digest "${source_reference}")" || {
    printf 'Missing immutable staging source for production promotion: %s\n' \
      "${source_reference}" >&2
    exit 4
  }

  if image_exists "${destination_reference}"; then
    destination_digest="$(image_digest "${destination_reference}")" || {
      printf 'Production immutable image did not resolve to an OCI digest: %s\n' \
        "${destination_reference}" >&2
      exit 4
    }
    if [[ "${destination_digest}" != "${source_digest}" ]]; then
      printf 'Conflicting immutable production image for %s: expected %s, found %s\n' \
        "${destination_reference}" "${source_digest}" "${destination_digest}" >&2
      exit 4
    fi
    printf 'Reusing promoted immutable image for %s at %s\n' "${target}" "${source_digest}"
    return
  fi

  docker buildx imagetools create \
    --tag "${destination_reference}" \
    "${source_reference}@${source_digest}"
  destination_digest="$(image_digest "${destination_reference}")" || {
    printf 'Promoted immutable image did not resolve to an OCI digest: %s\n' \
      "${destination_reference}" >&2
    exit 4
  }
  if [[ "${destination_digest}" != "${source_digest}" ]]; then
    printf 'Promoted immutable image digest mismatch for %s: expected %s, found %s\n' \
      "${destination_reference}" "${source_digest}" "${destination_digest}" >&2
    exit 4
  fi
  printf 'Promoted immutable image for %s from %s to %s at %s\n' \
    "${target}" "${source_reference}" "${destination_reference}" "${source_digest}"
}

publish_production_images() {
  local -a production_frontend_targets=(
    merchant-production customer-production admin-production marketing-production
  )
  local -a missing_frontend_targets=()
  local target

  if [[ -n "${release_build_targets}" ]]; then
    printf 'Selective image publication is staging-only.\n' >&2
    exit 2
  fi

  for target in "${invariant_targets[@]}"; do
    promote_invariant_image "${target}"
  done

  for target in "${production_frontend_targets[@]}"; do
    if image_exists "${production_frontend_references[${target}]}"; then
      printf 'Reusing existing immutable production frontend for %s.\n' "${target}"
    else
      missing_frontend_targets+=("${target}")
    fi
  done

  if (( ${#missing_frontend_targets[@]} > 0 )); then
    printf 'Building missing production frontend targets sequentially on one Buildx runner: %s\n' \
      "${missing_frontend_targets[*]}"
    for target in "${missing_frontend_targets[@]}"; do
      build_missing_target "${target}" "${production_frontend_references[${target}]}"
    done
  else
    printf 'All SHA-qualified production frontend images already exist; no Docker build is required.\n'
  fi
}

if [[ "${release_scope}" == "staging" ]]; then
  publish_staging_images
else
  publish_production_images
fi

"${script_directory}/verify-release-images.sh" "${release_scope}" "${release_sha}"
if [[ "${release_scope}" == "staging" ]]; then
  "${script_directory}/smoke-node-release-images.sh" staging "${release_sha}"
  publish_release_marker
fi

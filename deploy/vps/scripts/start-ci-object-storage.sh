#!/usr/bin/env bash
set -euo pipefail

: "${OBJECT_STORAGE_ENDPOINT:?OBJECT_STORAGE_ENDPOINT is required}"
: "${OBJECT_STORAGE_ACCESS_KEY_ID:?OBJECT_STORAGE_ACCESS_KEY_ID is required}"
: "${OBJECT_STORAGE_SECRET_ACCESS_KEY:?OBJECT_STORAGE_SECRET_ACCESS_KEY is required}"
: "${OBJECT_STORAGE_BUCKET:?OBJECT_STORAGE_BUCKET is required}"

# Use Chainguard's immutable official MinIO image containing both minio and mc.
minio_server_image="cgr.dev/chainguard/minio:latest-dev@sha256:d7c906993247627c19f37fc1fa302c34cf2d209ae0e7dc7d52fb0be6ac2849ba"

docker run --detach \
  --name waflo-ci-wallet-storage \
  --publish 127.0.0.1:9000:9000 \
  --env MINIO_ROOT_USER="${OBJECT_STORAGE_ACCESS_KEY_ID}" \
  --env MINIO_ROOT_PASSWORD="${OBJECT_STORAGE_SECRET_ACCESS_KEY}" \
  --entrypoint /bin/sh \
  "${minio_server_image}" \
  -ec 'exec minio server /data --address ":9000"'

for attempt in {1..30}; do
  if curl --silent --fail http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    docker logs waflo-ci-wallet-storage
    exit 1
  fi
  sleep 1
done

docker run --rm --network host \
  --env CI_STORAGE_ENDPOINT="${OBJECT_STORAGE_ENDPOINT}" \
  --env CI_STORAGE_ACCESS_KEY="${OBJECT_STORAGE_ACCESS_KEY_ID}" \
  --env CI_STORAGE_SECRET_KEY="${OBJECT_STORAGE_SECRET_ACCESS_KEY}" \
  --env CI_STORAGE_BUCKET="${OBJECT_STORAGE_BUCKET}" \
  --entrypoint /bin/sh \
  "${minio_server_image}" \
  -c '
    set -eu
    export MC_CONFIG_DIR=/tmp/.mc-ci
    mkdir -p "${MC_CONFIG_DIR}"
    mc alias set ci "$CI_STORAGE_ENDPOINT" "$CI_STORAGE_ACCESS_KEY" "$CI_STORAGE_SECRET_KEY" &&
    mc mb --ignore-existing "ci/$CI_STORAGE_BUCKET" &&
    mc anonymous set none "ci/$CI_STORAGE_BUCKET" &&
    mc stat "ci/$CI_STORAGE_BUCKET"
  '

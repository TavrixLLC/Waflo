#!/usr/bin/env bash
set -euo pipefail

: "${OBJECT_STORAGE_ENDPOINT:?OBJECT_STORAGE_ENDPOINT is required}"
: "${OBJECT_STORAGE_ACCESS_KEY_ID:?OBJECT_STORAGE_ACCESS_KEY_ID is required}"
: "${OBJECT_STORAGE_SECRET_ACCESS_KEY:?OBJECT_STORAGE_SECRET_ACCESS_KEY is required}"
: "${OBJECT_STORAGE_BUCKET:?OBJECT_STORAGE_BUCKET is required}"

docker run --detach \
  --name waflo-ci-wallet-storage \
  --publish 127.0.0.1:9000:9000 \
  --env MINIO_ROOT_USER="${OBJECT_STORAGE_ACCESS_KEY_ID}" \
  --env MINIO_ROOT_PASSWORD="${OBJECT_STORAGE_SECRET_ACCESS_KEY}" \
  --health-cmd "curl --fail http://localhost:9000/minio/health/live" \
  --health-interval 2s \
  --health-timeout 2s \
  --health-retries 30 \
  minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e \
  server /data --address ":9000"

for attempt in {1..30}; do
  storage_status="$(docker inspect --format '{{.State.Health.Status}}' waflo-ci-wallet-storage)"
  if [[ "${storage_status}" == "healthy" ]]; then
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
  minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727 \
  -c '
    mc alias set ci "$CI_STORAGE_ENDPOINT" "$CI_STORAGE_ACCESS_KEY" "$CI_STORAGE_SECRET_KEY" &&
    mc mb --ignore-existing "ci/$CI_STORAGE_BUCKET" &&
    mc anonymous set none "ci/$CI_STORAGE_BUCKET" &&
    mc stat "ci/$CI_STORAGE_BUCKET"
  '

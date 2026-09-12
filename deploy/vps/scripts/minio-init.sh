#!/bin/sh
set -eu
umask 077

MC_CONFIG_DIR=/tmp/.mc
export MC_CONFIG_DIR
mkdir -p "${MC_CONFIG_DIR}"
chmod 0700 "${MC_CONFIG_DIR}"

mc_cmd() {
  mc --config-dir "${MC_CONFIG_DIR}" "$@"
}

root_user="$(cat /run/secrets/minio_root_user)"
root_password="$(cat /run/secrets/minio_root_password)"
application_user="$(cat /run/secrets/object_storage_access_key)"
application_password="$(cat /run/secrets/object_storage_secret_key)"
policy_name="waflo-${DEPLOYMENT_ENVIRONMENT}"
policy_file="/tmp/${policy_name}-policy.json"

cleanup() {
  rm -rf "${MC_CONFIG_DIR}"
  rm -f "${policy_file}"
}
trap cleanup EXIT

mc_cmd alias set local http://minio:9000 "${root_user}" "${root_password}" >/dev/null
mc_cmd mb --ignore-existing "local/${OBJECT_STORAGE_BUCKET}" >/dev/null
mc_cmd anonymous set none "local/${OBJECT_STORAGE_BUCKET}" >/dev/null

cat >"${policy_file}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::${OBJECT_STORAGE_BUCKET}"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::${OBJECT_STORAGE_BUCKET}/*"]
    }
  ]
}
EOF

mc_cmd admin policy create local "${policy_name}" "${policy_file}" >/dev/null
mc_cmd admin user add local "${application_user}" "${application_password}" >/dev/null
mc_cmd admin user enable local "${application_user}" >/dev/null
mc_cmd admin policy attach local "${policy_name}" --user "${application_user}" >/dev/null

printf '%s\n' "MinIO bucket and private application policy are ready."

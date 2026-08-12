# Individual secret files

Create these extensionless files separately under each environment's secrets directory. Each file contains one value. All are `root:root` mode `0600` on the VPS except for the Cloudflare token's explicit contract below:

- `postgres_password` — also URL-encode the same value into `application.env`'s `DATABASE_URL`.
- `redis_password` — also URL-encode the same value into `application.env`'s `REDIS_URL`.
- `minio_root_user` — administrative bootstrap identity; never give it to applications.
- `minio_root_password` — administrative bootstrap secret.
- `object_storage_access_key` — same application identity as `OBJECT_STORAGE_ACCESS_KEY_ID`.
- `object_storage_secret_key` — same application secret as `OBJECT_STORAGE_SECRET_ACCESS_KEY`.
- `cloudflare_tunnel_token` — token for that environment's remotely managed tunnel; it must be a regular, non-symlink file owned by `root:65532` with mode `0440`. Host preparation and release deployment repair only its metadata without changing its content.

Staging and production must use different values for every file. The MinIO console has no published port and buckets are explicitly private.

## Provider secret files

Create `provider-files/` under each environment's secrets directory. The API and Wallet worker mount
only this directory read-only at `/run/waflo-provider-secrets`; Web applications and the operational
worker do not receive it. Keep the directory `root:10001` mode `0750` and each file `root:10001`
mode `0440` so the non-root application user can read it without making it host-public.

- `google-wallet-service-account.json` — complete Google service-account JSON. The implementation
  reads `client_email`, the PEM `private_key`, and optional `token_uri`; never put it in an env file.
- `apple-wallet-pass.p12` — password-protected PKCS#12 containing the Pass Type ID signing
  certificate and its matching private key. The same identity authenticates Wallet APNs pushes.
- `apple-wwdr.pem` — Apple WWDR intermediate certificate in PEM form. This certificate is public,
  but it is installed beside the private signing material as an operational secret file.

Do not create or replace provider credentials in this repository. Google and Apple provider files
must be different where the provider account or certificate lifecycle requires it; Stripe TEST and
LIVE values must always be different.

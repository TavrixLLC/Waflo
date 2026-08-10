# Individual secret files

Create these extensionless files separately under each environment's secrets directory. Each file contains one value and must be mode `0600` on the VPS:

- `postgres_password` — also URL-encode the same value into `application.env`'s `DATABASE_URL`.
- `redis_password` — also URL-encode the same value into `application.env`'s `REDIS_URL`.
- `minio_root_user` — administrative bootstrap identity; never give it to applications.
- `minio_root_password` — administrative bootstrap secret.
- `object_storage_access_key` — same application identity as `OBJECT_STORAGE_ACCESS_KEY_ID`.
- `object_storage_secret_key` — same application secret as `OBJECT_STORAGE_SECRET_ACCESS_KEY`.
- `cloudflare_tunnel_token` — token for that environment's remotely managed tunnel.

Staging and production must use different values for every file. The MinIO console has no published port and buckets are explicitly private.

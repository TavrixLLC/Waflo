# Backup, restore, and disaster recovery

## PostgreSQL

Run `backup-postgres.sh <environment> <release-sha>` from cron/systemd timer or an operator session. It produces a compressed custom-format logical dump, verifies gzip integrity, writes a SHA-256 sidecar, and applies local retention (`POSTGRES_BACKUP_RETENTION_DAYS`, default 14). Docker log retention is unrelated to backup retention.

Every successful dump must be copied promptly to encrypted off-server storage with independent credentials and versioning/immutability appropriate to the business. A dump remaining on `/opt/waflo-platform` does not survive VPS loss. Monitor backup age, size anomalies, checksum upload, and destination retention.

## Object storage

MinIO data needs a separate off-server replication/copy policy. Use `mc mirror --watch` or scheduled versioned sync to an external private S3-compatible bucket with an environment-specific least-privilege backup identity. Preserve object versions/deletion protection when the destination supports it. Database rows and object storage should be copied in the same documented backup window; PostgreSQL logical dumps alone do not contain customer assets or encrypted exports.

When moving to managed S3, enable its versioning, lifecycle, replication, access logging, and restore procedure. No bucket is anonymous. Never expose the MinIO console or administration API through Cloudflare.

## Secrets

Back up environment secrets and legacy/active keyrings only into an encrypted off-server secret vault with audited access and recovery keys held separately. Plain secret archives must never be stored beside database/object backups. A database restore without the historical encryption/signing key versions can be permanently unreadable.

## Restore drill

`restore-drill.sh <environment> <release-sha> <dump.gz>` validates gzip, creates a uniquely named disposable database in that environment's PostgreSQL container, restores with `--exit-on-error`, verifies completed Prisma migrations and public table count, writes a PASS report, and removes the drill database. It never targets the live database name.

After the database drill, separately restore a representative private object into an isolated drill bucket/account, verify its checksum and application-level decrypt/read path using controlled credentials, then delete the drill copy. Record operator, timestamps, backup identifiers, RPO/RTO observations, migration count, object checksum, and any repair action.

Backup readiness remains **unverified** until an operator has completed and retained evidence for both the database and object restore exercises using off-server copies. Repository scripts and documentation are not proof of recoverability.

## Full recovery outline

1. Provision a clean protected host/state service; do not overwrite a possibly compromised host.
2. Restore the environment secret vault and verify every active/legacy key version.
3. Restore PostgreSQL into an empty database and verify migrations/data.
4. Restore the private object bucket and deny anonymous access.
5. Point authenticated Redis at an empty instance; Redis is coordination/ephemeral state and is normally rebuilt, not treated as the database authority.
6. Install the last known-good immutable application release and configuration.
7. Run `prisma migrate deploy` once only if the restored dump predates required forward migrations.
8. Start workers/API/Web, pass readiness, perform domain/provider checks, then restore edge traffic.
9. Document actual RPO/RTO and reconcile provider events received during the outage.

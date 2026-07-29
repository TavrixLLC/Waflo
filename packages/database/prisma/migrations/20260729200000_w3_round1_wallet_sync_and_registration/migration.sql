CREATE TYPE "ProgramWalletSyncJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'DEAD_LETTER'
);

CREATE TABLE program_wallet_sync_jobs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  program_id UUID NOT NULL,
  action VARCHAR(30) NOT NULL,
  reason VARCHAR(80) NOT NULL,
  command_type "WalletCommandType" NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  status "ProgramWalletSyncJobStatus" NOT NULL DEFAULT 'PENDING',
  cursor_pass_instance_id UUID,
  batch_size INTEGER NOT NULL DEFAULT 500,
  processed_count INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_owner VARCHAR(120),
  lease_expires_at TIMESTAMPTZ(6),
  next_attempt_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  safe_error_code VARCHAR(120),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(6),
  CONSTRAINT program_wallet_sync_jobs_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT program_wallet_sync_jobs_program_id_fkey
    FOREIGN KEY (program_id) REFERENCES loyalty_programs(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX program_wallet_sync_jobs_idempotency_key_key
  ON program_wallet_sync_jobs(idempotency_key);
CREATE INDEX program_wallet_sync_jobs_status_next_attempt_at_lease_expires_at_idx
  ON program_wallet_sync_jobs(status, next_attempt_at, lease_expires_at);
CREATE INDEX program_wallet_sync_jobs_organization_id_program_id_created_at_idx
  ON program_wallet_sync_jobs(organization_id, program_id, created_at);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY wallet_pass_instance_id, device_library_identifier_hash
           ORDER BY (unregistered_at IS NULL) DESC, updated_at DESC, id DESC
         ) AS position
  FROM apple_pass_registrations
)
DELETE FROM apple_pass_registrations
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX apple_pass_registrations_wallet_pass_instance_id_device_library_identifier_hash_key
  ON apple_pass_registrations(wallet_pass_instance_id, device_library_identifier_hash);

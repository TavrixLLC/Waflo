ALTER TABLE program_wallet_sync_jobs
ADD COLUMN snapshot_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN cursor_created_at TIMESTAMPTZ(6);

CREATE INDEX program_wallet_sync_jobs_program_snapshot_cursor_idx
ON program_wallet_sync_jobs(program_id, snapshot_at, cursor_created_at, cursor_pass_instance_id);

# Program Wallet lifecycle sync

Program lifecycle transactions now update Program state, create one deterministic `ProgramWalletSyncJob`, and write the audit event atomically. They do not enumerate Wallet passes.

The worker:

- leases eligible jobs with retry/dead-letter state;
- reads only passes at or before `snapshotAt`;
- pages by stable `(createdAt, id)` cursor;
- uses configurable `batchSize`;
- commits deterministic per-pass Wallet commands and checkpoint progress per page;
- resumes from the stored cursor after interruption;
- treats a page replay as idempotent;
- writes safe created, completed, retry, and dead-letter audits.

The old `take: 10_000` lifecycle enumeration is removed. Tests use 61 passes and a batch of 17, while the code has no 10,000-record ceiling.

## New passes during transition

Passes created after `snapshotAt` are outside that job by design. Issuance maps the Program's current operational state. A later reconcile or lifecycle event handles any remaining drift. The test's post-snapshot pass receives no command from the older job.

See `evidence/program-wallet-sync-multi-batch.json`.

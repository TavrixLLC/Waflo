# Program Wallet reconciliation

The merchant reconcile request no longer enumerates pass instances.

After permission and tenant validation, the API enters the Program lifecycle lock,
revalidates the Program, returns an existing compatible active reconcile job when one
exists, or creates a persisted `ProgramWalletSyncJob` with deterministic key:

`program-wallet-reconcile:<programId>:run<N>`

The response contains only:

- `jobId`
- `status`
- `processedCount`
- `safeErrorCode`

The status endpoint is:

`GET /v1/organizations/:organizationId/programs/:programId/wallet-sync/:jobId`

It is tenant-scoped and does not expose provider secrets or customer PII. The merchant
dashboard polls it and presents safe progress.

The Wallet worker claims jobs with a lease, pages pass instances by stable
`(createdAt, id)` cursor, and creates `RECONCILE` commands keyed by the job event
`program-sync:<jobId>`. Replaying a page reuses command idempotency keys and does not
increment processed progress. Failed/interrupted jobs retain their cursor and resume.
Reconciliation deliberately includes transferred/invalidated passes and non-active
credentials so every provider identity is converged.

The 502-pass real-database test proves two pages, interruption/resume, replay safety,
one compatible job under concurrent requests, exactly one command per pass, completion
status, and one transactional job-creation audit event.


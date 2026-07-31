# Process cleanup

Operational worker handles shutdown signals and releases its database client. API and worker tests
close Nest/Prisma clients. Final evidence checks record listening ports and relevant Node
processes. Every managed Playwright run reported ports 3000, 3001, 3002 and 4000 closed after the
run. The final port check is stored in `raw-test-output/process-cleanup.log`.

Docker development dependencies (PostgreSQL, Redis, Mailpit and MinIO) remain running
intentionally for local use. They are outside the portable archive, and no API/web/worker process
is left listening by the test harness.

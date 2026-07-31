# Projection invariants

Projection version equals last ledger sequence. A nonzero projection must reference the exact
source entry for the same Organization and Membership. The API persists events and the reduced
projection in one transaction. Direct invalid updates are rejected by PostgreSQL and covered by
the W4 database-guard suite.


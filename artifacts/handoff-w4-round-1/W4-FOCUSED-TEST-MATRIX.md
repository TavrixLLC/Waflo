# Dedicated W4 focused test matrix

Inherited W1-W3 tests are not counted below.

| Suite | Files | Tests | Repair proof |
| --- | ---: | ---: | --- |
| Unit | 2 | 17 | risk decisions, analytics/cohort metrics, HMAC/key rotation, expiry reducer, policy and 10,000-event projection |
| Integration | 3 | 3 | complete lifecycle, operational domain, incremental analytics pages/replay/late events/backfill |
| HTTP | 2 | 8 | signed Staff operations, merchant mutations, plan/role/tenant/security boundaries |
| Concurrency | 2 | 24 | expiry, redemption, transfer, lifecycle/status/reversal, pairing, refresh, approval, device, privacy and rebuild races |
| Failure | 1 | 4 | Redis, object storage, audit rollback, worker crash/lease and Wallet provider outage |
| Database | 1 | 5 | tenant context, append-only Ledger, command uniqueness and approval/pairing constraints |
| **Total** | **11** | **61** | **Dedicated W4 feature proof** |

The separate load gate re-runs two of these tests with explicit filters: 10,000 ordered Ledger events
and 100 simultaneous same-key stamp requests. They are not double-counted in the total. Raw logs are
`w4-unit.log`, `w4-integration.log`, `w4-http.log`, `w4-concurrency.log`, `w4-failure.log`,
`w4-database.log` and `w4-load.log` under `raw-test-output/`.


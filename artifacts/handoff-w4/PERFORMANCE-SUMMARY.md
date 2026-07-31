# Performance summary

Targets for production observation: QR resolve p95 under 300 ms, stamp commit p95 under 500 ms and
redemption p95 under 500 ms excluding client/network latency. Local values are not production
capacity claims.

Ledger/timeline/customer/nonce/expiry/command paths are indexed; lists are cursor paginated;
analytics are pre-aggregated; exports are asynchronous; provider calls are outside ledger
transactions. Tests rebuild 10,000 reducer events and issue 100 concurrent idempotent requests.
Production query plans and pool limits must be validated on production-sized staging data.

The local gate proves correctness under the controlled fixtures, not production throughput.
The 100,000 aggregate-row query-plan fixture, real Redis/provider outage duration, and sustained
multi-instance worker capacity remain explicit staging exercises.

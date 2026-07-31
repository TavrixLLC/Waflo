# W4 Repair Round 1 final compliance matrix

| Repair requirement | Implemented evidence | Focused proof | Result |
| --- | --- | --- | --- |
| Authoritative reward expiry | `RewardExpiryCommand`, leased bounded claim, common locks, `REWARD_EXPIRED` Ledger event, entitlement/projection/Wallet/audit transaction | expiry vs two workers, replay, redemption, suspension, transfer, provider outage and final reward | PASS |
| Incremental analytics | source checkpoints, unique contributions/facts, bounded cursor pages, leases, retry/dead-letter and scoped jobs | interruption, replay, late Ledger/risk data, two organizations, workers and date rebuild | PASS |
| Real advanced analytics | typed program/version, location, staff and cohort responses from aggregates/facts | metric correctness, plan/date/cursor bounds and EN/AR/RTL browser UI | PASS |
| Durable commands | short durable claim, fingerprint, lease recovery, separate terminal-failure persistence | policy failures, replay, fingerprint conflict, crash and concurrent retry | PASS |
| Global lock order | Organization → Program → Membership → Command/approval → Device → Wallet/provider | stamp/redeem/transfer/status/reversal/rebuild/expiry/privacy races | PASS |
| Pairing/refresh/approval | conditional single-winner transitions and atomic refresh rotation | one winner and one audit; old token replay rejected | PASS |
| Risk engine | typed decisions, hard blocks, safe signals, rule version and deduplication | rule unit tests plus HTTP/security and dashboard evidence | PASS |
| Keyed transaction reference | HMAC-SHA-256, normalization/key versions and duplicate window | normalization, duplicate and key-rotation tests | PASS |
| Worker audit | completion/failure/dead-letter audit for expiry, exports, privacy, analytics and integrity | failure suite and one-shot worker gate | PASS |
| Privacy locking | deterministic multi-membership ordering and common Program/Membership locks | erasure vs stamp, redemption and transfer | PASS |
| Dedicated W4 matrix | 61 focused tests, including 24 real database concurrency tests | per-suite raw logs | PASS |
| Full W1-W4 gate | 20 command core gate, browser/accessibility, load, cleanup, scans and archive verification | raw outputs and archive extraction log | PASS |
| No Flutter | no mobile application source added | 598 scanned source files, zero findings | PASS |

Apple and Google external certification remain pending by design; see
[EXTERNAL-CERTIFICATION.md](EXTERNAL-CERTIFICATION.md). They are not represented as local proof.


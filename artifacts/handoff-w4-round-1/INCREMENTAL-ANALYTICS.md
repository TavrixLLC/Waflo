# Incremental operational analytics

The normal worker loop uses three stable source streams: enrollment, Ledger and risk. Each stream has
an `OperationalAnalyticsCheckpoint` cursor ordered by `(occurredAt, sourceId)`, a lease, attempts,
retry time and safe failure state. Work is processed in bounded pages.

Each source row creates at most one `OperationalAnalyticsContribution` and one
`OperationalAnalyticsFact`, enforced by `(sourceKind, sourceId)`. Aggregate deltas are applied with
upserts to the exact organization/program/version/location/staff/local-date key. Replays are no-ops;
late events correct their original timezone-pinned local date. No normal-loop global delete or
whole-Ledger scan remains.

`OperationalAnalyticsJob` provides idempotent organization/date-range rebuild and explicit backfill.
It is leased, bounded and retryable; permanent row-limit failures stop rather than retry forever.
Rebuild replaces only the requested organization's date range and never clears another tenant.

The integration proof runs multiple small pages, interruption/resume, replay, a late Ledger event, a
late risk signal, two organizations, concurrent workers and date-range rebuild/backfill. The built
worker also completes a real one-shot pass in the final quality gate.


# Advanced analytics

The four advanced routes now return typed public contracts rather than raw internal aggregate rows:

- `analytics/programs`: Program and Version, enrollments, active members, stamp operations/units,
  unlock/redemption, completion/reversal/risk rates, Wallet adoption, first-activity conversion and
  repeat visits.
- `analytics/locations`: activity, unique members, redemption, reversal, risk, conversion and repeat
  visits.
- `analytics/staff`: operations, stamp units, redemption, reversal, overrides and risk rate.
- `analytics/cohorts`: enrollment cohort size, first activity, retained count/rate, time to first
  stamp, time to reward, unlock-to-redemption and completion distribution.

Dates are interpreted using the pinned operational timezone. Responses enforce the advanced plan
gate, date range, stable cursor pagination and hard evidence bounds: daily aggregate results are
limited with an extra-row overflow check, and activity/cohort source evidence has explicit maximums.
Oversized ranges return a safe instruction to narrow the range.

The dashboard renders accessible tables and summaries in English and Arabic with RTL layout. The
Round 1 browser evidence includes program comparison and Arabic/RTL operations. Calculations use
`OperationalDailyAggregate` and bounded `OperationalAnalyticsFact`/enrollment evidence, not an
unbounded read-time Ledger scan.


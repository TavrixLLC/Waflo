# Publication preconditions

## Transaction boundary

Publication runs under the existing organization invariant lock and a serializable database
transaction. Idempotency replay is checked before any mutation. The publish command, version state,
prior-version supersession, program pointers, deferred trial activation, and audit events commit or
roll back together.

## Current-state checks

The transaction reloads and verifies:

- organization status is `ACTIVE`;
- billing profile exists and its subscription status is allowed;
- current non-archived program usage is within the selected plan limit;
- the draft's Pro Mode, reward count, milestones, PATH, and RING remain entitled;
- every participating location exists, is tenant-owned, and remains `ACTIVE`;
- each selected visual asset is tenant-safe, unarchived, `READY`, semantically categorized, and has
  the required digest-valid processed object;
- the latest validation is for the exact revision/fingerprint, passed or passed with warnings, and
  contains no errors;
- a completed Test Mode session matches the exact revision and validation fingerprint;
- Customer Web, Apple, and Google preview records exist for the exact revision;
- every preview object exists and matches its stored digest.

Publication never regenerates missing or damaged preview evidence.

## Billing policy

Allowed centralized publication statuses:

- `PENDING_ACTIVATION`
- `TRIALING`
- `ACTIVE`
- `GRACE_PERIOD`

Blocked statuses include `PAST_DUE`, `SUSPENDED`, and `CANCELED`.

The deferred trial starts only for an eligible `PENDING_ACTIVATION` profile whose trial has never
started. Active paid organizations do not start a trial, and idempotent replay cannot start one
again.

## Stable error codes

| Condition | Code | Studio destination |
| --- | --- | --- |
| Organization unavailable | `PROGRAM_PUBLICATION_ORGANIZATION_UNAVAILABLE` | Overview |
| Billing blocked | `PROGRAM_PUBLICATION_BILLING_BLOCKED` | Overview |
| Program usage above plan | `PROGRAM_PUBLICATION_PROGRAM_LIMIT_EXCEEDED` | Overview |
| Draft features exceed plan | `PROGRAM_PUBLICATION_PLAN_BLOCKED` | Overview |
| Location stale | `PROGRAM_PUBLICATION_LOCATION_STALE` | Locations |
| Asset stale or unavailable | `PROGRAM_PUBLICATION_ASSET_STALE` | Artwork |
| Validation stale | `PROGRAM_PUBLICATION_VALIDATION_STALE` | Validation |
| Preview missing/corrupt | `PROGRAM_PUBLICATION_PREVIEW_STALE` | Relevant preview section |
| Test Mode stale/incomplete | `PROGRAM_TEST_REQUIRED` | Validation/Test Mode |

Organization errors expose only the public availability state, never a private suspension reason.


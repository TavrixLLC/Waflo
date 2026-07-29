# Program-limit downgrade behavior

## Direct selected-plan change

`BillingService.selectPlan()` acquires the organization invariant lock and counts:

- active locations;
- active and pending team seats;
- every non-archived loyalty program.

When the target plan cannot hold current usage, the transaction returns
`PLAN_DOWNGRADE_BLOCKED` and leaves the selected plan unchanged. Structured details include:

- `requestedPlan`
- `locationUsage` / `locationLimit`
- `teamSeatUsage` / `teamSeatLimit`
- `programUsage` / `programLimit`

## Stripe-applied downgrade

Stripe remains authoritative, so an externally applied lower plan is recorded. Existing locations,
team seats, and programs are preserved; Waflo does not silently archive or mutate merchant data.
The resulting over-limit state and all three usage/limit pairs are recorded in safe audit metadata.

While over limit:

- new program creation is blocked;
- archived program restore is blocked;
- publication is blocked;
- publication of draft features unavailable on the current plan is blocked.

The same program is counted as current usage rather than as a newly added publication slot.
Publication therefore uses the explicit `usage <= limit` entitlement decision.


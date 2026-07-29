# ADR: W2 stamp policy execution is deferred to W4

- Status: Accepted
- Date: 2026-07-29
- Scope: W2 Loyalty Studio and the W3 enrollment/wallet-preview boundary

## Decision

Maximum stamps per customer per day, minimum purchase amount/currency, and configurable post-reward reset behavior are not operational W2 controls. Their full production semantics are deferred to W4, before real production stamp issuance.

W2 and W3-facing published configuration use these stable values:

- one stamp per qualifying action;
- at most five stamps per synthetic Test Mode command;
- no daily customer cap;
- no purchase-amount or currency threshold;
- final-reward redemption closes the current cycle and resets current progress to zero.

The typed source is `W2_STAMP_POLICY_DEFAULTS` and the W4 ownership contract is `W4_STAMP_POLICY_EXECUTION_BACKLOG` in `@waflo/contracts`.

## W3 boundary

W3 may enroll a customer and construct preview/issuance-facing data only from the stable defaults above. W3 must not expose or claim daily-cap, purchase-threshold, or configurable-reset enforcement. Those controls are not prerequisites for enrollment or wallet preview/issuance scaffolding, but they are prerequisites for real production stamp issuance.

## Data compatibility

The existing database columns remain version-compatible. W2 draft reconstruction preserves their stored values losslessly during partial updates and version cloning, but the W2 UI does not activate them. New W2 configurations persist the stable defaults.

## Consequences

- No half-operational policy controls appear in Loyalty Studio.
- Marketing and UI copy cannot claim these policies are enforced.
- W4 must define validation, ledger interaction, timezone/day boundaries, currency semantics, reset variants, migration behavior, and production tests before issuance is enabled.
- W2 Test Mode continues to model only the locked reset cycle described above.

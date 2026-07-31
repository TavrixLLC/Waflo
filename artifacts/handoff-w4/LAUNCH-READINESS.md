# Launch readiness

- Back up and complete an isolated restore verification.
- Apply migrations before API/worker rollout and record checksums.
- Validate all production secrets, Test Client rejection and provider credential modes.
- Verify ledger chains, projections, worker health, Redis persistence and queue age.
- Exercise device revocation, fraud escalation, privacy processing and key rotation runbooks.
- Confirm rollback schema compatibility and incident communication ownership.
- Obtain legal review for retention and privacy language.
- Complete external Apple/Google certification on real credentials/devices.

Local migration deploy/status, deterministic seed, ledger/projection checks, worker one-shot,
revocation, privacy processing, retry/dead-letter behavior, secret scan and archive inspection are
complete. A production backup restore, production-sized query-plan exercise, legal sign-off,
on-call ownership and external Apple/Google certification remain environment-dependent and are
not claimed.

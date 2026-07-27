# Concurrency Invariants

## Mechanism

`withInvariantLock` executes a serializable PostgreSQL transaction, obtains a transaction-scoped advisory lock from a stable domain key, retries serialization/deadlock failures up to four times, and returns `CONCURRENT_MODIFICATION_RETRY` if contention cannot be resolved.

Organization mutations share `organization:<uuid>` so every capacity or final-resource decision observes a serialized current state.

## Proven invariants

- Verification token: simultaneous claims yield one success and one `VERIFICATION_LINK_INVALID`.
- Password reset: simultaneous claims yield one success and one `RESET_LINK_INVALID`; session revocation is atomic with the password write.
- Invitation acceptance: simultaneous acceptance yields one membership and one `INVITATION_ALREADY_ACCEPTED`.
- Starter invitation capacity: six simultaneous invitations create exactly three pending seats.
- Member reactivation versus invitation: only one capacity-consuming operation succeeds; active plus pending seats remain three.
- Invitation lifecycle: an expired invitation can be reissued; a Manager cannot resend or cancel a Manager invitation.
- Growth locations: simultaneous creates stop at three active locations.
- Location restore: simultaneous restores stop at the plan limit.
- Final location: simultaneous archives leave one active location.
- Final owner: simultaneous demotions leave one active Owner.
- Final owner removal: simultaneous removals leave one active Owner.

Tests: `tests/concurrency/invariants.test.ts`
Combined concurrency/Stripe result: 14 passed, exit code 0.

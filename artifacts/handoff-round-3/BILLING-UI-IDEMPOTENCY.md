# Billing UI Checkout Command IDs

- Checkout creates one UUID with `globalThis.crypto.randomUUID()` per intentional attempt.
- The UUID is sent only as `x-idempotency-key` on Checkout. Portal sends no Checkout command header.
- A ref guard and disabled/loading state make rapid double-clicks produce one browser request.
- A network/transport failure retains the UUID so an explicit retry replays the same command.
- A successful URL response clears it immediately before navigation.
- Stable validation and conflict responses clear it, allowing the next intentional attempt to receive a new UUID.
- Command IDs are not logged and are not treated as authentication material.

Source: `apps/merchant-dashboard/components/dashboard-screens.tsx`.
Browser proof: `tests/e2e/platform.spec.ts` Checkout test.

# Apple registration race

Registration is serialized with a transaction/advisory lock and a unique device-library/pass pair. Concurrent identical registration returns protocol-compatible 201/200 outcomes rather than exposing a Prisma uniqueness error.

Policy:

- one active registration row per device/pass;
- a changed push token replaces the encrypted value;
- one material registration audit, with replay audit separated;
- unregister is idempotent;
- re-registration reactivates the existing row and returns 200.

The uniqueness migration deduplicates historical rows before enforcing the pair. `evidence/apple-registration-race-result.json` summarizes the focused concurrency assertions without push-token material.

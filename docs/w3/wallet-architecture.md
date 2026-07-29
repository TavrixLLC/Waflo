# Wallet architecture

`@waflo/wallet-core` defines provider-neutral health, command, result, status, asset, idempotency, and normalized-error contracts. Apple and Google implementations satisfy the same `WalletProvider` interface.

Enrollment and transfer call the Wallet orchestrator, not provider-specific branches. The orchestrator creates immutable `WalletPassInstance` rows and `WalletCommand` outbox records. Provider work is not part of the enrollment transaction.

Each provider operation accepts a Waflo idempotency key. Provider errors are mapped to stable categories such as `NOT_CONFIGURED`, `RATE_LIMITED`, `TEMPORARY_FAILURE`, `SIGNING_FAILED`, and `PERMANENT_FAILURE`; raw credentials and raw provider responses are not browser-visible.

Program Version bindings are immutable by configuration fingerprint. Apple uses a local signing/template binding; Google uses one LoyaltyClass identity per published Program Version.

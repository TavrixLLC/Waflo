# Architecture Decision Records

W4 continues with ADRs 0032-0043: authoritative ledger, derived projection, hash chain, reset and
daily-cap semantics, timezone pinning, device key binding, approval, reversals, erasure retention,
Wallet coalescing, and the Flutter boundary.

| ADR | Decision |
| --- | --- |
| [0001](0001-monorepo-and-application-boundaries.md) | Monorepo and application boundaries |
| [0002](0002-nestjs-api-boundary.md) | NestJS API boundary |
| [0003](0003-first-party-authentication.md) | First-party authentication |
| [0004](0004-session-storage-and-csrf.md) | Session storage and CSRF |
| [0005](0005-multi-tenancy-enforcement.md) | Multi-tenancy enforcement |
| [0006](0006-merchant-subdomain-resolution.md) | Merchant subdomain resolution |
| [0007](0007-plan-entitlements.md) | Central plan entitlements |
| [0008](0008-stripe-source-of-truth.md) | Stripe as billing source of truth |
| [0009](0009-english-arabic-localization.md) | English and Arabic localization |
| [0010](0010-loyalty-excluded-from-w1.md) | Loyalty functionality excluded from W1 |
| [0011](0011-w2-program-version-separation.md) | W2 Program/version separation |
| [0012](0012-w2-published-version-immutability.md) | W2 published-version immutability |
| [0013](0013-w2-test-mode-without-customers.md) | W2 Test Mode without customers |
| [0014](0014-w2-stamp-renderer.md) | W2 stamp renderer |
| [0015](0015-w2-object-storage-abstraction.md) | W2 object-storage abstraction |
| [0016](0016-w2-merchant-upload-policy.md) | W2 merchant upload policy |
| [0017](0017-w2-preview-capability-matrix.md) | W2 preview capability matrix |
| [0018](0018-w2-first-publication-trial.md) | W2 first-publication trial |
| [0019](0019-w2-publication-idempotency.md) | W2 publication idempotency |
| [0020](0020-w2-autosave-concurrency.md) | W2 autosave concurrency |
| [0021](0021-w3-customer-without-account.md) | Customer without an account |
| [0022](0022-w3-membership-version-pinning.md) | Membership pinned to enrollment Program Version |
| [0023](0023-w3-static-revocable-qr.md) | Static revocable QR in W3 |
| [0024](0024-w3-customer-contact-encryption.md) | Customer contact encryption |
| [0025](0025-w3-apple-pass-identity-and-auth.md) | Apple pass identity and auth token |
| [0026](0026-w3-google-class-per-program-version.md) | Google Class per Program Version |
| [0027](0027-w3-wallet-outbox-worker.md) | Wallet outbox and worker |
| [0028](0028-w3-transfer-new-provider-identity.md) | Transfer creates new provider identity |
| [0029](0029-w3-public-wallet-asset-safety.md) | Public Wallet asset safety |
| [0030](0030-w3-external-credential-gates.md) | External provider credential gates |
| [0031](0031-w3-ledger-deferred-to-w4.md) | Production ledger deferred to W4 |

Records 0001–0010 are accepted for W1, 0011–0020 for W2, and 0021–0031 for W3.

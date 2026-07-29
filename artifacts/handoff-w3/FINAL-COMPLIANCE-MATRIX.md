# Final W3 compliance matrix

| Area | Status | Evidence |
| --- | --- | --- |
| W1/W2 controls and two-state grid | Passed | Full automated suite; `TEST-SUMMARY.md` |
| Customer, contacts, consents, Membership | Passed | Prisma schema/migrations; `CUSTOMER-DOMAIN.md` |
| Versioned enrollment policy and public slug | Passed | API/UI/browser evidence |
| Name-only and optional/required email enrollment | Passed | Unit/integration/HTTP/browser tests |
| Transactional enrollment idempotency | Passed | `ENROLLMENT-IDEMPOTENCY.md` |
| Encrypted contact data | Passed | `CUSTOMER-DATA-ENCRYPTION.md` |
| Zeroed projection and private card | Passed | Unit/integration/browser tests |
| Opaque revocable Membership QR | Passed | `QR-FORMAT.md` |
| Apple package/Test Adapter | Passed | Automated package, MIME, registration/update tests |
| Apple real device/certificate certification | Pending | Credentials/device not supplied |
| Google Class/Object/JWT Test Adapter | Passed | Automated mapping/action/update tests |
| Google real issuer certification | Pending | Issuer/service account not supplied |
| Wallet outbox, worker, retry, reconciliation | Passed | Worker tests and structured logs |
| Email and no-email transfer | Passed | HTTP/browser/concurrency tests |
| Exactly one active credential after transfer | Passed | Transaction logic and partial unique index |
| Old Apple/Google identity invalidation | Passed in Test Adapter | Worker/provider assertions |
| Pause/archive/suspension/billing behavior | Passed | Integration/browser tests |
| Membership version pinning | Passed | Integration test and browser/DB evidence |
| E2E twice | Passed | Two 6-test W3 runs |
| Accessibility twice | Passed | Two axe-assisted W3 runs |
| Secret scan | Passed | `SECRET-SCAN.md` |
| Portable archive inspection | Passed | `PROCESS-CLEANUP.md` |
| W4 exclusion | Passed | `NO-W4.md` |

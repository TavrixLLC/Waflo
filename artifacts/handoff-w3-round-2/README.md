# Waflo W3 repair round 2 handoff

W3 Repair Round 2 closes the five blockers in the Round 2 gate review:

1. Apple update tags are globally monotonic `BIGINT` values.
2. Program transitions, enrollment, and transfer completion share one lifecycle lock.
3. Manual reconciliation is a persisted, resumable, stable-cursor batch job.
4. Multi-program Customer Web links preserve the resolved locale.
5. Portable-source creation and inspection reject `*.tsbuildinfo`, `tmp/`, caches, and runtime output.

The full Vitest run passed 277/277 tests. The final W1/W2 browser regression passed
14/14, W1/W2 accessibility passed 3/3, W3 browser passed 7/7 twice, and W3
accessibility passed 1/1 twice. Every recorded final gate returned exit code 0.

External Apple and Google certification was not performed because no production
credentials or physical-device certification environment was supplied. The evidence is
truthfully limited to local services, real PostgreSQL concurrency, Chromium, and Wallet
Test Adapters.

## Contents

- [Final compliance matrix](FINAL-COMPLIANCE-MATRIX.md)
- [Apple global update sequence](APPLE-GLOBAL-UPDATE-SEQUENCE.md)
- [Program lifecycle lock](PROGRAM-LIFECYCLE-LOCK.md)
- [Program Wallet reconciliation](PROGRAM-WALLET-RECONCILIATION.md)
- [Multi-program locale](MULTI-PROGRAM-LOCALE.md)
- [Test summary](TEST-SUMMARY.md)
- [Screenshot manifest](SCREENSHOT-MANIFEST.md)
- [External certification](EXTERNAL-CERTIFICATION.md)
- [Process cleanup](PROCESS-CLEANUP.md)
- [Secret scan](SECRET-SCAN.md)
- [No-W4 confirmation](NO-W4.md)
- [Focused evidence](evidence/ROUND2-FOCUSED-EVIDENCE.md)
- `raw-test-output/` — command and Playwright output
- `provider-artifacts/` — synthetic Apple package and redacted Google mappings
- `screenshots/` — browser evidence and contact sheet
- `waflo-w3-round-2-portable-source.zip` — portable source
- `waflo-w3-round-2-portable-source.zip.sha256` — checksum

Portable source SHA-256:
`66c24c814d2d180855907a0f7066d45a1c584907c3fa8feba341b03e62cfc9f2`.

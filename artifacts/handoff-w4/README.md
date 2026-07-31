# Waflo W4 portable handoff

This handoff covers the authoritative loyalty ledger, signed Staff device backend, merchant
operations, risk, analytics, exports, privacy, workers and launch documentation delivered from the
approved W3 Round 2 baseline.

Start with `FINAL-COMPLIANCE-MATRIX.md`, `TEST-SUMMARY.md`, `SECURITY-REVIEW.md` and
`LAUNCH-READINESS.md`. Provider-facing machine contracts are under `provider-artifacts/`.
Screenshots are indexed by `SCREENSHOT-MANIFEST.md`.

The source archive intentionally excludes runtime data, secrets, provider credentials, private
keys, raw Membership QR values and generated PII exports.

Final verification is summarized in `TEST-SUMMARY.md`; machine-readable core exit codes are in
`raw-test-output/quality-gate-summary.json`. External Apple/Google certification and a
production backup restore are intentionally listed as remaining launch gates.

# Token Fragment Regression

Verification, reset-password, and invitation emails use `#token=` fragments. The browser reads the fragment client-side, immediately removes it with `history.replaceState`, then submits the token in a POST body. Next.js never receives the token in its request URL.

Coverage:

- `tests/e2e/platform.spec.ts` asserts verification and reset links contain `#token=`, the fragment is cleared, and invitation acceptance uses the same flow.
- `artifacts/handoff-round-3/raw-test-output/token-log-scan.txt` scans API, Next.js, and Playwright process logs for raw token patterns.

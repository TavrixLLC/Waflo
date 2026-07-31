# W1-W3 regression

W1 authentication, merchant sessions, CSRF, CORS, tenancy, permissions, billing, audit and
security remain the governing controls. W2 immutable Program Versions, Test Mode isolation,
publication, trial, stamp rendering and plan gates remain intact. W3 customer-without-account,
encrypted contacts, credential transfer, Wallet outbox and provider identity remain intact.

Final regression results:

- W1/W2 Playwright: 14/14 passed, exit code 0.
- W1/W2 Axe/keyboard accessibility: 3/3 passed, exit code 0.
- W3 main browser suite: 7/7 passed, exit code 0.
- W3 evidence/version-pinning: 1/1 passed, exit code 0.
- W3 provider-disabled truthfulness: 1/1 passed, exit code 0.
- W3 Axe accessibility: 1/1 passed, exit code 0.
- Full cross-phase Vitest: 27 files and 299 tests passed, exit code 0.

The W2 Starter entitlement check now establishes and restores its own plan fixture, so the W4
Scale demonstration seed cannot invalidate the older test. W3 HTTP tests use an isolated
rate-limit namespace, preventing unrelated suites from exhausting their public-enrollment budget.
Exact final browser result paths and exit codes are indexed by
`raw-test-output/BROWSER-EXIT-CODES.md`; the raw W1/W2 and W3 transcripts remain in their approved
phase handoff directories.

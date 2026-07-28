# Waflo W1 Repair Round 3 Test Summary

Date: 2026-07-28

All final gate commands completed with exit code 0. Raw command output is in `raw-test-output/`.

| Gate | Result |
| --- | --- |
| Format check | `format-check.txt` — exit 0 |
| Lint | `lint.txt` — exit 0 |
| Typecheck | `typecheck.txt` — exit 0 |
| Unit | `unit-tests.txt` — 62 passed |
| Integration | `integration-tests.txt` — 42 passed |
| HTTP | `http-tests.txt` — 12 passed |
| Concurrency | `concurrency-tests.txt` — 33 passed |
| Full Vitest | `vitest-full.txt` — 150 passed |
| Prisma schema validation | `prisma-validate.txt` — exit 0 |
| Prisma migration status | `prisma-migrate-status.txt` — database up to date |
| Production build | `production-build.txt` — exit 0 |
| Browser E2E | `playwright-chromium-2026-07-28T09-02-19.032Z-257663-results.log` — 9 passed; repeated in `playwright-chromium-2026-07-28T09-03-03.484Z-30544f-results.log` — 9 passed |
| Accessibility E2E | `playwright-accessibility-2026-07-28T09-03-44.075Z-b20089-results.log` — 2 passed; repeated in `playwright-accessibility-2026-07-28T09-04-18.883Z-6afef0-results.log` — 2 passed |
| Token scan | `token-log-scan.txt` — clean |
| Process and port cleanup | `post-playwright-process-check.txt`, `post-playwright-port-check.txt` — zero managed processes and zero listeners |

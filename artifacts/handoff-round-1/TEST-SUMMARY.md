# W1 Repair Test Summary

All exit codes below are from commands executed on 2026-07-27 in `C:\waflo`.

| Check | Result | Exit code | Raw evidence |
| --- | ---: | ---: | --- |
| Node runtime | 24.14.1 | 0 | `raw-test-output/node-version.txt` |
| Docker dependencies | PostgreSQL, Redis, Mailpit healthy | 0 | `raw-test-output/docker-compose-ps.txt` |
| Format check | 142 files, no changes required | 0 | `raw-test-output/format-check.txt` |
| Lint | 157 files, zero warnings/errors | 0 | `raw-test-output/lint.txt` |
| Typecheck | 14 packages passed | 0 | `raw-test-output/typecheck.txt` |
| Unit | 47 passed | 0 | `raw-test-output/unit-tests.txt` |
| Service/database integration | 42 passed | 0 | `raw-test-output/integration-tests.txt` |
| HTTP integration | 9 passed | 0 | `raw-test-output/http-tests.txt` |
| Concurrency and Stripe | 14 passed | 0 | `raw-test-output/concurrency-tests.txt` |
| Full Vitest matrix | 112 passed in 6 files | 0 | `raw-test-output/vitest-full.txt` |
| Prisma schema validation | valid | 0 | `raw-test-output/prisma-validate.txt` |
| Prisma migration status | 3 migrations; database up to date | 0 | `raw-test-output/prisma-migrate-status.txt` |
| Production build | 14 packages passed | 0 | `raw-test-output/production-build.txt` |
| E2E run 1 | 7 passed | 0 | `raw-test-output/playwright-chromium-2026-07-27T19-45-28.437Z-ac3950-results.log` |
| E2E run 2 | 7 passed | 0 | `raw-test-output/playwright-chromium-2026-07-27T19-46-17.436Z-5335b8-results.log` |
| Accessibility run 1 | 2 passed; expanded W1 routes | 0 | `raw-test-output/playwright-accessibility-2026-07-27T19-47-04.617Z-8abe5a-results.log` |
| Accessibility run 2 | 2 passed; expanded W1 routes | 0 | `raw-test-output/playwright-accessibility-2026-07-27T19-47-41.928Z-07ae55-results.log` |

The individual project counts intentionally overlap the full 112-test Vitest matrix. Browser and accessibility runs are outside Vitest.

## Observed non-failing warning

The PostgreSQL adapter emits a pg 8.x deprecation warning when concurrent Prisma queries share a client. It does not change exit codes or invariant results. This should be rechecked during a future pg 9 compatibility upgrade.

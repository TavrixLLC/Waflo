# W3 Repair Round 2 test summary

All final gate commands returned exit code 0.

| Gate | Result |
| --- | ---: |
| Format check | 245 files, exit 0 |
| Lint | 260 files, exit 0 |
| Workspace typecheck | 21/21 tasks, exit 0 |
| Unit project | 135/135 tests, exit 0 |
| Integration project | 49/49 tests, exit 0 |
| HTTP project | 24/24 tests, exit 0 |
| Concurrency project | 69/69 tests, exit 0 |
| Focused W3 concurrency | 9/9 tests, exit 0 |
| Full Vitest | 22 files, 277/277 tests, exit 0 |
| Prisma validation | Valid, exit 0 |
| Prisma migration status | 19 migrations, up to date, exit 0 |
| Production build | 21/21 tasks, exit 0 |
| W1/W2 Chromium regression | 14/14 tests, exit 0 |
| W1/W2 accessibility | 3/3 tests, exit 0 |
| W3 Chromium run 1 | 7/7 tests, exit 0 |
| W3 Chromium run 2 | 7/7 tests, exit 0 |
| W3 accessibility run 1 | 1/1 test, exit 0 |
| W3 accessibility run 2 | 1/1 test, exit 0 |
| W3 extra evidence | 1/1 test, exit 0 |
| W3 disabled-provider evidence | 1/1 test, exit 0 |
| Secret scan | 489 files, zero violations, exit 0 |
| No-W4 scan | 128 files, zero prohibited findings, exit 0 |
| Portable archive inspect/extract | 486 entries/files, zero forbidden, exit 0 |

The full Vitest total includes Apple package/web-service tests, Apple updated-serial
tests, Google mapping/JWT tests, Wallet worker tests, unit, integration, HTTP, and
real-PostgreSQL concurrency projects.

The handoff retains raw final output. It also retains two earlier isolated browser
diagnostic logs that exposed fixture cleanup assumptions; those assumptions were
repaired, and the subsequent repeat runs above are green.

Portable source SHA-256:
`66c24c814d2d180855907a0f7066d45a1c584907c3fa8feba341b03e62cfc9f2`.

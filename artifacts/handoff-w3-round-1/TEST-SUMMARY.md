# Test summary

Final gate date: 2026-07-29.

| Gate | Result |
| --- | --- |
| Format check | Pass, exit 0 |
| Lint | Pass, exit 0, zero warnings/errors |
| Full workspace typecheck | Pass, exit 0, 21/21 |
| Prisma validate | Pass, exit 0 |
| Migration deploy/status | Pass, exit 0, 18 migrations, none pending |
| Unit project | Pass, 135 tests |
| Full integration project | Pass, 49 tests |
| Full concurrency project | Pass, 67 tests |
| HTTP project | Pass, 24 tests |
| Full Vitest | Pass, 275 tests in 22 files |
| All workspace production builds | Pass, 21/21 |
| W1/W2 browser regression | Pass, 14/14 |
| W1/W2 accessibility regression | Pass, 3/3 |
| W3 E2E run 1 | Pass, 7/7 |
| W3 E2E run 2 | Pass, 7/7 |
| W3 accessibility run 1 | Pass, 1/1 |
| W3 accessibility run 2 | Pass, 1/1 |
| W3 supplemental evidence | Pass, 1/1 |
| W3 provider-disabled evidence | Pass, 1/1 |

Raw outputs are in `raw-test-output/`. Controlled retry/dead-letter tests intentionally emit `command_failed` worker log lines before asserting recovery or terminal handling.

The PostgreSQL driver prints a deprecation warning when a client is asked to query while already executing a query. It does not fail a test, but should be removed before upgrading to pg 9.

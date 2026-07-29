# Authoritative Test Summary

Timestamp: **2026-07-28**

All commands below completed with **exit code 0**.

## Repository quality gate

Command: `pnpm check`

- Format: 168 files checked, no fixes required
- Lint: 183 files checked, no fixes required
- Typecheck: 15/15 workspaces successful
- Test suite: 14/14 files, 189/189 tests passed
- Production build: 15/15 workspaces successful, including all applications

Raw output: `raw-test-output/final-quality-gate.log`

The final accessibility timeout stabilization changed only test configuration. A final format and lint rerun also passed after that adjustment.

## Layered test counts

| Layer | Files | Tests | Exit |
|---|---:|---:|---:|
| Unit and renderer/image | 6 | 84 | 0 |
| PostgreSQL integration | 1 | 42 | 0 |
| HTTP boundary | 2 | 17 | 0 |
| PostgreSQL/MinIO concurrency | 5 | 46 | 0 |
| **Total** | **14** | **189** | **0** |

Raw outputs:

- `raw-test-output/final-unit.log`
- `raw-test-output/final-integration.log`
- `raw-test-output/final-http.log`
- `raw-test-output/final-concurrency.log`

## Prisma

- Schema validation: valid, exit 0
- Migration status: 11 migrations found; schema up to date, exit 0

Raw outputs:

- `raw-test-output/final-prisma-validate.log`
- `raw-test-output/final-prisma-status.log`

## Playwright E2E — two clean runs

| Run | Result | Duration | Exit |
|---|---|---:|---:|
| `2026-07-28T15-18-28.366Z-020959` | 12/12 passed | 59.3 s | 0 |
| `2026-07-28T15-23-35.446Z-0cbf4b` | 12/12 passed | 1.1 min | 0 |

Authoritative result logs:

- `raw-test-output/playwright-chromium-2026-07-28T15-18-28.366Z-020959-results.log`
- `raw-test-output/playwright-chromium-2026-07-28T15-23-35.446Z-0cbf4b-results.log`

## Accessibility — two clean runs

| Run | Result | Duration | Exit |
|---|---|---:|---:|
| `2026-07-28T15-30-12.170Z-a8c068` | 3/3 passed | 49.0 s | 0 |
| `2026-07-28T15-31-19.748Z-1ef4d5` | 3/3 passed | 47.6 s | 0 |

Authoritative result logs:

- `raw-test-output/playwright-accessibility-2026-07-28T15-30-12.170Z-a8c068-results.log`
- `raw-test-output/playwright-accessibility-2026-07-28T15-31-19.748Z-1ef4d5-results.log`

## Infrastructure and cleanup

- PostgreSQL healthy
- Redis healthy
- MinIO running and initialized
- Private bucket anonymous probe returned HTTP 403
- Final managed ports 3000, 3001, 3002, and 4000 closed
- Source secret scan passed

The PowerShell-captured pnpm logs contain a `NativeCommandError` wrapper because pnpm writes normal progress to stderr. The commands themselves returned exit 0 and the pass summaries above are present in the same raw files.

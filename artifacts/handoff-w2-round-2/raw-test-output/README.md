# Raw Test Output Guide

## Authoritative final outputs

- `final-quality-gate.log`
- `final-unit.log`
- `final-integration.log`
- `final-http.log`
- `final-concurrency.log`
- `final-prisma-validate.log`
- `final-prisma-status.log`
- `final-docker-compose-ps.log`
- `final-minio-init.log`
- `final-minio-private-probe.log`
- `final-secret-scan.log`
- `final-process-cleanup.log`
- `playwright-chromium-2026-07-28T15-18-28.366Z-020959-results.log`
- `playwright-chromium-2026-07-28T15-23-35.446Z-0cbf4b-results.log`
- `playwright-accessibility-2026-07-28T15-30-12.170Z-a8c068-results.log`
- `playwright-accessibility-2026-07-28T15-31-19.748Z-1ef4d5-results.log`

The matching `api`, `dashboard`, `marketing`, and `customer` logs for those run IDs are supporting process logs.

## Historical diagnostic outputs

All other timestamped Playwright logs in this directory are repair diagnostics from iterations before the final source freeze. They are retained for transparency and must not be interpreted as the final result.

The only final browser verdicts are the four passing result logs listed above.

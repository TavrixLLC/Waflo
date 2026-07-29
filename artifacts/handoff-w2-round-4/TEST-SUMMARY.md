# Final test summary

All final commands below exited 0 on 2026-07-29.

| Gate | Final result | Raw output |
| --- | --- | --- |
| Format check | 179 files; no changes required in the authoritative quality run | `raw-test-output/quality-gate-final.log` |
| Lint | 194 files; clean in the authoritative quality run | `raw-test-output/quality-gate-final.log` |
| Workspace typecheck | 15/15 workspaces | `raw-test-output/quality-gate-final.log` |
| Unit | 8 files, 108/108 tests | `raw-test-output/unit-final.log` |
| Integration | 1 file, 43/43 tests | `raw-test-output/integration-final.log` |
| HTTP boundary | 2 files, 18/18 tests | `raw-test-output/http-final.log` |
| Concurrency/database | 5 files, 57/57 tests | `raw-test-output/concurrency-final.log` |
| Renderer/image focus | Stamp renderer suite passed | `raw-test-output/renderer-image-final.log` |
| Full Vitest | 16 files, 226/226 tests | `raw-test-output/quality-gate-final.log` |
| Prisma validation | Schema valid | `raw-test-output/prisma-validation.log` |
| Migration status | 14 migrations; database current | `raw-test-output/migration-status.log` |
| Production build | 15/15 workspaces | `raw-test-output/quality-gate-final.log` |
| E2E pass 1 | 14/14; managed ports closed | `raw-test-output/e2e-final-pass-1.log` |
| E2E pass 2 | 14/14; managed ports closed | `raw-test-output/e2e-final-pass-2.log` |
| Accessibility pass 1 | 3/3; managed ports closed | `raw-test-output/a11y-final-pass-1.log` |
| Accessibility pass 2 | 3/3; managed ports closed | `raw-test-output/a11y-final-pass-2.log` |
| Independent cleanup | Ports 3000, 3001, 3002, and 4000 closed | `raw-test-output/process-port-cleanup.log` |
| Secret scan | Zero high-confidence matches | `raw-test-output/secret-scan.log` |
| Archive inspection | Zero forbidden entries | `raw-test-output/archive-inspection.log` |
| Archive extraction | Extracted source and required metadata verified | `raw-test-output/archive-extraction.log` |

## Coverage highlights

The final suite covers stale publication dependencies, billing/organization/plan enforcement,
program-limit downgrade behavior, lifecycle concurrency, lossless nested PATCH, semantic asset
deduplication and recovery, audit cardinality and rollback, two-state renderer parity, reward-ready
and redemption reset behavior, English/Arabic/RTL, and idempotent/concurrent command behavior.

# Round 5 final test summary

All final commands exited 0 on 2026-07-29.

| Gate | Result | Raw output |
| --- | --- | --- |
| Format | 182 files | `raw-test-output/final-format.log` |
| Format check | 182 files; clean | `raw-test-output/final-quality-gate.log` |
| Lint | 197 files; clean | `raw-test-output/final-quality-gate.log` |
| Workspace typecheck | 15/15 | `raw-test-output/final-quality-gate.log` |
| Unit | 9 files, 117/117 | `raw-test-output/final-unit.log` |
| Integration | 1 file, 44/44 | `raw-test-output/final-integration.log` |
| HTTP | 2 files, 19/19 | `raw-test-output/final-http.log` |
| Concurrency/database | 5 files, 60/60 | `raw-test-output/final-concurrency.log` |
| Renderer/image | 1 file, 13/13 | `raw-test-output/final-renderer-image.log` |
| Full Vitest | 17 files, 240/240 | `raw-test-output/final-quality-gate.log` |
| Prisma validation | Valid | `raw-test-output/final-prisma-validation.log` |
| Migration status | 14 migrations; database current | `raw-test-output/final-migration-status.log` |
| Production build | 15/15 | `raw-test-output/final-quality-gate.log` |
| E2E pass 1 | 14/14; managed ports closed | `raw-test-output/final-e2e-pass-1.log` |
| E2E pass 2 | 14/14; managed ports closed | `raw-test-output/final-e2e-pass-2.log` |
| Accessibility pass 1 | 3/3; managed ports closed | `raw-test-output/final-a11y-pass-1.log` |
| Accessibility pass 2 | 3/3; managed ports closed | `raw-test-output/final-a11y-pass-2.log` |
| Independent cleanup | Ports 3000, 3001, 3002, and 4000 closed | `raw-test-output/final-process-port-cleanup.log` |
| Secret scan | Zero high-confidence matches | `raw-test-output/final-secret-scan.log` |
| No-W3 scan | Zero prohibited model/implementation matches | `raw-test-output/final-no-w3-scope-scan.log` |
| Archive creation | Passed | `raw-test-output/final-archive-creation.log` |
| Archive inspection | Zero forbidden entries | `raw-test-output/final-archive-inspection.log` |
| Archive extraction | Required source and metadata verified | `raw-test-output/final-archive-extraction.log` |

Round 5 required no schema change, so no migration was added. Prisma validation and status confirm
the existing 14-migration schema remains aligned and current.


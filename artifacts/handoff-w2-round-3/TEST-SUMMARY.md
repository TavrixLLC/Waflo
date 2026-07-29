# Final test summary

All commands below exited 0 on 2026-07-28.

| Gate | Final result | Raw output |
| --- | --- | --- |
| Format write | 176 files; 1 final evidence-only source fix formatted | `raw-test-output/final-format.log` |
| Format check | 176 files; no changes required | `raw-test-output/final-quality-gate.log` |
| Lint | 191 files; clean | `raw-test-output/final-lint.log` |
| Workspace typecheck | 15/15 packages | `raw-test-output/final-typecheck.log` |
| Unit | 7 files, 95/95 tests | `raw-test-output/final-unit.log` |
| Integration | 1 file, 42/42 tests | `raw-test-output/final-integration.log` |
| HTTP | 2 files, 18/18 tests | `raw-test-output/final-http.log` |
| Concurrency/database | 5 files, 50/50 tests | `raw-test-output/final-concurrency.log` |
| Renderer/image focus | 1 file, 3/3 tests | `raw-test-output/final-renderer-image.log` |
| Full tests | 15 files, 205/205 tests | `raw-test-output/final-full-tests.log` |
| Prisma validation | Valid | `raw-test-output/final-prisma-validate.log` |
| Migration status | 13 migrations; database current | `raw-test-output/final-migration-status.log` |
| Production build | 15/15 packages | `raw-test-output/final-build.log` |
| Full quality gate | Format, lint, 15 typechecks, 205 tests, and 15 builds passed | `raw-test-output/final-quality-gate.log` |
| E2E run 1 | 13/13; managed ports closed | `raw-test-output/final-e2e-run-1.log` |
| E2E run 2 | 13/13; managed ports closed | `raw-test-output/final-e2e-run-2.log` |
| Accessibility run 1 | 3/3; managed ports closed | `raw-test-output/final-a11y-run-1.log` |
| Accessibility run 2 | 3/3; managed ports closed | `raw-test-output/final-a11y-run-2.log` |
| Independent port check | No listeners on 3000, 3001, 3002, 4000 | `raw-test-output/final-process-port-cleanup.log` |
| Secret signature scan | 0 high-confidence signatures | `raw-test-output/final-secret-scan.log` |
| Archive inspection | 0 forbidden entries | `raw-test-output/final-archive-inspection.log` |
| Archive extraction | 378 files; package metadata and required scripts present | `raw-test-output/final-archive-extraction.log` |

## Baseline

The initial gate attempt recorded the unavailable Docker dependency in `baseline-quality-gate-environment-failure.log`. After local infrastructure was started, the unchanged baseline passed and was recorded in `baseline-quality-gate.log`. Repair work began only after that successful baseline.

## Browser coverage retained

The two final E2E runs cover public English/Arabic and RTL, registration and Mailpit verification, onboarding, authentication, Quick and Pro Studio flows, autosave/conflicts, validation, Test Mode, publication and v2 history, lifecycle actions, Round 3 templates/artwork/background/capabilities/pagination, password reset, billing/location limits, invitations, audit/security, organization/language switching, Starter restrictions, and unauthenticated access.

Accessibility runs cover public/auth/form-error screens, authenticated English/Arabic dashboards and dialogs, and the Studio crop/validation/Test Mode/publication/conflict/RTL flow with no serious violations.

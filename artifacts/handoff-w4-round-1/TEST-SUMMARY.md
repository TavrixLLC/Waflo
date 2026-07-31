# W4 Repair Round 1 test summary

Final local gate completed on 2026-07-31 with every recorded command at exit code 0.

| Gate | Final result |
| --- | --- |
| Core command gate | 20/20 |
| Frozen install, format and lint | PASS; no format or lint findings |
| Workspace typecheck | 26/26 packages |
| Dedicated W4 | 61/61 tests in 11 files |
| W4 unit / integration / HTTP | 17/17, 3/3, 8/8 |
| W4 concurrency / failure / database | 24/24, 4/4, 5/5 |
| Load | 10,000-event rebuild and 100 concurrent requests, both PASS |
| Full Vitest regression | 338/338 tests in 33 files: 152 unit, 57 integration, 32 HTTP, 93 concurrency, 4 failure |
| Prisma | Valid; 24 migrations deployed; no pending migration |
| Production build | 26/26 packages |
| W1/W2 browser / accessibility | 14/14 and 3/3 |
| W3 browser / accessibility | 7/7 and 1/1 |
| W4 E2E run 1 / run 2 | 6/6 and 6/6 |
| W4 accessibility run 1 / run 2 | 2/2 and 2/2 |
| Secret / No-Flutter scans | 657 files, 0 violations / 598 files, 0 artifacts |
| Process cleanup | ports 3000, 3001, 3002 and 4000 closed |
| Portable source | 594 entries, 0 forbidden; clean extraction/install/format/lint PASS |
| Archive SHA-256 | `8ebed2d49c613d2199b534b7633f6c98847da73c2c13330868c37784cf295258` |

The final quality summary is `raw-test-output/quality-gate-summary.json`; every command has its own
raw log. `raw-test-output/BROWSER-EXIT-CODES.md` identifies the successful browser runs. Earlier
failed diagnostic attempts remain in the directory and show the two fixes discovered during the
gate: isolated seeded browser state and legacy Ledger v1 hash compatibility.

These load checks are controlled local correctness gates, not a production capacity claim.
Production-scale query plans, real provider incidents, backup restoration and external certification
remain deployment-environment exercises.

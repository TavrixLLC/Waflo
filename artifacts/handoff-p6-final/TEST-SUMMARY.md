# Test summary

All final release gates passed.

| Gate | Final result |
| --- | --- |
| Format | Passed, exit 0 |
| Lint | Passed, exit 0 |
| Typecheck | 26/26 packages, exit 0 |
| Vitest full suite | 41 files / 430 tests, exit 0 |
| Monorepo build | 26/26 packages, exit 0 |
| Chromium merchant regression | 92/92, exit 0 |
| Merchant accessibility | 3/3 passed; 0 serious/critical |
| W4 browser regression | 6/6 passed |
| W4 accessibility | 2/2 passed; 0 serious/critical |
| M2 provenance verifier | Passed; 22 source hashes and 12 generated files |
| Flutter modification scan | Passed; 0 changed files |

## Vitest breakdown

- Unit: 21 files / 240 tests
- Integration: 6 files / 58 tests
- HTTP: 5 files / 34 tests
- Concurrency: 8 files / 94 tests
- Failure handling: 1 file / 4 tests

## Chromium breakdown

- P3 Gallery and Builder: 24 tests
- Loyalty Cards Library: 7 tests
- P4A Studio: 17 tests
- P4B Launch/publication: 13 tests
- P5 polish: 4 tests
- P5 final repair: 8 tests
- P6 release smoke: 5 tests
- W2 platform regression retained in the project: 14 tests

Infrastructure note: repository browser wrappers require a machine-local `.env`, which is intentionally absent and was not created. Direct Playwright project execution used documented development variables. A first aggregate run exposed the intended CSP block because its production server did not inherit the explicit loopback-smoke build setting; rebuilding the merchant package directly with both documented smoke variables produced the final 92/92 result. PostgreSQL, Redis, MinIO, and the W4 workers were treated as explicit test prerequisites. The W4 workers were stopped after their browser and accessibility gates.

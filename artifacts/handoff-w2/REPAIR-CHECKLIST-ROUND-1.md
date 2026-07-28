# W2 repair checklist — Round 1

This checklist records the repair work completed against the Round 1 gate review.

| Gate area | Evidence | Result |
|---|---|---|
| Live state remains separate from draft editing | `apps/api/src/programs/programs.service.ts`, `tests/unit/program-rules.test.ts` | Completed |
| Version list/detail and draft abandonment/restore routes | `apps/api/src/programs/programs.controller.ts` | Completed |
| Four layouts and three output profiles | `packages/stamp-engine/src/index.ts`, `tests/unit/stamp-engine.test.ts` | Completed |
| Separate filled/empty artwork with safe SVG handling | `packages/stamp-engine/src/index.ts`, `apps/api/src/programs/library-artwork.ts` | Completed |
| Built-in artwork library and bilingual template metadata | `apps/api/src/programs/library-artwork.ts` | Completed |
| Custom asset reference preservation and ownership checks | `apps/api/src/programs/programs.service.ts` | Completed for current upload contract |
| Asset signature, dimensions, size, archive, and safe metadata checks | `apps/api/src/programs/assets.service.ts` | Completed for current upload contract |
| Test Mode replay/reset/cycle/reward rules | `apps/api/src/programs/programs.service.ts`, `tests/unit/program-rules.test.ts` | Completed |
| Publish requires current validation and completed Test Mode | `apps/api/src/programs/programs.service.ts` | Completed |
| Publish idempotency is bound to program identity | `apps/api/src/programs/programs.service.ts`, `tests/unit/program-rules.test.ts` | Completed |
| Tenant and immutability database guards | `packages/database/prisma/migrations/20260728145000_w2_integrity_triggers` | Applied and verified |
| Server-backed Loyalty Studio preview | `tests/e2e/platform.spec.ts`, `screenshots/23-loyalty-studio-preview.png` | Passed |
| Accessibility smoke coverage | `tests/e2e/accessibility.spec.ts` | Passed |
| Production dashboard build | Next production build | Passed |
| Full direct unit suite | Vitest | 163 passed |
| Formatting and lint | Biome | Passed |

## Explicit follow-up items

These are recorded rather than hidden: Pro Mode is currently surfaced as a capability panel while the Quick flow is the fully wired merchant path; autosave/conflict UX is represented by revision-safe server behavior but does not yet have a dedicated autosave editor; the current asset adapter still accepts the existing base64 request contract and records deterministic raw variants rather than performing a full decode/re-encode crop pipeline; and the object-storage abstraction plus MinIO service are present but not yet the active production upload path.

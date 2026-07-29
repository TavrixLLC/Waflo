# W2 Round 4 final compliance matrix

| Gate | Final implementation | Verification |
| --- | --- | --- |
| Publication uses current external state | Publication reloads organization, billing, selected plan, usage, draft graph, locations, selected assets, validation, Test Mode, and all three persisted previews inside the organization lock and serializable transaction. | Concurrency failure tests; HTTP flow; E2E screenshots 49–51 and 58 |
| Organization and billing eligibility | Only `ACTIVE` organizations and the centralized allowed billing states can publish. Stable organization and billing error codes disclose no private suspension reason. | Billing stale-state concurrency test; publication unit policy test |
| Current plan usage and features | Publication permits `usage <= limit`, blocks over-limit program counts, and rechecks Pro, multiple rewards, milestones, PATH, and RING against the current plan. | Unit entitlement tests; concurrency downgrade tests; screenshot 51 |
| Direct and Stripe downgrades | Location, team-seat, and non-archived program usage are checked. Direct downgrade is atomic and blocked; Stripe preserves resources and records over-limit metadata. | Integration direct-plan test; Stripe concurrency test |
| Initial unpublished lifecycle | Initial drafts cannot be abandoned into a dead state. DRAFT, VALIDATED, and TEST programs can be archived without data loss; restore is draft-derived and rechecks limits. | HTTP/concurrency tests; screenshots 52–54 |
| Partial PATCH preservation | One canonical stored-version conversion reconstructs every mutable W2 nested field before overlaying the partial input. | HTTP nested-data regression; screenshot 57 |
| Asset semantic identity | Merchant asset identity is `(organizationId, sha256Digest, category)`. Active replay, cross-category reuse, archive restore/repair, and concurrent replay are deterministic. | Migration, integration/concurrency tests; screenshots 55–56 |
| Material W2 audits | Added version-created, test-reward-redeemed, preview-generated-on-miss, and validation-failed events. State-changing audit writes share their domain transaction. | Audit cardinality and failure-injection tests |
| Policy ownership | Option B selected. W2 and W3-facing publication use stable inactive defaults; typed W4 backlog owns configurable execution semantics. | ADR, typed contract, unit test, Studio wording |
| Stamp visual rule | Primary grids render only `FILLED` and `EMPTY`; milestone artwork, numbers, checks, badges, and replacement icons are ignored/deprecated. | Renderer tests; screenshots 41–47 |
| Reward redemption reset | Goal remains all-filled and reward-ready until redemption. Successful redemption appends history, increments the cycle, resets current progress to zero, and reloads empty. | Unit/concurrency/E2E/accessibility tests; screenshot 48 |
| Database migration and guards | Prisma schema and SQL migration use category-aware asset uniqueness while all prior W1/W2 guards remain active. | Prisma validation, migration status, full database suite |
| Regression and portability | Full format/lint/type/build/test/browser/accessibility gates pass; archive excludes local, generated, secret, and runtime data. | `TEST-SUMMARY.md` and `PORTABLE-HANDOFF.md` |

## Final gate

Every command required by the Round 4 contract exited 0. The implementation remains W2-only.


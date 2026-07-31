# W3 Repair Round 2 final compliance matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| Global Apple update ordering | PASS | PostgreSQL `BIGINT` sequence, serialized allocation, interleaved two-pass test |
| Idempotent Apple command replay | PASS | Existing command is returned before `nextval`; duplicate-event test preserves the sequence |
| Initial Apple issuance | PASS | Database trigger assigns a non-null sequence on Apple pass insertion |
| Google does not consume Apple sequence | PASS | Check constraint requires Google/non-Apple sequence to remain null |
| Updated-serial BigInt parsing | PASS | Decimal-only, nonnegative, PostgreSQL-BIGINT-bounded parser |
| Updated-serial completeness | PASS | No 500-row cap; 502 registered changed passes are returned |
| Transfer invalidation update | PASS | Invalidation allocates a sequence and appears after the prior `lastUpdated` |
| Shared Program lifecycle lock | PASS | Pause, resume, archive, restore, enrollment, transfer, and reconcile use the centralized contract |
| Post-lock revalidation | PASS | Organization, billing, Program, version/open state, Membership, and credential eligibility are re-read as applicable |
| Sync snapshot correctness | PASS | Stable cursor has no `snapshotAt` upper bound; later eligible rows are drained |
| Enrollment/transition races | PASS | Pause/archive/restore service races prove final state invariants |
| Transfer/transition races | PASS | No-email and email-confirmed transfer races prove one active credential and synchronized pass state |
| Lifecycle/worker race | PASS | Issue worker race drains lifecycle jobs and verifies provider-state consistency |
| Manual reconcile persistence | PASS | API claims/creates `ProgramWalletSyncJob` and returns safe job state |
| Reconcile scale/restart/replay | PASS | 502-pass, multi-page, replay, interruption/resume, and concurrent-claim coverage |
| Locale preservation | PASS | English and Arabic chooser links, join pages, and header navigation preserve locale; Arabic remains RTL |
| Production tenant override prevention | PASS | `tenant` query override is accepted only on local development/test hosts |
| Archive hygiene | PASS | Creator and inspector reject caches, runtime artifacts, `tmp/`, logs, and `*.tsbuildinfo` |
| Full automated gate | PASS | 277/277 Vitest; all typecheck/build tasks; final E2E and accessibility runs |
| Secret scan | PASS | 489 source files inspected, zero violations |
| No W4 | PASS | 128 implementation files inspected, zero prohibited W4 findings |
| Apple external certification | PENDING | `APPLE_EXTERNAL_CERTIFICATION_PENDING` |
| Google external certification | PENDING | `GOOGLE_EXTERNAL_CERTIFICATION_PENDING` |


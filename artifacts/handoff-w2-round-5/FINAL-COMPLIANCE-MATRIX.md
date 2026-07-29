# W2 Round 5 final compliance matrix

| Requirement | Final behavior | Verification |
| --- | --- | --- |
| Centralized typed state policy | `decideProgramPublicationState()` exhaustively covers every persisted operational state and distinguishes first from replacement publication. | Unit and database-enum integration tests |
| First publication | `DRAFT`, `VALIDATED`, and `TEST` may publish when all existing W2 preconditions pass; resulting Program and Version are `PUBLISHED`. | Unit, HTTP, concurrency, and E2E |
| Published replacement | Replacement Version becomes `PUBLISHED`; Program stays `PUBLISHED`, `pausedAt` stays null, and original Program `publishedAt` is preserved. | Concurrency and HTTP tests |
| Paused replacement | Replacement Version becomes `PUBLISHED`; Program stays `PAUSED`; exact `pausedAt` and original Program `publishedAt` are preserved. | Concurrency, HTTP, E2E screenshot 61 |
| Explicit Resume | Publishing emits no `program.resumed`. Only the Resume transition changes `PAUSED` to `PUBLISHED` and clears `pausedAt`. | Audit assertions, HTTP, E2E screenshot 62 |
| Archived block | Initial and replacement drafts cannot publish from `ARCHIVED`; HTTP 409 contains `PROGRAM_PUBLICATION_STATE_BLOCKED`, `programStatus`, and `RESTORE_PROGRAM`. | HTTP/concurrency tests; screenshot 59 |
| Suspended block | `SUSPENDED` cannot publish and no private suspension reason is returned. | HTTP/concurrency/race tests; screenshot 60 |
| Scheduled block | `SCHEDULED` cannot publish while scheduling is unavailable. | Unit, HTTP, concurrency, Studio policy |
| Transaction placement | Replay is checked first; state decision runs under the organization advisory lock and serializable publication transaction before command/version mutation. | Concurrency and replay tests |
| Later-state replay | A completed command replays successfully after the Program is later archived; publication/audit cardinality remains one. | Concurrency test |
| Audit metadata | `program.published` includes previous state, resulting state, publication type, and remained-paused flag. | First, paused, and published replacement assertions |
| Archive/publish race | Final Program is never live as `PUBLISHED` after concurrent Archive. | Concurrency test |
| Suspend/publish race | Final Program remains `SUSPENDED` under concurrent system suspension. | Concurrency test |
| Studio guidance | Archived, suspended, and scheduled states disable Publish; archived offers Restore; paused confirmation explains it remains paused. | E2E and accessibility |
| English/Arabic and keyboard | Localized blocked-state copy is exposed through keyboard-focusable disclosure guidance with no serious accessibility violations. | Accessibility passed twice |
| Regression and scope | All W1/W2 tests/builds pass and no W3 implementation is present. | Full gate and no-W3 scan |


# Publication operational-state policy

## Central decision

The typed policy is implemented in:

`packages/contracts/src/program-publication-state.ts`

It is consumed by both `ProgramsService.publish()` and the Merchant Studio. The policy accepts the
current Program operational state and whether a current published Version exists.

| Publication kind | Source Program state | Resulting Program state | Version result |
| --- | --- | --- | --- |
| First | `DRAFT`, `VALIDATED`, `TEST` | `PUBLISHED` | `PUBLISHED` |
| Replacement | `PUBLISHED` | `PUBLISHED` | `PUBLISHED` |
| Replacement | `PAUSED` | `PAUSED` | `PUBLISHED` |

`ARCHIVED`, `SUSPENDED`, and `SCHEDULED` always return a blocked decision. Inconsistent combinations,
such as `PUBLISHED` without a current published Version or `TEST` with one, are also blocked.

## Transaction and replay

The publish command replay lookup remains the first operation under the organization invariant lock
and serializable transaction. A completed command therefore replays even if the Program was
subsequently paused or archived.

For a new command, the operational-state decision runs before the publish command is created and
before any Version or Program mutation.

## Blocked response

Blocked publication returns HTTP 409:

`PROGRAM_PUBLICATION_STATE_BLOCKED`

Safe details contain `programStatus`. Archived Programs additionally contain:

`requiredAction: RESTORE_PROGRAM`

Suspension reasons are never returned.

## Program mutation policy

- First publication sets Program `status=PUBLISHED`, sets Program `publishedAt`, clears
  `pausedAt`, points at the new published Version, and clears the draft pointer.
- Replacement from `PUBLISHED` preserves Program `publishedAt`, keeps `status=PUBLISHED`, and keeps
  `pausedAt=null`.
- Replacement from `PAUSED` preserves Program `publishedAt` and the exact existing `pausedAt`, keeps
  `status=PAUSED`, replaces the published Version pointer, and clears the draft pointer.

The replacement Version itself is always `PUBLISHED`. Paused replacement emits no
`program.resumed`; the explicit Resume transition remains the only operation that makes it live.

## Audit metadata

Every non-replayed `program.published` event records:

- `previousOperationalState`
- `resultingOperationalState`
- `publicationType`
- `remainedPaused`
- existing command, Version, and trial metadata


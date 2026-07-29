# Unpublished program lifecycle

## Initial unpublished program

An initial program with no published version cannot use `Abandon draft`. The API returns
`PROGRAM_INITIAL_DRAFT_ARCHIVE_REQUIRED`, and the Studio presents a safe Archive action with
explanatory copy.

Archiving is supported from `DRAFT`, `VALIDATED`, and `TEST`. It:

- preserves the current draft pointer;
- preserves every version and child record;
- records the lifecycle audit in the same transaction;
- releases the active program entitlement slot.

## Restore

Restore rechecks the current plan limit under the organization lock. An unpublished program is
restored from its active draft state:

| Draft version | Restored program |
| --- | --- |
| `DRAFT` | `DRAFT` |
| `VALIDATED` | `VALIDATED` |
| `TEST_READY` | `TEST` |

An unpublished program is never restored as `PUBLISHED`. Concurrent restores serialize, so only the
number of restores allowed by the current plan can succeed.

## Published program draft

Abandon remains available when a published version remains live. The draft becomes `ABANDONED`, the
published version and operational state remain intact, and no published history is deleted.


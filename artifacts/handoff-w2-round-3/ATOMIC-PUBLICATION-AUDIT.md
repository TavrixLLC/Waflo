# Atomic publication audit

Publication uses the same serializable database transaction for the state transition, idempotency command, trial activation, and audit records.

## Required events

- `program.published`
- `program.version_superseded` when a prior published version is replaced
- `trial.started_by_program_publication` when first publication starts the trial

`AuditService.recordInTransaction()` accepts the active Prisma transaction, so no required publication event is deferred until after commit.

## Transaction outcome

Within one commit boundary, the service:

1. locks and rechecks organization/program/version state;
2. verifies current revision, validation, Test Mode, and command identity;
3. starts the trial when eligible;
4. transitions the selected version to PUBLISHED;
5. transitions the former version to SUPERSEDED when applicable;
6. updates current program pointers;
7. stores the publish command result;
8. inserts all applicable audit rows.

Any failure, including audit insertion, rolls back publication, supersession, trial state, command state, and audit rows together.

## Idempotency

A completed publish command is replayed from its stored result. It does not execute transitions or append audit rows again.

## Regression proof

- Failure injection makes `recordInTransaction()` throw and verifies the version remains unpublished, the trial remains unchanged, the command is absent/uncommitted, and no required audit row exists.
- Replay tests call the same command again and verify one `program.published`, at most one applicable supersession event, and one trial-start event.


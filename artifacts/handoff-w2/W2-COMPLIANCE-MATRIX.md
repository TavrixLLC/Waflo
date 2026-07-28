# W2 compliance matrix

| Area | Evidence | Status |
|---|---|---|
| Normalized program/version domain | Prisma schema and migration `20260728095038_w2_loyalty_studio` | Implemented |
| Draft concurrency | `ProgramsService.update`, revision conflict, partial index migration | Implemented |
| Templates | `apps/api/src/programs/programs.service.ts` | Implemented |
| Stamp rendering | `packages/stamp-engine/src/index.ts` and unit tests | Implemented |
| Asset upload | `apps/api/src/programs/assets.service.ts` | Implemented locally |
| Validation | `ProgramsService.validate` and `ProgramValidationRun` | Implemented |
| Synthetic Test Mode | `ProgramTestSession`/`ProgramTestEvent` services | Implemented |
| Publication/trial | `ProgramsService.publish` and publish-command table | Implemented |
| Wallet issuance/customer enrollment/Flutter | Explicitly excluded | Not in W2 |

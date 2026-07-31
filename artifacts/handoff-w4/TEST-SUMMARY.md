# W4 test summary

Final local gate completed on 2026-07-30 with every recorded command at exit code 0.

| Gate | Result |
| --- | --- |
| Frozen-lockfile install, format and lint | Passed; lint has zero warnings |
| Workspace typecheck | 26/26 workspaces |
| Unit | 12 files, 145 tests |
| Integration | 4 files, 55 tests |
| HTTP boundary | 4 files, 28 tests |
| Concurrency/load | 7 files, 71 tests |
| Full Vitest | 27 files, 299 tests |
| Prisma | Valid; 23 migrations; no pending migration |
| Production build | 26/26 workspaces |
| W1/W2 browser regression | 14/14 |
| W1/W2 accessibility | 3/3 |
| W3 browser + evidence + provider-disabled | 9/9 |
| W3 accessibility | 1/1 |
| W4 E2E run 1 / run 2 | 6/6 and 6/6 |
| W4 accessibility run 1 / run 2 | 2/2 and 2/2 |
| Secret scan | 641 source files, 0 violations |
| No-Flutter scan | 582 source files, 0 Flutter/Dart artifacts |
| Process cleanup | Exit 0; managed ports 3000, 3001, 3002 and 4000 closed |
| Portable archive | Exit 0; 580 entries, 0 forbidden entries |
| Clean extracted install | Exit 0; frozen install, format and lint passed |
| Archive SHA-256 | `d14f063ed3ed486508e5868e8c52cb2399924c8dc9561f2a3ff570ca3845d241` |

Concurrency includes 100 simultaneous compatible same-key stamp requests and distinct-key
serialization. Unit coverage rebuilds a 10,000-event ledger. Controlled tests also cover provider
failure/retry, Redis fail-closed behavior, nonce replay, clock skew, audit rollback, worker lease
recovery, direct database guards and projection drift detection.

The exact core command list, timestamps and exit codes are in
`raw-test-output/quality-gate-summary.json`; per-command and Playwright process logs are in the same
directory. Archive extraction and clean-install evidence is in
`raw-test-output/archive-extraction.log`, and browser command exits are indexed in
`raw-test-output/BROWSER-EXIT-CODES.md`. Production-scale 100,000-row query-plan validation, real
provider outages, and a real backup restore remain staging/production exercises, not local
capacity claims.

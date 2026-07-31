# Process and fixture cleanup

Every Playwright launcher reported that all managed application ports were closed after
its run. Final verification covers ports 3000, 3001, 3002, and 4000. Local Docker
infrastructure started for the real-database gate is stopped after archive creation and
extraction verification. The temporary extracted archive directory was removed after
the 486-file verification completed.

To keep the disposable local Waflo test database usable during repeated gates:

- 2,050 pending/processing/failed Wallet commands belonging only to generated,
  non-seeded test organizations were removed;
- 8 stale prior W3 Browser Circle/Discovery Companion evidence programs were archived;
- 23 stale interrupted `Round 3 %` draft fixtures were archived;
- current W3 fixtures now archive themselves after each browser run;
- isolated W3 evidence and accessibility fixtures temporarily publish their selected
  fixture and restore it to archived state in `finally`.

No seeded merchant/customer business records were deleted. Prior-round screenshot files
accidentally refreshed by regression runs were restored to their repository versions;
Round 2 evidence remains under this handoff only.

See `raw-test-output/process-port-cleanup.txt` for the final port/container check.

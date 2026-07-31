# Operational workers

`@waflo/operational-worker` performs bounded reward expiry, aggregate rebuild, CSV export, privacy
export, erasure, integrity sampling and cleanup. The existing Wallet worker remains responsible
for provider updates and dead-letter behavior.

Work uses status, lease owner, lease expiry, retry count and safe failure codes where commands need
claiming. The `--once` mode is deterministic for deployment probes and evidence. Long-running mode
polls, handles shutdown signals and reports safe diagnostics.

Monitor command age, lease expiry, retries, dead letters and loop failures. Never run unbounded
table scans.


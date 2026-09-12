# Operational workers

`@waflo/operational-worker` performs bounded reward expiry, aggregate rebuild, CSV export, privacy
export, erasure, Apple Sign-In token revocation, integrity sampling and cleanup. Apple revocation
jobs contain only AES-256-GCM ciphertext and encryption context; workers claim them with database
leases, retry with bounded backoff, and erase token ciphertext on success or terminal failure so a
provider outage never blocks local unlink or deletion indefinitely. The existing Wallet worker
remains responsible for Wallet provider updates and dead-letter behavior.

Work uses status, lease owner, lease expiry, retry count and safe failure codes where commands need
claiming. The `--once` mode is deterministic for deployment probes and evidence. Long-running mode
polls, handles shutdown signals and reports safe diagnostics.

Monitor command age, lease expiry, retries, dead letters and loop failures. Never run unbounded
table scans.

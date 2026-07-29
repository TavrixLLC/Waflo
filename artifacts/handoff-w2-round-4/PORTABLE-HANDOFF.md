# Portable source handoff

Archive: `waflo-w2-round-4-portable-source.zip`

SHA-256: `2D624FDDF3B308522D0732CA26B8FD2405A858DD8A93787C22E78FC2231C6FA5`

Checksum file: `waflo-w2-round-4-portable-source.zip.sha256`.

## Exclusion policy

The deterministic archive builder excludes:

- `.git`, dependencies, and package stores;
- `.next`, `dist`, `.turbo`, caches, browser reports, and test results;
- all `artifacts` to prevent recursive evidence/archive inclusion;
- PostgreSQL, Redis, MinIO, Docker, and other runtime-volume data;
- `.env` and every non-example environment variant;
- logs and temporary files.

## Final verification

The inspector lists the real ZIP and rejects forbidden paths. The archive is then extracted into an
isolated temporary directory, where entry count, package metadata, migration, source, test, and
archive scripts are checked.

Exact entry count, checksum, inspection, and extraction results are recorded in
`raw-test-output/archive-creation.log`, `raw-test-output/archive-inspection.log`, and
`raw-test-output/archive-extraction.log`.

Final result: 383 source files, 383 inspected archive entries, zero forbidden entries, and 383
files successfully extracted and verified.

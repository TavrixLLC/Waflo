# Round 5 portable source handoff

Archive: `waflo-w2-round-5-portable-source.zip`

SHA-256: `809F92FFB0494307D19132768974FC0CC5FC9FB0A2E606FE57E17D7ED48B6025`

Checksum file: `waflo-w2-round-5-portable-source.zip.sha256`.

## Exclusions

The deterministic builder excludes Git data, dependencies, package stores, build output, caches,
browser/test output, handoff artifacts, runtime volumes, local environment files, logs, and
temporary files.

## Verification

The final archive is inspected for forbidden entries and extracted into an isolated, verified
temporary directory. Package metadata, the centralized state policy, Round 5 tests, migration
history, and packaging scripts must all be present before extraction passes.

Final SHA-256, entry count, inspection, and extraction results are recorded in:

- `raw-test-output/final-archive-creation.log`
- `raw-test-output/final-archive-inspection.log`
- `raw-test-output/final-archive-extraction.log`

Final result: 386 source files, 386 inspected archive entries, zero forbidden entries, and 386
files successfully extracted and verified.

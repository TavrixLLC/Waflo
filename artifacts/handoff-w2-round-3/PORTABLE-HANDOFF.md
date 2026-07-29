# Portable source handoff

Archive: `waflo-w2-round-3-portable-source.zip`

SHA-256: `97C48B086B34C3DA0475217F8BBF5A1C8894355712C277287E1AF3B555F62718`

Checksum file: `waflo-w2-round-3-portable-source.zip.sha256`.

## Builder policy

The archive builder walks the repository with a deterministic sorted file list and excludes:

- `.git`
- `.pnpm-store`
- `node_modules`
- `.next`
- `dist`
- `.turbo`
- browser/test output
- artifacts and prior archives
- Docker/PostgreSQL/Redis/MinIO runtime volumes
- `.env` and non-example environment variants
- logs and temporary files

The handoff evidence directory is intentionally outside the source ZIP, preventing recursive inclusion of screenshots, raw logs, or the archive itself.

## Inspector policy

The archive inspector lists the actual ZIP and fails if any path contains `.git`, `.next`, `.pnpm-store`, `dist`, runtime volumes, `node_modules`, browser output, test results, `.env`, or a non-example `.env.*`.

The final inspected entry count and forbidden-entry count are in `raw-test-output/final-archive-inspection.log`. The archive was also extracted to a temporary directory; all 378 files extracted, package metadata parsed, and the build, test, check, archive, and inspection scripts were present. See `raw-test-output/final-archive-extraction.log`.

# Portable Source Handoff

Archive: `waflo-w2-round-2-portable-source.zip`

Companion integrity record: `ARCHIVE-CHECKSUM.txt`

The archive contains the repository source plus this final handoff and excludes:

- `.git`;
- dependency directories;
- build/cache/test-result directories;
- local `.env` files;
- production credentials.

Suggested setup after extraction:

1. Copy the example environment file to a local `.env` and provide development values.
2. Install with the repository's pinned pnpm/Node toolchain.
3. Start infrastructure with `pnpm infra:up`.
4. Apply migrations and run `pnpm check`.
5. Run the Chromium and accessibility suites using the repository Playwright runner.

The archive is a source handoff, not a preconfigured production deployment.

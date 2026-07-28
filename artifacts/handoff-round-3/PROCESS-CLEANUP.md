# Round 3 Process Cleanup

`scripts/run-playwright.mjs` owns API, marketing, dashboard, and customer processes, writes unique per-run logs, terminates every child in `finally`, uses a Windows process-tree fallback when needed, and waits until ports `3000`, `3001`, `3002`, and `4000` are closed.

The Round 3 runner writes all raw output to `artifacts/handoff-round-3/raw-test-output/`. Each E2E and accessibility run has a result log with its exit code, plus per-process logs. Final port/process checks are recorded there.

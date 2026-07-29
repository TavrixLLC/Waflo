# Raw output index

The authoritative final records use the `final-*` prefix and all exited 0.

Timestamped `playwright-*` files are the per-service/process logs emitted by the browser runner. They intentionally preserve repair-loop diagnostics as well as the two final passing runs. The final passing wrapper results are:

- `final-e2e-run-1.log`
- `final-e2e-run-2.log`
- `final-a11y-run-1.log`
- `final-a11y-run-2.log`

The initial environment-only Docker failure and the successful unchanged baseline are both retained for traceability:

- `baseline-quality-gate-environment-failure.log`
- `baseline-quality-gate.log`

See `../TEST-SUMMARY.md` for the final result matrix.

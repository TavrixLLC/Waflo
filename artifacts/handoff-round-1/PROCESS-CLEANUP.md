# Playwright Process Cleanup

## Observed failure mode

The prior Playwright `webServer` configuration launched API and Next commands under Windows process ownership that did not consistently track every descendant. Test assertions completed, but teardown could wait indefinitely and leave ports or child processes behind.

## Repair

`scripts/run-playwright.mjs` now:

1. starts the API and three Next servers directly with Node, without an intermediate command shell;
2. waits for each health URL;
3. starts the selected Playwright project with built-in `webServer` disabled;
4. records separate server and result logs;
5. terminates managed children in `finally`;
6. allows a five-second graceful stop before a Windows process-tree fallback;
7. polls ports 3000, 3001, 3002, and 4000 until all are closed;
8. returns the Playwright exit code.

## Verification

Two final E2E runs and two final accessibility runs exited naturally with code 0 and printed `cleanup: all managed ports closed`.

Post-run checks:

- `raw-test-output/post-playwright-port-check.txt`: no listeners on managed ports.
- `raw-test-output/post-playwright-process-check.txt`: no Playwright browser, API, or Next managed processes.

No timeout wrapper was used to manufacture a successful exit.

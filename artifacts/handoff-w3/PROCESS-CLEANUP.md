# Process cleanup and archive inspection

Every managed Playwright run recorded that API, marketing, dashboard, customer web, and Wallet worker processes were stopped and ports 3000, 3001, 3002, and 4000 were closed.

Portable archive creation excludes `.git`, dependency stores, `node_modules`, `.next`, `dist`, caches, runtime volumes/data, test results, artifacts, `.env`, logs, certificates, private keys, service-account files, and provider credentials.

Final archive inspection: **passed**. The archive contains 490 source entries and zero forbidden entries. Creation and inspection logs are `raw-test-output/final-archive-create.log` and `raw-test-output/final-archive-inspection.log`.

Archive SHA-256: `5e0a9518e1e607968dea0d16b10f58de6329d8601da0d0297598b9f67e5f2a07`.

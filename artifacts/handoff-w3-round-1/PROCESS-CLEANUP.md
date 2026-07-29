# Process and port cleanup

Every managed Playwright run reported all managed ports closed. The managed services were API 4000, marketing 3000, merchant dashboard 3001, customer web 3002, and the W3 Wallet worker.

Final checks found no Waflo-managed listener left on those ports. The Playwright launcher terminates its process tree and closes log streams in `finally`, including on failures.

Historical failed diagnostic runs are retained in raw output rather than relabeled as passing. The latest result logs are the authoritative green runs.

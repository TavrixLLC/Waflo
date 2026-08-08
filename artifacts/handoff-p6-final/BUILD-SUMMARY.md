# Build summary

The repository uses Node.js `>=24 <25` and pnpm `11.5.2`; this QA session used Node.js `24.14.1`.

Production configuration keeps the centralized environment-aware CSP. The merchant client defaults to `https://api.waflo.app` in production. Localhost is admitted only for development or the explicit `WAFLO_LOCAL_PRODUCTION_SMOKE=1` test path. The final strict production build removes that local-smoke override.

The strict final build passed all 26 workspace packages through Turbo with forced execution, checking unresolved imports and generated dependencies. A production-served P6 browser smoke then passed 5/5.

The runtime response for `/en/login` was HTTP 200. Its production CSP contains no `unsafe-eval`, `localhost`, or `127.0.0.1`; `https://api.waflo.app` is the production API connect target.

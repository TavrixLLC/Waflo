# Cloudflare edge runbook

Waflo uses a dedicated remotely managed tunnel container per environment. It does not read, edit, restart, or share the host's historical system cloudflared configuration. The token is a regular, non-symlink host file owned by `root:65532` with mode `0440`, mounted at `/run/secrets/cloudflare_tunnel_token`. cloudflared 2026.7.2 runs explicitly as the non-root identity `65532:65532` and reads it through `--token-file`. Host preparation and every deploy or rollback idempotently repair only this file's ownership and mode without rewriting its bytes. The token is absent from the image, Compose command line, container environment, and normal logs.

Configure ingress in the Cloudflare dashboard for the environment's tunnel. Origins are private Compose service DNS names:

## Staging tunnel `waflo-staging`

| Public hostname | Origin service |
|---|---|
| `staging.waflo.app` | `http://marketing-web:3000` |
| `app-staging.waflo.app` | `http://merchant-web:3001` |
| `card-staging.waflo.app` | `http://customer-web:3002` |
| `api-staging.waflo.app` | `http://api:4000` |
| fallback | HTTP 404 |

The staging Marketing Web is authoritative at `https://staging.waflo.app`. Cloudflare routing is configured manually; this repository does not call Cloudflare APIs or require Advanced Certificate Manager or Total TLS.

## Production tunnel

| Public hostname | Origin service |
|---|---|
| `waflo.app` | `http://marketing-web:3000` |
| `www.waflo.app` | `http://marketing-web:3000` |
| `app.waflo.app` | `http://merchant-web:3001` |
| `card.waflo.app` | `http://customer-web:3002` |
| `api.waflo.app` | `http://api:4000` |
| `*.waflo.app` | `http://customer-web:3002` |
| fallback | HTTP 404 |

Keep the exact infrastructure hostnames above before the wildcard published-application route.
The wildcard is the customer loyalty origin only; application tenant resolution rejects reserved,
malformed, unknown, archived, and suspended merchant labels. The matching proxied DNS records must
also keep exact records for `www`, `app`, `api`, and `card`; Cloudflare DNS gives those exact records
precedence over `*.waflo.app`.

Production customer sites are canonical at `https://{merchantSlug}.waflo.app`. Keep
`card.waflo.app` routed for compatibility with existing Wallet and shared customer links. Do not
redirect it until the issued-link and provider callback inventory has been reviewed separately.

### Wildcard cutover (operator-run only)

1. In the production tunnel dashboard, verify the five exact routes above and their current origins.
2. Add `*.waflo.app` to the same production tunnel with origin `http://customer-web:3002`, after all
   exact hostname routes and before the HTTP 404 fallback.
3. Add a proxied wildcard CNAME named `*` pointing to the production tunnel's existing
   `<tunnel-id>.cfargotunnel.com` target. Do not replace or delete any exact DNS record.
4. Confirm Universal SSL is active for the full Cloudflare zone and covers `*.waflo.app`. This
   first-level wildcard does not require a per-merchant certificate.
5. Verify route selection and HTTPS without exposing credentials:

   ```text
   dig +short app.waflo.app
   dig +short today.waflo.app
   curl --fail --silent --show-error https://api.waflo.app/ready
   curl --fail --silent --show-error https://app.waflo.app/en/login
   curl --fail --silent --show-error https://today.waflo.app/
   curl --fail --silent --show-error https://card.waflo.app/privacy
   ```

6. Verify that `app`, `api`, `www`, and `card` still reach their exact services, an unknown tenant
   shows the safe customer not-found state, and a real merchant slug reaches the matching tenant.

Rollback is additive and immediate: remove only the wildcard tunnel route and wildcard DNS record,
then confirm the exact routes above. Do not alter application data, merchant slugs, exact DNS records,
or the compatibility `card.waflo.app` route.

Staging deliberately remains on the shared `card-staging.waflo.app?tenant={slug}` strategy. A host
such as `{slug}.staging.waflo.app` is a deeper hostname than Universal SSL covers in a full zone and
must not be introduced without an explicit certificate and routing design review.

The application returns a permanent `308` from `www.waflo.app` to the canonical
`https://waflo.app` origin while preserving the path and query string. Keep both hostnames routed
to Marketing Web, or enforce the same redirect at Cloudflare before the tunnel. Do not serve
separate indexable copies on both hosts.

Do not add host port publications for these origins. Keep Cloudflare SSL mode, HTTPS redirects, DNS records, access policy, caching exclusions for authenticated/API traffic, and upload/body limits consistent with Waflo's API controls. Do not cache API, dashboard, card-session, OAuth callback, or Wallet update-service responses.

The API trusts only the configured Waflo edge subnet as its immediate proxy. If Compose subnets change, change `TRUSTED_PROXIES` in the same release. Never trust all forwarded headers or all RFC1918 space without an explicit network review.

For multiple servers, run a connector/origin per application node and use Cloudflare Load Balancing or an equivalent health-checked load balancer. Check API `/ready` and real Web pages, add a healthy node before removing an old one, and keep two connectors during cloudflared upgrades. State remains shared and no session affinity is configured.

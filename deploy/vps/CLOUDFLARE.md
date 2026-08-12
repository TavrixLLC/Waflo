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
| fallback | HTTP 404 |

The application returns a permanent `308` from `www.waflo.app` to the canonical
`https://waflo.app` origin while preserving the path and query string. Keep both hostnames routed
to Marketing Web, or enforce the same redirect at Cloudflare before the tunnel. Do not serve
separate indexable copies on both hosts.

Do not add host port publications for these origins. Keep Cloudflare SSL mode, HTTPS redirects, DNS records, access policy, caching exclusions for authenticated/API traffic, and upload/body limits consistent with Waflo's API controls. Do not cache API, dashboard, card-session, OAuth callback, or Wallet update-service responses.

The API trusts only the configured Waflo edge subnet as its immediate proxy. If Compose subnets change, change `TRUSTED_PROXIES` in the same release. Never trust all forwarded headers or all RFC1918 space without an explicit network review.

For multiple servers, run a connector/origin per application node and use Cloudflare Load Balancing or an equivalent health-checked load balancer. Check API `/ready` and real Web pages, add a healthy node before removing an old one, and keep two connectors during cloudflared upgrades. State remains shared and no session affinity is configured.

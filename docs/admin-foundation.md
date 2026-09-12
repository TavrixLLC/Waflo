# Waflo Admin foundation

The internal application is `apps/admin-dashboard` and is intended for `https://admin.waflo.app`.
It authenticates exclusively through `/v1/admin/*` using the dedicated host-only admin session cookie.
Merchant, customer, and Staff Mobile sessions do not grant administrator authority.

## Provision the first administrator

Provisioning is an internal CLI operation. It defaults to a JSON dry run and accepts passwords only
through stdin, never command-line arguments or environment examples.

```powershell
pnpm admin:provision -- --email operator@company.example --display-name "Waflo Operator" --role SUPER_ADMIN --locale EN
```

Review the dry-run JSON. Against the intended database, write explicitly:

```powershell
$credential = Read-Host -AsSecureString "Initial password"
$plain = [System.Net.NetworkCredential]::new("", $credential).Password
$plain | pnpm admin:provision -- --email operator@company.example --display-name "Waflo Operator" --role SUPER_ADMIN --locale EN --write --password-stdin
$plain = $null
```

The command creates no default account or password. Write mode rejects passwords shorter than 12
characters, refuses duplicate normalized email addresses, and writes an audit event. Transfer the
credential through the approved secret-sharing channel and rotate it according to Waflo's internal
access policy.

## Production boundary

- `ADMIN_DASHBOARD_URL=https://admin.waflo.app`
- `ADMIN_COOKIE_NAME=__Host-waflo_admin_session`
- Admin CSRF origin is derived from `ADMIN_DASHBOARD_URL`.
- Admin sessions expire after eight hours and idle after 60 minutes by default.
- The app emits `X-Robots-Tag: noindex, nofollow, noarchive` and disallows all crawling in robots.txt.

Cloudflare/DNS routing to the `admin-web:3003` service remains an operator-managed deployment step.

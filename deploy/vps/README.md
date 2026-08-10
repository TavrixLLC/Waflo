# Waflo VPS production platform

This directory defines the production-capable Waflo runtime. It does not deploy anything by itself. The initial topology is one Ubuntu 24.04 Docker Compose host, but application state is already externalized to PostgreSQL, Redis, and S3-compatible storage so application nodes can be added later without sticky sessions or application redesign.

## Architecture

Cloudflare Tunnel reaches only the `edge` Docker network. API and Web containers publish no host ports. PostgreSQL, Redis, and MinIO exist only on the separate `backend` network, which Docker marks internal. API and workers join both networks for private state access and outbound provider calls. Every staging and production stack has a distinct Compose project name, subnets, credentials, buckets, data paths, and rate-limit namespace.

The initial VPS is a single failure domain. It is not high availability: losing the host loses the application tier and access to its colocated state until restore/recovery. See [SCALE.md](SCALE.md) for the stateful split and multi-node transition.

## Immutable release and image model

Release source lives at `/opt/waflo-platform/releases/<full-git-sha>`. Environment pointers are `/opt/waflo-platform/current/staging` and `/opt/waflo-platform/current/production`; they may point at different releases. Live source is never edited and deployment never performs `git pull` over a running release.

Images are environment-qualified because Next.js public variables are compiled into its browser bundles:

```text
<registry>/waflo-api:<git-sha>-<environment>
<registry>/waflo-merchant:<git-sha>-<environment>
<registry>/waflo-customer:<git-sha>-<environment>
<registry>/waflo-marketing:<git-sha>-<environment>
<registry>/waflo-operational-worker:<git-sha>-<environment>
<registry>/waflo-wallet-worker:<git-sha>-<environment>
<registry>/waflo-migrate:<git-sha>-<environment>
```

Every image also has the OCI revision label and `RELEASE_SHA`. The Dockerfile uses Node 24.14.1, pnpm 11.5.2, a frozen workspace lockfile, one cached build graph, production deploy subsets for Node services, Next standalone output, and non-root runtime users. No `.env`, Git metadata, or secret is copied into images.

## Host layout

```text
/opt/waflo-platform/
  releases/<git-sha>/
  current/{staging,production} -> release
  env/{staging,production}/{compose.env,application.env}
  secrets/{staging,production}/
  data/{staging,production}/{postgres,redis,object-storage}/
  backups/{staging,production}/{postgres,restore-drills}/
  scripts/
```

Run `sudo bash deploy/vps/scripts/prepare-host.sh` once. It creates only this tree; it does not change Docker daemon settings, host firewall, ports, Nginx Proxy Manager, Stalwart, historical Tavrix containers, or the existing system cloudflared configuration.

Before selecting the example subnets, inspect `docker network ls` and `docker network inspect` for overlap. Change `WAFLO_EDGE_SUBNET`, `WAFLO_BACKEND_SUBNET`, and the matching `TRUSTED_PROXIES` together if either example range is already routed. Never use a broad arbitrary forwarded-header trust rule.

## Configuration and secrets

Copy the matching tracked templates to the paths above. `compose.env` and `application.env` are non-sensitive and mode `0640` is suitable. The entire environment secret directory and every file within it must be restricted; deployment enforces mode `0600` for files.

`secrets/<environment>/application.env` holds secret application values. Individual Docker secret files are described in [templates/secrets/README.md](templates/secrets/README.md). PostgreSQL, Redis, object-storage application credentials, encryption keyrings, OAuth secrets, Wallet credentials, Stripe secrets, SMTP password, Sentry DSN, and the Cloudflare token never belong in Git.

All replicas in one environment receive exactly the same active and legacy versioned keyrings. Rotate by adding the new version to each JSON keyring, deploying it everywhere, changing the active version only after every participant can read the new key, and retaining legacy versions until their data is re-encrypted or expired. Do not generate per-node application encryption identities.

## Migration rule

`migrate` is an explicit `tools` profile and never starts with application replicas. `deploy.sh` waits for PostgreSQL and runs one `prisma migrate deploy` container before updating applications. `prisma migrate dev` is absent from deployment artifacts. Application rollback never rolls the schema backward; every migration must therefore remain backward-compatible with the immediately previous application release for the rollback window.

## First staging deploy

1. Review and commit the release outside this task, then create a clean archive named by its full SHA.
2. Install that immutable archive into `/opt/waflo-platform/releases/<sha>`.
3. Copy staging templates, populate all secrets, use test/sandbox provider credentials, and apply restrictive permissions.
4. Configure the remotely managed `waflo-staging` tunnel routes from [CLOUDFLARE.md](CLOUDFLARE.md).
5. Run Compose validation and the production configuration readiness command.
6. Build or pull the immutable images.
7. Run `deploy.sh staging <sha>`. The script starts state, initializes the private bucket/user, migrates once, waits for application health, then advances the staging current pointer.
8. Perform external HTTPS, OAuth, Stripe webhook, SMTP, and Wallet verification. A successful build is not external verification.

## Staging update

Install a new SHA directory without changing the current release. Build/pull its images, run the same validation, then `deploy.sh staging <new-sha>`. Keep at least the prior image and release directory through the rollback window.

## First production deploy

Repeat the staging process with production templates and completely separate credentials, PostgreSQL data, Redis data, bucket, tunnel, provider production modes, and image tags. Do not promote until staging verification and a PostgreSQL restore drill have passed. Run `deploy.sh production <sha>` only after all provider/configuration gates are intentionally satisfied.

## Production update

Prepare and validate a new immutable release, take an off-server-confirmed backup, run one forward migration through `deploy.sh`, wait for `/ready`, then perform domain/provider smoke tests. Do not run concurrent builds on this shared 11 GiB host; `build-images.sh` deliberately builds service targets sequentially.

## Rollback

Run `rollback.sh <environment> <previous-sha>`. It changes application images and the current pointer only. It never invokes Prisma and never reverses schema. If the new schema is not backward-compatible, application rollback is blocked and must be handled as an incident with a forward database repair.

## Provider readiness

| Provider/capability | CODE_READY | CONFIG_READY | EXTERNALLY_VERIFIED | DEPLOYED |
|---|---:|---:|---:|---:|
| Google Sign-In | yes | templates only | no | no |
| Apple Sign-In | yes | templates only | no | no |
| Google Wallet | yes | templates/modes only | no | no |
| Apple Wallet | yes | templates/modes only | no | no |
| Authenticated SMTP | yes | template points to network SMTP | no | no |
| Stripe | yes | templates/test-vs-live gates | no | no |

`CODE_READY` means the code path and configuration validation exist. `CONFIG_READY` is true only after an operator has installed valid environment-specific values. `EXTERNALLY_VERIFIED` requires a real provider transaction/callback. `DEPLOYED` requires the operator to run this platform on a host; this repository task does not do that.

## Validation

Run `pnpm deploy:validate` locally. It renders staging and production with temporary dummy secret files and asserts project isolation, private state, no published host ports, one-shot migrations, externalized tunnel token, and Git-SHA image identity. The unit suite contains matching static deployment assertions.

The API exposes the existing `/health` liveness and `/ready` dependency readiness endpoints. Next containers are checked through real application pages rather than invented health responses. Full provider readiness remains `pnpm readiness:production` with the target environment loaded.

## Mobile compatibility

This platform does not change Flutter, Staff/M2 request or response schemas, command-status schema, stamp payload, or redeem payload. Mobile endpoints are `https://api.staging.waflo.app` and `https://api.waflo.app`.

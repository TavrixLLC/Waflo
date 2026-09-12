# Cost-controlled GitHub release and VPS deployment

This runbook configures the single tracked workflow at `.github/workflows/ci.yml`. It does not put
provider credentials in GitHub or in container images. The first push to
`release/production-v1` validates that exact commit, publishes its immutable GHCR images, and
deploys staging. Production is a later promotion of the same image set by an authorized semantic
`v*` tag; it never rebuilds source.

## Trigger and cost model

| Event | Validation | Image build/push | Deployment |
| --- | --- | --- | --- |
| Pull request to any branch | once | no | no |
| Push to `main` | once | no | no |
| Push to `release/production-v1` | once | missing SHA targets only | staging |
| Push of `vMAJOR.MINOR.PATCH[-suffix]` | no repeat | no | production |

Obsolete validation and pre-deployment image-publish work can be canceled. Staging and production
deployment jobs have separate concurrency locks with `cancel-in-progress: false`, so a newer run
cannot cancel an executing migration or container update. The production tag job first verifies
that the tagged commit is on `release/production-v1` and that every production image already
exists.

The authoritative validation job uses the frozen pnpm store cache and a content-addressed
Turborepo cache. It runs the repository's format, lint, typecheck, complete test, build, migration,
deployment, secret, M2 provenance, browser, accessibility, and production-audit gates once. Browser
diagnostics upload only after failure, expire after three days, and exclude historical evidence.

## Exact GHCR image matrix

`<namespace>` is the lowercase GitHub owner and `<sha>` is the full 40-character `GITHUB_SHA`.

| Build target | Staging tag | Production tag | Build behavior |
| --- | --- | --- | --- |
| Migration | `ghcr.io/<namespace>/waflo-migrate:<sha>-staging` | `ghcr.io/<namespace>/waflo-migrate:<sha>-production` | one invariant manifest, two tags |
| API | `ghcr.io/<namespace>/waflo-api:<sha>-staging` | `ghcr.io/<namespace>/waflo-api:<sha>-production` | one invariant manifest, two tags |
| Operational worker | `ghcr.io/<namespace>/waflo-operational-worker:<sha>-staging` | `ghcr.io/<namespace>/waflo-operational-worker:<sha>-production` | one invariant manifest, two tags |
| Wallet worker | `ghcr.io/<namespace>/waflo-wallet-worker:<sha>-staging` | `ghcr.io/<namespace>/waflo-wallet-worker:<sha>-production` | one invariant manifest, two tags |
| Merchant Web | `ghcr.io/<namespace>/waflo-merchant:<sha>-staging` | `ghcr.io/<namespace>/waflo-merchant:<sha>-production` | two builds because public URLs differ |
| Customer Web | `ghcr.io/<namespace>/waflo-customer:<sha>-staging` | `ghcr.io/<namespace>/waflo-customer:<sha>-production` | two builds because public URLs differ |
| Marketing Web | `ghcr.io/<namespace>/waflo-marketing:<sha>-staging` | `ghcr.io/<namespace>/waflo-marketing:<sha>-production` | two builds; staging contains required noindex behavior |

There are ten build targets, not fourteen builds. API, workers, and migration are built once and
receive both existing Compose tags. The three Web targets have distinct staging and production
outputs. Buildx executes the target graph on one runner and reuses the dependency and workspace
layers. Existing SHA-qualified images are reused on reruns; a missing twin tag for an invariant
image is restored from the existing manifest without rebuilding. No `latest` tag is used.

Every Waflo image receives OCI source, revision, version, and commit-time metadata plus BuildKit
provenance and SBOM attestations. The Docker context excludes `.git`, `.github`, `.env*`, docs,
tests, historical artifacts, generated reports, and dependency/build directories. Build arguments
contain only public URLs, environment identity, and the release SHA. Legal approval state is not
baked into an image or stored in GitHub.

## GitHub repository setup

Before the first release-branch push:

1. In **Settings → Actions → General**, allow GitHub Actions and allow the workflow token to write
   packages. The workflow defaults to `contents: read`; only the image job receives
   `packages: write`. No PAT is stored in Actions for publishing.
2. Do not add a GitHub legal-date variable. The date is environment-scoped non-secret runtime
   configuration on each VPS, and staging intentionally permits it to remain empty while legal
   review is pending.
3. Optionally add repository variable `RELEASE_IMAGE_PLATFORM`. Omit it for the current
   `linux/amd64` default; use `linux/arm64` only after confirming the VPS architecture.
4. Create GitHub Environments named exactly `staging` and `production`.
5. Protect `release/production-v1`: require pull-request review, prevent force pushes/deletion, and
   restrict direct pushes to release operators. This protects staging secrets and GHCR writes.
6. Add a repository ruleset for tags matching `v*`. Restrict tag creation/deletion to release
   operators. Create only `vMAJOR.MINOR.PATCH` or `vMAJOR.MINOR.PATCH-suffix` tags.
7. Add production environment reviewers/approval and deployment-branch restrictions when the
   repository plan exposes those controls. If it does not, the restricted tag ruleset is the
   mandatory approval boundary: an authorized release operator creates the tag only after staging
   E2E approval.
8. After the first image push, confirm each GHCR package is linked to this repository and grants
   this repository Actions access. Keep packages private unless public distribution is intended.

No repository secret is required by the pipeline. `GITHUB_TOKEN` publishes and verifies packages
within the same repository.

The only repository variable recognized by this workflow is optional `RELEASE_IMAGE_PLATFORM`.
There is no repository or GitHub Environment variable named `NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE`.

Configure these variables separately in **both** GitHub Environments:

| Environment variable | Exact meaning |
| --- | --- |
| `VPS_HOST` | DNS name or IPv4 address of that environment's Ubuntu VPS |
| `VPS_USER` | `waflo-deploy-staging` in staging; `waflo-deploy-production` in production |
| `VPS_SSH_PORT` | SSH port, normally `22` |

Configure these secrets separately in **both** GitHub Environments:

| Environment secret | Exact meaning |
| --- | --- |
| `VPS_SSH_PRIVATE_KEY` | Dedicated unencrypted Ed25519 private key for that environment's deployment user |
| `VPS_SSH_HOST_KEY` | Verified `known_hosts` line for `VPS_HOST` and `VPS_SSH_PORT` |

Do not add Google service-account JSON, Apple P12/WWDR files, Stripe keys, pass-auth keyrings,
OAuth/SMTP credentials, application encryption keys, Cloudflare tunnel tokens, database secrets,
or the VPS GHCR pull token to GitHub. They remain under `/opt/waflo-platform/secrets/<environment>/`.

## One-time dedicated SSH identities

Generate two deployment keys on a trusted operator workstation, outside the repository:

```bash
umask 077
ssh-keygen -t ed25519 -a 100 -N '' -C github-waflo-staging \
  -f "$HOME/.ssh/waflo-github-staging"
ssh-keygen -t ed25519 -a 100 -N '' -C github-waflo-production \
  -f "$HOME/.ssh/waflo-github-production"
```

From the reviewed local checkout, copy only the two one-time host scripts through an authenticated
operator connection (this is not the GitHub deployment identity and does not install application
source):

```bash
scp deploy/vps/scripts/prepare-host.sh \
  deploy/vps/scripts/release-deploy-entrypoint.sh \
  root@VPS_HOST:/tmp/
```

On the VPS, as an operator with sudo, prepare Waflo and the isolated users. Replace the two public
key placeholders with the exact contents of the generated `.pub` files:

```bash
sudo apt-get update
sudo apt-get install --yes ca-certificates curl tar
sudo bash /tmp/prepare-host.sh
sudo useradd --create-home --shell /bin/bash waflo-deploy-staging
sudo useradd --create-home --shell /bin/bash waflo-deploy-production

for user in waflo-deploy-staging waflo-deploy-production; do
  sudo install -d -o "$user" -g "$user" -m 0700 "/home/$user/.ssh"
  sudo touch "/home/$user/.ssh/authorized_keys"
  sudo chown "$user:$user" "/home/$user/.ssh/authorized_keys"
  sudo chmod 0600 "/home/$user/.ssh/authorized_keys"
done

printf '%s\n' 'REPLACE_WITH_STAGING_PUBLIC_KEY' | \
  sudo tee /home/waflo-deploy-staging/.ssh/authorized_keys >/dev/null
printf '%s\n' 'REPLACE_WITH_PRODUCTION_PUBLIC_KEY' | \
  sudo tee /home/waflo-deploy-production/.ssh/authorized_keys >/dev/null
sudo chown waflo-deploy-staging:waflo-deploy-staging \
  /home/waflo-deploy-staging/.ssh/authorized_keys
sudo chown waflo-deploy-production:waflo-deploy-production \
  /home/waflo-deploy-production/.ssh/authorized_keys
```

From the same reviewed checkout, install the fixed root entrypoint; do not install it from an
unreviewed branch:

```bash
sudo install -o root -g root -m 0755 \
  /tmp/release-deploy-entrypoint.sh \
  /usr/local/sbin/waflo-release-deploy
sudo rm -- /tmp/prepare-host.sh /tmp/release-deploy-entrypoint.sh
sudo tee /etc/sudoers.d/waflo-release-deploy >/dev/null <<'EOF'
Cmnd_Alias WAFLO_STAGING_DEPLOY = /usr/local/sbin/waflo-release-deploy staging *
Cmnd_Alias WAFLO_PRODUCTION_DEPLOY = /usr/local/sbin/waflo-release-deploy production *
waflo-deploy-staging ALL=(root) NOPASSWD: WAFLO_STAGING_DEPLOY
waflo-deploy-production ALL=(root) NOPASSWD: WAFLO_PRODUCTION_DEPLOY
EOF
sudo chmod 0440 /etc/sudoers.d/waflo-release-deploy
sudo visudo --check --file /etc/sudoers.d/waflo-release-deploy
```

Neither deployment user belongs to the Docker group and neither has general sudo. The stable root
entrypoint verifies `SUDO_USER`, environment, SHA, archive size, paths, links, and required files;
it will not overwrite an existing SHA release directory.

Obtain the SSH host key from a trusted console or separately authenticated operator connection,
verify its fingerprint with the VPS provider, then store the entire output line as
`VPS_SSH_HOST_KEY`. Do not trust an unverified network scan and do not use
`StrictHostKeyChecking=no`.

```bash
ssh-keyscan -p 22 -t ed25519 VPS_HOST
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

## One-time private GHCR pull authentication

Use a dedicated GitHub machine account that can read the repository-linked packages. Create a
classic PAT with `read:packages` only (and authorize its organization SSO if required). Do not grant
`write:packages` or `delete:packages`. From an interactive root-controlled VPS session:

```bash
read -rsp 'GHCR read-only token: ' WAFLO_GHCR_READ_TOKEN
printf '\n'
printf '%s' "$WAFLO_GHCR_READ_TOKEN" | \
  sudo docker login ghcr.io --username REPLACE_WITH_MACHINE_ACCOUNT --password-stdin
unset WAFLO_GHCR_READ_TOKEN
sudo chmod 0700 /root/.docker
sudo chmod 0600 /root/.docker/config.json
```

The credential remains in root's Docker configuration outside the repository. GitHub Actions never
copies it. For public packages authentication is not required, but keeping immutable full-SHA tags
and package access controls is still required.

Set each server's `compose.env` `IMAGE_REGISTRY` to the exact lowercase namespace:

```text
IMAGE_REGISTRY=ghcr.io/<lowercase-owner>
```

Install and permission the existing staging/production configuration and secret contracts before
the workflow runs. In staging, Google is `REAL` plus publishing mode `DEMO`, Stripe uses TEST
objects/keys, Apple uses the real pass signing material and production Wallet APNs, and
`SUPPORT_EMAIL` is a real receiving address. The Waflo-specific cloudflared token remains the
server-side file already referenced by Compose; unrelated host tunnels and Stalwart are untouched.

Legal approval remains a separate release boundary. In
`/opt/waflo-platform/env/staging/application.env`, leave `LEGAL_EFFECTIVE_DATE=` empty while review
is pending; the English and Arabic pages render their explicit review-pending text. After counsel
approves the actual Privacy Policy and Terms, place the approved ISO date in
`/opt/waflo-platform/env/production/application.env` as
`LEGAL_EFFECTIVE_DATE=YYYY-MM-DD`. Do not set it merely to make a deployment pass. A production
deployment with a missing, sentinel, malformed, or impossible calendar date fails before image
pull, migration, or application-container mutation.

## First run and promotion

1. Commit this automation, review it, then push `release/production-v1`.
2. One workflow run validates the pushed `GITHUB_SHA`, publishes only its missing images, and
   serially deploys staging from those images.
3. The remote script pulls before mutation, starts healthy stateful services, runs exactly one
   `prisma migrate deploy`, updates application containers, checks internal readiness, then checks
   the public staging health, readiness, Merchant, and Customer URLs.
4. Only after every check passes does `/opt/waflo-platform/current/staging` advance. On failure the
   job fails, the pointer is unchanged, and bounded diagnostics remain at
   `/opt/waflo-platform/deploy-logs/staging/<sha>.log`.
5. Complete real Google Demo, Apple iPhone/APNs, Stripe TEST/webhook/reconciliation, OAuth, SMTP,
   and Cloudflare staging E2E outside CI.
6. Complete substantive Privacy/Terms legal review, install the approved production effective date
   as described above, and retain `LEGAL_REVIEW_REQUIRED` as an external release blocker until both
   actions are complete.
7. After provider, product, and legal approval, create and push an authorized semantic tag pointing
   to the exact staged SHA:

```bash
git tag -s v1.0.0 <approved-full-40-character-sha>
git push origin v1.0.0
```

8. The tag workflow verifies release-branch ancestry and the existing production image set, waits
   for production environment approval when available, and deploys without rebuilding.

## Rollback and multi-server behavior

Run `rollback.sh <environment> <previous-full-sha>` through an authorized operator session. It
pulls and selects the previous application images, performs readiness/public checks, and advances
the pointer only after success. It never reverses migrations. Rollback is allowed only when the
new schema remains backward-compatible with the prior application; otherwise perform a forward
repair.

Every node in a future application pool uses the same registry namespace and exact full-SHA image
tags. Images contain no machine identity or durable state. Deployment concurrency must remain one
migration per shared database, followed by rolling application-node updates against shared
PostgreSQL, Redis, and object storage.

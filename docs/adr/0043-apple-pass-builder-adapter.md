# ADR 0043: Isolate Apple Pass Builder behind a private adapter service

## Status

Accepted for staging; production activation remains gated by real Apple certificate and device tests.

## Decision

The loyalty domain continues to call `AppleWalletProvider`, which delegates package construction to
the internal `WalletPassGenerator` interface. Real mode can select either the retained legacy
generator or `ApplePassBuilderGenerator` with `APPLE_WALLET_GENERATOR`.

The selected new implementation sends bounded domain personalization over an authenticated private
HTTP API to `apple-pass-builder-service`. That service encodes Apple's pinned protobuf schema and
invokes Apple's pinned `buildpass` CLI with argument arrays. It personalizes a versioned
`.pkpasstemplate`, runs Apple's validator, preflights the configured signing identity, and invokes
Apple's manifest/sign/archive implementation.

The adopted upstream revision is
`8908b955a42da8294ce7506719aa1f186d096c02`. The Swift dependency resolution hash is pinned in the
Dockerfile. A documented one-line compatibility patch is required for Swift 6.3.3/Linux at this
revision.

## Why

- The backend is TypeScript/Node, while Pass Builder is Swift 6.3+.
- Protobuf personalization is an official integration boundary and avoids duplicating Apple's Swift
  model API in application code.
- A private process boundary confines P12/WWDR signing material and early-preview API churn.
- Explicit merchant allowlists plus an optional merchant-to-signing-key map prevent cross-merchant
  identity selection while preserving the platform's current shared Pass Type identity.
- A long-running service provides bounded concurrency, health, metrics, timeout, cleanup, and
  horizontal scaling without spawning the CLI from every API or worker process.
- The feature flag preserves an immediate rollback while production parity is proven.

## Alternatives rejected

- **Direct Swift HTTP service using the library API:** viable later, but requires maintaining a
  custom Swift server against an API with no stability guarantees. It would couple more adapter code
  to preview Swift types without improving current personalization.
- **Invoke `buildpass` directly from the API/worker:** fewer components, but duplicates process,
  temporary-file, certificate, timeout, and observability concerns in two Node workloads and exposes
  signing secrets more broadly.
- **Generate protobuf and run a one-shot CLI container per pass:** strong isolation but excessive
  cold-start and orchestration overhead for synchronous downloads and worker updates.
- **Direct non-Swift language bindings:** Apple publishes protobuf schemas but no supported Node
  binding for the Pass Builder library. Reimplementing bindings would recreate the maintenance risk
  this migration is intended to remove.

## Trade-offs

- Adds one private service and network hop.
- The CLI still launches child processes (`buildpass` and its `zip` helper) per request.
- Base templates are deployment artifacts rather than arbitrary runtime uploads.
- Pass Builder is early preview and the pinned revision currently needs a Linux compilation patch.
- The legacy generator remains temporarily, so custom packaging code cannot be deleted until the
  production exit criteria are met.

## Operational impact

Deploy the service on an internal-only network with read-only root filesystem, a bounded per-pod
tmpfs, mounted secret files, and no public ingress. Scale replicas only from measured latency/CPU.
Roll back by setting `APPLE_WALLET_GENERATOR=legacy` and redeploying the API and Wallet worker while
the legacy signing configuration is still available.

APNs remains a Wallet worker responsibility. Its P12/password can be mounted through the separate
`APPLE_APNS_CERTIFICATE_PATH_OR_BASE64` and `APPLE_APNS_CERTIFICATE_PASSWORD_FILE` settings so the
main API does not need Pass Builder signing material. Legacy pass-certificate settings remain as an
APNs fallback only for the controlled migration window.

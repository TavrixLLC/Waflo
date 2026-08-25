# Apple Pass Builder service deployment

The service is an internal-only adapter around Apple's `buildpass` executable and protobuf
personalization schema. Build it from the repository root:

```sh
docker build -f apps/apple-pass-builder-service/Dockerfile -t waflo/apple-pass-builder:8908b955 .
```

The image pins Apple Pass Builder commit
`8908b955a42da8294ce7506719aa1f186d096c02`, Swift 6.3.3, and both Docker base-image
indexes. It runs as UID/GID `10001`, uses a read-only root filesystem, and needs a bounded tmpfs.
The pinned upstream commit needs the audited
`8908b955-swift-6.3-linux-pointer.patch` compatibility change to compile on Swift 6.3.3/Linux.
The build also verifies the exact upstream `Package.resolved` SHA-256 before compilation.

Copy `apps/apple-pass-builder-service/config/signing-identities.example.json` outside the
repository and update it so its paths match the mounted secrets. The example Compose overlay
mounts these files:

- `/run/secrets/apple-pass-builder-auth-token`
- `/run/secrets/apple-pass-certificate`
- `/run/secrets/apple-pass-certificate-password`
- `/run/secrets/apple-wwdr-certificate`

Never commit the populated identity configuration, certificate, password, or auth token. In
Kubernetes, mount equivalent Secret volumes and expose port 8080 only through a private ClusterIP
or service mesh. The main API and Wallet worker authenticate with the shared service token; public
clients must never reach this service.

Each identity has an explicit `merchantIds` allowlist. Use `"*"` only for the existing shared
Pass Type identity; it must be the sole list entry. When merchants have distinct identities, mount
an API/worker JSON map based on `config/signing-key-map.example.json` through
`APPLE_PASS_BUILDER_SIGNING_KEY_MAP_FILE`. The service rejects a key
whose merchant allowlist, Pass Type Identifier, Team Identifier, or certificate UID/OU does not
match the request.
The current application still supplies one global Pass Type/Team Identifier. The map therefore
supports explicit merchant allowlisting and identity/rotation selection now; different Pass Types
per merchant require the separate domain/update-service work described in the migration report.

Pass Builder owns pass signing only. The Wallet worker still owns APNs and should receive its P12
through `APPLE_APNS_CERTIFICATE_PATH_OR_BASE64` and its password through
`APPLE_APNS_CERTIFICATE_PASSWORD_FILE`. The old pass-certificate variables remain a compatibility
fallback during rollback; do not mount Pass Builder's signing secrets into the API container.

The default tmpfs size is 256 MiB. Each build has an independent `0700` directory that is removed
after success or failure. Scale replicas when measured CPU, queue depth, or generation latency
requires it; do not share temp directories between replicas.

Run the synthetic-chain integration test after building the image:

```sh
pnpm --filter @waflo/wallet-apple build
node scripts/apple-pass-builder-smoke.mjs
```

The test creates ephemeral certificates outside the repository, starts the service read-only,
executes Apple personalization/validation/signing, verifies every manifest hash and the CMS chain,
checks failure cases and concurrency, and removes the fixtures. It is not a substitute for the
staging test with the real Apple Pass Type certificate.

For rotation, add the replacement secret and identity config, verify its UID/OU and expiration in a
new replica's `/health`, generate/install/update a canary pass, then shift traffic. Keep the previous
secret available only for the rollback window. Alert before expiration (recommended at 60, 30, 14,
and 7 days); after the window, remove the old secret and identity entry. Never overwrite a live
mounted P12 in place.

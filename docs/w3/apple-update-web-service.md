# Apple update web service

The API implements Apple registration, unregistration, updated-serial lookup, updated-pass download, and device-log endpoints under `/v1/apple-wallet/v1`.

Registration authenticates the pass authorization token, protects device and push identifiers at rest, and returns Apple-compatible create/already-registered statuses. Updated-serial queries use monotonic update tags. Pass responses support conditional update behavior and correct Wallet MIME types.

The worker queues APNs notifications for active registrations after relevant pass changes. Push tokens are never logged. Permanent APNs failures unregister the protected registration; retriable failures use the Wallet command retry policy.

Transfer queues invalidation and push work for the old serial while the new credential receives a distinct pass identity.

Official source consulted on 2026-07-29: [Adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes).

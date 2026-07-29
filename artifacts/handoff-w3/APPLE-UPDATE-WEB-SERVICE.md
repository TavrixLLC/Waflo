# Apple update web service

Implemented routes cover device registration, unregistration, updated-serial lookup, updated-pass download, and device logs. Authorization tokens are derived and timing-safe checked; device/push values are protected and never logged.

Update tags are monotonic. Updated passes use the Wallet MIME, and worker APNs commands notify active registrations. Transfer invalidation queues a voided old pass and push update.

Official source and access date are recorded in [../../docs/w3/apple-update-web-service.md](../../docs/w3/apple-update-web-service.md).

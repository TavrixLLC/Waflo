# Enrollment idempotency

`EnrollmentCommand` is unique by organization and client idempotency key. It records the Program Version and a canonical request fingerprint. Same-key/same-request retries replay the completed result; same-key/different-request retries return conflict.

The Customer, encrypted contact, consents, Membership, zero projection, active credential, customer session, Wallet pass identities, and Wallet commands are created in the same organization-scoped transaction. Provider failure occurs later and cannot roll back a valid Membership.

Concurrent tests cover identical requests, duplicate form submission, and uniqueness of the active credential.

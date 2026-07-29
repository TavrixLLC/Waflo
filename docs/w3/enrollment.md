# Enrollment

Only an active organization and a published, enrollment-open Program with a current published Program Version can accept enrollment. Billing status is evaluated independently from Wallet-provider availability: a valid membership is not rolled back because a provider is disabled or temporarily unavailable.

The public form requires a display name and the two required consents. Email follows the versioned policy (`HIDDEN`, `OPTIONAL`, or `REQUIRED`). Marketing consent is never preselected and is stored independently.

The client supplies an idempotency key. `EnrollmentCommand` records the tenant, Program, Program Version, request fingerprint, lease, and result. The same key and same fingerprint replay the original result; the same key with a different request returns a conflict. Transactional row locking and uniqueness guards protect concurrent requests.

Successful enrollment creates the complete customer/membership graph, the initial active credential and session, Apple and Google pass identities, and wallet outbox commands. The response contains public identifiers and a private card URL, never internal IDs or raw contact data.

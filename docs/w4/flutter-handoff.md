# Flutter handoff

M1-M4 may consume the OpenAPI document, `packages/contracts/src/w4.ts`, the canonical signature
functions in `@waflo/staff-device-security`, and the durable M2 compatibility bundle in
[`docs/contracts/m2`](../contracts/m2).

The mobile client must generate and protect an Ed25519 private key, scan the pairing QR, sign the
challenge, store opaque session credentials in platform secure storage, and sign every sensitive
request. Retries keep the operation idempotency UUID but create a new nonce and timestamp.

Stable behaviors include QR resolve, issue, redeem, reverse, command recovery, approval polling,
Location context, clock-skew errors, replay conflict and app-version policy. iOS and Android
versions use strict `major.minor.patch` parsing and must meet `STAFF_MOBILE_MINIMUM_APP_VERSION`;
the signed device context returns the recorded and minimum versions. Error codes are
machine-readable; English and Arabic strings belong to the app localization layer.

M2 compatibility is reconstructed over W4 in this authoritative repository. The mobile recovery
route is `GET /v1/staff/operations/commands/:commandId`; it returns only PROCESSING, COMPLETED or
FAILED public command data for the same tenant and Staff device. Wrong-device and cross-tenant
lookups use not-found behavior.

No Flutter source is part of W4.

# Flutter handoff

M1-M4 may consume the OpenAPI document, `packages/contracts/src/w4.ts`, the canonical signature
functions in `@waflo/staff-device-security`, and fixtures in the W4 provider-artifacts handoff.

The mobile client must generate and protect an Ed25519 private key, scan the pairing QR, sign the
challenge, store opaque session credentials in platform secure storage, and sign every sensitive
request. Retries keep the operation idempotency UUID but create a new nonce and timestamp.

Stable behaviors include QR resolve, issue, redeem, reverse, approval polling, Location context,
clock-skew errors, replay conflict and app-version policy. Error codes are machine-readable;
English and Arabic strings belong to the app localization layer.

No Flutter source is part of W4.

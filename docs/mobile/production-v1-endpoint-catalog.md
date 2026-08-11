# Waflo Mobile — Production v1 Endpoint Catalog

## Inventory authority and counts

Counts were independently regenerated from all executable Nest controller route decorators registered at commit `763f2dfccdb24fb9bfa16457f0e49936840e20a1`. There is no global prefix; every path below is the complete path after the API origin.

| Count | Value |
|---|---:|
| **TOTAL API ROUTES INSPECTED** | **178** |
| **DIRECT_MOBILE_REQUIRED** | **9** |
| **DIRECT_MOBILE_OPTIONAL** | **4** |
| **MOBILE_SUPPORTING** | **12** |
| **NOT_FOR_MOBILE** | **153** |
| **MOBILE_RELEVANT_TOTAL** | **25** |

Classes mean:

- `DIRECT_MOBILE_REQUIRED`: required Staff Mobile production flow.
- `DIRECT_MOBILE_OPTIONAL`: useful Staff Mobile diagnostics/recovery or optional reversal.
- `MOBILE_SUPPORTING`: Merchant browser endpoint that provisions/controls Mobile state; Staff Mobile must not call it.
- `NOT_FOR_MOBILE`: another security/product/deployment domain.

## Master catalog

| Method | Route | Mobile Class | Auth | Device | Org | Location | Entitlement | Idempotent | Purpose |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/v1/staff/devices/pairing/claim` | DIRECT_MOBILE_REQUIRED | Pairing token | New key metadata | Token-bound | Pairing-bound | No | One-time | Claim a Merchant-created pairing |
| POST | `/v1/staff/devices/pairing/complete` | DIRECT_MOBILE_REQUIRED | Ed25519 challenge proof | Creates device/session | Pairing-bound | First pairing location | No | One-time | Complete pairing and issue credentials |
| POST | `/v1/staff/devices/session/refresh` | DIRECT_MOBILE_REQUIRED | Signed Staff device | Active/unexpired session | Derived | Derived | No | Rotation, one winner | Replace session/token bundle |
| POST | `/v1/staff/devices/session/logout` | DIRECT_MOBILE_REQUIRED | Signed Staff device | Active/unexpired session | Derived | Derived | No | No after success | Revoke current session |
| GET | `/v1/staff/device-context` | DIRECT_MOBILE_REQUIRED | Signed Staff device | Active/unexpired session | Derived | Derived | No | Read-only | Read authoritative context/version support |
| POST | `/v1/staff/memberships/resolve` | DIRECT_MOBILE_REQUIRED | Signed Staff device | Active assigned device | Credential must match | Earning eligibility | Effective billing/card state | Read-only | Resolve scanned member and Loyalty Card state |
| POST | `/v1/staff/operations/stamps` | DIRECT_MOBILE_REQUIRED | Signed Staff device | Active earning assignment | Credential must match | Derived earning location | Effective billing/policy | Required command UUID | Issue stamps |
| POST | `/v1/staff/operations/redeem` | DIRECT_MOBILE_REQUIRED | Signed Staff device | Active redemption assignment | Credential/entitlement match | Derived redemption location | Reward + approval policy | Required command UUID | Redeem reward |
| GET | `/v1/staff/operations/commands/:commandId` | DIRECT_MOBILE_REQUIRED | Signed Staff device | Must be originating device | Derived | None additional | No | Read-only | Recover command status/result |
| POST | `/v1/staff/devices/pairing/challenge` | DIRECT_MOBILE_OPTIONAL | Pairing public ID | Claimed pairing | Pairing-bound | Pairing-bound | No | Read-only recovery | Re-read deterministic live challenge |
| POST | `/v1/staff/operations/reverse` | DIRECT_MOBILE_OPTIONAL | Signed Staff device | Active; actor/device rules | Derived | Derived | Current operation rules | Required command UUID | Append compensating reversal |
| GET | `/v1/staff/operations/:operationPublicId` | DIRECT_MOBILE_OPTIONAL | Signed Staff device | Any active device in org | Derived | None additional | No | Read-only | Read operation by public ID |
| GET | `/health` | DIRECT_MOBILE_OPTIONAL | Public | No | No | No | No | Read-only | Optional API diagnostics, not readiness dependency |
| GET | `/v1/organizations/:organizationId/staff-devices` | MOBILE_SUPPORTING | Merchant cookie | Administers devices | Path + membership | Lists assignments | `devices.view` | Read-only | List paired devices |
| GET | `/v1/organizations/:organizationId/members/:memberId/location-assignments` | MOBILE_SUPPORTING | Merchant cookie | Target member | Path + membership | Lists Staff authority | `devices.view` | Read-only | List assignment lifecycle |
| PUT | `/v1/organizations/:organizationId/members/:memberId/location-assignments/:locationId` | MOBILE_SUPPORTING | Merchant cookie + CSRF | Target member/devices | Path + membership | Active path Location | `devices.pair` | Idempotent representation update | Provision/update assignment |
| DELETE | `/v1/organizations/:organizationId/members/:memberId/location-assignments/:locationId` | MOBILE_SUPPORTING | Merchant cookie + CSRF | Revokes affected sessions | Path + membership | Path Location | `devices.pair` | Idempotent revocation | Revoke assignment/access |
| POST | `/v1/organizations/:organizationId/device-pairing-sessions` | MOBILE_SUPPORTING | Merchant cookie + CSRF | Selects target | Path + membership | Explicit authorized list | `devices.pair` | No; one active attempt | Create pairing QR |
| GET | `/v1/organizations/:organizationId/device-pairing-sessions/:sessionId` | MOBILE_SUPPORTING | Merchant cookie | Pairing state | Path + membership | Stored | `devices.view` | Read-only | Poll pairing state |
| POST | `/v1/organizations/:organizationId/device-pairing-sessions/:sessionId/cancel` | MOBILE_SUPPORTING | Merchant cookie + CSRF | Pairing state | Path + membership | Stored | `devices.pair` | State transition | Cancel active pairing |
| POST | `/v1/organizations/:organizationId/staff-devices/:deviceId/revoke` | MOBILE_SUPPORTING | Merchant cookie + CSRF | Target device | Path + membership | Stored | `devices.revoke` | State transition | Revoke device/sessions |
| POST | `/v1/organizations/:organizationId/staff-devices/:deviceId/mark-compromised` | MOBILE_SUPPORTING | Merchant cookie + CSRF | Target device | Path + membership | Stored | `devices.revoke` | State transition | Mark compromised and revoke sessions |
| GET | `/v1/organizations/:organizationId/operation-approvals` | MOBILE_SUPPORTING | Merchant cookie | Referenced device | Path + membership | Referenced | `operations.manager_approve` | Read-only | List approval queue/history |
| POST | `/v1/organizations/:organizationId/operation-approvals/:approvalId/approve` | MOBILE_SUPPORTING | Merchant cookie + CSRF | Bound device | Path + membership | Bound | `operations.manager_approve` | One winning decision | Approve pending redeem request |
| POST | `/v1/organizations/:organizationId/operation-approvals/:approvalId/reject` | MOBILE_SUPPORTING | Merchant cookie + CSRF | Bound device | Path + membership | Bound | `operations.manager_approve` | One winning decision | Reject pending redeem request |

## Cross-cutting wire rules

Unless a subsection says `Public`, direct Staff endpoints require the complete signed header set from the [master contract](production-v1-backend-contract.md#signed-transport-envelope). Organization, location, staff membership, and device are derived from that session; no organization/location request header is accepted as authority. Signed route defaults additionally limit 60 requests/minute/device and 600/hour/staff; the route-specific limit, when present, is listed below. The global limit is 120/minute across configured IP/account/organization dimensions.

All JSON objects with a documented schema are strict: unknown keys produce `VALIDATION_FAILED`/422. All normal JSON successes are wrapped:

```json
{"data":{"example":"endpoint-specific object"},"requestId":"00000000-0000-4000-8000-000000000099"}
```

All errors are wrapped as `{ "error": { "code", "message", "details"?, "requestId" } }`. All responses are `Cache-Control: no-store`; Mobile must not persist endpoint bodies as authorization or balance authority. ISO timestamps are strings. UUID parameters and fields are UUID strings. All examples are fabricated and tokens/QRs are visibly non-functional placeholders.

Merchant supporting endpoints use the production `__Host-waflo_session` opaque cookie, current active Merchant session, organization membership, and named permission. Mutating endpoints additionally require an allowed `Origin`, `waflo_csrf` cookie, and matching `x-csrf-token`. They are browser-only; Mobile must never reproduce this flow.

### Exact common failure sets

References to these named sets in endpoint subsections mean every code/status shown here; they are not placeholders.

| Set | Exact HTTP/code contract |
|---|---|
| `PUBLIC_COMMON` | `VALIDATION_FAILED` 422 for Zod/path/query/body validation; `RATE_LIMITED` 429; `RATE_LIMIT_STORAGE_UNAVAILABLE` 503 in production; `INTERNAL_ERROR` 500 for an unhandled exception |
| `SIGNED_COMMON` | All `PUBLIC_COMMON`, plus `STAFF_DEVICE_SIGNATURE_INVALID` 401, `STAFF_DEVICE_BODY_DIGEST_INVALID` 401, `STAFF_DEVICE_CLOCK_SKEW` 401, `STAFF_DEVICE_NOT_ACTIVE` 401, `STAFF_USER_DEACTIVATED` 401, `STAFF_MEMBERSHIP_INACTIVE` 401, `STAFF_DEVICE_REVOKED` 401, `STAFF_LOCATION_ASSIGNMENT_INVALID` 401, `STAFF_APP_VERSION_UNSUPPORTED` 426, and `STAFF_DEVICE_NONCE_REPLAYED` 409 |
| `MERCHANT_COMMON_GET` | `AUTH_REQUIRED` 401, `SESSION_EXPIRED` 401, `ORGANIZATION_ACCESS_DENIED` 403, `PERMISSION_DENIED` 403, `VALIDATION_FAILED` 422, `RATE_LIMITED` 429, `RATE_LIMIT_STORAGE_UNAVAILABLE` 503, `INTERNAL_ERROR` 500 |
| `MERCHANT_COMMON_MUTATION` | All `MERCHANT_COMMON_GET`, plus `CSRF_REJECTED` 403 |
| `MUTATION_COMMAND` | `OPERATION_COMMAND_ID_INVALID` 422; `OPERATION_IDEMPOTENCY_CONFLICT`, `OPERATION_IN_PROGRESS`, `OPERATION_CLAIM_MISSING`, `OPERATION_CLAIM_LOST`, `CONCURRENT_MODIFICATION_RETRY`, `PROJECTION_DRIFT_DETECTED`, and replayed `OPERATION_FAILED` are 409; a first unhandled failure is `INTERNAL_ERROR` 500 and its command status can retain `safeFailureCode: "OPERATION_FAILED"` |
| `OPERATIONAL_EARN` | `LOCATION_NOT_AUTHORIZED`/`STAFF_ASSIGNMENT_REQUIRED` 403; `OPERATION_BILLING_BLOCKED`, `LOCATION_EARNING_DISABLED`, policy-origin `PROGRAM_NOT_OPERATIONAL`, `MEMBERSHIP_NOT_OPERATIONAL`, and `PROGRAM_VERSION_MISMATCH` 422; an explicit missing/inconsistent program or membership check can emit the same program/member/version codes as 404 or 409 at the stage stated by the endpoint |
| `OPERATIONAL_REDEEM` | `LOCATION_NOT_AUTHORIZED`/`STAFF_ASSIGNMENT_REQUIRED` 403; `OPERATION_BILLING_BLOCKED`, `LOCATION_REDEMPTION_DISABLED`, and policy-origin program/member/version codes 422; explicit missing/inconsistent state can be 404 or 409 as stated by the endpoint |

The status can therefore legitimately differ for the same machine code when it identifies credential lookup (`404`), a transactional state change (`409`), or a policy denial (`422`). Mobile branches on the code and uses the status for authentication/retry class; it must not assume one global status where source has multiple throw sites.

## Direct Mobile required endpoints

### `POST /v1/staff/devices/pairing/claim`

- **Use:** first-launch claim after scanning a pairing QR. Public/CSRF-skipped; rate limit 10/minute. No signed session or idempotency header yet.
- **Body:** strict `{ pairingToken: string(80..512), installationId: trimmed string(16..160), publicKey: string(40..1024), platform: "IOS"|"ANDROID"|"TEST_CLIENT", appVersion: trimmed string(1..40), osVersion?: trimmed string(max 80), model?: trimmed string(max 120) }`. Key is Ed25519 SPKI PEM or base64 DER. iOS/Android app version is strict semver and must meet server minimum. `TEST_CLIENT` is non-production only.
- **Success 200:** `{ pairingPublicId: UUID, challenge: string, challengeExpiresAt: ISO timestamp, signatureAlgorithm: "Ed25519", message: string }`. Sign the exact returned `message`; do not reconstruct a different string.
- **State/side effects:** atomically changes one unexpired matching environment-bound session from `PENDING` to `CLAIMED`, binds installation/key/metadata, stores a two-minute challenge, and audits. Token is one-use; concurrent claims have one winner.
- **Errors:** `PUBLIC_COMMON`; `DEVICE_PAIRING_INVALID` 422, `DEVICE_PAIRING_EXPIRED` 410, `DEVICE_PAIRING_ALREADY_USED` 409, `STAFF_APP_VERSION_UNSUPPORTED` 426, and `STAFF_DEVICE_NOT_ACTIVE` 403 when `TEST_CLIENT` is forbidden. Structurally valid bad key material can currently become `INTERNAL_ERROR` 500.
- **Retry/cache/test:** do not retry after an ambiguous successful claim by rescanning/reclaiming; call the optional challenge endpoint with the returned pairing UUID. Never cache or log token/challenge/message. Physical test required.

Safe shape:

```json
{
  "pairingToken": "FAKE-OPAQUE-PAIRING-TOKEN-................................................................",
  "installationId": "install-fake-00000001",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nFAKE-NOT-A-KEY\n-----END PUBLIC KEY-----",
  "platform": "ANDROID",
  "appVersion": "1.0.0",
  "model": "Test handset"
}
```

### `POST /v1/staff/devices/pairing/complete`

- **Use/auth:** prove key control and create trusted device/session. Public/CSRF-skipped; rate limit 10/minute.
- **Body:** strict `{ pairingPublicId: UUID, challenge: string(32..256), signature: base64url string(40..256), displayName?: trimmed string(1..120) }`.
- **Success 200:** `{ device: { publicId: UUID, displayName: string, platform: "IOS"|"ANDROID"|"TEST_CLIENT", status: "ACTIVE" }, session: { id: UUID, token: opaque string, refreshToken: opaque base64url string, expiresAt: ISO }, context: { organizationId: UUID, role: "OWNER"|"MANAGER"|"STAFF", locationId: UUID } }`.
- **State/side effects:** under the pairing lock verifies exact challenge/signature, active member and locations; creates device/location rows and session; first pairing location becomes session location; marks pairing `COMPLETED`; audits. Tokens are returned only here.
- **Errors:** `PUBLIC_COMMON`; `DEVICE_PAIRING_EXPIRED` 410, `DEVICE_PAIRING_INVALID` 422, and `STAFF_ASSIGNMENT_REQUIRED` 403 for an inactive target member or 422 for absent stored location. A concurrent second completion observes the no-longer-`CLAIMED` row and receives `DEVICE_PAIRING_EXPIRED` 410. A bad cryptographic signature currently maps to `INTERNAL_ERROR` 500.
- **Retry/cache/test:** one-time, not safely repeatable after success. If response is lost, do not assume credentials exist locally; Merchant checks pairing state and revokes the created device if necessary, then starts a fresh pairing. Store result atomically in secure storage. Physical test required.

### `POST /v1/staff/devices/session/refresh`

- **Use/auth/context:** proactive rotation while the current signed access session remains active and unexpired. Full signed headers, exact JSON digest; org/location/device are derived. Default signed rate limits.
- **Body:** strict `{ refreshToken: string(40..512) }`.
- **Success 200:** `{ session: { id: UUID, token: opaque string, refreshToken: opaque base64url string, expiresAt: ISO } }`.
- **Side effects/concurrency:** atomically revokes old session and creates replacement with the same device/member/location/metadata. One concurrent refresh wins; old access and refresh values cease to work.
- **Errors:** `SIGNED_COMMON`; the refresh token/session rotation checks specifically use `STAFF_DEVICE_NOT_ACTIVE` 401, and body shape failures use `VALIDATION_FAILED` 422. There is no after-expiry refresh path.
- **Retry/cache/test:** never resend a refresh known to have succeeded. On ambiguous loss, old bundle may already be revoked and the new secret is unrecoverable; re-pair. Replace secure bundle only on confirmed success. Physical expiry/rotation test required.

### `POST /v1/staff/devices/session/logout`

- **Use/auth:** signed current session; empty body digest; no JSON fields.
- **Success:** `204 No Content`, not a wrapped JSON body.
- **Side effect:** revokes current session. A repeat request is unauthenticated.
- **Errors:** `SIGNED_COMMON`.
- **Retry/cache/test:** clear local secrets regardless of network result. For guaranteed lost-device invalidation use supporting device revoke. Physical test required.

### `GET /v1/staff/device-context`

- **Use/auth:** post-pair/relaunch context validation. Signed GET with SHA-256 of empty body. No query/path parameters.
- **Success 200:** `{ organizationId: UUID, role: "OWNER"|"MANAGER"|"STAFF", locationId: UUID, devicePublicId: UUID, deviceSessionId: UUID, platform: "IOS"|"ANDROID"|"TEST_CLIENT", appVersion: string(1..40), minimumSupportedAppVersion: strict semver, appVersionSupported: true, requestId: string(1..160) }`.
- **Side effects:** updates activity/nonce bookkeeping only; it does not switch context.
- **Errors:** `SIGNED_COMMON`, including `STAFF_APP_VERSION_UNSUPPORTED` 426.
- **Retry/cache/test:** read-only and retriable with a new signed envelope. Keep only short-lived UI context; physical relaunch/revocation/version tests required.

### `POST /v1/staff/memberships/resolve`

- **Use/auth/context:** send a complete scanned customer credential. Signed; route limit 120/minute. Requires active organization, member/device/session, effective billing, published enrolled Loyalty Card/version, active credential/membership, staff/device location assignment, and earning-enabled location.
- **Body:** strict `{ qrPayload: string(40..220) }`; raw opaque QR text, no client parsing.
- **Success 200:** strict object:
  - `membershipPublicId` trimmed string(8..80), `membershipStatus` `ACTIVE|SUSPENDED|EXPIRED|REVOKED`, `customerDisplayName` string(1..160), `programName` string(1..120), `locale` `en|ar`;
  - nonnegative integer `progress`, positive integer `goal`, boolean `rewardReady`, nonnegative `completedCycles`/`projectionVersion`;
  - `locationEligibility: { earning: boolean, redemption: boolean }`;
  - `operationLimits: { maximumStampsPerOperation: positive int, maximumStampsPerCustomerPerDay: positive int|null, dailyRemainingStamps: nonnegative int|null }`;
  - `operationalTimezone` string(1..100), `operationalDate` `YYYY-MM-DD`;
  - `purchaseRequirement: { required: boolean, minimumAmountMinor: nonnegative int|null, currency: uppercase 3-letter string|null }`;
  - `stampVisuals: { filled: { state: "FILLED", contentDigest: 64-lower-hex|null }, empty: { state: "EMPTY", contentDigest: 64-lower-hex|null } }`;
  - `availableRewards[]: { publicId: UUID, name: string(1..120), description: string(max 240), threshold: positive int, finalReward: boolean, status: "AVAILABLE"|"PARTIALLY_REDEEMED", redemptionCount: nonnegative int, maximumRedemptionCount: positive int, expiresAt: ISO|null, requiresManagerApproval: boolean }`.
- **Successful status value:** although the schema retains `ACTIVE|SUSPENDED|EXPIRED|REVOKED` compatibility, current operational eligibility rejects non-active memberships before success, so an executable successful resolve returns `membershipStatus: "ACTIVE"`.
- **Errors:** `SIGNED_COMMON` and `OPERATIONAL_EARN`. Initial malformed/forged/expired/revoked/transferred/wrong-org credential lookup is `MEMBERSHIP_CREDENTIAL_INVALID` 404. A loaded-but-nonoperational membership is `MEMBERSHIP_NOT_OPERATIONAL` 409 before policy evaluation or 422 from policy.
- **Retry/cache/test:** read-only and retriable with new signature. No persistent balance cache. Physical valid, invalid, cross-org, location, billing, and Apple/Google Wallet tests required.

### `POST /v1/staff/operations/stamps`

- **Use/auth/context:** signed online mutation; route limit 120/minute; UUID `x-idempotency-key` required. Server derives org/location/device. Earning assignment, active membership/credential/card, effective billing, and stamp/purchase/daily/risk rules are transactional preconditions.
- **Body:** strict `{ qrPayload: string(40..220), amount: int(1..30), purchaseAmountMinor?: int(0..2147483647), purchaseCurrency?: 3 letters (trimmed/uppercased), merchantTransactionReference?: trimmed string(1..120) matching Unicode letters/numbers plus space and ._:/-, managerOverride?: { approvalPublicId: UUID, dailyCap?: boolean=false, purchasePolicy?: boolean=false, reason: trimmed string(3..500) }, clientObservedAt?: ISO datetime }`.
- **Security normalization:** QR is fingerprinted by SHA-256. Merchant reference is NFKC/trim/collapsed-space/uppercase then HMACed; same org/program/location/key-version/reference blocks another stamp for 24 hours. `managerOverride` is accepted for compatibility but always `permitted: false`; omit it.
- **Success 200:** `{ operationPublicId: UUID, commandId: UUID, replayed: boolean, beforeProgress: nonnegative int, progress: nonnegative int, goal: positive int, rewardReady: boolean, completedCycles: nonnegative int, projectionVersion: nonnegative int, unlockedRewards: [{ publicId: UUID, threshold: positive int, status: string(1..40), final: boolean }], requestId: string|null }`.
- **Side effects/concurrency:** durable command, ledger `STAMP_ISSUED`, threshold entitlement(s), projection, Wallet outbox, audit and risk history in one serializable transaction. Cross-device requests serialize.
- **Errors:** `SIGNED_COMMON`, `MUTATION_COMMAND`, and `OPERATIONAL_EARN`; initial credential lookup `MEMBERSHIP_CREDENTIAL_INVALID` 404, credential changed after command claim `MEMBERSHIP_CREDENTIAL_INVALID` 409, explicit missing stamp policy `PROGRAM_NOT_OPERATIONAL` 409; `STAMP_AMOUNT_INVALID`, `STAMP_OPERATION_LIMIT_EXCEEDED`, `PURCHASE_AMOUNT_REQUIRED`, `PURCHASE_CURRENCY_MISMATCH`, `PURCHASE_THRESHOLD_NOT_MET` 422; `DAILY_STAMP_LIMIT_REACHED`, `FINAL_REWARD_PENDING_REDEMPTION`, and `RISK_HARD_BLOCK` 409.
- **Retry/cache/test:** exact same semantic body/key is safely replayable; changed body conflicts. Never use a new key after ambiguous transmit until status+resolve. No offline queue or optimistic progress. Physical goal/retry/concurrency/policy tests required.

### `POST /v1/staff/operations/redeem`

- **Use/auth/context:** signed online mutation; route limit 120/minute; UUID `x-idempotency-key`. Requires active membership/card, redemption assignment, effective billing, matching available unexpired entitlement, and approval only where reward policy requires it.
- **Body:** strict `{ qrPayload: string(40..220), rewardEntitlementPublicId: UUID, managerApprovalPublicId?: UUID, note?: trimmed string(max 240) }`.
- **Fingerprint:** server-owned canonical SHA-256 binds version, `REDEEM`, command/idempotency key, organization, customer/membership, QR credential digest, Loyalty Card/program and pinned version, entitlement internal/public identity, reward definition, threshold/cycle/redemption limits and approval policy, requesting Staff membership, originating device, Location, and normalized note. The approval public ID is deliberately excluded. Mobile never computes or submits this fingerprint.
- **Success 200:** `{ operationPublicId: UUID, commandId: UUID, replayed: boolean, redemptionPublicId: UUID, rewardStatus: "REDEEMED"|"PARTIALLY_REDEEMED", finalReward: boolean, beforeProgress: nonnegative int, progress: nonnegative int, goal: positive int, rewardReady: boolean, completedCycles: nonnegative int, projectionVersion: nonnegative int, requestId: string|null }`.
- **Approval issuance 409:** first exact approval-required request omits `managerApprovalPublicId`. The server reserves the command and creates one five-minute `PENDING` request, then returns `MANAGER_APPROVAL_REQUIRED` with `details: { approvalRequest: { publicId, status, expiresAt }, operationType: "REDEEM", retryWithSameIdempotencyKey: true }`. Mobile protects the exact payload/key/public ID and waits for Merchant Web. No internal ID or fingerprint is exposed.
- **Approval retry/side effects:** after Merchant approval, the originating device retries the same semantic body/key with the returned `managerApprovalPublicId`. Requester/approver/device/Location/assignment/entitlement/policy bindings are revalidated. Conditional `APPROVED → CONSUMED` and ledger/redemption/projection/history/outbox/audit occur atomically. An exact timeout retry replays stored success without another consumption.
- **Errors:** `SIGNED_COMMON`, `MUTATION_COMMAND`, and `OPERATIONAL_REDEEM`; initial credential lookup `MEMBERSHIP_CREDENTIAL_INVALID` 404; explicit missing entitlement `REWARD_NOT_AVAILABLE` 404 while policy-state unavailable is 422; `REWARD_EXPIRED` 422, `REWARD_ALREADY_REDEEMED` 409, explicit missing policy `PROGRAM_NOT_OPERATIONAL` 409, and reward/card mismatch `PROGRAM_VERSION_MISMATCH` 409. Approval codes are `MANAGER_APPROVAL_REQUIRED` 409, `MANAGER_APPROVAL_PENDING` 409, `MANAGER_APPROVAL_REJECTED` 409, `MANAGER_APPROVAL_EXPIRED` 410, `MANAGER_APPROVAL_CONSUMED` 409, `MANAGER_APPROVAL_MISMATCH` 409, `MANAGER_APPROVAL_INVALID` 409, `MANAGER_APPROVAL_APPROVER_INACTIVE` 409, and `MANAGER_APPROVAL_NOT_APPLICABLE` 422.
- **Retry/cache/test:** same key/semantic intent replays or advances the reserved approval flow; changed semantics conflict. Never switch keys during pending/ambiguous recovery. Final reward success must render progress 0, rewardReady false, cycles incremented, all EMPTY. Direct and approval-required physical redemption are required.

Fabricated, non-functional mutation example:

```http
POST /v1/staff/operations/stamps HTTP/1.1
Authorization: Device FAKE-NOT-A-TOKEN
x-waflo-device-id: 00000000-0000-4000-8000-000000000011
x-waflo-device-session-id: 00000000-0000-4000-8000-000000000012
x-waflo-request-id: 00000000-0000-4000-8000-000000000013
x-waflo-timestamp: 2026-08-11T12:00:00.000Z
x-waflo-nonce: FAKE-NONCE-0001
x-waflo-body-sha256: 0000000000000000000000000000000000000000000000000000000000000000
x-waflo-signature: FAKE-NOT-A-SIGNATURE
x-idempotency-key: 00000000-0000-4000-8000-000000000014
Content-Type: application/json

{"qrPayload":"FAKE-OPAQUE-QR-NOT-A-CREDENTIAL-0000000000000001","amount":1}
```

The fake digest/signature above deliberately do not verify. A real client hashes the exact final JSON bytes and signs the canonical envelope; it must never copy literal example credential material.

### `GET /v1/staff/operations/commands/:commandId`

- **Use/auth:** originating-device recovery. Signed GET; `commandId` is the mutation's UUID idempotency key. Same organization **and same actor device** are required. No query/body.
- **Success 200:** `{ commandId: UUID, operationPublicId: UUID, operationType: "ISSUE_STAMP"|"REDEEM_REWARD"|"REVERSE_STAMP"|"REVERSE_REDEMPTION"|"MANUAL_ADJUSTMENT"|"SUSPEND_MEMBERSHIP"|"RESTORE_MEMBERSHIP"|"REVOKE_MEMBERSHIP"|"EXPIRE_REWARD", status: "PROCESSING"|"COMPLETED"|"FAILED", result: StampResult|RedeemResult|ReverseResult|null, safeFailureCode: string(1..120)|null, createdAt: ISO, completedAt: ISO|null }`.
- **Errors:** `SIGNED_COMMON`; `OPERATION_COMMAND_ID_INVALID` 422 for a bad UUID and `OPERATION_NOT_FOUND` 404 for absent/wrong-org/wrong-device command.
- **Retry/cache/test:** read-only; retry/poll with new signed envelope/backoff. Result is authoritative recovery data but still `no-store`. Physical ambiguous-timeout and wrong-device tests required.

## Direct Mobile optional endpoints

### `POST /v1/staff/devices/pairing/challenge`

- **Use/auth:** public recovery after a successful claim; rate 20/minute. Strict body `{ pairingPublicId: UUID }`.
- **Success 200:** `{ pairingPublicId: UUID, challenge: string, challengeExpiresAt: ISO, message: string }`. It deterministically validates and returns the existing two-minute challenge; it does not extend expiry or issue a new challenge.
- **Errors:** `PUBLIC_COMMON`; `DEVICE_PAIRING_EXPIRED` 410 and `DEVICE_PAIRING_INVALID` 422.
- **Retry/cache/test:** read-only while `CLAIMED`, but sensitive/no-store. Physical interrupted-pairing recovery recommended.

### `POST /v1/staff/operations/reverse`

- **Use/auth/context:** optional compensation, never destructive ledger deletion. Signed; route 120/minute; UUID idempotency key. Staff must be original member and same device inside default 120 seconds. Owner/Manager use default 1,440-minute window and a reason.
- **Body:** strict `{ operationPublicId: UUID, reason?: trimmed string(max 500) }`.
- **Success 200:** `{ operationPublicId: UUID, commandId: UUID, reversedOperationPublicId: UUID, replayed: boolean, progress: nonnegative int, rewardReady: boolean, completedCycles: nonnegative int, projectionVersion: nonnegative int, requestId: string|null }`.
- **Side effects:** locks dependencies and appends compensating `REVERSE_STAMP`/`REVERSE_REDEMPTION` ledger/audit/outbox history; original record remains.
- **Errors:** `SIGNED_COMMON`, `MUTATION_COMMAND`, and the applicable `OPERATIONAL_EARN` or `OPERATIONAL_REDEEM` set; `OPERATION_NOT_REVERSIBLE` 404 when the original public operation is absent and 409 for a non-reversible state; `REVERSAL_DEPENDENCY_EXISTS`, `REVERSAL_WINDOW_EXPIRED`, and `REVERSAL_REASON_REQUIRED` 409; preloaded membership loss `MEMBERSHIP_NOT_OPERATIONAL` 409; `RISK_HARD_BLOCK` 409.
- **Retry/cache/test:** same command recovery rules as other mutations. Test physically only if Mobile exposes reverse.

### `GET /v1/staff/operations/:operationPublicId`

- **Use/auth:** operation lookup by public UUID. Signed; same organization required, but unlike command status it is not restricted to the originating device. No query/body.
- **Success 200:** `{ publicId: UUID, operationPublicId: UUID, commandId: UUID, operationType: operation enum above, status: "PROCESSING"|"COMPLETED"|"FAILED", resultProjectionVersion: nonnegative int|null, resultPayload: StampResult|RedeemResult|ReverseResult|null, safeFailureCode: string|null, createdAt: ISO, completedAt: ISO|null }`.
- **Errors/retry/cache:** `SIGNED_COMMON` and `OPERATION_NOT_FOUND` 404. Read-only/new signature retry; no-store. Test if exposed in recovery/history UI.

### `GET /health`

- **Use/auth:** public, optional connectivity/build diagnostic. No parameters/body and no device/session meaning.
- **Success 200:** `{ status: "ok", service: "waflo-api", environment: string, release: string, instance: string, timestamp: ISO }`.
- **Behavior:** does not check PostgreSQL, Redis, or object storage. Mobile must not treat it as operational readiness, authentication, or a preflight for mutation.
- **Errors/retry/cache/test:** `RATE_LIMITED` 429, `RATE_LIMIT_STORAGE_UNAVAILABLE` 503, or `INTERNAL_ERROR` 500; otherwise read-only/no-store. Optional diagnostics test only.

## Mobile-supporting Merchant endpoints

These endpoints explain how the paired state is produced and controlled. They are **not callable by Staff Mobile**.

### `GET /v1/organizations/:organizationId/staff-devices`

- **Auth/context:** Merchant cookie, active org membership, `devices.view`; GET has no CSRF. Path org UUID. Query `cursor?: UUID`, `limit?: integer 1..100` (default 30).
- **Success 200:** `{ items: [{ publicId, displayName, platform, status, trustLevel, appVersion, osVersion|null, model|null, pairedAt|null, lastSeenAt|null, revokedAt|null, staff: {id,role,status,user:{displayName}}|null, locations:[{locationId,earningAllowed,redemptionAllowed}], session:{id,locationId,expiresAt,lastActiveAt}|null }], nextCursor: UUID|null }`. `staff.id` and `session.id` are internal Merchant-side values; do not expose them to Staff Mobile.
- **Side effects/errors:** read-only; `MERCHANT_COMMON_GET`. A syntactically valid cursor that does not identify a device currently becomes `INTERNAL_ERROR` 500 through the uncaught database cursor error. No-store. Merchant physical support test covers paired/revoked display.

### `GET /v1/organizations/:organizationId/members/:memberId/location-assignments`

- **Auth/scope:** Merchant `__Host-waflo_session` cookie, active organization membership, `devices.view`; GET has no CSRF requirement. Owner may inspect an organization target; Manager may inspect only a `STAFF` target. Organization/member path values are UUIDs. Staff Mobile must never call this route and cannot self-assign.
- **Success 200:** `{ staffMember: { id, role, status, user: { displayName, status } }, items: [{ locationId, location: { id, name, status }|null, earningAllowed, redemptionAllowed, active, createdAt, revokedAt }] }`. These are Merchant-side administration records; internal member IDs are not Mobile authority.
- **Errors:** `MERCHANT_COMMON_GET`; `STAFF_MEMBER_NOT_FOUND` 404 for absent/cross-org/Manager-disallowed target. Read-only/no-store.

### `PUT /v1/organizations/:organizationId/members/:memberId/location-assignments/:locationId`

- **Auth/scope:** Merchant cookie plus allowed Origin, `waflo_csrf` cookie, matching `x-csrf-token`, and `devices.pair`. Owner may manage an eligible active organization member; Manager only an active `STAFF` target. Organization/member/Location path values are UUIDs.
- **Body:** strict `{ earningAllowed: boolean, redemptionAllowed: boolean }`; at least one value must be true.
- **Success 200:** `{ organizationId, staffMemberId, staffDisplayName, locationId, locationName, earningAllowed, redemptionAllowed, active, createdAt, revokedAt, changed }`. It creates/reactivates/updates the unique member+Location assignment. Repeating identical active values returns `changed: false` without a duplicate audit.
- **Effects:** a changed representation cancels unfinished pairings for the Staff member. Permission narrowing clamps matching active device-Location permissions; sessions remain usable only for operations whose authority remains. PUT does not eagerly expire approval rows, but the decision/consumption checks make an approval whose redemption authority was narrowed `MANAGER_APPROVAL_STALE` or `MANAGER_APPROVAL_MISMATCH` and non-consumable. Any old sessions previously revoked by a prior assignment revocation remain revoked. Changed provisioning/update is audited.
- **Errors:** `MERCHANT_COMMON_MUTATION`; `STAFF_MEMBER_NOT_ASSIGNABLE` 422, `STAFF_LOCATION_INVALID` 422, `PERMISSION_DENIED` 403, and `VALIDATION_FAILED` 422 for the both-false or otherwise invalid strict body.

### `DELETE /v1/organizations/:organizationId/members/:memberId/location-assignments/:locationId`

- **Auth/scope:** same Merchant cookie/CSRF/Origin and `devices.pair` domain; Owner may revoke an organization target, Manager only `STAFF`. No body.
- **Success 200:** `{ organizationId, staffMemberId, locationId, status: "REVOKED", revokedAt, changed }`. First active revocation returns `changed: true`; an already inactive assignment returns its stored timestamp with `changed: false`.
- **Effects:** the changed transition sets the assignment inactive, revokes the member's sessions at that Location, cancels all unfinished pairings for that member, expires pending/approved approvals at that Location, and audits `staff.location_assignment_revoked` atomically. The next affected signed request/refresh is denied with `STAFF_LOCATION_ASSIGNMENT_INVALID`/401.
- **Errors:** `MERCHANT_COMMON_MUTATION`; `STAFF_MEMBER_NOT_FOUND` 404, `STAFF_LOCATION_ASSIGNMENT_NOT_FOUND` 404, and `PERMISSION_DENIED` 403.

### `POST /v1/organizations/:organizationId/device-pairing-sessions`

- **Auth/context:** Merchant cookie+CSRF/allowed Origin, `devices.pair`, rate 20/minute. Owner may target active staff; Manager may target only `STAFF`. Path org UUID.
- **Body:** strict `{ staffMemberId: internal UUID, locations: 1..50 unique [{ locationId: UUID, earningAllowed: boolean, redemptionAllowed: boolean }], deviceLabelSuggestion?: trimmed string(1..120), expiresInMinutes?: int(2..30), default 10 }`. Every requested permission must be within an active `StaffLocationAssignment`.
- **Success 201:** `{ publicId: UUID, status: "PENDING", expiresAt: ISO, staffDisplayName: string, pairingQrSvg: string, accessibleLabel: string }`. `pairingQrSvg` contains the live secret and is `DO_NOT_PERSIST/DO_NOT_LOG`.
- **Side effects/errors:** creates/audits environment-bound one-time session. `MERCHANT_COMMON_MUTATION`; `DEVICE_PAIRING_ALREADY_ACTIVE` 409, `DEVICE_PAIRING_INVALID` 422, `LOCATION_NOT_AUTHORIZED` 403.
- **Concurrency/test:** only one unexpired PENDING/CLAIMED attempt per target. Merchant initiates every physical pairing test.

### `GET /v1/organizations/:organizationId/device-pairing-sessions/:sessionId`

- **Auth/parameters:** Merchant cookie, `devices.view`; org and session public UUID paths; no body/query.
- **Success 200:** `{ publicId, status, expiresAt, claimedAt|null, completedAt|null, deviceLabelSuggestion|null, requestedLocationAssignments }`; statuses include `PENDING|CLAIMED|COMPLETED|EXPIRED|CANCELED`.
- **Errors/retry/cache:** `MERCHANT_COMMON_GET`. A missing pairing UUID currently reaches uncaught `findFirstOrThrow` and becomes `INTERNAL_ERROR` 500. Read-only/no-store. Used to verify claim/completion and ambiguous completion.

### `POST /v1/organizations/:organizationId/device-pairing-sessions/:sessionId/cancel`

- **Auth/parameters:** Merchant cookie+CSRF, `devices.pair`; org/session UUID; no request fields.
- **Success 201:** `{ status }`; an active PENDING/CLAIMED row becomes `CANCELED`, otherwise current status is returned.
- **Errors/side effects:** `MERCHANT_COMMON_MUTATION`; `DEVICE_PAIRING_INVALID` 404 if absent. The transition is serialized and audited. Mobile subsequently receives expired/unavailable pairing behavior.

### `POST /v1/organizations/:organizationId/staff-devices/:deviceId/revoke`

- **Auth/parameters:** Merchant cookie+CSRF, `devices.revoke`; Manager can target only `STAFF`; org/device public UUID paths.
- **Body:** object containing `reason: string`, trimmed 3..240. Controller ignores extra body keys; do not depend on that permissiveness.
- **Success 201:** `{ status: "REVOKED" }`.
- **Side effects/concurrency:** serializes device, sets status/revoked time/reason, revokes every active session, expires pending/approved approvals for the device, and audits. Post-revoke signed calls receive `STAFF_DEVICE_REVOKED`/401.
- **Errors:** `MERCHANT_COMMON_MUTATION`; `REVOCATION_REASON_REQUIRED` 422, `STAFF_DEVICE_NOT_FOUND` 404, and `PERMISSION_DENIED` 403 when a Manager targets a non-Staff member. Physical revocation test required.

### `POST /v1/organizations/:organizationId/staff-devices/:deviceId/mark-compromised`

- Same contract as revoke, including `reason` 3..240, but success is `{ status: "COMPROMISED" }` and audit records compromise. Use for a suspected key/token exposure. All device sessions are revoked. Physical security recovery test recommended.

### `GET /v1/organizations/:organizationId/operation-approvals`

- **Auth/query:** Merchant cookie, Owner/Manager `operations.manager_approve`; optional `status=PENDING|APPROVED|REJECTED|EXPIRED|CONSUMED`, `cursor=public UUID`, `limit=1..100` default 30.
- **Success 200:** `{ items: [{ publicId, status, membership|null, rewardEntitlement|null, staffDevice|null, location|null, requestedBy|null, approvedBy|null, expiresAt, approvedAt|null, rejectedAt|null, consumedAt|null, createdAt }], nextCursor: UUID|null }`. Nested records expose Merchant-side IDs/display data and must not be copied to Mobile logs.
- **Errors/retry:** `MERCHANT_COMMON_GET`; no-store. Listing itself transitions overdue `PENDING`/`APPROVED` entries to `EXPIRED`. Approval requests originate only from signed redeem; `POST /v1/organizations/:organizationId/operation-approvals` is intentionally absent.

### `POST /v1/organizations/:organizationId/operation-approvals/:approvalId/approve`

- **Auth/parameters:** Merchant cookie+CSRF, Owner/Manager `operations.manager_approve`; org and approval public UUID.
- **Body:** strict `{ reason?: trimmed string(max 500) }`.
- **Success 201:** `{ publicId: UUID, status: "APPROVED", decidedAt: ISO }`.
- **Side effects/concurrency:** revalidates current approver permission and, for approval, requester/device/Location/Staff+device assignments/entitlement/pinned version/reward policy/eligibility. It then performs an atomic unexpired `PENDING → APPROVED` transition and audit. Stale intent becomes `EXPIRED`; one concurrent decision wins.
- **Errors:** `MERCHANT_COMMON_MUTATION`; `MANAGER_APPROVAL_INVALID` 409 for absent/non-REDEEM intent, `MANAGER_APPROVAL_ALREADY_DECIDED` 409, `MANAGER_APPROVAL_REJECTED` 409, `MANAGER_APPROVAL_EXPIRED` 410, `MANAGER_APPROVAL_CONSUMED` 409, `MANAGER_APPROVAL_STALE` 409, and `PERMISSION_DENIED` 403 if current manager authority is lost. An approval still must pass every binding and one-time consumption rule at Mobile retry.

### `POST /v1/organizations/:organizationId/operation-approvals/:approvalId/reject`

- Same auth, parameters, optional reason, decision concurrency, and terminal errors as approve. Success is `{ publicId: UUID, status: "REJECTED", decidedAt: ISO }`; it also marks the reserved command failed with `MANAGER_APPROVAL_REJECTED`. A rejected approval can never authorize redeem.

## Potentially confusing `NOT_FOR_MOBILE` families

The following 153 routes were inspected and excluded. The counts below partition category D exactly.

| Route family/controller area | D routes | Why excluded |
|---|---:|---|
| Merchant/customer/external auth | 25 | Merchant session cookies/OAuth and Customer Web sessions are separate security domains; includes Google/Apple Merchant callbacks |
| Merchant billing/Stripe | 6 | Dashboard subscription and Stripe webhook/reconciliation; Mobile receives only operational enforcement errors |
| Customer Web Loyalty Card BFF | 16 | Customer card/session/transfer APIs are Customer Web-only |
| Enrollment/customer public routes | 7 | Customer enrollment/settings/browser session domain |
| Platform capabilities | 1 | Merchant external-auth and Wallet provider availability, not Staff entitlement |
| Readiness | 1 | `/ready` is deployment orchestration only |
| Locations | 6 | Merchant dashboard location administration; no Staff location switch |
| Merchant operations/reporting | 30 | Internal-ID operational dashboard, exports, risk, manual membership actions; excludes the three supporting approval list/decision routes |
| Organizations | 9 | Merchant organization administration |
| Assets/Loyalty Card studio | 27 | Merchant asset and Loyalty Card/program/version authoring/publishing |
| Audit | 2 | Merchant audit views |
| Team | 9 | Merchant invite/member administration, not Staff authentication |
| Apple Wallet web service/assets | 6 | Wallet callbacks/APNs/pass assets, not Mobile app APNs |
| Customer Wallet/save actions | 6 | Apple pass/Google save-link Customer Web endpoints; Staff only scans resulting credential |
| Public marketing/lookup | 2 | Browser public content, not operational Staff interface |
| **Total NOT_FOR_MOBILE** | **153** | |

Stripe webhooks, Apple Wallet callbacks, Google Wallet save actions, worker/operational processing, Merchant auth, and Customer Web BFF routes must never receive Staff device credentials. Worker jobs are not HTTP Mobile endpoints and therefore are not included in the 178 route-decorator total.

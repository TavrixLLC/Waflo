# Manager approval

Manager approval is a server-owned REDEEM protocol. A Staff client never creates an approval,
supplies a fingerprint, or uses internal database identifiers.

## Staff Mobile protocol

1. Mobile sends the intended operation to `POST /v1/staff/operations/redeem` with a durable UUID
   `Idempotency-Key`, the public Membership QR payload, the public reward entitlement ID, and the
   optional redeem note. It omits `managerApprovalPublicId` on the first attempt.
2. If the exact reward requires approval, the server reserves the redeem command, computes the
   canonical fingerprint from authoritative state, creates one pending approval, and responds
   `409 MANAGER_APPROVAL_REQUIRED`. `error.details.approvalRequest` contains only `publicId`,
   `status: "PENDING"`, and `expiresAt`; `retryWithSameIdempotencyKey` is `true`.
3. While the request is undecided, an exact retry using the same idempotency key and returned
   `managerApprovalPublicId` receives `409 MANAGER_APPROVAL_PENDING`.
4. After approval, Mobile retries the exact original redeem with the same idempotency key and the
   returned `managerApprovalPublicId`. The server recomputes every binding and atomically consumes
   the approval with the redemption.
5. A retry after a completed response or network timeout returns the stored successful command
   result with `replayed: true`; it does not consume or perform the redemption again.

Changing a redeem field while reusing the key is an idempotency conflict. Using an approval with
a different key, device, Location, Membership, organization, reward, policy context, or redeem
payload is `MANAGER_APPROVAL_MISMATCH`. STAMP never creates or consumes manager approval; its
legacy override-shaped input cannot authorize a stamp-policy exception. A redeem approval supplied
for a reward that does not require approval is rejected as `MANAGER_APPROVAL_NOT_APPLICABLE`.

## Manager protocol

An authenticated Merchant Owner or Manager with `operations.manager_approve` lists requests with
`GET /v1/organizations/:organizationId/operation-approvals` and decides a pending public reference
with either:

- `POST /v1/organizations/:organizationId/operation-approvals/:approvalId/approve`
- `POST /v1/organizations/:organizationId/operation-approvals/:approvalId/reject`

The optional strict JSON body is `{ "reason": "up to 500 characters" }`. A successful decision is
HTTP 201 with `{ publicId, status, decidedAt }` in the standard success envelope. The former
Merchant `POST /operation-approvals` issuance route is intentionally absent: issuance can occur
only from the originating signed redeem intent.

The decision transaction revalidates the manager's current user, membership, role, organization,
and approval permission. Approval additionally revalidates the requester, device, Location,
Staff/device Location assignments, active Membership, exact entitlement, pinned Program Version,
reward policy, expiry, and remaining redemption eligibility. Two managers racing can produce only
one terminal decision.

## Fingerprint and consumption

Fingerprint ownership is **SERVER**. The canonical SHA-256 fingerprint binds operation type
`REDEEM`, command/idempotency key, organization, customer and Membership, hashed QR credential,
Program and pinned Program Version, entitlement internal/public identity, reward definition and
policy snapshot, threshold/cycle/redemption limits, Staff member, originating device, Location,
and normalized note. The approval public ID is deliberately not part of the fingerprint, removing
the former creation-order cycle.

Approval is short-lived, single-use, and linked to the reserved command. Consumption repeats all
authoritative lifecycle and permission checks and performs the conditional `APPROVED` to
`CONSUMED` transition in the same serializable mutation transaction. Requests, approval/rejection
decisions, and successful consumption are audited; terminal status and command failure state retain
expiration outcomes.

Mobile-visible state codes are `MANAGER_APPROVAL_REQUIRED`, `MANAGER_APPROVAL_PENDING`,
`MANAGER_APPROVAL_REJECTED`, `MANAGER_APPROVAL_EXPIRED`, `MANAGER_APPROVAL_CONSUMED`,
`MANAGER_APPROVAL_MISMATCH`, `MANAGER_APPROVAL_INVALID`, and
`MANAGER_APPROVAL_NOT_APPLICABLE`. Merchant decision races and stale authority additionally use
`MANAGER_APPROVAL_ALREADY_DECIDED`, `MANAGER_APPROVAL_STALE`, and
`MANAGER_APPROVAL_APPROVER_INACTIVE` as applicable.

# Customer CSRF and Origin policy

Customer browser mutations use a dedicated CSRF namespace, separate from merchant authentication. The bootstrap endpoint is `GET /v1/customer/csrf`; its HMAC token is bound to the host-bound customer session and is carried in a separate cookie/header pair.

The guard requires:

- a valid customer session;
- matching customer-session merchant host;
- the dedicated CSRF cookie/header token;
- an exact allowed `Origin`;
- no wildcard credentialed CORS.

Protected mutations include customer session rotate/logout, Google Wallet add action, and customer-session-initiated transfer requests. Apple pass download remains a non-mutating GET.

In production, only the configured customer origin or the resolved merchant origin is accepted. Query tenant overrides and `.localhost`/`.lvh.me` are rejected by the API in production. Development/test accepts exact base, `merchant.localhost`, and `merchant.lvh.me` forms only.

Public enrollment uses idempotency and host resolution but no ambient customer session. A one-time transfer confirmation can proceed with its one-time challenge/browser proof; when an existing customer session initiates the transfer, CSRF is enforced.

Failures return `CUSTOMER_CSRF_INVALID`, are rate limited, and produce a safe audit record with no token material. Real HTTP and Playwright cross-merchant rejection are covered. See `evidence/customer-csrf-cross-merchant-rejection.json`.

# Production V1 UX and billing repair

## Staff QR authentication

The Merchant **Team** screen is the single staff access surface. An Owner or Manager creates a
staff identity with a name and supported role; no email address or email invitation is required.
Waflo stores that identity as a non-login service user using the reserved internal
`@staff.waflo.invalid` domain. The internal address is never returned as staff contact data and
cannot be used for password or OAuth sign-in.

From the staff row, the merchant chooses a Location and generates a ten-minute QR. Generation is
serialized under the staff-member invariant lock and atomically:

1. revokes every device session for that membership;
2. cancels every previous pending or claimed pairing and approval;
3. marks every previous active or pending staff device revoked; and
4. creates the new pairing as the only current access context.

The app claims the opaque QR token, proves possession of its Ed25519 key, and completes pairing.
Re-pairing the same installation safely rotates its key and session. A different organization or
staff identity cannot take over an installation. The legacy `/dashboard/devices` merchant route
redirects to `/dashboard/team`.

The same migration adds a structural interactive-login barrier for synthetic Staff users. Database
checks and triggers prevent password hashes, email verification, reset tokens, Merchant sessions,
and Google/Apple identities for these users. The application also rejects authentication and email
delivery to the reserved domain. Random UUID local-parts plus the global normalized-email unique
constraint prevent organization collisions and deletion/recreation takeover.

## Customer Wallet staging host

Staging uses one shared Customer host, `card-staging.waflo.app`, plus an explicit tenant slug. The
Apple pass is a direct browser download, so its link now retains `?tenant=<merchant>`. The API
accepts that override only when the request host is exactly the configured shared staging Customer
host. It remains forbidden in production and is rejected on Merchant, Marketing, API, or arbitrary
hosts. Local overrides remain restricted to localhost and lvh.me.

iOS shows only Add to Apple Wallet. Android shows only Add to Google Wallet. Desktop explains that
the customer should open the card on the target phone; it does not show either incorrect action.
Wallet notification/promotion consent is no longer presented on the save surface.

## Billing cadence and Stripe setup

Cadence is independent from the Starter, Growth, or Scale tier and is stored as `BillingCadence`
(`MONTHLY`, `QUARTERLY`, or `YEARLY`) on the billing profile and provider subscription. Monthly is
unchanged. Quarterly charges three monthly prices less 7%; yearly charges twelve monthly prices
less 17%. Calculations round the final charge to USD cents and the UI shows both the charge and its
monthly equivalent.

Stripe requires six external recurring Prices before quarterly/yearly checkout can be enabled:

- `STRIPE_STARTER_QUARTERLY_PRICE_ID`
- `STRIPE_GROWTH_QUARTERLY_PRICE_ID`
- `STRIPE_SCALE_QUARTERLY_PRICE_ID`
- `STRIPE_STARTER_YEARLY_PRICE_ID`
- `STRIPE_GROWTH_YEARLY_PRICE_ID`
- `STRIPE_SCALE_YEARLY_PRICE_ID`

Create each Price with the exact charge shown by Waflo for its tier/cadence and attach it to a
customer-readable Product/line description such as `Waflo Starter — Quarterly`, then set the IDs
in the staging or production application environment. Configure all three Prices in a cadence group;
partial groups fail environment validation. No code path claims those cadences are available until
the corresponding ID is configured. Keep Customer Portal plan switching disabled: plan changes go
through Waflo's downgrade prerequisites. Provider webhooks also reject an invalid lower-tier
transition instead of silently applying it.

The single migration `20260812193000_staff_qr_billing_cadence` also adds the billing identity,
authoritative invoice projection, durable billing-email outbox, dunning recovery state, and Staff
interactive-login constraints required by this final pre-commit repair. It remains the only new
migration; previously deployed migrations are not edited.

## Authoritative billing and customer identity

The Billing screen reads current plan and cadence, subscription/trial status, renewal, previewed
next amount/date/currency, masked default card and expiry, latest/outstanding invoice, grace
deadline, and invoice/receipt history. It never returns the payment-method ID in the merchant view
and never stores or renders PAN, CVC, client secrets, or payment tokens.

Every organization has one authoritative Stripe Customer. Checkout first reconciles both current
and legacy organization metadata and fails closed if multiple Customers claim the same
organization. Customer creation uses a stable organization idempotency key. Name, billing email,
explicit billing address/country, Waflo locale, and safe `wafloOrganizationId` metadata synchronize
at checkout, when Billing identity changes, and by the operational worker. Billing country is kept
separate from operating-location country.

Stripe invoices remain the financial artifact. Waflo stores only safe identity, amounts, currency,
status, service period, masked card summary, and Stripe-hosted/PDF links. Paid-email content links
back to that artifact instead of generating a divergent invoice.

## Billing communication and dunning policy

Waflo owns billing and refund messages through the audited, leased, retryable
`BillingEmailOutbox`: renewal reminder, invoice paid, payment failed, grace expired, refund request
received, refund approved/processing, refund succeeded, refund rejected, and refund failed. Duplicate
webhooks and repeated scheduler scans converge on unique cycle/invoice dedupe keys. Organization
locale and canonical organization IANA timezone control date rendering.

- Renewal reminders are queued once per subscription period when the organization's local calendar
  date is exactly two days before `currentPeriodEnd`. Stripe `invoice.upcoming` is observed but does
  not send a second reminder.
- A paid invoice queues one message per Stripe invoice and links the hosted invoice or PDF.
- The first failed recurring collection starts one immutable 48-hour deadline. Recoverable
  insufficient-funds/temporary issuer errors retry at +12 hours and +47 hours. Authentication,
  invalid-card, and hard-decline categories require customer action and are not described as
  automatically recoverable.
- A changed customer default payment method wakes recovery immediately. The worker sets that new
  method on the exact subscription and outstanding invoice, then pays the same invoice using a
  stable attempt idempotency key. The original grace deadline does not reset.
- A paid invoice immediately restores `ACTIVE`, ends grace, and cancels stale unsent failure/final
  messages. After 48 hours an unpaid invoice becomes `PAST_DUE`: new publication/enrollment is
  restricted, existing cards remain viewable, Wallet issuance is unavailable, and a later paid
  invoice restores the account. Waflo does not cancel, delete, or claim continuous balance
  monitoring.

### Required Stripe Dashboard actions (not verifiable from this repository)

Before Production-v1 release, an authorized Stripe operator must:

1. subscribe the production webhook endpoint to the exact events in
   `docs/release/real-provider-configuration.md` using API version `2026-06-24.dahlia`;
2. configure Customer Portal payment-method replacement and keep plan switching disabled;
3. disable Stripe's paid-invoice, failed-payment, and upcoming-renewal customer emails because
  Waflo owns these messages; this prevents duplicate Stripe + Waflo mail;
4. disable Stripe Smart Retries for this product or configure it so it cannot extend/add attempts
   beyond Waflo's documented +12h/+47h 48-hour policy; do not enable duplicate dunning messages;
5. create and install all six quarterly/yearly recurring Price IDs before exposing those cadence
   groups; and
6. complete a live-mode controlled verification of hosted invoice/PDF availability, customer
   email, Portal return URL, webhook delivery, and recovery behavior without disclosing secret
   keys.

The repository cannot prove these Dashboard settings. Until an authorized operator records that
verification, external Stripe configuration remains a release blocker even though monthly billing
continues to fail safely and quarterly/yearly remain unavailable without complete ID groups.

## Global country and timezone authority

Country choices come from `i18n-iso-countries` ISO 3166-1 data and store the 249 assigned uppercase
alpha-2 codes. The library's non-ISO user-assigned `XK` convenience entry is deliberately excluded.
The UI localizes English/Arabic display names but never stores translated text. Existing location
codes are uppercased by the new migration; server schemas reject unknown codes.

Timezone choices come from the runtime's canonical `Intl.supportedValuesOf("timeZone")` set plus
the accepted canonical UTC identifier. The searchable UI groups readable regions and shows current
offsets, while storage and server validation retain canonical DST-safe IANA identifiers.

## Downgrade prerequisites

Before moving to a lower tier, Waflo checks active Locations, Manager/Staff seats (including pending
legacy invitations), active programs, Pro Mode, multiple rewards, milestone rewards, and active
advanced-export jobs. Billing lists each violation and the API blocks
both direct and provider-originated invalid downgrades.

## Template access

The current codebase had no plan filter in the template catalog or template preview endpoint. This
repair makes that product rule explicit by returning all templates with
`availableOnPlans: [STARTER, GROWTH, SCALE]`. PATH and RING template layouts are now also universal,
so choosing one of those designs cannot create an unpublishable Starter draft. Unrelated plan
limits remain enforced.

## Refund review and Stripe execution

Eligible paid invoices expose **Request refund** with the invoice reference, original payment,
remaining refundable amount, reason, and optional explanation. Request submission does not execute
a refund. One active request per invoice is enforced in PostgreSQL. Review and execution require an
authenticated organization Owner, global CSRF/session guards, endpoint rate limits, tenant-scoped
queries, immutable audit rows, a stable Stripe idempotency key, and a conditional execution lease.
Synthetic Staff identities cannot establish Merchant sessions and have no billing permission.

Approved full or partial refunds re-retrieve the authoritative paid Stripe invoice and Customer,
resolve its single original PaymentIntent, subtract non-failed provider refunds, and reject any
amount above Stripe's remaining refundable balance. The current saved card is never used as a
refund destination. `refund.created`, `refund.updated`, and `refund.failed` reconcile canonical
provider state through the signed, idempotent webhook processor; failed refunds never render as
complete.

Stripe invoices remain the financial source of truth. This implementation uses Stripe Refunds and
does not create a Waflo-only invoice adjustment. Whether a finalized invoice also requires a Stripe
Credit Note for a full refund, partial refund, account credit, or out-of-band adjustment is marked
`LEGAL_ACCOUNTING_REVIEW_REQUIRED` pending jurisdiction-specific legal/accounting approval. That
review does not weaken the technically safe original-payment refund path.

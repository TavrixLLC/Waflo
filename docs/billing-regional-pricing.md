# Waflo-owned regional pricing

`pricing_markets` and immutable `pricing_versions` are the commercial source of truth. `GLOBAL` is USD and is the fallback for every billing country without an active country override. Amounts are integer ISO-currency minor units; Waflo never calculates an FX conversion.

## Controlled bootstrap

The schema migration intentionally does **not** guess existing Price amounts from the old environment variables. Before enabling checkout after deployment, an operator must create verified historical GLOBAL pricing versions for each legacy Stripe Price, bind each exact Stripe Price ID, and set each existing subscription's pricing-version snapshot. Any unmapped legacy subscription must remain blocked from catalog-driven changes and be reported for review.

Use `pnpm tsx scripts/bootstrap-legacy-stripe-pricing.mts` first for a non-mutating JSON report. With a test-mode key and an approved report, run `pnpm tsx scripts/bootstrap-legacy-stripe-pricing.mts --write`. It never changes a Stripe Subscription, invoice, or Price; it only creates retired historical catalog bindings and fills missing local snapshots. Unknown, inactive, non-recurring, or conflicting Prices are reported and left untouched.

## TEST-mode Stripe setup

Configure only the Stripe API, publishable, webhook, and Portal configuration credentials. Create nothing per country in environment variables. The internal publisher creates a reusable Product per plan as needed and creates the immutable Price with Waflo metadata and a deterministic Stripe idempotency key. Test that every intended currency is supported by the account/payment route before validating a version; if it is not, publish an explicit USD (or another supported) fallback version instead.

## Annual repricing

Preview a market/plan/cadence cohort with an explicit `effectiveOnOrAfter` date and notice policy before scheduling. Scheduling creates one durable command per eligible grandfathered subscription and immutable notice snapshot. The worker performs the update only at the eligible normal period end with `proration_behavior=none`; it never creates a mid-cycle platform charge. Canceling affects only pending commands. Replacing a pending target creates a new command and supersedes the old one without rewriting its commercial or notice evidence. The audit log is the customer-notice and operator-review trail; delivery templates remain an operator responsibility.

## Secure operator workflow

There is intentionally no public or merchant-facing pricing-admin endpoint. Operators can use `pnpm tsx scripts/pricing-operator.mts inspect` to list GLOBAL, country overrides, historical versions, Stripe bindings, and subscriber/grandfathered counts. Mutating commands require `--write`: `draft MARKET PLAN MONTHLY CURRENCY AMOUNT_MINOR`, `validate VERSION_ID`, `publish VERSION_ID`, `retire VERSION_ID`, `annual-schedule`, `annual-cancel TRANSITION_ID`, and `annual-replace TRANSITION_ID TARGET_VERSION_ID`. `annual-preview MARKET` is read-only. The command produces JSON and never prints Stripe credentials.

The internal Admin application also exposes protected `/v1/admin/pricing/*` and `/v1/admin/repricing/*` operations for authorized Waflo staff. They require the dedicated Admin session, server-side capability checks, CSRF/origin protection, audit logging, and sensitive reauthentication for commercial mutations. Admin users configure Waflo terms only; Stripe Price IDs are internal binding diagnostics, never manual price input.

## Country authority

`organization_billing_profiles.billing_country_code` is contractual server-side data. It is never inferred from IP, Checkout parameters, or a Stripe billing address. Changes need a separate authorized/audited organization-country workflow; this migration deliberately exposes no merchant-controlled country endpoint.

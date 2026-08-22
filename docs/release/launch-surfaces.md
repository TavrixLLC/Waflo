# Waflo launch surfaces

This document records the release configuration boundary for public discovery. It does not claim
deployment, search-engine verification, legal approval, or external provider verification.

## Canonical and indexing policy

- `https://waflo.app` is the canonical Marketing origin. `https://www.waflo.app` permanently
  redirects to it.
- English and Arabic Marketing pages are public at `/en` and `/ar`; each public route declares its
  canonical URL plus `en`, `ar`, and `/en` x-default alternates.
- `https://waflo.app/sitemap.xml` lists only localized Marketing home, pricing, contact, privacy,
  and terms URLs.
- Merchant Web, Customer Web, API responses, and every staging surface use `noindex`. Merchant and
  Customer Web also publish a disallow-all `robots.txt`. Marketing staging publishes a
  disallow-all `robots.txt` and a response-level `X-Robots-Tag` when built with
  `DEPLOYMENT_ENVIRONMENT=staging`.
- `robots.txt` is only a crawler directive. Authentication, opaque customer identifiers, access
  control, private caching rules, and token handling remain the security controls.

## Required launch configuration

Set the non-secret `SUPPORT_EMAIL` value in each deployed
`/opt/waflo-platform/env/<environment>/application.env`. It must be a verified mailbox that accepts
incoming merchant/customer support mail. When it is absent or still a `REPLACE_` value, Marketing
does not render a fabricated email address and instead links existing merchants to sign in.

Set the runtime `LEGAL_EFFECTIVE_DATE` in each environment's `application.env` only after counsel
has approved the public Privacy Policy and Terms of Service. Staging may leave it empty and will
render explicit review-pending text. Production deployment requires the approved `YYYY-MM-DD`
value and fails closed without it. Both documents remain `LEGAL_REVIEW_REQUIRED` until substantive
approval occurs.

## Google Search Console after production deployment

1. Add and verify the Domain property `waflo.app` using the DNS method. Do not commit the DNS token.
2. Confirm `https://www.waflo.app/...` redirects to the matching `https://waflo.app/...` URL.
3. Inspect the production home page, one English route, and one Arabic route.
4. Submit `https://waflo.app/sitemap.xml`.
5. Confirm Merchant, Customer, API, and staging URLs report `noindex` and are not submitted.

No Search Console verification file or meta token is stored in this repository.

## Optional analytics

No third-party browser analytics provider is configured. Marketing analytics is
`OPTIONAL_POST_LAUNCH`; adding it requires a privacy/cookie review and an explicit production-only
configuration boundary. Do not add trackers to Merchant, Customer membership, tokenized transfer,
or Wallet flows without separate product and privacy approval.

# Wallet engagement and nearby-notification feasibility

## Final product policy (2026-08-12)

Provider-native Nearby relevance is an organization-level business policy and is not gated by an
individual customerâ€™s `WALLET_PROMOTIONS` consent. When an owner or authorized manager enables it,
the selected active business locations feed every eligible published Loyalty Card; each Program
Version intersects that selection with its participating locations. Loyalty-Card-specific Apple
copy still resolves from `LoyaltyProgramVersion.baseTemplateCode`, then
`Organization.businessCategory`, then `GENERAL`.

`WALLET_PROMOTIONS` remains mandatory for manual promotional messages such as Google
`TEXT_AND_NOTIFY`. Apple manual promotion remains `PROVIDER_CONFIRMATION_REQUIRED`, and
`changeMessage` is not a marketing channel. Apple, Google, Wallet notification/location settings,
and pass removal remain authoritative for actual Nearby presentation; no exact 2 km trigger or
delivery is guaranteed.

Research date: 2026-08-12

Original scope: research and design. The provider research and decision history below are retained. The implementation status recorded on 2026-08-12 supersedes the original “do not implement” recommendation while preserving every provider limitation and external verification requirement. No production provider traffic was used during implementation.

## Implementation status — 2026-08-12

### IMPLEMENTED

- Merchant Web now exposes `Loyalty Card -> Wallet Engagement`, not a separate top-level product.
- Apple nearby relevance is represented in signed passes with up to 10 selected active merchant locations, `latitude`, `longitude`, localized `relevantText`, and a requested `maxDistance` of 2,000 metres. Product copy states that Apple determines actual relevance distance.
- Google nearby relevance patches the existing version-bound Loyalty Class with up to 10 `merchantLocations`. Waflo sends latitude/longitude only; no radius or merchant-authored nearby notification text is sent.
- Google manual promotion uses object-level Add Message with `TEXT_AND_NOTIFY`, localized header/body, a stable delivery-derived message ID, and an optional validated merchant/Waflo HTTPS destination.
- Google delivery reads the object before Add Message: a retry returns success when the stable message ID is already present. Near the ten-message object limit, Waflo deterministically removes only lexicographically earliest `wfl_` issuer-owned messages, leaving up to two safe send slots when ownership permits; it never removes another integration's message.
- Apple manual promotion is disabled and reports `PROVIDER_CONFIRMATION_REQUIRED`. No private API was invented and `changeMessage` is not used for marketing.
- Wallet promotion consent is an explicit, append-only, revocable Customer Web choice scoped to the organization, customer, and membership. Absence defaults to off. Loyalty participation and Wallet use remain available while consent is off.
- Campaign creation is tenant-authoritative and limited to active, consented Google Wallet holders of the selected Loyalty Card. PostgreSQL resolves the latest consent record before applying the 5,000-pass audience ceiling. The HTTP request creates only durable campaign state; the existing wallet worker resolves targets and creates idempotent delivery commands.
- Server caps are two promotional sends per pass/provider in 24 hours and five in seven days, plus ten merchant campaigns per 24 hours and a six-hour duplicate-content cooldown. Per-pass slots include in-flight reservations under an advisory transaction lock, preventing concurrent campaigns from racing the caps. Provider quota and transient failures retain safe retry state.
- Known organization timezones enforce promotional quiet hours from 21:00 until 08:00 local time. This does not reclassify or delay operational loyalty-state updates.
- Merchant content is normalized plain text with Unicode length limits, control/bidi/HTML/template rejection, first-party-only nearby variables, credential-pattern rejection, related-domain HTTPS validation, and deterministic nearby-claim safeguards.
- Merchant location coordinates are nullable, range-checked, editable business data. Waflo does not collect customer latitude, longitude, location history, or geofence events.
- The single category authority is `LoyaltyProgramVersion.baseTemplateCode`; existing `Organization.businessCategory` is the fallback, followed by `GENERAL`. Static versioned English/Arabic copy is resolved deterministically without AI or customer PII.
- Organization-level Nearby changes, selected-location coordinate/archive changes, and relevant organization name/category changes queue the existing pass-refresh pipeline for every affected Program and all usable Google version bindings. Archiving the last selected nearby branch turns Nearby off rather than leaving an enabled configuration with no locations.
- Migration `20260812170000_wallet_engagement` adds the campaign, delivery, nearby configuration/selection, consent scope, command type, and merchant-coordinate storage. Existing consent, wallet command/outbox, audit, membership, provider identity, and program sync infrastructure are reused.

### PROVIDER-VERIFICATION-PENDING

- Apple must confirm a public, approved promotional/program-notification mechanism for ordinary barcode/store-card loyalty passes that does not require NFC/VAS. Until then, Apple manual promotion remains unselectable.
- Google publishing access, production issuer policy standing, Add Message quota responses, message-link behavior, and final lock-screen presentation must be verified with controlled staging credentials.
- Provider acceptance is not proof of device delivery, presentation, timing, or customer view.

### EXTERNAL-PHYSICAL-TEST-PENDING

- Apple nearby relevance requires a physical iPhone with the pass saved and relevant Wallet/location settings enabled.
- Google manual and nearby behavior requires a physical Android device with Google Wallet notifications and required location permissions enabled.
- Cloudflare public TLS remains `EXTERNAL_DEFERRED`; physical staging verification starts only after the public staging origin is trustworthy.

### LEGAL_REVIEW_REQUIRED

- Final bilingual consent notice, promotional content policy, retention, complaint/suppression operations, merchant terms, and controlled-pilot wording require legal approval.
- The Customer Web control deliberately labels the current notice version `LEGAL_REVIEW_REQUIRED`; it is separate from required loyalty terms and is never prechecked.

### Loyalty Card category authority

Nearby copy resolves in this order:

1. explicit built-in Loyalty Card template vertical from `baseTemplateCode`;
2. existing organization `businessCategory` when no mapped template vertical exists;
3. `GENERAL`.

Merchant names are never used for category inference. Supported copy families are coffee, restaurant, barber, salon, bakery, gym, retail, and general, but they are resolver outputs rather than a second stored merchant taxonomy.

## Executive decision

Waflo can continue to update loyalty state in installed Wallet passes without requiring a Waflo customer app. A future Google Wallet merchant-message feature is technically supported through `TEXT_AND_NOTIFY`, subject to consent, product safeguards, Google quotas, and new backend/UI work. Apple supports issuer-driven pass updates, field change messages, and pass relevance, but its Human Interface Guidelines say change messages are only for time-critical changes and must not be used for marketing or other noncritical communication. Apple's newer loyalty page describes broader promotional engagement but does not document a separate free-form promotional-notification API or numeric quota. Waflo must therefore obtain provider confirmation before exposing generic Apple promotional pushes.

Wallet-native nearby behavior is feasible on both providers without Waflo receiving customer location. It is provider controlled, not an exact geofence:

- Apple: `LOCATION_RELEVANCE_SUPPORTED_BUT_2KM_NOT_GUARANTEED`.
- Google: `APPROXIMATE_PLATFORM_CONTROLLED_NEARBY_SUPPORTED`.

Neither provider lets Waflo guarantee a 2,000-metre trigger. Do not market the feature as “within 2 km.” The accurate product wording is “Surface my Loyalty Card when Wallet considers the customer nearby,” with provider-specific permission disclosures.

Historical recommendation at research time: do not add promotional campaigns or nearby configuration until explicit consent, safety controls, durable delivery, and truthful provider-specific UX exist. Those software prerequisites are now implemented; physical-provider verification and legal review remain pending.

### Historical research decision table

The phase labels in this table capture the original assessment before implementation. The implementation-status sections above are authoritative for the current repository.

| Capability | Apple Wallet | Google Wallet | Waflo feasibility | Provider-controlled limitations | Recommended phase |
| --- | --- | --- | --- | --- | --- |
| Manual merchant promotional message | Loyalty page describes engagement, but `changeMessage` is not a marketing channel | `LoyaltyClass`/`LoyaltyObject` Add Message with `TEXT_AND_NOTIFY` | Apple: `PROVIDER_CONFIRMATION_REQUIRED`, `NOT_RECOMMENDED` until resolved; Google: `SUPPORTED_REQUIRES_BACKEND_FEATURE`, `SUPPORTED_REQUIRES_MERCHANT_UI`, `LEGAL_REVIEW_REQUIRED` | Apple has no documented free-form alert API/quota; Google owns lock-screen UI and applies quota/spam controls | Post-v1 Google pilot; defer Apple |
| Individual customer message | Per-pass update/fanout is possible; promotional use unresolved | Add Message to one `LoyaltyObject` | Apple: state update `READY_WITH_CURRENT_PLATFORM`, promotion `PROVIDER_CONFIRMATION_REQUIRED`; Google: `SUPPORTED_REQUIRES_BACKEND_FEATURE` | One pass/object may be installed by multiple devices/holders | Post-v1 |
| Loyalty progress/reward update | Updated signed pass plus APNs update signal; constrained `changeMessage` | Object field update with `notifyPreference=NOTIFY_ON_UPDATE` for supported balance fields | `READY_WITH_CURRENT_PLATFORM` for pass-state synchronization; notification controls require provider-specific work | Delivery is not guaranteed; visible text is constrained/platform controlled | Current state sync; carefully scoped post-v1 notifications |
| Nearby location reminder | Pass `locations`/`maxDistance` or iBeacon relevance | `merchantLocations` Nearby Notifications | `SUPPORTED_BUT_PLATFORM_CONTROLLED`; new location storage/config required | Provider chooses presentation; Google also chooses radius, dwell, and text | Post-v1 physical-device pilot |
| Exact 2 km geofence | `NOT_SUPPORTED` as an exact boundary | `NOT_SUPPORTED`; no radius field | `NOT_RECOMMENDED` | Apple may use a smaller distance; Google selects radius/dwell | Reject requirement |
| Multiple branch locations | Up to 10 locations per pass; up to 10 beacon UUID entries | Up to 10 locations per class and 10 per object | `SUPPORTED_BUT_PLATFORM_CONTROLLED` | More branches require selection/personalization or multiple provider resources | Post-v1 |
| Custom notification text | `changeMessage` is a localizable format string tied to a changed field; `relevantText` is relevance text | Issuer controls stored message header/body/link/localization; Google controls push text and CTA | Apple: constrained; Google: `SUPPORTED_REQUIRES_BACKEND_FEATURE` | No arbitrary Apple title/body/CTA; no Google notification image/custom lock-screen UI | Post-v1 |
| No-customer-app requirement | Supported by Apple Wallet pass alone | Supported without a Waflo app; the Google Wallet app is required for Wallet behavior | `READY_WITH_CURRENT_PLATFORM` invariant | User must keep the pass and required Wallet settings/permissions enabled | Required invariant |

## Apple Wallet — merchant-triggered notifications

### Current mechanism

Apple's documented pass-update sequence is issuer initiated but device mediated:

1. An installed pass containing `webServiceURL` and `authenticationToken` registers a `deviceLibraryIdentifier` and APNs `pushToken` with Waflo.
2. Waflo changes authoritative pass state and sends an empty Wallet update signal through APNs to each active registration.
3. The device asks Waflo which serial numbers changed and retrieves a newly signed `.pkpass`.
4. Wallet decides how and when to present any change notification. APNs delivery can be coalesced and is not a delivery guarantee.

No Waflo customer app is required. The current Waflo Apple update service, protected registrations, update tags, signed-pass retrieval, and wallet worker already implement the state-update foundation.

`changeMessage` belongs to a changed pass field. It is a localizable format string containing `%@`, which Wallet replaces with the new field value. It is not an arbitrary push payload: Waflo does not set an independent notification title, body, image, CTA, or deep link. Links and images can appear in updated pass content, but that is different from controlling the notification UI.

### Targeting

- Every holder of one Loyalty Card: Waflo must select the relevant pass instances and fan out to their active registrations. Apple has no Google-style class notification call.
- One merchant: enforce `organizationId` in the audience query and command records.
- One location: Waflo can select memberships using an explicitly defined ledger/location rule; a membership is not currently assigned to a location.
- One customer: update the membership's pass serial and notify all of its active Apple registrations.
- Filtered segment: Waflo can compute an audience from its own tenant-scoped loyalty data, then issue per-pass updates. This requires future campaign/audience storage.

Apple device registrations identify installations, not marketing consent. A pass can have registrations on multiple devices; Waflo must deduplicate by pass registration semantics, not assume one push token equals one customer.

### Loyalty state versus promotion

Use pass updates for truthful loyalty state such as stamp progress, reward availability, tier, validity, or other pass data. A visible field change message is appropriate only when the change is genuinely time-critical and the message describes that changed value.

Do not use `changeMessage` for “double stamps today,” “new seasonal drink,” or “we miss you.” The Apple Wallet HIG explicitly limits change messages to time-critical information and prohibits marketing/noncritical use. Apple's current loyalty page separately says Wallet can alert customers about campaigns, offers, products, and services and can broadcast or personalize updates. The two sources reconcile as follows:

- the loyalty page describes the overall loyalty capability and engagement outcome;
- the pass web service documents the update transport;
- `changeMessage` documents a constrained field-change alert;
- the HIG governs acceptable use of that field-change alert;
- no current public API page found in this study documents a second free-form Apple Wallet marketing-notification payload, custom alert UI, or numeric promotional quota.

Therefore, generic Apple promotional notification is `PROVIDER_CONFIRMATION_REQUIRED` and should remain disabled. Updating noncritical offer content on the pass without forcing a change alert, or using location relevance where genuinely relevant, is technically distinct and safer.

## Google Wallet — merchant-triggered notifications

Google documents two separate partner-triggered mechanisms.

### Add Message

The Add Message API accepts a `Message` on a `LoyaltyClass` or `LoyaltyObject`:

- `TEXT` stores the message on the pass details without a push.
- `TEXT_AND_NOTIFY` stores it and asks Google Wallet to send a push.
- the issuer controls message header, body, ID, display interval, localized header/body, and a hyperlink related to the pass;
- Google controls the lock-screen notification text, tap behavior, “View Message” callout, and final presentation;
- the Message resource has no notification-image field;
- a loyalty class and a loyalty object each hold at most 10 messages, so lifecycle cleanup is required;
- message data can later be edited or removed with class/object update methods, but an already delivered notification cannot be recalled.

This is the provider-native future path for a guarded Merchant Web action such as “Notify loyalty customers.” It does not require Waflo Mobile or a Waflo customer app.

Class-level messages reach holders of objects using that class. In Waflo, a Google `LoyaltyClass` is bound to one published Loyalty Card Program Version, so “all holders of this Loyalty Card” may require coordinated calls across historical active class bindings. It must not accidentally mean every program in an organization. Object-level messages target one Waflo membership's provider object. A filtered segment requires Waflo to select and enqueue object-level targets; there is no arbitrary Google segment expression in the Wallet API.

### Update Field and Notify

`notifyPreference` is transient and must be supplied on each update request. The REST enum is `NOTIFY_ON_UPDATE`; the guide renders JSON as `notifyOnUpdate`. This is the same mechanism, not two features.

For loyalty passes, Google currently allows notifications for:

- class: `rewardsTier`, `secondaryRewardsTier`, `programName`;
- object: `loyaltyPoints.balance`, `secondaryLoyaltyPoints.balance`.

This mechanism is for real field updates, not a promotional message. Waflo should use it only when its authoritative loyalty state changes and should never fabricate a balance/tier change to obtain a notification.

## Apple Wallet — location relevance

An Apple pass can contain up to 10 `locations`. Each can include localized `relevantText` for the Lock Screen. The optional `maxDistance` is in metres, but Apple uses the smaller of that value and its own default distance. The operating system decides whether the pass is relevant and whether to surface it; `maxDistance: 2000` is only an upper request, not a guaranteed trigger at 2,000 metres.

Location data can be changed on an already installed pass through the normal update flow. Apple provides no public propagation SLA; an update signal can be delayed/coalesced, and the device retrieves the current signed pass when it processes the update.

Apple also supports `relevantDates` (the older singular `relevantDate` is deprecated) and semantic relevance. Waflo's loyalty pass is a Store Card; branch proximity should use location relevance rather than pretending that a promotional time window is a loyalty-state change.

The device performs relevance evaluation. This mechanism does not disclose the customer's live location to Waflo or the merchant.

### iBeacon alternative

Wallet still documents a `beacons` array and Lock Screen relevance for a matching BLE/iBeacon identifier. A pass can carry up to 10 beacon UUID entries; many physical beacons may share one UUID, with major/minor values refining branch or zone behavior. Apple's iBeacon guide describes the “Near” proximity state as roughly 1–3 metres with clear line of sight and warns that physical placement and obstructions affect accuracy. Beacon relevance is useful for in-store or very-near-store presentation, not a 2 km business boundary.

This option requires merchant hardware procurement, powered/configured beacons, secure identifier allocation, placement surveys, monitoring, replacement, and on-site physical-device testing. It is `OPTIONAL_FUTURE_PRODUCT`, not a production-v1 dependency.

## Google Wallet — nearby notifications

Nearby Passes Geofence Notifications became generally available for regular pass types on 2025-10-14. `merchantLocations` may be supplied on a class or object using insert, patch, or update:

- up to 10 locations per class and 10 per object;
- each current `MerchantLocation` is latitude/longitude only;
- Places IDs are not documented by the current resource;
- the deprecated general `locations`/`LatLongPoint` field is explicitly not supported for geofenced notifications;
- Google chooses the trigger radius and required dwell time;
- Google controls the notification text;
- the notification is sticky, opens the pass, can be swiped away, and disappears after the user leaves Google's radius.

The customer must have pass notifications enabled and grant the Google Wallet app precise, always-on location access. If either precise or always-on location access is unavailable, Waflo must treat nearby notification delivery as unavailable. A Waflo customer app is not required, but Google Wallet itself is.

Google Wallet performs the detection. Neither Waflo nor the merchant receives live customer location from this feature.

Coordinates can be changed on an installed object's class/object through insert, patch, or update. Google documents the API operation but no device-delivery or nearby-configuration propagation SLA; timing remains `UNSPECIFIED` and must be tested rather than promised.

## Exact 2 km feasibility

### Apple

Classification: `LOCATION_RELEVANCE_SUPPORTED_BUT_2KM_NOT_GUARANTEED`.

Waflo can encode `maxDistance: 2000`, but Apple documents that it uses the smaller of the supplied maximum and its default. Relevance is an implementation detail controlled by the operating system. Thus 2,000 metres is neither an exact boundary nor a guaranteed presentation distance.

Best native alternative: supply the most relevant branch coordinates and honest location-specific `relevantText`; describe the merchant setting as nearby relevance, not a radius. Use iBeacon only for optional in-store/very-near relevance.

### Google

Classification: `APPROXIMATE_PLATFORM_CONTROLLED_NEARBY_SUPPORTED`.

`MerchantLocation` has latitude and longitude but no radius. Google explicitly chooses both closeness and dwell time. Waflo cannot request exactly 2,000 metres.

Best native alternative: add approved branch coordinates to `merchantLocations`, disclose that Google decides proximity, and avoid displaying a radius control.

## User permissions and opt-out behavior

| Platform | Required state | Opt out while retaining card | Disabled/reduced permission outcome |
| --- | --- | --- | --- |
| Apple | Pass installed; Automatic Updates for update retrieval; Wallet notifications for alerts; Suggest on Lock Screen and Location Services for relevance | The user can disable Automatic Updates, Suggest on Lock Screen, or Wallet notifications without deleting the pass | Updates/alerts/relevance may stop. Apple's Wallet pass documentation does not specify the effect of reduced-precision location on pass relevance, so it is `UNSPECIFIED` and needs device testing |
| Google | Pass saved; Wallet/pass notifications enabled; precise, always-on Google Wallet location permission for nearby | Google added a per-pass notification control; the user can turn it off and keep the pass. Global notification/location controls also remain available | Partner-triggered pushes require notifications. Nearby pushes require precise, always-on permission and should be treated as unavailable otherwise |

Provider notification enablement is not evidence of Waflo marketing consent. Waflo needs its own explicit, revocable Wallet promotional-consent record before any promotional campaign. `LEGAL_REVIEW_REQUIRED` applies to the consent language, lawful basis, retention, and market-specific rules.

Apple's general notification HIG requires explicit agreement before marketing notifications and issuer-managed settings for changing that choice. That page is written in app terms; Waflo's normal customer flow has no customer app. Customer Web could supply issuer-side consent and withdrawal, but whether that satisfies Apple's expectations for promotional Wallet pass communication is `PROVIDER_CONFIRMATION_REQUIRED` rather than assumed.

## Provider notification limits

### Apple

Apple does not publish a numeric Wallet pass-update or change-notification quota in the reviewed current documentation. APNs update signals are not ordinary alert payloads, can be coalesced, and are not guaranteed. Absence of a published quota is not permission to send frequently. Waflo should impose stricter internal caps and use change messages only under HIG rules. Promotional use remains `PROVIDER_CONFIRMATION_REQUIRED`.

### Google

Google documents a maximum of three notification-triggering messages per pass in 24 hours and a maximum of three notification-triggering updates per pass in 24 hours; excess attempts return `QuotaExceededException`, and Google may throttle delivery when it considers behavior spam. The summary does not clearly establish whether these are independent or combined enforcement buckets. Waflo should use one conservative combined per-pass cap below the provider maxima until Google confirms quota accounting.

Nearby notifications are platform generated and have no issuer-configurable frequency field. Google controls proximity/dwell and may apply its own suppression.

## Merchant-controlled content

| Control | Apple pass update/change | Apple location relevance | Google Add Message | Google update/nearby |
| --- | --- | --- | --- | --- |
| Title | No arbitrary alert title | No | Message header stored on pass; lock-screen title controlled by Google | Controlled by Google |
| Body | `changeMessage` format string tied to changed value | Localizable `relevantText` | Header/body controlled and localizable | Update/nearby notification text controlled by Google |
| Call to action | No arbitrary notification CTA | Opens relevant pass | Google provides “View Message”; issuer cannot rename it | Google provides update/pass behavior |
| Link | Updated pass fields/back content may contain detected links | Not a location-notification CTA | Related website/app hyperlink allowed in message body | Not issuer controlled in notification |
| Image | Updated pass artwork can change; not a notification image | Pass artwork only | No Message notification-image field | Not issuer controlled |
| Language | Pass `.lproj` localization and localizable fields | Localizable pass text | `localizedHeader`/`localizedBody` | Provider UI localization |

All content must remain truthful, related to the Loyalty Card, and tenant scoped. Google hyperlinks unrelated to the pass violate its acceptable-use rules. Merchant previews must show provider-specific approximations, never a fake native notification that implies controls Waflo does not have.

## Broadcast versus customer-specific targeting

| Audience | Apple | Google | Waflo requirement |
| --- | --- | --- | --- |
| All active customers of merchant | Per-pass registration fanout | Class messages only if classes exactly match audience; otherwise object fanout | Tenant-scoped query and safety limit |
| Members of one Loyalty Card | Per-pass fanout | All active Program Version classes or object fanout | Include historical active versions deliberately |
| One location | Waflo-selected pass fanout | Waflo-selected object fanout; class only if dedicated class truly maps to audience | Define ledger-based eligibility; membership has no assigned location |
| One customer | One pass serial, possibly many active device registrations | One LoyaltyObject, possibly multiple holders/devices | Idempotent provider-target record |
| Filtered segment | Waflo computes and snapshots serials | Waflo computes and snapshots object IDs | No provider-side arbitrary segmentation |

A Google class call is operationally efficient but has a larger blast radius. Use it only when its exact holder set equals the authorized campaign audience. Prefer explicit object targets for segments and location-specific audiences.

## Multiple merchant locations

Both providers document a limit of 10 geographic locations on the relevant resource: Apple per pass; Google per class and another 10 per object. When a merchant exceeds the limit:

- do not silently take the first 10;
- let the merchant explicitly choose locations or compute customer-relevant branches from Waflo's non-live, historical loyalty activity with clear rules;
- personalize per-object/pass location sets when operationally justified;
- rotate locations only through audited updates and account for propagation delay;
- consider Apple beacon UUID grouping only for an optional managed-hardware product;
- do not create extra Google classes merely to evade limits unless the class lifecycle and audience semantics are correct.

Current `Location` rows contain postal address and timezone but no latitude/longitude or provider Place ID. Coordinates and verification would require new storage and merchant workflow. Google currently documents latitude/longitude, not Place IDs.

## Wallet-only architecture

The normal flow remains:

`Customer Web -> Apple Wallet or Google Wallet`

No customer Waflo app is required. Apple evaluates pass relevance on device; Google Wallet evaluates Nearby Notifications. Neither provider returns customer live location to Waflo. Merchant Web configures issuer-owned content and branch coordinates; providers control delivery/presentation.

Mobile-facing API contract changed: **NO**

Staff Mobile action required now: **NO**

Customer Waflo app required: **NO**

## Optional future customer-app geofencing

Classification: `OPTIONAL_FUTURE_PRODUCT`, not production v1.

A future customer app could register circular geofences with Apple Core Location or Android geofencing APIs. This would permit a configurable 2,000-metre requested radius, but still would not guarantee a mathematically exact boundary because operating systems trade accuracy, latency, power, and privacy. Apple limits monitored regions and caps radius to device capability. Android requires fine and, for background use, background location permission; it documents latency and accuracy constraints and a per-app geofence limit.

This product would add an app-install requirement, prominent permission/disclosure flows, background-location review, privacy and retention obligations, battery/platform constraints, App Store/Google Play policy review, and a substantially different abuse surface. Google Play says background location must be core functionality with significant user benefit and not solely advertising/analytics. Apple requires location use to be directly relevant and consented.

It must remain optional and must never gate the existing Customer Web + Wallet loyalty flow. It is not justified merely to force an “exact 2 km” marketing claim.

## Privacy and consent

- Apple/Google location processing for Wallet relevance does not give Waflo or the merchant a live-location feed. Waflo should store branch coordinates only, not customer coordinates.
- Provider notification settings and location permission are necessary platform controls, not affirmative Waflo marketing consent.
- The existing Waflo consent model includes privacy, program terms, and marketing email; it does not establish Wallet promotional consent. Marketing email consent must not be repurposed.
- Add explicit, channel-specific, revocable consent before promotional Wallet messages; default promotions off. `LEGAL_REVIEW_REQUIRED`.
- Provide a Customer Web preference/unsubscribe path in addition to provider controls. Revocation must suppress future queued sends while leaving the Loyalty Card usable.
- Define retention for campaign targets, delivery metadata, content, consent evidence, and audit history. Avoid retaining provider responses or identifiers beyond operational need.
- Birthday automation is unavailable because the current schema does not authoritatively collect birthday; collecting it would require separate minimization, purpose, and legal review.
- Do not infer location presence from a subsequent stamp as if it were live tracking; it is an attribution signal with limitations.

This report makes no jurisdiction-specific legal conclusion.

## Anti-spam and tenant safety

Technically mandatory controls:

- enforce authenticated organization and role authorization on creation, approval, cancellation, and audience estimation;
- bind every campaign, target, and delivery to `organizationId` and verify ownership again in the worker;
- snapshot/audit the approved audience and content before enqueueing;
- use stable idempotency keys per campaign, provider, target, and content version;
- use worker leases/atomic claims so multiple instances cannot duplicate a send;
- enforce provider quotas, per-pass cooldowns, retry/backoff, and global emergency limits;
- suppress revoked consent, inactive memberships, invalidated passes, unregistered Apple devices, and already-completed targets at send time;
- never log APNs tokens, Google credentials, pass auth tokens, customer location, or unrestricted message bodies;
- provide a global/tenant disable switch and safe cancellation of unsent work.

Product safeguards:

- merchant opt-in and default-off promotional capability;
- conservative per-merchant/customer/platform frequency caps lower than provider limits;
- quiet hours in the customer's/merchant's appropriate timezone;
- provider-specific preview and content validation;
- audience estimate plus an explicit confirmation for large sends;
- explicit branch selection and a warning that nearby radius is provider controlled;
- campaign audit history, abuse reporting, content moderation/escalation, and tenant suspension;
- no notification storms when a program update and campaign coincide.

## Proposed Merchant Web experience

Current Merchant terminology uses **Loyalty Cards**, **Customers**, **Locations**, and **Analytics**. The narrow future name should be **Wallet engagement** inside a Loyalty Card detail, rather than a new top-level “Customer Engagement” area before Waflo has multiple engagement channels.

### Manual campaign

The merchant chooses:

- Loyalty Card (organization is implicit from the authenticated tenant);
- Apple Wallet and/or Google Wallet, with unsupported Apple promotion disabled;
- audience: all active members, reward ready, near reward, inactive under a defined ledger rule, or individually selected customers;
- optional branch-based historical segment, clearly not a live-location audience;
- localized message, related link, start, expiry, quiet hours;
- preview, audience estimate, consent-eligible count, and final confirmation.

The UI must display provider differences. Google can support a post-v1 `TEXT_AND_NOTIFY` action. Apple can show state/relevance updates but must not offer arbitrary promotional pushes until Apple confirms the approved mechanism.

### Loyalty automation

- Reward ready and genuine progress/tier updates: loyalty-state events; eligible for provider update mechanisms.
- Inactivity, birthday, seasonal offer, and “we miss you”: marketing; require explicit consent, caps, and legal review.
- Birthday remains unavailable until lawfully collected data and purpose-specific product design exist.
- Expiry and merchant-defined events need unambiguous trigger semantics and deduplication.

### Nearby relevance

Offer one business-level **Nearby Wallet reminders** switch plus deterministic participating-location selection. The organization switch overrides all cards; each Program Version can only receive selected locations that already participate in that card. Show the 10-location limits and “Distance and timing are controlled by Apple/Google and the customer’s device settings.” Do not expose a 2 km slider or mention promotional consent in this control.

## Proposed Backend architecture

Report-only target flow:

`Merchant Web -> authenticated API -> campaign command -> durable outbox/job -> multi-instance-safe worker -> provider adapter -> Apple Wallet / Google Wallet`

The HTTP request validates authorization/content, creates an immutable campaign definition and audience-snapshot job transactionally, and returns. It must not synchronously fan out notifications.

### Processing model

- Materialize or cursor through a tenant-scoped audience at a fixed snapshot time; recheck consent and pass activity immediately before send.
- Use campaign/provider/target/content-version idempotency keys and atomic worker claims with expiring leases.
- Separate state-update priority from campaign traffic so promotions cannot delay reward/pass correctness.
- Apple adapter: update the signed pass representation and queue APNs update signals only for allowed state/relevance use cases.
- Google adapter: choose class Add Message only for an exact class-wide audience; otherwise enqueue object Add Message. Use transient notify preference only for genuine allowlisted field updates.
- Apply per-target, per-tenant, provider, and global token buckets before calls. Treat `QuotaExceededException`/429 as rate-limited, retry with jitter, and cap attempts.
- Record pending, suppressed, sent-to-provider, provider-rejected, retrying, permanently failed, and cancelled states. “Sent-to-provider” is not proof displayed/read.
- Allow cancellation of unsent targets. Removal of stored provider message content does not retract an already delivered alert.
- Generate locale variants from explicit reviewed content with a required default. Never auto-translate silently at send time.
- Handle partial provider failures independently; one provider outage must not duplicate successful sends on the other.
- Collect aggregate metrics without message bodies, credentials, push tokens, or live location. Restrict detailed target history and set retention.
- Keep provider credentials in the existing secret boundary and expose only safe provider request IDs/error categories.

## Existing Waflo components reusable

Repository inspection found these authoritative foundations:

- `WalletProgramBinding`: immutable provider binding per published Program Version; Google class identity is already version scoped.
- `WalletPassInstance`: membership/provider identity, status, state, update tag, and provider sync status.
- `ApplePassRegistration`: protected device-registration hash and encrypted APNs token with unregister state.
- `WalletCommand`: durable idempotent command, attempts, lease, retry schedule, safe error, and provider request ID.
- `ProgramWalletSyncJob`: batched/cursored, leased, idempotent program-wide wallet fanout.
- `wallet-worker`: multi-instance claims, provider adapters, Apple push queueing, retry, and reconciliation outside HTTP.
- `MembershipProgressProjection`: authoritative stamp progress and `rewardReady`.
- `RewardEntitlement`: available/redeemed/expired reward lifecycle.
- `LoyaltyLedgerEntry`: customer, membership, Loyalty Card/version, optional action location, event, and occurrence time.
- `Customer.preferredLocale`, active membership state, program locations, and existing audit/authentication boundaries.

These are reusable patterns, not evidence that campaign, consent, coordinates, or notification-delivery features already exist.

### Currently available data

- active customers/memberships within one organization and Loyalty Card;
- members enrolled under a Program Version;
- current progress, `rewardReady`, and progress-near-reward derived from the published stamp requirement;
- ledger-derived last qualifying visit/stamp and earned/redeemed-at-location, once product semantics are precisely defined;
- active Apple Wallet registrations (`unregisteredAt` is null);
- provisioned/synced Google Wallet objects via pass-instance provider identity/status.

A provisioned Google object does not prove that a user has saved it. Immediately before a manual
`TEXT_AND_NOTIFY` send, Waflo now retrieves the Google object and requires authoritative
`hasUsers=true`. `false` is stored as a non-delivered `NO_ACTIVE_WALLET_HOLDER` skip; unavailable or
missing state receives only the existing bounded retry policy and is never guessed true. Nearby
class synchronization does not perform per-customer `hasUsers` lookups.

### Not authoritative at the original research checkpoint

- membership assigned to one branch (only ledger events may carry a location);
- materialized “last visit” with agreed event/reversal semantics;
- customer birthday;
- Wallet promotional consent/preference (now implemented as audited `WALLET_PROMOTIONS` consent);
- branch latitude/longitude or Google Place ID (latitude/longitude are now implemented; Google Place ID remains unnecessary);
- customer live location, entry, dwell, or exit;
- notification display, open, or read receipt.

## Implemented components (original requirements retained)

- campaign definition, status machine, approval/audit record, schedule, locale content, and cancellation;
- immutable audience snapshot/cursor and per-provider/per-target delivery state;
- Wallet promotional consent/preferences and Customer Web unsubscribe controls;
- verified branch coordinates and nearby-enabled configuration;
- campaign API, authorization policy, validation, audience estimator, and Merchant Web screens;
- provider-specific message/relevance adapters and throttlers;
- quiet-hours/frequency-cap service, emergency disable switch, abuse controls, and aggregate metrics;
- physical-device/provider conformance test harness and operating runbooks.

## Database implementation

Migration `20260812170000_wallet_engagement` adds:

- `WalletEngagementCampaign` and localized content/schedule/audience definition;
- audience snapshot or resumable target rows;
- provider delivery/attempt/audit state with idempotency and safe errors;
- channel-specific consent/preference and revocation evidence;
- verified `Location` coordinates and nearby enablement/provider sync state;
- frequency-cap/cooldown accounting and possibly a materialized last-qualifying-visit projection.

Do not place message bodies in general operational logs. Do not add customer location storage.

Database schema changed by implementation: **YES**, additively and without changing existing-customer consent from its off-by-absence default.

## Provider approval/external requirements

### Apple

- Existing Pass Type ID, signing certificate, and production APNs Wallet update capability must remain valid.
- Promotional alert behavior needs direct Apple/provider confirmation before Waflo ships a generic campaign control.
- HIG review, explicit consent design, and physical-device validation are required.
- Beacon relevance would require managed compatible beacon hardware and field operations.

### Google

- Demo Mode is limited to issuer Admin/Developer/test accounts and shows `[TEST ONLY]`; public users require Google publishing access/approval.
- The issuer must remain compliant with Google Wallet API terms and Acceptable Use Policy; unrelated links, deceptive/spam content, and restricted categories are not acceptable.
- Current production publishing status and quotas must be verified before a pilot.

## Operator staging and physical-device test plan — EXTERNAL-PHYSICAL-TEST-PENDING

Provider behavior is meaningful only on physical devices; simulator/API success cannot prove delivery or geofence behavior.

### Apple matrix

1. Install a test Store Card on supported iPhone/Apple Watch combinations and confirm registration fields reach the existing service.
2. Change real loyalty state, send the empty APNs Wallet update, and verify updated-serial lookup and signed `.pkpass` retrieval.
3. Test notification on/off, Automatic Updates on/off, Suggest on Lock Screen on/off, Location Services states, device lock, reboot, and multiple devices.
4. Test field updates with and without compliant `changeMessage`; verify localization and that no unsupported custom alert assumptions exist.
5. Test 1, 10, and updated branch locations at varied distances. Record observed behavior only; do not convert observations into a radius guarantee.
6. If evaluated, test real iBeacon hardware, interference/obstructions, shared UUID plus major/minor, entry/exit, and operational monitoring.

### Google matrix

1. Use approved issuer test accounts in Demo Mode, then a publishing-approved controlled pilot; verify class and object Add Message behavior separately.
2. Test `TEXT`, `TEXT_AND_NOTIFY`, localization, related link, edit/removal, per-pass notification opt-out, global notification off, and quota errors.
3. Test allowlisted genuine loyalty field updates with transient `NOTIFY_ON_UPDATE`; confirm provider-generated text.
4. Test Nearby Notifications on physical Android devices with precise/always-on permission combinations, 1/10 class and object locations, entry, dwell, swipe dismissal, and exit disappearance.
5. Measure observed distance/time across device models and OS versions only to find defects; label it platform controlled, never a service-level promise.
6. Test >10 rejection, coordinate updates, class/object overlap, multiple saved passes, and partial provider failures.

No real customers or production mass send should be used for validation.

### Required staging sequence after public TLS repair

#### Google manual message

1. Use a controlled test customer and explicitly opt in to `WALLET_PROMOTIONS` in Customer Web.
2. Save the Google Loyalty Card and verify the expected object identity before sending.
3. Create one Merchant Web campaign and verify the durable campaign/delivery/command records before the worker calls Google.
4. Verify message content in Google Wallet, the Google-controlled system notification, and the destination opening the intended merchant/Waflo page.
5. Exercise quota behavior with provider-approved test procedures; never intentionally spam a pass or real customer.

#### Apple manual message

Do not test or expose this path unless Apple confirms a documented compliant mechanism and the adapter is independently reviewed. If approved later, physical-iPhone verification is mandatory. `changeMessage` must remain excluded from promotional delivery.

#### Apple nearby relevance

1. Save the Loyalty Card on a physical iPhone and enable the relevant Wallet/location settings.
2. Approach a configured merchant location and verify that the signed pass contains the selected coordinates and vertical-specific localized `relevantText`.
3. Record observed relevance behavior, pass-refresh behavior, and localization. Never report an exact two-kilometre trigger.

#### Google nearby relevance

1. Save the Loyalty Card on a physical Android device; enable Wallet notifications and the precise/always-on location permissions required by Google.
2. Approach a configured merchant location and verify the provider-generated nearby notification and documented disappearance after leaving.
3. Confirm that no radius or merchant-authored nearby notification text was sent. Never report an exact radius.

## Business measurement plan

Nearby reminders increasing sales is a hypothesis, not an established result. A later consented pilot could record:

- campaign/provider/eligible-audience/sent-to-provider counts;
- pass/message opens only where the provider exposes an authoritative signal;
- qualifying visit/stamp or redemption within a predeclared conversion window;
- aggregate comparison with a randomized holdout/control cohort where appropriate;
- frequency, opt-out, complaint, suppression, and error rates as guardrails.

Attribution is limited: provider acceptance is not delivery; delivery is not view; a later visit may have occurred without the notification; devices/users may share passes; Apple does not provide a campaign read receipt; Google metrics may be aggregate/privacy thresholded. Report association and experiment estimates, not deterministic causation. `LEGAL_REVIEW_REQUIRED` applies to experiment consent, data minimization, and retention.

## Risks

- Apple promotional documentation ambiguity and HIG rejection risk.
- Merchant spam, deceptive content, unrelated links, and restricted-category abuse.
- Cross-tenant audience or class-level blast-radius error.
- Duplicate sends from retries/multiple workers or overlapping automation/manual campaigns.
- Provider quota exhaustion causing loyalty-state notifications to be suppressed.
- False promise of exact proximity, inconsistent OS behavior, or permission-disabled users.
- More than 10 branches and stale/incorrect coordinates.
- Mistaking provisioned Google objects or Apple registrations for consent or active attention.
- Sensitive campaign content, identifiers, or consent evidence leaking through logs/analytics.
- Weak attribution leading to unsupported sales claims.

## Historical recommendation for production v1 — superseded by implementation status

- Do not implement merchant promotional Wallet campaigns.
- Do not implement nearby configuration or claim exact 2 km.
- Continue existing truthful Apple/Google loyalty-state synchronization only.
- Do not change Customer Web, Staff Mobile, Apple signing, Google signing, NFC/Smart Tap/POS scope, reward lifecycle, or the FILLED/EMPTY stamp-grid invariant.
- Record public Cloudflare edge TLS/certificate coverage as a separate external deployment blocker; it has no bearing on this product study.

Classification: promotional engagement `NOT_RECOMMENDED` for production v1; exact 2 km `NOT_SUPPORTED`.

## Historical recommendation for post-v1 — retained for decision history

1. Obtain legal review and provider confirmation, particularly for Apple promotional communication.
2. Add channel-specific consent, audit, caps, quiet hours, tenant isolation, emergency shutoff, and coordinates through reviewed migrations.
3. Physically validate Google Add Message/update/Nearby behavior and Apple state update/location relevance.
4. Pilot Google `TEXT_AND_NOTIFY` for a small, explicitly opted-in cohort with conservative caps and holdout measurement.
5. Consider provider-native nearby relevance using non-radius wording and explicit branch selection.
6. Consider Apple promotion only after Apple confirms the compliant API/content mechanism; otherwise limit Apple to state changes, passive pass offer content, and relevance.
7. Keep app-based configurable geofencing and iBeacon operations optional future products.

## Historical product decision proposal — superseded

The following proposal is retained as decision history. The software safeguards it required are now implemented; the current decision is Google manual promotion plus Apple/Google provider-native nearby relevance, with Apple manual promotion still disabled pending provider confirmation.

Adopt these decisions:

- **Production v1:** no Wallet marketing campaign feature and no nearby feature.
- **Post-v1 provider-native nearby:** proceed to design/physical validation, described as platform-controlled nearby relevance; never promise 2 km.
- **Post-v1 Google promotions:** eligible for a guarded pilot using `TEXT_AND_NOTIFY`, after consent, publishing/quota verification, backend durability, Merchant UI, and abuse controls.
- **Apple promotions:** defer behind `PROVIDER_CONFIRMATION_REQUIRED`; never misuse `changeMessage`.
- **Loyalty state:** continue provider-specific pass updates; keep them separate from marketing.
- **Location privacy:** Waflo stores merchant branch coordinates only and does not collect customer live location.
- **Customer app:** remains unnecessary. App-based geofencing is `OPTIONAL_FUTURE_PRODUCT` only.

## Official primary source register

Only provider-owned primary sources were used for provider claims. “Guaranteed” below means the cited schema/API contract or explicit documented limit, not guaranteed delivery, display, timing, or commercial outcome. Pages without a visible date are marked accordingly and were accessed on 2026-08-12.

| Page/document title | Provider | Current documented behavior and relevant limit | Date shown | Result control |
| --- | --- | --- | --- | --- |
| [Loyalty and membership passes on Apple platforms](https://developer.apple.com/wallet/loyalty-passes/) | Apple | Passes work without an issuer app; Apple describes real-time state, offer/campaign alerts, broadcast/personalized engagement, and time/location relevance | No visible update date; accessed 2026-08-12 | `UNSPECIFIED` for exact promotional API/delivery |
| [Wallet — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/wallet/) | Apple | Use change messages only for time-critical updates; never for marketing/noncritical communication | Page metadata updated 2026-06-08 | `GUARANTEED` design constraint; display platform controlled |
| [Adding a Web Service to Update Passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes) | Apple | Device registration, APNs update signal, changed serial query, and updated signed-pass retrieval | No visible update date; accessed 2026-08-12 | API flow documented; delivery `PLATFORM-CONTROLLED` |
| [Register a Pass for Update Notifications](https://developer.apple.com/documentation/walletpasses/register-a-pass-for-update-notifications) | Apple | Registration path uses `deviceLibraryIdentifier`; body contains push token | No visible update date; accessed 2026-08-12 | `GUARANTEED` API contract |
| [Pass](https://developer.apple.com/documentation/walletpasses/pass) | Apple | Up to 10 locations; `maxDistance` is metres but system uses smaller of requested/default; `relevantDate` deprecated for `relevantDates`; beacons supported | No visible update date; accessed 2026-08-12 | Limit `GUARANTEED`; actual relevance `PLATFORM-CONTROLLED` |
| [Showing a Pass on the Lock Screen](https://developer.apple.com/documentation/walletpasses/showing-a-pass-on-the-lock-screen) | Apple | System evaluates date/location/beacon relevance; physical-device testing; select/update best 10 locations | No visible update date; accessed 2026-08-12 | `PLATFORM-CONTROLLED` |
| [Pass.Locations](https://developer.apple.com/documentation/walletpasses/pass/locations-data.dictionary) | Apple | Latitude/longitude/altitude and localizable `relevantText` used when pass is relevant | No visible update date; accessed 2026-08-12 | Data contract `GUARANTEED`; presentation platform controlled |
| [Pass.Beacons](https://developer.apple.com/documentation/walletpasses/pass/beacons-data.dictionary) | Apple | BLE beacon UUID with optional major/minor and Lock Screen `relevantText` | No visible update date; accessed 2026-08-12 | Support documented; detection `PLATFORM-CONTROLLED` |
| [Getting Started with iBeacon](https://developer.apple.com/ibeacon/Getting-Started-with-iBeacon.pdf) | Apple | “Near” is approximately 1–3 m in clear line of sight; placement/obstructions affect accuracy | Version 1.0; no reliable current revision date shown | `PLATFORM-CONTROLLED`/environment dependent |
| [PassFieldContent](https://developer.apple.com/documentation/walletpasses/passfieldcontent) | Apple | `changeMessage` is a localizable `%@` format tied to changed field value | No visible update date; accessed 2026-08-12 | Data contract `GUARANTEED`; notification presentation controlled |
| [Change the pass settings in Wallet](https://support.apple.com/en-mide/guide/ipod-touch/iph46f49b562/ios) | Apple | User controls Automatic Updates, Suggest on Lock Screen, Wallet notifications/location settings | No visible update date; accessed 2026-08-12 | User controlled |
| [Wallet & Privacy](https://www.apple.com/legal/privacy/data/en/wallet/) | Apple | Pass management can involve an issuer device identifier; users can disable Automatic Updates; Wallet privacy boundaries described | Published within eight months before research date | User/provider controlled; issuer live location not documented |
| [Creating the Source for a Pass](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass) | Apple | Pass content supports `.lproj` localizations and localized images/strings | No visible update date; accessed 2026-08-12 | `GUARANTEED` package capability |
| [Trigger Push Notifications](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications) | Google | Add Message `TEXT`/`TEXT_AND_NOTIFY`; allowlisted update notifications; three-per-pass/24h limits; Nearby permissions/10+10 locations/provider-selected radius, dwell, text | Last updated 2026-08-07 UTC | API/limits `GUARANTEED`; display/relevance `PLATFORM-CONTROLLED` |
| [Message](https://developers.google.com/wallet/reference/rest/v1/Message) | Google | Header/body, localized variants, display interval, related hyperlink, `TEXT` and `TEXT_AND_NOTIFY`; no image field | Last updated 2025-03-13 UTC | Data contract `GUARANTEED`; push UI controlled |
| [NotificationSettingsForUpdates](https://developers.google.com/wallet/reference/rest/v1/NotificationSettingsForUpdates) | Google | Transient `NOTIFY_ON_UPDATE` preference for allowlisted fields | Last updated 2024-10-23 UTC | API contract `GUARANTEED`; delivery controlled |
| [Managing notifications — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/managing-notifications) | Apple | Marketing notifications require explicit agreement and issuer-managed opt-in/out settings; marketing must not be Time Sensitive | No visible update date; accessed 2026-08-12 | Consent requirement documented for apps; Wallet-only application `UNSPECIFIED` |
| [REST Resource: loyaltyclass](https://developers.google.com/wallet/reference/rest/v1/loyaltyclass) | Google | Class messages/updates affect objects using class; max 10 messages and max 10 `merchantLocations` | Last updated 2025-03-18 UTC | Fanout/data contract `GUARANTEED`; receipt controlled |
| [REST Resource: loyaltyobject](https://developers.google.com/wallet/reference/rest/v1/loyaltyobject) | Google | Object-level messages, transient notify preference, `hasUsers`, and max 10 merchant locations; deprecated `locations` not for geo notifications | Last updated 2025-03-18 UTC | Data contract `GUARANTEED`; save/delivery state limited |
| [MerchantLocation](https://developers.google.com/wallet/reference/rest/v1/MerchantLocation) | Google | Latitude/longitude; Google-set radius+dwell; notification hidden after exit | Last updated 2025-03-18 UTC | Coordinates contract `GUARANTEED`; trigger `PLATFORM-CONTROLLED` |
| [Wallet release notes](https://developers.google.com/wallet/docs/release-notes) | Google | Nearby Passes became GA for regular passes with 10 class/object locations on 2025-10-14; per-pass notification control announced 2024-12-19 | Release dated entries | Availability `GUARANTEED`; behavior controlled |
| [Update passes](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/updates) | Google | Class updates fan out; object updates target an object | Last updated 2026-07-20 UTC | API semantics `GUARANTEED`; display controlled |
| [Request publishing access](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/request-publishing-access) | Google | Demo Mode only for Admin/Developer/test accounts and `[TEST ONLY]`; public issue requires publishing access | Last updated 2026-07-20 UTC | Provider approval required |
| [Google Wallet API Acceptable Use Policy](https://payments.developers.google.com/terms/aup) | Google | Communications/offers must be high quality, truthful, relevant, and policy compliant; provider may restrict abuse | Page displays “Effective April 31, 2025,” an invalid calendar date; reconfirm before launch | Provider enforcement `PLATFORM-CONTROLLED` |
| [Google Wallet API Terms of Service](https://developers.google.com/wallet/terms-of-service) | Google | Privacy, authorization, acceptable-use, and suspension obligations | Last modified 2022-06-08; page updated 2026-07-20 UTC | Contractual/provider controlled |
| [Issue loyalty cards on the web](https://developers.google.com/wallet/retail/loyalty-cards/web) | Google | Signed Add to Google Wallet link supports web issuance without a Waflo customer app | Last updated 2026-07-20 UTC | API flow documented; user save required |
| [Core Location](https://developer.apple.com/documentation/corelocation) and [Monitoring geographic regions](https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions) | Apple | Optional native app can monitor circular regions subject to permission/device limits | No visible update date; accessed 2026-08-12 | `OPTIONAL_FUTURE_PRODUCT`, OS controlled |
| [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) | Apple | Background/location use must be relevant, consented, and policy compliant | Live guideline; accessed 2026-08-12 | App review/provider controlled |
| [Create and monitor geofences](https://developer.android.com/develop/sensors-and-location/location/geofencing) | Google/Android | Optional app geofences accept radius; up to 100 per app/user; fine/background location and latency/accuracy constraints | Live page accessed 2026-08-12 | `OPTIONAL_FUTURE_PRODUCT`, OS controlled |
| [Google Play background location policy](https://support.google.com/googleplay/android-developer/answer/9799150) | Google Play | Background location must be core/significantly beneficial, disclosed, and reviewed; not solely ads/analytics | Live policy accessed 2026-08-12 | App review/provider controlled |

## Explicit non-impact statement

- Loyalty stamp grid changed: **NO**; remains exactly FILLED or EMPTY.
- Merchant term changed: **NO**; remains Loyalty Card / Loyalty Cards.
- Reward lifecycle changed: **NO**.
- Staff Mobile auth/pairing or manager approval changed: **NO**.
- Customer Web normal loyalty flow changed: **NO**.
- Apple Wallet signing contract changed: **NO**.
- Google Wallet signing contract changed: **NO**.
- Smart Tap/NFC/POS scope changed: **NO**.
- Mobile-facing API contract changed: **NO**.
- Staff Mobile action required now: **NO**.
- Customer Waflo app required: **NO**.
- Wallet notification feature implemented: **YES for Google object-level manual messages and provider-native nearby relevance; Apple manual promotion remains `PROVIDER_CONFIRMATION_REQUIRED`**.
- Customer tracking implemented: **NO**.
- Customer live-location collection added to Waflo: **NO**; merchant business coordinates added: **YES**.
- Database schema changed: **YES**, additive only.
- Migration files changed: **YES**, exactly `20260812170000_wallet_engagement`.

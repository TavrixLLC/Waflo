import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  billingFailurePolicy,
  billingGraceDeadline,
  billingRecoverySchedule,
  cadencePrice,
  isExactlyTwoLocalCalendarDaysBefore,
  planDowngradeViolations,
  renderBillingEmail,
} from "../../packages/billing/src/index.js";
import {
  countryCodeSchema,
  countryCodes,
  countryOptions,
  isCanonicalTimeZone,
  registerSchema,
  timeZoneIds,
  timeZoneOptions,
  timezoneSchema,
} from "../../packages/contracts/src/index.js";
import { parseEnvironment } from "../../packages/config/src/index.js";
import { messages } from "../../packages/i18n/src/index.js";
import { renderStampSvg } from "../../packages/stamp-engine/src/index.js";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import { walletPlatform } from "../../apps/customer-web/app/wallet-platform.js";

describe("production-v1 UX and billing repair", () => {
  it("keeps merchant branding additive, tenant-scoped, and asynchronously refreshed for Wallet", () => {
    const schema = readFileSync("packages/database/prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "packages/database/prisma/migrations/20260818143000_organization_brand_logo/migration.sql",
      "utf8",
    );
    const organizations = readFileSync(
      "apps/api/src/organizations/organizations.service.ts",
      "utf8",
    );
    const worker = readFileSync("apps/wallet-worker/src/main.ts", "utf8");
    const previews = readFileSync("apps/api/src/programs/preview-composer.ts", "utf8");
    const publicEnrollment = readFileSync(
      "apps/api/src/enrollment/public-enrollment.service.ts",
      "utf8",
    );
    const customerCard = readFileSync("apps/api/src/customer/customer-card.service.ts", "utf8");
    const builder = readFileSync(
      "apps/merchant-dashboard/components/program-card-builder.tsx",
      "utf8",
    );
    const quickWizard = readFileSync(
      "apps/merchant-dashboard/components/program-quick-wizard.tsx",
      "utf8",
    );
    const studio = readFileSync(
      "apps/merchant-dashboard/components/program-studio-editor.tsx",
      "utf8",
    );
    const launch = readFileSync(
      "apps/merchant-dashboard/components/program-launch-experience.tsx",
      "utf8",
    );
    const brandMark = readFileSync(
      "apps/merchant-dashboard/components/merchant-brand-mark.tsx",
      "utf8",
    );
    expect(schema).toContain("brandLogoAssetId      String?");
    expect(migration).toContain('ADD COLUMN "brand_logo_asset_id" UUID');
    expect(organizations).toContain('category: "LOGO"');
    expect(organizations).toContain('source: "MERCHANT_UPLOAD"');
    expect(organizations).toContain('processingStatus: "READY"');
    expect(organizations).toContain("MERCHANT_BRANDING_CHANGED");
    expect(organizations).toContain("batchSize: 500");
    expect(worker).toContain("ensureGoogleProgramLogo");
    expect(worker).toContain("merchantApplePassImages");
    expect(worker).toContain('"logo@2x.png"');
    expect(previews).toContain("merchantBrandLogoDataUri");
    expect(previews).toContain('data-issuer-brand="organization"');
    expect(publicEnrollment).toContain("brandLogoDataUri");
    expect(customerCard).toContain("brandLogoDataUri");
    expect(builder).not.toContain('category="LOGO"');
    expect(quickWizard).not.toContain('category="LOGO"');
    expect(studio).toContain("MerchantBrandMark");
    expect(studio).toContain("savedDraft={hasUnpublishedChanges ? displayDraft : null}");
    expect(launch).toContain("MerchantBrandMark");
    expect(brandMark).toContain('credentials: "include"');
    expect(brandMark).toContain("reader.readAsDataURL(blob)");
    expect(brandMark).toContain("privateImageCache");
    const capabilities = readFileSync("packages/contracts/src/platform-capabilities.ts", "utf8");
    expect(capabilities).toContain('support: "SUPPORTED"');
    expect(capabilities).toContain(
      "normalized merchant logo is packaged in the Apple pass logo slot",
    );
  });

  it("models quarterly and yearly prices with exact advertised discounts", () => {
    expect(cadencePrice("starter", "monthly").billedAmountUsd).toBe(29);
    expect(cadencePrice("growth", "monthly").billedAmountUsd).toBe(69);
    expect(cadencePrice("scale", "monthly").billedAmountUsd).toBe(129);
    expect(cadencePrice("starter", "quarterly").billedAmountUsd).toBe(79.75);
    expect(cadencePrice("growth", "quarterly")).toEqual({
      monthlyEquivalentUsd: 63.25,
      billedAmountUsd: 189.75,
      undiscountedAmountUsd: 207,
    });
    expect(cadencePrice("scale", "quarterly").billedAmountUsd).toBe(354.75);
    expect(cadencePrice("starter", "yearly").billedAmountUsd).toBe(290);
    expect(cadencePrice("growth", "yearly")).toEqual({
      monthlyEquivalentUsd: 57.5,
      billedAmountUsd: 690,
      undiscountedAmountUsd: 828,
    });
    expect(cadencePrice("scale", "yearly").billedAmountUsd).toBe(1290);
  });

  it("keeps monthly bootable without cadence IDs and rejects partial cadence groups", () => {
    const monthly = {
      NODE_ENV: "test",
      STRIPE_SECRET_KEY: "sk_test_monthly",
      STRIPE_WEBHOOK_SECRET: "whsec_monthly",
      STRIPE_STARTER_MONTHLY_PRICE_ID: "price_monthly_starter",
      STRIPE_GROWTH_MONTHLY_PRICE_ID: "price_monthly_growth",
      STRIPE_SCALE_MONTHLY_PRICE_ID: "price_monthly_scale",
    };
    expect(parseEnvironment(monthly).STRIPE_STARTER_QUARTERLY_PRICE_ID).toBeUndefined();
    expect(() =>
      parseEnvironment({
        ...monthly,
        STRIPE_STARTER_QUARTERLY_PRICE_ID: "price_quarterly_starter",
      }),
    ).toThrow("Invalid Waflo environment configuration");
    expect(() =>
      parseEnvironment({
        ...monthly,
        STRIPE_STARTER_YEARLY_PRICE_ID: "price_yearly_starter",
        STRIPE_GROWTH_YEARLY_PRICE_ID: "price_yearly_growth",
      }),
    ).toThrow("Invalid Waflo environment configuration");
    expect(
      parseEnvironment({
        ...monthly,
        STRIPE_STARTER_QUARTERLY_PRICE_ID: "price_quarterly_starter",
        STRIPE_GROWTH_QUARTERLY_PRICE_ID: "price_quarterly_growth",
        STRIPE_SCALE_QUARTERLY_PRICE_ID: "price_quarterly_scale",
      }).STRIPE_SCALE_QUARTERLY_PRICE_ID,
    ).toBe("price_quarterly_scale");
    expect(
      parseEnvironment({
        ...monthly,
        STRIPE_STARTER_YEARLY_PRICE_ID: "price_yearly_starter",
        STRIPE_GROWTH_YEARLY_PRICE_ID: "price_yearly_growth",
        STRIPE_SCALE_YEARLY_PRICE_ID: "price_yearly_scale",
      }).STRIPE_SCALE_YEARLY_PRICE_ID,
    ).toBe("price_yearly_scale");
    expect(() =>
      parseEnvironment({
        ...monthly,
        STRIPE_STARTER_MONTHLY_PRICE_ID: "prod_not_a_price",
      }),
    ).toThrow("Invalid Waflo environment configuration");
  });

  it("uses complete canonical ISO countries and runtime IANA timezones", () => {
    expect(countryCodes).toHaveLength(249);
    expect(countryCodeSchema.parse("iq")).toBe("IQ");
    expect(() => countryCodeSchema.parse("ZZ")).toThrow();
    expect(countryOptions("ar").find((country) => country.code === "IQ")?.name).toBeTruthy();
    expect(timeZoneIds.length).toBeGreaterThan(400);
    expect(timeZoneIds).toEqual(
      expect.arrayContaining(["UTC", "Asia/Baghdad", "Europe/London", "America/New_York"]),
    );
    expect(isCanonicalTimeZone("Asia/Baghdad")).toBe(true);
    expect(timezoneSchema.safeParse("UTC+03:00").success).toBe(false);
    expect(timezoneSchema.safeParse("Mars/Olympus_Mons").success).toBe(false);
    expect(timeZoneOptions("en", new Date("2026-08-12T12:00:00Z"))[0]?.label).toMatch(/GMT|UTC/);
  });

  it("finds exactly the local two-calendar-day reminder window across DST", () => {
    expect(
      isExactlyTwoLocalCalendarDaysBefore(
        new Date("2026-03-06T23:30:00.000Z"),
        new Date("2026-03-09T13:00:00.000Z"),
        "America/New_York",
      ),
    ).toBe(false);
    expect(
      isExactlyTwoLocalCalendarDaysBefore(
        new Date("2026-03-07T05:01:00.000Z"),
        new Date("2026-03-09T13:00:00.000Z"),
        "America/New_York",
      ),
    ).toBe(true);
  });

  it("enforces the immutable 48-hour grace and bounded recovery schedule", () => {
    const failedAt = new Date("2026-08-12T10:15:00.000Z");
    expect(billingGraceDeadline(failedAt).toISOString()).toBe("2026-08-14T10:15:00.000Z");
    expect(billingRecoverySchedule(failedAt).map((date) => date.toISOString())).toEqual([
      "2026-08-12T22:15:00.000Z",
      "2026-08-14T09:15:00.000Z",
    ]);
    expect(billingFailurePolicy("insufficient_funds")).toEqual({
      category: "RECOVERABLE_FUNDS",
      automaticRetryEligible: true,
    });
    expect(billingFailurePolicy("authentication_required").automaticRetryEligible).toBe(false);
    expect(billingFailurePolicy("stolen_card").category).toBe("HARD_DECLINE");
  });

  it("renders safe billing lifecycle email content with last4 only", () => {
    const message = renderBillingEmail(
      "PAYMENT_FAILED",
      {
        organizationName: "Waflo Coffee",
        invoiceNumber: "WF-2026-0042",
        amount: 19251,
        currency: "USD",
        failureCategory: "RECOVERABLE_FUNDS",
        automaticRetryEligible: true,
        graceEndsAt: "2026-08-14T10:15:00.000Z",
        paymentMethod: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2028 },
        billingUrl: "https://merchant.waflo.app/en/dashboard/billing",
        timezone: "Asia/Baghdad",
      },
      "en",
    );
    expect(message.html).toContain("visa •••• 4242");
    expect(message.html).toContain("48-hour recovery window");
    expect(message.html).not.toContain("4242424242424242");
    expect(message.html).not.toMatch(/\bCVC\b|client_secret|payment[_-]?token/i);

    const refund = renderBillingEmail(
      "REFUND_SUCCEEDED",
      {
        organizationName: "Waflo Coffee",
        invoiceNumber: "WF-2026-0042",
        originalPaymentDate: "2026-08-01T12:00:00.000Z",
        amount: 1700,
        currency: "USD",
        refundStatus: "SUCCEEDED",
        paymentMethod: { brand: "visa", last4: "4242" },
        billingUrl: "https://merchant.waflo.app/en/dashboard/billing",
        timezone: "Asia/Baghdad",
      },
      "en",
    );
    expect(refund.subject).toContain("refund succeeded");
    expect(refund.html).toContain("originally paid");
    expect(refund.html).toContain("payment-network posting times can vary");
    expect(refund.html).toContain("4242");
    expect(refund.html).not.toContain("4242424242424242");
  });

  it("keeps recovery on the same invoice with durable dedupe and no raw card IDs in UI", () => {
    const worker = readFileSync("apps/operational-worker/src/main.ts", "utf8");
    const billing = readFileSync("apps/api/src/billing/billing.service.ts", "utf8");
    const screen = readFileSync("apps/merchant-dashboard/components/dashboard-screens.tsx", "utf8");
    expect(worker).toContain("this.stripe.invoices.pay(");
    expect(worker).toContain("idempotencyKey: attemptToken");
    expect(worker).not.toContain("this.stripe.invoices.create(");
    expect(billing).toContain(`dedupeKey: \`invoice-paid:\${invoice.id}\``);
    expect(billing).toContain("graceDeadlineReset: false");
    expect(screen).toContain("••••");
    expect(screen).not.toContain("stripePaymentMethodId");
  });

  it("structurally bars synthetic Staff users from all interactive authentication", () => {
    const migration = readFileSync(
      "packages/database/prisma/migrations/20260812193000_staff_qr_billing_cadence/migration.sql",
      "utf8",
    );
    const auth = readFileSync("apps/api/src/auth/auth.service.ts", "utf8");
    const oauth = readFileSync("apps/api/src/auth/external-auth.service.ts", "utf8");
    expect(migration).toContain("users_staff_identity_login_barrier");
    expect(migration).toContain("sessions_reject_synthetic_staff");
    expect(migration).toContain("external_identities_reject_synthetic_staff");
    expect(migration).toContain("email_verification_tokens_reject_synthetic_staff");
    expect(migration).toContain("password_reset_tokens_reject_synthetic_staff");
    expect(auth).toContain("interactiveLoginAllowed");
    expect(oauth).toContain("!existingIdentity.user.interactiveLoginAllowed");
  });

  it("lists every lower-tier violation before downgrade", () => {
    expect(
      planDowngradeViolations("starter", {
        locations: 2,
        teamSeats: 4,
        programs: 2,
        activeAdvancedExports: 1,
        programFeatures: { PRO_MODE: 1, ADVANCED_LAYOUT: 2, MULTIPLE_REWARDS: 1 },
      }).map((violation) => violation.code),
    ).toEqual([
      "LOCATIONS",
      "TEAM_SEATS",
      "ACTIVE_PROGRAMS",
      "PRO_MODE",
      "MULTIPLE_REWARDS",
      "ACTIVE_ADVANCED_EXPORTS",
    ]);
  });

  it("selects exactly one mobile wallet provider and uses an explicit desktop fallback", () => {
    expect(walletPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(walletPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("android");
    expect(walletPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(walletPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
  });

  it("removes notification consent from wallet save and preserves tenant on Apple download", () => {
    const source = readFileSync(
      "apps/customer-web/app/card/[publicMembershipId]/customer-card.tsx",
      "utf8",
    );
    expect(source).not.toContain("wallet-promotion-consent");
    expect(source).not.toContain("wallet-engagement/consent");
    expect(source).toContain("apple/pass$" + "{tenantQuery}");
    expect(source).toContain("google/add-action$" + "{tenantQuery}");
    expect(source).toContain('platform === "ios"');
    expect(source).toContain('platform === "android"');
  });

  it("uses direct crop manipulation without horizontal or vertical position sliders", () => {
    const source = readFileSync(
      "apps/merchant-dashboard/components/program-asset-uploader.tsx",
      "utf8",
    );
    const styles = readFileSync("apps/merchant-dashboard/app/globals.css", "utf8");
    expect(source).toContain("onPointerDown={beginPan}");
    expect(source).toContain("setPointerCapture(event.pointerId)");
    expect(source).toContain("releasePointerCapture(event.pointerId)");
    expect(source).toContain("onLostPointerCapture");
    expect(source).toContain("onWheel=");
    expect(source).toContain("onKeyDown={keyboardPan}");
    expect(source).toContain("copy.zoomOut");
    expect(source).toContain("copy.zoomIn");
    expect(styles).toContain("transform-origin: top left");
    expect(source).not.toContain("Horizontal position");
    expect(source).not.toContain("Vertical position");
  });

  it("keeps the repaired mobile onboarding controls compact and validates uploads before sending", () => {
    const onboarding = readFileSync("apps/merchant-dashboard/components/onboarding.tsx", "utf8");
    const uploader = readFileSync(
      "apps/merchant-dashboard/components/program-asset-uploader.tsx",
      "utf8",
    );
    const locationPicker = readFileSync(
      "apps/merchant-dashboard/components/location-map-picker.tsx",
      "utf8",
    );
    const styles = readFileSync("apps/merchant-dashboard/app/globals.css", "utf8");

    expect(onboarding).toContain('className="wf-sr-only"');
    expect(onboarding).toContain('aria-current={number === step ? "step" : undefined}');
    expect(styles).toContain("grid-auto-columns: min(82vw, 21rem);");
    expect(styles).toContain("max-height: min(70dvh, 31rem);");
    expect(uploader).toContain("const maximumUploadBytes = 2 * 1024 * 1024;");
    expect(uploader).toContain("acceptedImageTypes.has(selected.type)");
    expect(uploader).toContain("const initialCrop =");
    expect(locationPicker).toContain("timeout: 20_000");
    expect(locationPicker).toContain("maximumAge: 15 * 60_000");
  });

  it("uses native selects for bounded choices and the accessible listbox for searchable choices", () => {
    const primitive = readFileSync("packages/ui/src/index.tsx", "utf8");
    const styles = readFileSync("packages/ui/src/styles.css", "utf8");
    const builder = readFileSync(
      "apps/merchant-dashboard/components/program-card-builder.tsx",
      "utf8",
    );

    expect(primitive).toContain("<select");
    expect(primitive).toContain("SelectHTMLAttributes<HTMLSelectElement>");
    expect(primitive).toContain('role="combobox"');
    expect(primitive).toContain('role="listbox"');
    expect(primitive).toContain('role="option"');
    expect(primitive).toContain('event.key === "Home"');
    expect(primitive).toContain('event.key === "End"');
    expect(primitive).toContain("createPortal(");
    expect(primitive).toContain("aria-disabled={option.disabled");
    expect(styles).toContain("position: fixed;");
    expect(builder).toContain("value={reward.rewardType}");
    expect(builder).toContain('value="FREE_ITEM"');
    expect(builder).toContain('value="DISCOUNT_DESCRIPTION"');
    expect(builder).toContain('value="TEXT_REWARD"');
    expect(builder).toContain('value="CUSTOM"');
  });

  it("centers the stamp SVG canvas and emits coherent Arabic Wallet anchors", () => {
    const stamp = renderStampSvg({
      goal: 8,
      progress: 3,
      layout: "GRID",
      filledColor: "#6B3F2A",
      emptyColor: "#E7B56B",
      accentColor: "#222222",
    });
    const rightEdge = Math.max(...stamp.positions.map((position) => position.x + 24));
    expect(stamp.width).toBe(rightEdge);

    const preview = composeProgramPreview({
      profile: "GOOGLE_WALLET",
      locale: "AR",
      organizationName: "مقهى وافلو",
      programName: "بطاقة القهوة",
      shortDescription: "اجمع الأختام واحصل على مكافأة",
      rewardSummary: "قهوة مجانية",
      terms: "ختم واحد لكل زيارة",
      progress: 3,
      goal: 8,
      stampSvg: stamp.svg,
      stampLayout: "GRID",
      backgroundColor: "#F5E5D2",
      foregroundColor: "#2A1710",
      accentColor: "#6B3F2A",
      secondaryColor: "#E7B56B",
      customerWebVariant: "CARD",
      apple: {
        headerLabel: "الأختام",
        headerValue: "3/8",
        secondaryLabel: "الحالة",
        barcodeLabel: "العضوية",
        showBackContent: true,
      },
      google: {
        title: "بطاقة القهوة",
        subtitle: "مقهى وافلو",
        detailsLabel: "المكافأة",
        barcodeLabel: "العضوية",
      },
    });
    expect(preview.svg).toContain('lang="ar" xml:lang="ar"');
    expect(preview.svg).toContain('x="48" y="210" text-anchor="end"');
    expect(preview.svg).toContain('x="48" y="440" text-anchor="end"');
    expect(preview.digest).toBe(createHash("sha256").update(preview.svg).digest("hex"));
  });

  it("uses the organization logo as the visible issuer mark across every card preview", () => {
    const stamp = renderStampSvg({
      goal: 8,
      progress: 0,
      layout: "GRID",
      filledColor: "#6B3F2A",
      emptyColor: "#F5E5D2",
      accentColor: "#6B3F2A",
      backgroundColor: "#F5E5D2",
      foregroundColor: "#2A1710",
    });
    const merchantBrandLogoDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+9R/5VQAAAABJRU5ErkJggg==";
    const base = {
      locale: "AR" as const,
      organizationName: "مقهى وافلو",
      programName: "بطاقة القهوة",
      shortDescription: "اجمع الأختام",
      rewardSummary: "قهوة مجانية",
      terms: "ختم واحد لكل زيارة",
      progress: 2,
      goal: 8,
      stampSvg: stamp.svg,
      stampLayout: "GRID" as const,
      backgroundColor: "#F5E5D2",
      foregroundColor: "#2A1710",
      accentColor: "#6B3F2A",
      secondaryColor: "#E7B56B",
      merchantBrandLogoDataUri,
      customerWebVariant: "CARD" as const,
      apple: {
        headerLabel: "الأختام",
        headerValue: "2/8",
        secondaryLabel: "الحالة",
        barcodeLabel: "العضوية",
        showBackContent: true,
      },
      google: {
        title: "بطاقة القهوة",
        subtitle: "مقهى وافلو",
        detailsLabel: "المكافأة",
        barcodeLabel: "العضوية",
      },
    };
    for (const profile of ["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const) {
      const preview = composeProgramPreview({ ...base, profile });
      expect(preview.svg).toContain(merchantBrandLogoDataUri);
      expect(preview.svg).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(preview.svg).toContain('data-issuer-brand="organization"');
    }
    const { merchantBrandLogoDataUri: _merchantBrandLogoDataUri, ...fallbackBase } = base;
    const fallback = composeProgramPreview({ ...fallbackBase, profile: "APPLE_WALLET" });
    expect(fallback.svg).not.toContain(merchantBrandLogoDataUri);
    expect(fallback.svg).toContain('fill="#E4572E"');
  });

  it("styles native selects and wraps the accessible color input", () => {
    const styles = readFileSync("packages/ui/src/styles.css", "utf8");
    const controls = readFileSync("packages/ui/src/index.tsx", "utf8");
    expect(styles).toContain(".wf-select");
    expect(styles).toContain("appearance: none");
    expect(styles).toContain(".wf-color-input:focus-within");
    expect(controls).toContain("export function ColorInput");
    expect(controls).toContain('type="color"');
  });

  it("keeps merchant branding copy as valid Arabic instead of mojibake", () => {
    const source = readFileSync("apps/merchant-dashboard/components/dashboard-screens.tsx", "utf8");
    expect(source).toContain("الهوية البصرية");
    expect(source).toContain("شعار النشاط");
    expect(source).toContain("إزالة الشعار");
    expect(source).not.toMatch(/(?:Ã|Â|Ø|Ù|ðŸ|â€|ï¿½)/u);
  });

  it("declares every template available to every plan without a plan filter", () => {
    const service = readFileSync("apps/api/src/programs/programs.service.ts", "utf8");
    expect(service).toContain('availableOnPlans: ["STARTER", "GROWTH", "SCALE"]');
    expect(service).toContain("templates.map((template)");
  });

  it("keeps signup legal consent explicit, unchecked, auditable, and safe in a new tab", () => {
    const signup = readFileSync("apps/merchant-dashboard/components/auth-forms.tsx", "utf8");
    const auth = readFileSync("apps/api/src/auth/auth.service.ts", "utf8");
    expect(signup).toContain("const [termsAccepted, setTermsAccepted] = useState(false)");
    expect(signup).toContain("const [privacyAccepted, setPrivacyAccepted] = useState(false)");
    expect(signup).toContain('name="terms"');
    expect(signup).toContain('name="privacy"');
    expect(signup.match(/target="_blank"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(signup.match(/rel="noopener noreferrer"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(signup).toContain("copy.signup.termsAgreement");
    expect(signup).toContain("copy.signup.privacyAgreement");
    expect(messages.en.auth.signup.termsAgreement).toContain("Terms of Service");
    expect(messages.en.auth.signup.privacyAgreement).toContain("Privacy Policy");
    expect(auth).toContain("legalAcceptedAt");
    expect(auth).toContain("termsVersion");
    expect(auth).toContain("privacyVersion");
    const registration = {
      displayName: "Legal Test",
      email: "legal-test@waflo.local",
      password: "Legal Test Password 2026!",
      locale: "en",
    };
    expect(
      registerSchema.safeParse({
        ...registration,
        termsAccepted: false,
        privacyAccepted: true,
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        ...registration,
        termsAccepted: true,
        privacyAccepted: false,
      }).success,
    ).toBe(false);
  });

  it("keeps verification copy production-safe and auth spacing shared", () => {
    const forms = readFileSync("apps/merchant-dashboard/components/auth-forms.tsx", "utf8");
    const layout = readFileSync("apps/merchant-dashboard/components/auth-layout.tsx", "utf8");
    const styles = readFileSync("apps/merchant-dashboard/app/globals.css", "utf8");
    expect(forms).toContain("copy.verification.accepted");
    expect(forms).toContain("copy.verification.help");
    expect(messages.en.auth.verification.accepted).toBe(
      "If the address is eligible, the verification request was accepted.",
    );
    expect(messages.en.auth.verification.help).toBe(
      "Didn’t receive it? Check your spam or junk folder.",
    );
    expect(messages.ar.auth.verification.accepted).toBe(
      "إذا كان العنوان مؤهلاً، فقد قُبل طلب إرسال رسالة تأكيد جديدة.",
    );
    expect(messages.ar.auth.verification.help).toBe(
      "لم تصلك الرسالة؟ تحقّق من مجلد الرسائل غير المرغوب فيها.",
    );
    expect(forms).not.toContain("localhost:8025");
    expect(forms).not.toContain("open Mailpit");
    expect(forms).toContain('const [email, setEmail] = useState("")');
    expect(forms).toContain('setEmail(sessionStorage.getItem("waflo:verification-email") ?? "")');
    expect(layout).toContain('className="auth-card__body"');
    expect(styles).toContain("--auth-space-related: 0.5rem");
    expect(styles).toContain("--auth-space-control: 1rem");
    expect(styles).toContain("--auth-space-section: 1.5rem");
    expect(styles).toContain(".auth-card__body > * + *");
    expect(styles).toContain(".auth-verify__action + .auth-verify__help");
  });

  it("keeps refunds review-based, tenant-scoped, idempotent, and on the original payment path", () => {
    const billing = readFileSync("apps/api/src/billing/billing.service.ts", "utf8");
    const controller = readFileSync("apps/api/src/billing/billing.controller.ts", "utf8");
    const migration = readFileSync(
      "packages/database/prisma/migrations/20260812193000_staff_qr_billing_cadence/migration.sql",
      "utf8",
    );
    expect(controller).toContain("invoices/:invoiceId/refunds");
    expect(controller).toContain("parseRefundIdempotencyKey");
    expect(billing).toContain("requireBillingOwner");
    expect(billing).toContain("invoicePaymentIntentId");
    expect(billing).toContain("payment_intent: paymentIntentId");
    expect(billing).toContain("REFUND_AMOUNT_EXCEEDS_AVAILABLE");
    expect(billing).toContain('event.type !== "refund.failed"');
    expect(migration).toContain("billing_refund_one_active_request_per_invoice");
    expect(migration).toContain('CREATE TABLE "billing_refund_requests"');
  });

  it("verifies P1 responsive grid architectures, customer progressive loading, and refined stamp artwork", () => {
    const tokens = readFileSync("packages/brand/src/tokens.css", "utf8");
    const tailwindTokens = readFileSync("packages/brand/src/tailwind.css", "utf8");
    const globals = readFileSync("apps/merchant-dashboard/app/globals.css", "utf8");
    const operationsService = readFileSync(
      "apps/api/src/operations/merchant-operations.service.ts",
      "utf8",
    );
    const operationsScreens = readFileSync(
      "apps/merchant-dashboard/components/w4-operations-screens.tsx",
      "utf8",
    );
    const dashboardScreens = readFileSync(
      "apps/merchant-dashboard/components/dashboard-screens.tsx",
      "utf8",
    );
    // Softened dashboard canvas background token
    expect(tokens).toContain("--waflo-cloud: #f8f9fb;");
    expect(tailwindTokens).toContain("--color-waflo-cloud: #f8f9fb;");

    // Loyalty cards responsive 2-column grid
    expect(globals).toContain(".program-list {");
    expect(globals).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(globals).toContain(".program-list__card {");

    // Locations responsive 2-column grid
    expect(globals).toContain(".location-grid {");
    expect(globals).toContain(".location-card {");
    expect(dashboardScreens).toContain('className="location-grid"');
    expect(dashboardScreens).toContain('className="location-card"');

    // Customers Team-like list and progressive API loading
    expect(operationsScreens).toContain("dashboard-team-table dashboard-customers-table");
    expect(operationsScreens).toContain("dashboard-customer-membership");
    expect(operationsScreens).toContain("dashboard-load-more");
    expect(operationsService).toContain("take: limit + 1");
    expect(operationsService).toContain('orderBy: [{ updatedAt: "desc" }, { id: "desc" }]');
    expect(operationsService).toContain("archivedAt: null");

    // Stamp engine fallback artwork invariant
    const filledRender = renderStampSvg({
      goal: 8,
      progress: 3,
      layout: "GRID",
      filledColor: "#ae3115",
      emptyColor: "#f4ede8",
      accentColor: "#ae3115",
      progressLabelVisible: false,
      rewardLabelVisible: false,
    });
    expect(filledRender.svg).toContain("svg");
    expect(filledRender.svg).not.toContain("<text");
    expect(filledRender.svg).not.toContain("✓");
  });
});

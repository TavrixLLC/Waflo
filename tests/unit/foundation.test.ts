import {
  hashOpaqueToken,
  hashPassword,
  isSessionActive,
  normalizeEmail,
  sessionExpiresAt,
  verifyPassword,
} from "../../packages/auth/src/index";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateTrialState,
  canCreateLocation,
  canInviteTeamMember,
  hasMerchantOperationalBillingAccess,
  planCatalog,
} from "../../packages/billing/src/index";
import { createErrorEnvelope } from "../../packages/contracts/src/index";
import { parseEnvironment } from "../../packages/config/src/index";
import { merchantPublicOrigin } from "../../packages/qr-core/src/index";
import {
  contentLocaleForInterface,
  directionFor,
  directionForInterface,
  formatUsd,
  isInterfaceLocale,
  isLocale,
  interfaceTextLocaleFor,
  localePath,
  localeRegistry,
} from "../../packages/i18n/src/index";
import {
  allowedInvitationRoles,
  assertRoleAssignment,
  canManageMember,
  hasPermission,
} from "../../packages/permissions/src/index";
import { describe, expect, it, vi } from "vitest";
import {
  HostResolutionService,
  parseMerchantHostname,
} from "../../apps/api/src/public/host-resolution.service";
import {
  isSlugFormatValid,
  normalizeSlug,
  oldSlugReservedUntil,
  validateSlug,
} from "../../apps/api/src/tenancy/slug";
import { resolveMerchantOrganizationAccess } from "../../apps/api/src/account/account-access.service";

describe("identity primitives", () => {
  it("normalizes email with Unicode normalization, trimming, and lowercase", () => {
    expect(normalizeEmail("  OWNER@WAFLO.APP  ")).toBe("owner@waflo.app");
    expect(normalizeEmail("ｔｅｓｔ@example.com")).toBe("test@example.com");
  });

  it("hashes and verifies passwords using a non-reversible hash", async () => {
    const password = "Correct horse battery 2026";
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(hash, password)).resolves.toBe(true);
    await expect(verifyPassword(hash, "incorrect password")).resolves.toBe(false);
  });

  it("hashes opaque session tokens deterministically without storing the token", () => {
    const token = "opaque-session-token";
    expect(hashOpaqueToken(token)).toHaveLength(64);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).not.toContain(token);
  });

  it("calculates session expiration and active state", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const expiresAt = sessionExpiresAt(now, 30);
    expect(expiresAt.toISOString()).toBe("2026-08-26T00:00:00.000Z");
    expect(isSessionActive({ expiresAt, revokedAt: null }, now)).toBe(true);
  });

  it("rejects expired or revoked sessions", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    expect(
      isSessionActive({ expiresAt: new Date("2026-07-26T23:59:59.000Z"), revokedAt: null }, now),
    ).toBe(false);
    expect(
      isSessionActive({ expiresAt: new Date("2026-08-01T00:00:00.000Z"), revokedAt: now }, now),
    ).toBe(false);
  });
});

describe("environment contract", () => {
  it("rejects development infrastructure and insecure cookies in production", () => {
    expect(() => parseEnvironment({ NODE_ENV: "production" })).toThrow(
      "Invalid Waflo environment configuration",
    );
  });

  it("accepts test-safe local defaults", () => {
    expect(parseEnvironment({ NODE_ENV: "test" }).NODE_ENV).toBe("test");
  });
});

describe("merchant slug policy", () => {
  it("normalizes merchant slugs", () => {
    expect(normalizeSlug("  TODAY-COFFEE  ")).toBe("today-coffee");
  });

  it("accepts the documented slug format", () => {
    expect(isSlugFormatValid("today-coffee")).toBe(true);
    expect(isSlugFormatValid("a1b")).toBe(true);
  });

  it.each(["-today", "today-", "today--coffee", "to", "today.coffee", "مرحبا"])(
    "rejects malformed slug %s",
    (slug) => {
      expect(isSlugFormatValid(slug)).toBe(false);
    },
  );

  it.each([
    "www",
    "api",
    "card",
    "app-staging",
    "api-staging",
    "card-staging",
    "admin",
    "waflo",
    "wallet",
    "stripe",
    "localhost",
    "smtp",
    "mobile",
  ])("rejects reserved slug %s", (slug) => {
    expect(validateSlug(slug)).toMatchObject({
      valid: false,
      reason: "SLUG_RESERVED",
    });
  });

  it("reserves an old slug for the 90-day cooldown", () => {
    const releasedAt = new Date("2026-07-27T12:00:00.000Z");
    expect(oldSlugReservedUntil(releasedAt).toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });

  it("rejects punycode labels to keep merchant identities ASCII and non-spoofable", () => {
    expect(isSlugFormatValid("xn--tday-9za")).toBe(false);
  });
});

describe("merchant account access authority", () => {
  const base = {
    id: "org-1",
    onboardingState: "COMPLETE" as const,
    activeLocationCount: 1,
    latestBillingCommandStatus: null,
    outstandingInvoice: null,
    billingProfile: {
      subscriptionStatus: "ACTIVE" as const,
      trialEnd: null,
      gracePeriodEnd: null,
      billingName: null,
      billingEmail: null,
      billingCountryCode: null,
      billingAddressLine1: null,
      billingCity: null,
    },
  };

  it("grants full access to an active completed legacy organization", () => {
    expect(resolveMerchantOrganizationAccess(base)).toMatchObject({
      onboarding: "complete",
      billing: "active",
      access: "full",
    });
  });

  it("keeps onboarding completion durable when operational location state later changes", () => {
    expect(resolveMerchantOrganizationAccess({ ...base, activeLocationCount: 0 })).toMatchObject({
      onboarding: "complete",
      billing: "active",
      access: "full",
    });
  });

  it("keeps an active grace window operational and restricts it at the exact boundary", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const graceEnd = new Date("2026-08-14T12:01:00.000Z");
    const inGrace = {
      ...base,
      billingProfile: {
        ...base.billingProfile,
        subscriptionStatus: "GRACE_PERIOD" as const,
        gracePeriodEnd: graceEnd,
      },
      outstandingInvoice: { failureCategory: "CARD_DECLINED", graceEndsAt: graceEnd },
    };
    expect(resolveMerchantOrganizationAccess(inGrace, now).access).toBe("full");
    expect(resolveMerchantOrganizationAccess(inGrace, graceEnd)).toMatchObject({
      billing: "restricted",
      access: "read_only_billing_recovery",
    });
  });

  it.each(["PAST_DUE", "SUSPENDED", "CANCELED"] as const)(
    "restricts completed organizations in %s",
    (subscriptionStatus) => {
      expect(
        resolveMerchantOrganizationAccess({
          ...base,
          billingProfile: { ...base.billingProfile, subscriptionStatus },
        }).access,
      ).toBe("read_only_billing_recovery");
    },
  );

  it("keeps incomplete onboarding out of full access even with active billing", () => {
    expect(
      resolveMerchantOrganizationAccess({
        ...base,
        onboardingState: "LOCATION",
        activeLocationCount: 0,
      }),
    ).toMatchObject({ onboarding: "location_required", access: "onboarding_only" });
  });
});

describe("worker-safe merchant billing entitlement policy", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");

  it("allows active, live trial, and live grace states", () => {
    expect(hasMerchantOperationalBillingAccess({ status: "ACTIVE" }, now)).toBe(true);
    expect(
      hasMerchantOperationalBillingAccess(
        { status: "TRIALING", trialEnd: new Date("2026-08-14T12:00:01.000Z") },
        now,
      ),
    ).toBe(true);
    expect(
      hasMerchantOperationalBillingAccess(
        { status: "GRACE_PERIOD", gracePeriodEnd: new Date("2026-08-14T12:00:01.000Z") },
        now,
      ),
    ).toBe(true);
  });

  it("restricts missing or elapsed trial/grace evidence at the exact boundary", () => {
    expect(hasMerchantOperationalBillingAccess({ status: "TRIALING", trialEnd: null }, now)).toBe(
      false,
    );
    expect(hasMerchantOperationalBillingAccess({ status: "TRIALING", trialEnd: now }, now)).toBe(
      false,
    );
    expect(
      hasMerchantOperationalBillingAccess({ status: "GRACE_PERIOD", gracePeriodEnd: now }, now),
    ).toBe(false);
    expect(hasMerchantOperationalBillingAccess({ status: "PAST_DUE" }, now)).toBe(false);
    expect(hasMerchantOperationalBillingAccess({ status: "SUSPENDED" }, now)).toBe(false);
    expect(hasMerchantOperationalBillingAccess({ status: "CANCELED" }, now)).toBe(false);
  });
});

describe("permissions", () => {
  it("gives Owners full W1 administration permissions", () => {
    expect(hasPermission("OWNER", "billing.manage")).toBe(true);
    expect(hasPermission("OWNER", "organization.slug.change")).toBe(true);
    expect(allowedInvitationRoles("OWNER")).toEqual(["MANAGER", "STAFF"]);
  });

  it("allows Managers to manage locations and Staff, but not billing", () => {
    expect(hasPermission("MANAGER", "locations.create")).toBe(true);
    expect(hasPermission("MANAGER", "billing.manage")).toBe(false);
    expect(allowedInvitationRoles("MANAGER")).toEqual(["STAFF"]);
    expect(canManageMember("MANAGER", "STAFF")).toBe(true);
    expect(canManageMember("MANAGER", "MANAGER")).toBe(false);
  });

  it("keeps Staff read-only at the organization foundation boundary", () => {
    expect(hasPermission("STAFF", "organization.view")).toBe(true);
    expect(hasPermission("STAFF", "locations.view")).toBe(false);
    expect(hasPermission("STAFF", "team.view")).toBe(false);
  });

  it("prevents invitation-based Owner assignment", () => {
    expect(assertRoleAssignment("OWNER", "OWNER")).toBe(false);
    expect(assertRoleAssignment("OWNER", "MANAGER")).toBe(true);
    expect(assertRoleAssignment("MANAGER", "MANAGER")).toBe(false);
  });
});

describe("plans, entitlements, and trial state", () => {
  it("uses the single authoritative plan price catalog", () => {
    expect(planCatalog.starter.monthlyPriceUsd).toBe(29);
    expect(planCatalog.growth.monthlyPriceUsd).toBe(69);
    expect(planCatalog.scale.monthlyPriceUsd).toBe(129);
    expect(formatUsd(planCatalog.growth.monthlyPriceUsd)).toBe("$69");
  });

  it("enforces Starter location entitlement and recommends Growth", () => {
    expect(canCreateLocation("starter", 0)).toMatchObject({
      allowed: true,
      limit: 1,
      remaining: 1,
    });
    expect(canCreateLocation("starter", 1)).toMatchObject({
      allowed: false,
      recommendedPlan: "growth",
    });
  });

  it("enforces team entitlement and supports a configured Scale cap", () => {
    expect(canInviteTeamMember("growth", 9)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(canInviteTeamMember("growth", 10)).toMatchObject({
      allowed: false,
      recommendedPlan: "scale",
    });
    expect(canInviteTeamMember("scale", 25, 25).allowed).toBe(false);
  });

  it("keeps the W1 trial pending with empty start and end timestamps", () => {
    expect(
      calculateTrialState({
        status: "pending_activation",
        trialStart: new Date(),
        trialEnd: new Date(),
      }),
    ).toEqual({
      status: "pending_activation",
      started: false,
      trialStart: null,
      trialEnd: null,
      messageKey: "trial.pending",
    });
  });
});

describe("API and localization utilities", () => {
  it("creates the stable error envelope", () => {
    expect(
      createErrorEnvelope("PERMISSION_DENIED", "Not allowed.", "req-123", {
        role: "STAFF",
      }),
    ).toEqual({
      error: {
        code: "PERMISSION_DENIED",
        message: "Not allowed.",
        details: { role: "STAFF" },
        requestId: "req-123",
      },
    });
  });

  it("resolves locale direction and localized paths", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("ar")).toBe("rtl");
    expect(directionForInterface("ar")).toBe("rtl");
    expect(localePath("ar", "/pricing")).toBe("/ar/pricing");
    expect(isInterfaceLocale("ku-badini")).toBe(true);
    expect(isInterfaceLocale("ku-sorani")).toBe(true);
    expect(isInterfaceLocale("ku")).toBe(false);
    expect(directionForInterface("ku-badini")).toBe("rtl");
    expect(directionForInterface("ku-sorani")).toBe("rtl");
    expect(localeRegistry["ku-badini"].htmlLang).toBe("kmr-Arab-IQ");
    expect(localeRegistry["ku-sorani"].htmlLang).toBe("ckb-Arab-IQ");
    expect(contentLocaleForInterface("ku-badini")).toBe("en");
    expect(contentLocaleForInterface("ku-sorani")).toBe("en");
    expect(contentLocaleForInterface("ar")).toBe("en");
    expect(interfaceTextLocaleFor("ar")).toBe("ar");
    expect(interfaceTextLocaleFor("ku-badini")).toBe("en");
    expect(interfaceTextLocaleFor("ku-sorani")).toBe("en");
    expect(localeRegistry["ku-badini"].messages.navigation.home).not.toBe(
      localeRegistry.ar.messages.navigation.home,
    );
  });

  it("keeps Builder and Studio structural direction tied to interface-locale metadata", () => {
    const root = resolve(import.meta.dirname, "../..");
    const files = [
      "apps/merchant-dashboard/components/program-card-builder.tsx",
      "apps/merchant-dashboard/components/program-studio-editor.tsx",
      "apps/merchant-dashboard/components/programs-screen.tsx",
      "apps/merchant-dashboard/components/template-gallery.tsx",
    ];

    for (const relativePath of files) {
      const source = readFileSync(resolve(root, relativePath), "utf8");
      expect(source).toContain("directionForInterface");
      expect(source).toContain("interfaceLocale");
    }

    const builder = readFileSync(resolve(root, files[0]), "utf8");
    const studio = readFileSync(resolve(root, files[1]), "utf8");
    expect(builder).toContain('className="builder-shell" dir={interfaceDirection}');
    expect(studio).toContain('className="studio-shell studio-shell--p4" dir={interfaceDirection}');
  });

  it("keeps the four-language picker metadata-driven, keyboard-operable, and portal-backed", () => {
    const root = resolve(import.meta.dirname, "../..");
    const picker = readFileSync(resolve(root, "packages/ui/src/index.tsx"), "utf8");
    const dashboard = readFileSync(
      resolve(root, "apps/merchant-dashboard/components/dashboard.tsx"),
      "utf8",
    );
    const layout = readFileSync(
      resolve(root, "apps/merchant-dashboard/app/[locale]/layout.tsx"),
      "utf8",
    );

    expect(picker).toContain("interfaceLocales.map");
    expect(picker).toContain("interfaceLanguageGroups");
    expect(picker).toContain('role="menuitemradio"');
    expect(picker).toContain("createPortal(menu, document.body)");
    expect(picker).toContain('event.key === "Escape"');
    expect(picker).toContain("focusOption");
    expect(dashboard).toContain("InterfaceLanguagePicker");
    expect(dashboard).toContain("waflo_interface_locale");
    expect(dashboard).toContain("ku-badini|ku-sorani");
    expect(layout).toContain("definition.htmlLang");
    expect(layout).toContain("definition.direction");
    expect(localeRegistry["ku-badini"].messages.merchant.shell.programs).not.toBe(
      localeRegistry["ku-sorani"].messages.merchant.shell.programs,
    );
  });
});

describe("merchant hostname parsing and resolution", () => {
  it("parses production and local merchant hosts", () => {
    expect(parseMerchantHostname("today.waflo.app:443", "waflo.app")).toMatchObject({
      status: "merchant",
      slug: "today",
    });
    expect(parseMerchantHostname("today.localhost:3002", "waflo.app")).toMatchObject({
      status: "merchant",
      slug: "today",
    });
    expect(parseMerchantHostname("today.lvh.me", "waflo.app")).toMatchObject({
      status: "merchant",
      slug: "today",
    });
  });

  it("rejects reserved, nested, and malformed hosts", () => {
    expect(parseMerchantHostname("www.waflo.app", "waflo.app").status).toBe("reserved");
    expect(parseMerchantHostname("a.b.waflo.app", "waflo.app").status).toBe("malformed");
    expect(parseMerchantHostname("evil.example.com", "waflo.app").status).toBe("malformed");
    expect(parseMerchantHostname("xn--tday-9za.waflo.app", "waflo.app").status).toBe("malformed");
    expect(parseMerchantHostname("today.waflo.app,evil.example", "waflo.app").status).toBe(
      "malformed",
    );
    expect(parseMerchantHostname("today.waflo.app:evil", "waflo.app").status).toBe("malformed");
    expect(parseMerchantHostname("today.waflo.app:70000", "waflo.app").status).toBe("malformed");
    expect(parseMerchantHostname("today.waflo.app::443", "waflo.app").status).toBe("malformed");
    expect(parseMerchantHostname("today.waflo.app./path", "waflo.app").status).toBe("malformed");
    expect(parseMerchantHostname("TODAY.WAFLO.APP.", "waflo.app")).toMatchObject({
      status: "merchant",
      slug: "today",
    });
  });

  it("uses the merchant slug as the production customer origin", () => {
    expect(
      merchantPublicOrigin({
        merchantSlug: "today",
        customerBaseUrl: "https://card.waflo.app",
        merchantBaseDomain: "waflo.app",
      }),
    ).toBe("https://today.waflo.app");
    expect(
      merchantPublicOrigin({
        merchantSlug: "today",
        customerBaseUrl: "http://localhost:3002",
        merchantBaseDomain: "waflo.app",
      }),
    ).toBe("http://today.localhost:3002");
  });

  it.each([
    ["ACTIVE", "active"],
    ["SUSPENDED", "suspended"],
    ["ARCHIVED", "unknown"],
    [null, "unknown"],
  ] as const)("resolves organization state %s to %s", async (organizationStatus, expected) => {
    const findUnique = vi.fn().mockResolvedValue(
      organizationStatus
        ? {
            id: "org-1",
            name: "Today Coffee",
            merchantSlug: "today",
            defaultLocale: "EN",
            status: organizationStatus,
          }
        : null,
    );
    const service = new HostResolutionService(
      { client: { organization: { findUnique } } } as never,
      {
        values: {
          NODE_ENV: "test",
          MERCHANT_BASE_DOMAIN: "waflo.app",
        },
      } as never,
    );
    const result = await service.resolve("today.waflo.app");
    expect(result.status).toBe(expected);
  });

  it("supports the explicit tenant query on the shared staging Customer Web host", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "org-1",
      name: "Today Coffee",
      merchantSlug: "today",
      defaultLocale: "AR",
      status: "ACTIVE",
    });
    const service = new HostResolutionService(
      { client: { organization: { findUnique } } } as never,
      {
        values: {
          NODE_ENV: "test",
          DEPLOYMENT_ENVIRONMENT: "staging",
          MERCHANT_BASE_DOMAIN: "waflo.app",
          CUSTOMER_WEB_URL: "https://card-staging.waflo.app",
        },
      } as never,
    );
    const result = await service.resolve("card-staging.waflo.app", "today");
    expect(result).toMatchObject({
      status: "active",
      merchant: {
        slug: "today",
        defaultLocale: "ar",
        hostname: "card-staging.waflo.app",
      },
    });
  });

  it("keeps tenant overrides scoped to the exact staging compatibility hostname", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "org-1",
      name: "Today Coffee",
      merchantSlug: "today",
      defaultLocale: "EN",
      status: "ACTIVE",
    });
    const service = new HostResolutionService(
      { client: { organization: { findUnique } } } as never,
      {
        values: {
          NODE_ENV: "test",
          DEPLOYMENT_ENVIRONMENT: "staging",
          MERCHANT_BASE_DOMAIN: "waflo.app",
          CUSTOMER_WEB_URL: "https://card-staging.waflo.app",
        },
      } as never,
    );

    await expect(service.resolve("card-staging.waflo.app")).resolves.toMatchObject({
      status: "reserved",
    });
    await expect(service.resolve("card-staging.waflo.app", "not valid")).rejects.toMatchObject({
      code: "TENANT_OVERRIDE_INVALID",
      status: 400,
    });
    await expect(service.resolve("today.waflo.app", "today")).rejects.toMatchObject({
      code: "TENANT_OVERRIDE_HOST_FORBIDDEN",
      status: 400,
    });
    await expect(service.resolve("today.waflo.app", "other-merchant")).rejects.toMatchObject({
      code: "TENANT_OVERRIDE_HOST_FORBIDDEN",
      status: 400,
    });
    await expect(service.resolve("hostile.example.test", "today")).rejects.toMatchObject({
      code: "TENANT_OVERRIDE_HOST_FORBIDDEN",
      status: 400,
    });
    await expect(service.resolve("today.lvh.me")).resolves.toMatchObject({
      status: "active",
      merchant: { slug: "today" },
    });
    expect(parseMerchantHostname("app.waflo.app", "waflo.app").status).toBe("reserved");
  });

  it("rejects tenant query overrides in production", async () => {
    const service = new HostResolutionService(
      { client: { organization: { findUnique: vi.fn() } } } as never,
      {
        values: {
          NODE_ENV: "production",
          DEPLOYMENT_ENVIRONMENT: "production",
          MERCHANT_BASE_DOMAIN: "waflo.app",
          CUSTOMER_WEB_URL: "https://card.waflo.app",
        },
      } as never,
    );
    await expect(service.resolve("card.waflo.app", "today")).rejects.toMatchObject({
      code: "TENANT_OVERRIDE_FORBIDDEN",
      status: 400,
    });
  });

  it("rejects staging tenant overrides outside the authoritative Customer host", async () => {
    const service = new HostResolutionService(
      { client: { organization: { findUnique: vi.fn() } } } as never,
      {
        values: {
          DEPLOYMENT_ENVIRONMENT: "staging",
          MERCHANT_BASE_DOMAIN: "waflo.app",
          CUSTOMER_WEB_URL: "https://card-staging.waflo.app",
        },
      } as never,
    );
    await expect(service.resolve("app-staging.waflo.app", "today")).rejects.toMatchObject({
      code: "TENANT_OVERRIDE_HOST_FORBIDDEN",
      status: 400,
    });
  });
});

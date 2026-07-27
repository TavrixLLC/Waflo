import {
  hashOpaqueToken,
  hashPassword,
  isSessionActive,
  normalizeEmail,
  sessionExpiresAt,
  verifyPassword,
} from "../../packages/auth/src/index";
import {
  calculateTrialState,
  canCreateLocation,
  canInviteTeamMember,
  planCatalog,
} from "../../packages/billing/src/index";
import { createErrorEnvelope } from "../../packages/contracts/src/index";
import { parseEnvironment } from "../../packages/config/src/index";
import { directionFor, formatUsd, isLocale, localePath } from "../../packages/i18n/src/index";
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

  it.each(["www", "api", "admin", "waflo", "wallet", "stripe", "localhost"])(
    "rejects reserved slug %s",
    (slug) => {
      expect(validateSlug(slug)).toMatchObject({
        valid: false,
        reason: "SLUG_RESERVED",
      });
    },
  );

  it("reserves an old slug for the 90-day cooldown", () => {
    const releasedAt = new Date("2026-07-27T12:00:00.000Z");
    expect(oldSlugReservedUntil(releasedAt).toISOString()).toBe("2026-10-25T12:00:00.000Z");
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
    expect(localePath("ar", "/pricing")).toBe("/ar/pricing");
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

  it("supports tenant query override only outside production", async () => {
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
          MERCHANT_BASE_DOMAIN: "waflo.app",
        },
      } as never,
    );
    const result = await service.resolve("localhost:3002", "today");
    expect(result).toMatchObject({
      status: "active",
      merchant: { slug: "today", defaultLocale: "ar" },
    });
  });
});

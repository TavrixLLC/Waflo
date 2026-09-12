import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AdminSession, AdminUser, PrismaClient } from "@waflo/database";
import { describe, expect, it } from "vitest";
import {
  adminCopy,
  adminDirection,
  adminNavigation,
  visibleAdminNavigation,
} from "../../apps/admin-dashboard/lib/admin-content";
import { AdminController } from "../../apps/api/src/admin/admin.controller.js";
import {
  AdminCsrfGuard,
  AdminSessionGuard,
  isAdminSessionActive,
} from "../../apps/api/src/admin/admin.guard.js";
import {
  AdminAuthService,
  safeAdminIdentity,
} from "../../apps/api/src/admin/admin-auth.service.js";
import { provisionAdminAccount } from "../../apps/api/src/admin/admin-provisioning.js";
import {
  adminRoleHasPermission,
  permissionsForAdminRole,
  requireAdminPermission,
} from "../../apps/api/src/admin/admin-rbac.js";

const baseAdmin = {
  publicId: "10000000-0000-4000-8000-000000000001",
  displayName: "Ops Admin",
  preferredLocale: "EN" as const,
  role: "READ_ONLY" as const,
  lastLoginAt: null,
};

function session(overrides: Partial<AdminSession> = {}) {
  return {
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    revokedAt: null,
    lastActiveAt: new Date("2026-08-27T11:59:00.000Z"),
    adminUser: { status: "ACTIVE" as const },
    ...overrides,
  } as unknown as Pick<AdminSession, "expiresAt" | "revokedAt" | "lastActiveAt"> & {
    adminUser: Pick<AdminUser, "status">;
  };
}

describe("admin identity, session and RBAC foundation", () => {
  function guardHarness(cookie: Record<string, string> = {}) {
    const request = {
      cookies: cookie,
      headers: {},
      requestId: "admin-test",
      id: "admin-test",
    };
    const reflector = {
      getAllAndOverride: (key: string) => key === "waflo:is-admin-route",
    };
    const environment = {
      values: { ADMIN_COOKIE_NAME: "waflo_admin_session", ADMIN_SESSION_IDLE_TTL_MINUTES: 60 },
    };
    const prisma = {
      client: { adminSession: { findUnique: async () => null, update: async () => undefined } },
    };
    const reporter = { captureException: async () => undefined };
    return {
      request,
      guard: new AdminSessionGuard(
        reflector as never,
        environment as never,
        prisma as never,
        reporter as never,
      ),
    };
  }

  function contextFor(request: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as never;
  }

  it("rejects an unauthenticated admin request", async () => {
    const harness = guardHarness();
    await expect(harness.guard.canActivate(contextFor(harness.request))).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
      status: 401,
    });
  });

  it("does not accept a merchant session cookie as admin authentication", async () => {
    const harness = guardHarness({ waflo_session: "merchant-token" });
    await expect(harness.guard.canActivate(contextFor(harness.request))).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
    });
  });

  it("does not accept a customer session cookie as admin authentication", async () => {
    const harness = guardHarness({ waflo_customer: "customer-token" });
    await expect(harness.guard.canActivate(contextFor(harness.request))).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
    });
  });

  it("hydrates a valid admin session from server state", async () => {
    const harness = guardHarness({ waflo_admin_session: "admin-token" });
    const session = {
      id: "session-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastActiveAt: new Date(),
      adminUser: {
        id: baseAdmin.publicId,
        publicId: baseAdmin.publicId,
        displayName: baseAdmin.displayName,
        email: "ops@example.com",
        preferredLocale: "EN",
        role: "READ_ONLY",
        status: "ACTIVE",
      },
    };
    const client = (harness.guard as unknown as { prisma: { client: unknown } }).prisma.client as {
      adminSession: { findUnique: () => Promise<unknown> };
    };
    client.adminSession.findUnique = async () => session;
    await expect(harness.guard.canActivate(contextFor(harness.request))).resolves.toBe(true);
    expect(harness.request.currentAdmin).toMatchObject({
      role: "READ_ONLY",
      displayName: "Ops Admin",
    });
  });

  it("admin controller returns a safe identity response", async () => {
    const controller = new AdminController(
      {
        me: async () => ({ ...safeAdminIdentity(baseAdmin), session: { expiresAt: new Date() } }),
      } as never,
      { values: { COOKIE_SECURE: false, ADMIN_COOKIE_NAME: "waflo_admin_session" } } as never,
    );
    const result = await controller.me(
      {
        id: "internal-id",
        publicId: baseAdmin.publicId,
        displayName: baseAdmin.displayName,
        email: "ops@example.com",
        preferredLocale: "EN",
        role: "READ_ONLY",
        permissions: permissionsForAdminRole("READ_ONLY"),
      },
      "session-id",
    );
    expect(result).not.toHaveProperty("passwordHash");
    expect(result).toHaveProperty("permissions");
  });

  it("admin CSRF rejects a merchant origin", async () => {
    const guard = new AdminCsrfGuard(
      { getAllAndOverride: () => true } as never,
      { adminCsrfCookieName: "waflo_admin_csrf", adminOrigin: "http://localhost:3003" } as never,
      { security: async () => undefined } as never,
    );
    const request = {
      method: "POST",
      headers: { origin: "http://localhost:3001", "x-csrf-token": "token" },
      cookies: { waflo_admin_csrf: "token" },
    };
    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      code: "ADMIN_CSRF_REJECTED",
    });
  });

  it("admin CSRF accepts the configured admin origin and token", async () => {
    const guard = new AdminCsrfGuard(
      { getAllAndOverride: () => true } as never,
      { adminCsrfCookieName: "waflo_admin_csrf", adminOrigin: "http://localhost:3003" } as never,
      { security: async () => undefined } as never,
    );
    const request = {
      method: "POST",
      headers: { origin: "http://localhost:3003", "x-csrf-token": "token" },
      cookies: { waflo_admin_csrf: "token" },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
  });

  it("logout revokes the exact admin session", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const service = new AdminAuthService(
      {
        client: {
          adminSession: {
            updateMany: async (input: Record<string, unknown>) => {
              calls.push(input);
              return { count: 1 };
            },
          },
        },
      } as never,
      {} as never,
      { record: async () => undefined } as never,
    );
    await service.logout("admin-1", "session-1", { headers: {} } as never);
    expect(calls).toEqual([
      expect.objectContaining({
        where: { id: "session-1", adminUserId: "admin-1", revokedAt: null },
        data: expect.objectContaining({ revocationReason: "logout" }),
      }),
    ]);
  });

  it("clears the production admin cookie with matching __Host attributes", () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const controller = new AdminController(
      {} as never,
      {
        values: { COOKIE_SECURE: true, ADMIN_COOKIE_NAME: "__Host-waflo_admin_session" },
      } as never,
    );
    (
      controller as unknown as {
        clearSessionCookie(reply: { clearCookie: (...args: never[]) => void }): void;
      }
    ).clearSessionCookie({
      clearCookie: (name: string, options: Record<string, unknown>) => calls.push([name, options]),
    } as never);
    expect(calls).toEqual([
      [
        "__Host-waflo_admin_session",
        { path: "/", httpOnly: true, secure: true, sameSite: "strict" },
      ],
    ]);
  });

  it("does not define a public admin signup handler", () => {
    expect(Object.getOwnPropertyNames(AdminController.prototype)).not.toContain("signup");
  });
  it("grants dashboard read to READ_ONLY", () => {
    expect(adminRoleHasPermission("READ_ONLY", "admin.dashboard.read")).toBe(true);
  });

  it("denies pricing publication to READ_ONLY", () => {
    expect(adminRoleHasPermission("READ_ONLY", "admin.pricing.write")).toBe(false);
  });

  it("grants pricing publication to PRICING_ADMIN", () => {
    expect(adminRoleHasPermission("PRICING_ADMIN", "admin.pricing.write")).toBe(true);
  });

  it("grants finance read to FINANCE", () => {
    expect(adminRoleHasPermission("FINANCE", "admin.finance.read")).toBe(true);
  });

  it("does not grant pricing publication to SUPPORT", () => {
    expect(adminRoleHasPermission("SUPPORT", "admin.pricing.write")).toBe(false);
  });

  it("grants all capabilities to SUPER_ADMIN", () => {
    expect(permissionsForAdminRole("SUPER_ADMIN")).toHaveLength(9);
  });

  it("keeps permissions server-derived and deterministic", () => {
    expect(permissionsForAdminRole("READ_ONLY")).toEqual([
      "admin.dashboard.read",
      "admin.customers.read",
      "admin.pricing.read",
      "admin.repricing.read",
      "admin.finance.read",
      "admin.stripe_health.read",
      "admin.audit.read",
    ]);
  });

  it("throws a typed forbidden error for a missing capability", () => {
    expect(() => requireAdminPermission("SUPPORT", "admin.pricing.write")).toThrowError(
      expect.objectContaining({ code: "ADMIN_FORBIDDEN", status: 403 }),
    );
  });

  it("accepts an active, unexpired admin session", () => {
    expect(isAdminSessionActive(session(), 60, new Date("2026-08-27T12:00:00.000Z"))).toBe(true);
  });

  it("rejects a revoked admin session", () => {
    expect(
      isAdminSessionActive(
        session({ revokedAt: new Date("2026-08-27T12:00:00.000Z") }),
        60,
        new Date("2026-08-27T12:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("rejects an expired admin session", () => {
    expect(
      isAdminSessionActive(
        session({ expiresAt: new Date("2026-08-27T11:00:00.000Z") }),
        60,
        new Date("2026-08-27T12:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("rejects an idle admin session", () => {
    expect(
      isAdminSessionActive(
        session({ lastActiveAt: new Date("2026-08-27T10:00:00.000Z") }),
        60,
        new Date("2026-08-27T12:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("rejects a disabled admin identity", () => {
    expect(
      isAdminSessionActive(
        session({ adminUser: { status: "DISABLED" } } as never),
        60,
        new Date("2026-08-27T12:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("safe identity excludes password and cryptographic fields", () => {
    const identity = safeAdminIdentity({ ...baseAdmin, passwordHash: "secret" } as never);
    expect(identity).not.toHaveProperty("passwordHash");
    expect(identity).not.toHaveProperty("email");
    expect(identity).toMatchObject({ publicId: baseAdmin.publicId, role: "READ_ONLY" });
  });

  it("safe identity maps Arabic locale", () => {
    expect(
      safeAdminIdentity({ ...baseAdmin, preferredLocale: "AR" } as never).preferredLocale,
    ).toBe("ar");
  });

  it("does not include client-provided permissions in safe identity", () => {
    const identity = safeAdminIdentity({
      ...baseAdmin,
      permissions: ["admin.pricing.write"],
    } as never);
    expect(identity).not.toHaveProperty("permissions", ["admin.pricing.write"]);
  });

  it("provisioning defaults to a dry run without a write flag", async () => {
    const result = await provisionAdminAccount({} as never as PrismaClient, {
      email: "ops@example.com",
      displayName: "Ops",
      role: "SUPER_ADMIN",
      preferredLocale: "EN",
      write: false,
    });
    expect(result.mode).toBe("dry-run");
  });

  it("dry-run provisioning does not require a password", async () => {
    const result = await provisionAdminAccount({} as never as PrismaClient, {
      email: "ops@example.com",
      displayName: "Ops",
      role: "READ_ONLY",
      preferredLocale: "AR",
      write: false,
    });
    expect(result.account).toMatchObject({
      normalizedEmail: "ops@example.com",
      preferredLocale: "AR",
    });
  });

  it("write provisioning requires explicit write intent", async () => {
    await expect(
      provisionAdminAccount({} as never as PrismaClient, {
        email: "ops@example.com",
        displayName: "Ops",
        role: "SUPER_ADMIN",
        preferredLocale: "EN",
        write: true,
      }),
    ).rejects.toThrow("password");
  });

  it("rejects weak provisioning passwords", async () => {
    await expect(
      provisionAdminAccount({} as never as PrismaClient, {
        email: "ops@example.com",
        displayName: "Ops",
        role: "SUPER_ADMIN",
        preferredLocale: "EN",
        write: true,
        password: "short",
      }),
    ).rejects.toThrow("12 characters");
  });

  it("admin navigation has the required sections", () => {
    expect(adminNavigation.map((item) => item.key)).toEqual([
      "overview",
      "customers",
      "pricing",
      "repricing",
      "finance",
      "stripeHealth",
      "audit",
      "settings",
    ]);
  });

  it("navigation is filtered by server permission", () => {
    expect(visibleAdminNavigation(["admin.dashboard.read"]).map((item) => item.key)).toEqual([
      "overview",
      "settings",
    ]);
  });

  it("pricing navigation is visible only with pricing read capability", () => {
    expect(visibleAdminNavigation(["admin.dashboard.read"])).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "pricing" })]),
    );
  });

  it("Arabic navigation copy is localized", () => {
    expect(adminCopy("ar").pricing).toBe("التسعير");
  });

  it("English navigation copy is localized", () => {
    expect(adminCopy("en").pricing).toBe("Pricing");
  });

  it("Arabic shell uses RTL", () => {
    expect(adminDirection("ar")).toBe("rtl");
  });

  it("English shell uses LTR", () => {
    expect(adminDirection("en")).toBe("ltr");
  });

  it("permission mapping has no write capability for support", () => {
    expect(
      permissionsForAdminRole("SUPPORT").some((permission) => permission.endsWith(".write")),
    ).toBe(false);
  });

  it("permission mapping has write capabilities for pricing admin", () => {
    expect(
      permissionsForAdminRole("PRICING_ADMIN").filter((permission) =>
        permission.endsWith(".write"),
      ),
    ).toEqual(["admin.pricing.write", "admin.repricing.write"]);
  });

  it("disabled identities cannot become active through role mapping", () => {
    expect(isAdminSessionActive(session({ adminUser: { status: "DISABLED" } } as never), 60)).toBe(
      false,
    );
  });

  it("session activity is bounded by configured idle TTL", () => {
    expect(isAdminSessionActive(session(), 5, new Date("2026-08-27T12:05:01.000Z"))).toBe(false);
  });

  it("overview capability is present for every valid role", () => {
    for (const role of [
      "SUPER_ADMIN",
      "PRICING_ADMIN",
      "FINANCE",
      "SUPPORT",
      "READ_ONLY",
    ] as const) {
      expect(adminRoleHasPermission(role, "admin.dashboard.read")).toBe(true);
    }
  });

  it("protected routes are wrapped by the admin session boundary", () => {
    const source = readFileSync(
      resolve("apps/admin-dashboard/app/[locale]/(protected)/layout.tsx"),
      "utf8",
    );
    expect(source).toContain("<AdminShell");
    expect(source).toContain("{children}</AdminShell>");
  });

  it("forbidden and expired-session routes expose no commercial data", () => {
    for (const route of ["forbidden", "session-expired"]) {
      const source = readFileSync(
        resolve(`apps/admin-dashboard/app/[locale]/${route}/page.tsx`),
        "utf8",
      );
      expect(source).not.toMatch(/customer|subscription|invoice|stripePrice/i);
    }
  });
});

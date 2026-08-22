import { afterEach, describe, expect, it } from "vitest";
import marketingConfig from "../../apps/marketing-web/next.config";
import dashboardConfig from "../../apps/merchant-dashboard/next.config";
import customerConfig from "../../apps/customer-web/next.config";
import { createApiApplication, serializeHttpRequest } from "../../apps/api/src/app";
import { EnvironmentService } from "../../apps/api/src/config/environment.service";
import {
  renderNotificationHtml,
  safeNotificationActionUrl,
} from "../../apps/api/src/notifications/notification.service";
import { RateLimitService } from "../../apps/api/src/security/rate-limit.service";
import {
  createErrorReporter,
  redactMetadata,
  sanitizeErrorForReporting,
  sanitizeRequestUrl,
} from "../../packages/security/src/index";

const originalNodeEnvironment = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnvironment;
});

describe("repair-round security boundaries", () => {
  it("removes token values from request URLs and serialized log output", () => {
    const rawToken = "raw-super-secret-token-value";
    expect(sanitizeRequestUrl(`/verify?token=${rawToken}&locale=en`)).toBe(
      "/verify?token=%5BREDACTED%5D&locale=en",
    );
    const serialized = JSON.stringify(
      serializeHttpRequest({
        method: "GET",
        url: `/verify?token=${rawToken}`,
        hostname: "app.waflo.local",
        ip: "127.0.0.1",
        socket: { remotePort: 443 },
      } as never),
    );
    expect(serialized).not.toContain(rawToken);
    expect(serialized).toContain("%5BREDACTED%5D");
  });

  it("redacts reporter metadata and exception messages", () => {
    const rawToken = "reporter-secret-token";
    expect(redactMetadata({ token: rawToken, nested: { password: "password-secret" } })).toEqual({
      token: "[REDACTED]",
      nested: { password: "[REDACTED]" },
    });
    const safe = sanitizeErrorForReporting(
      new Error(`request failed at /reset?token=${rawToken} password=password-secret`),
    );
    expect(JSON.stringify(safe)).not.toContain(rawToken);
    expect(safe.message).not.toContain("password-secret");
  });

  it("uses a graceful no-op or optional dynamic Sentry adapter", async () => {
    const noop = createErrorReporter(undefined);
    await expect(
      Promise.resolve(noop.captureException(new Error("test"))),
    ).resolves.toBeUndefined();
    await expect(Promise.resolve(noop.captureMessage("test"))).resolves.toBeUndefined();
    await expect(Promise.resolve(noop.setUserContext("user-id"))).resolves.toBeUndefined();
    await expect(
      Promise.resolve(noop.setOrganizationContext("organization-id")),
    ).resolves.toBeUndefined();
    await expect(Promise.resolve(noop.clearContext())).resolves.toBeUndefined();
    await expect(noop.flush()).resolves.toBe(true);
    await expect(
      Promise.resolve(
        createErrorReporter("https://public@example.invalid/1").captureException(new Error("test")),
      ),
    ).resolves.toBeUndefined();
  }, 15_000);

  it("escapes notification HTML and rejects unsafe or off-origin action URLs", () => {
    const origin = "https://app.waflo.app";
    const html = renderNotificationHtml(
      {
        to: "owner@example.com",
        locale: "en",
        kind: "team_invitation",
        organizationName: '<img src=x onerror="alert(1)">',
        actionUrl: "javascript:alert(1)",
      },
      [origin],
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("javascript:");
    expect(safeNotificationActionUrl("https://attacker.example/steal", [origin])).toBeNull();
    // Fragment-based token URL must be accepted.
    expect(
      safeNotificationActionUrl(`https://app.waflo.app/en/invite#token=safe-token`, [origin]),
    ).toContain("https://app.waflo.app/");
    // Off-origin URL must be rejected regardless of token position.
    expect(safeNotificationActionUrl("https://attacker.example/steal", [origin])).toBeNull();
    expect(
      safeNotificationActionUrl("https://attacker.example/invite#token=stolen", [origin]),
    ).toBeNull();
    // Same-origin URL with legacy query-token is still accepted by the URL validator
    // (origin check only) — the production code never emits ?token= links.
    expect(
      safeNotificationActionUrl("https://app.waflo.app/en/verify-email?token=safe", [origin]),
    ).toContain("https://app.waflo.app/");
  });

  it("renders production-quality localized email verification content", () => {
    const localOrigin = "http://localhost:3001";
    const english = renderNotificationHtml(
      {
        to: "owner@example.com",
        locale: "en",
        kind: "email_verification",
        actionUrl: `${localOrigin}/en/verify-email#token=test-only-verification-token`,
        expiresAt: new Date("2026-08-14T12:00:00.000Z"),
      },
      [localOrigin],
    );
    expect(english).toContain('<html lang="en" dir="ltr">');
    expect(english).toContain("Verify your Waflo email");
    expect(english).toContain("Confirm your email address");
    expect(english).toContain(">Verify email</a>");
    expect(english).toContain(`${localOrigin}/en/verify-email#token=`);

    const arabic = renderNotificationHtml(
      {
        to: "owner@example.com",
        locale: "ar",
        kind: "email_verification",
        actionUrl: `${localOrigin}/ar/verify-email#token=test-only-verification-token`,
        expiresAt: new Date("2026-08-14T12:00:00.000Z"),
      },
      [localOrigin],
    );
    expect(arabic).toContain('<html lang="ar" dir="rtl">');
    expect(arabic).toContain("تأكيد بريدك الإلكتروني في Waflo");
    expect(arabic).toContain("أكّد عنوان بريدك الإلكتروني");
    expect(arabic).toContain(">تأكيد البريد الإلكتروني</a>");
    expect(arabic).toContain(`${localOrigin}/ar/verify-email#token=`);
    expect(arabic).not.toMatch(/[٠-٩۰-۹]/u);

    for (const html of [english, arabic]) {
      expect(html).toContain("Waflo is owned and operated by Tavrix LLC.");
      expect(html).not.toContain("Mailpit");
      expect(html).not.toContain("localhost:8025");
      expect(html).not.toContain("SMTP");
    }
  });

  it("uses account-creation wording when a Google-only user creates a Waflo password", () => {
    const localOrigin = "http://localhost:3001";
    const english = renderNotificationHtml(
      {
        to: "owner@example.com",
        locale: "en",
        kind: "password_setup",
        actionUrl: `${localOrigin}/en/reset-password#token=one-time-token`,
        expiresAt: new Date("2026-08-22T12:00:00.000Z"),
      },
      [localOrigin],
    );

    expect(english).toContain("Create your Waflo password");
    expect(english).toContain(">Create password</a>");
    expect(english).toContain("Do not use your Google password here");
    expect(english).not.toContain("Reset your Waflo password");
  });

  it("adds CSP everywhere and HSTS only in production without unsafe-eval", async () => {
    process.env.NODE_ENV = "production";
    for (const config of [marketingConfig, dashboardConfig, customerConfig]) {
      const groups = (await config.headers?.()) ?? [];
      const headers = groups.flatMap((group) => group.headers);
      const csp = headers.find((header) => header.key === "Content-Security-Policy")?.value;
      expect(csp).toContain("default-src 'self'");
      expect(csp).not.toContain("unsafe-eval");
      expect(headers.some((header) => header.key === "Strict-Transport-Security")).toBe(true);
    }
    process.env.NODE_ENV = "development";
    for (const config of [marketingConfig, dashboardConfig, customerConfig]) {
      const groups = (await config.headers?.()) ?? [];
      expect(
        groups
          .flatMap((group) => group.headers)
          .some((header) => header.key === "Strict-Transport-Security"),
      ).toBe(false);
    }
  });

  it("disables the vulnerable Next server-side image optimizer in every web app", () => {
    for (const config of [marketingConfig, dashboardConfig, customerConfig]) {
      expect(config.images?.unoptimized).toBe(true);
    }
  });

  it("initializes non-production Swagger static assets through the Fastify adapter", async () => {
    process.env.NODE_ENV = "test";
    const app = await createApiApplication({ logger: false });
    try {
      expect(app.getHttpAdapter().getInstance().printRoutes()).toContain("docs");
      const response = await app.inject({ method: "GET", url: "/route-that-does-not-exist" });
      expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
    } finally {
      await app.close();
    }
  }, 30000);

  it("fails closed when production Redis is unavailable", async () => {
    const fakeEnvironment = {
      values: {
        NODE_ENV: "production",
        RATE_LIMIT_NAMESPACE: "waflo-production-test",
        REDIS_URL: "redis://127.0.0.1:1",
      },
    } as unknown as EnvironmentService;
    const limiter = new RateLimitService(fakeEnvironment);
    await expect(limiter.consume("key", 1, 60)).rejects.toMatchObject({
      code: "RATE_LIMIT_STORAGE_UNAVAILABLE",
      status: 503,
    });
    await expect(limiter.assertReady()).rejects.toBeDefined();
    await limiter.onModuleDestroy();
  });

  it("bounds development in-memory rate-limit buckets", async () => {
    const fakeEnvironment = {
      values: {
        NODE_ENV: "test",
        RATE_LIMIT_NAMESPACE: "waflo-memory-test",
        REDIS_URL: "",
      },
    } as unknown as EnvironmentService;
    const limiter = new RateLimitService(fakeEnvironment);
    for (let index = 0; index < 10_050; index += 1) {
      await limiter.consume(`key-${index}`, 1, 60);
    }
    const memory = (limiter as unknown as { memory: Map<string, unknown> }).memory;
    expect(memory.size).toBeLessThanOrEqual(10_000);
  });
});

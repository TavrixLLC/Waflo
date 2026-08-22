import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PublicEnrollmentService } from "../../apps/api/src/enrollment/public-enrollment.service.js";
import { normalizeWalletCampaignDestination } from "../../apps/api/src/wallet-engagement/wallet-engagement.service.js";
import { parseEnvironment, platformDomains } from "../../packages/config/src/index.js";
import { createNextContentSecurityPolicy } from "../../packages/security/src/index.js";
import { mapAppleStoreCard } from "../../packages/wallet-apple/src/index.js";
import type { WalletMembershipInput } from "../../packages/wallet-core/src/index.js";
import { canonicalJoinUrl } from "../../packages/qr-core/src/index.js";

const key = (label: string) => `${label}-`.repeat(16).slice(0, 64);

function stagingEnvironment(overrides: NodeJS.ProcessEnv = {}) {
  return parseEnvironment({
    NODE_ENV: "production",
    DEPLOYMENT_ENVIRONMENT: "staging",
    DATABASE_URL: "postgresql://staging:password@postgres:5432/waflo_staging",
    REDIS_URL: "rediss://redis:6379",
    TRUSTED_PROXIES: "10.210.10.0/24",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "staging-user",
    SMTP_PASSWORD: "staging-password",
    SMTP_FROM: "Waflo Staging <staging@waflo.app>",
    MARKETING_WEB_URL: "https://staging.waflo.app",
    MERCHANT_DASHBOARD_URL: "https://app-staging.waflo.app",
    CUSTOMER_WEB_URL: "https://card-staging.waflo.app",
    API_PUBLIC_URL: "https://api-staging.waflo.app",
    ALLOWED_ORIGINS:
      "https://staging.waflo.app,https://app-staging.waflo.app,https://card-staging.waflo.app",
    COOKIE_SECURE: "true",
    COOKIE_NAME: "__Host-waflo_session",
    CUSTOMER_COOKIE_NAME: "__Host-waflo_customer",
    OBJECT_STORAGE_ENDPOINT: "http://minio:9000",
    OBJECT_STORAGE_ALLOW_INSECURE_INTERNAL: "true",
    OBJECT_STORAGE_ACCESS_KEY_ID: "staging-access-key",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "staging-secret-key",
    OBJECT_STORAGE_SIGNING_SECRET: key("storage"),
    OAUTH_FLOW_SECRET: key("oauth"),
    CUSTOMER_DATA_ENCRYPTION_KEY_V1: key("customer-data"),
    CUSTOMER_CONTACT_LOOKUP_HMAC_KEY: key("contact"),
    CUSTOMER_SESSION_SECRET: key("session"),
    MEMBERSHIP_CREDENTIAL_SECRET_V1: key("membership"),
    APPLE_PASS_AUTH_SECRET_V1: key("apple-pass"),
    LEDGER_HASH_SECRET_V1: key("ledger"),
    MERCHANT_TRANSACTION_REFERENCE_HMAC_KEY_V1: key("transaction"),
    DEVICE_SESSION_SECRET: key("device"),
    TEST_STAFF_CLIENT_ENABLED: "false",
    WALLET_PUBLIC_BASE_URL: "https://api-staging.waflo.app/v1/public/wallet-assets",
    APPLE_PASS_WEB_SERVICE_URL: "https://api-staging.waflo.app/v1/apple-wallet",
    GOOGLE_WALLET_ALLOWED_ORIGINS: "https://card-staging.waflo.app",
    GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL: "https://api-staging.waflo.app/v1/public/wallet-assets",
    ...overrides,
  });
}

describe("staging public hostname cutover", () => {
  it("recovers an old shared-host QR only for one unambiguous staging merchant", async () => {
    const organization = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Cedar",
      merchantSlug: "cedar",
      status: "ACTIVE",
      defaultLocale: "EN",
      billingProfile: null,
      brandLogoAsset: null,
    };
    const findMany = vi.fn(async () => [organization]);
    const hosts = {
      resolveOrganization: vi.fn(async () => ({ status: "malformed" as const })),
    };
    const service = new PublicEnrollmentService(
      { client: { organization: { findMany } } } as never,
      hosts as never,
      {} as never,
      { values: stagingEnvironment() } as never,
      {} as never,
      {} as never,
    );
    const resolve = (
      service as unknown as {
        resolveProgramOrganization: (
          host: string,
          slug: string,
        ) => Promise<{
          status: string;
          organization?: typeof organization;
        }>;
      }
    ).resolveProgramOrganization.bind(service);

    await expect(resolve("card-staging.waflo.app", "cedar-circle")).resolves.toMatchObject({
      status: "active",
      organization,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );

    findMany.mockResolvedValueOnce([organization, { ...organization, id: "other" }]);
    await expect(resolve("card-staging.waflo.app", "shared-slug")).resolves.toEqual({
      status: "malformed",
    });

    const productionService = new PublicEnrollmentService(
      { client: { organization: { findMany } } } as never,
      hosts as never,
      {} as never,
      {
        values: { ...stagingEnvironment(), DEPLOYMENT_ENVIRONMENT: "production" },
      } as never,
      {} as never,
      {} as never,
    );
    const resolveProduction = (
      productionService as unknown as {
        resolveProgramOrganization: (host: string, slug: string) => Promise<{ status: string }>;
      }
    ).resolveProgramOrganization.bind(productionService);
    findMany.mockClear();
    await expect(resolveProduction("card.waflo.app", "cedar-circle")).resolves.toEqual({
      status: "malformed",
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("parses only the authoritative staging origins and preserves production constants", () => {
    const environment = stagingEnvironment();
    expect(environment).toMatchObject({
      MARKETING_WEB_URL: "https://staging.waflo.app",
      MERCHANT_DASHBOARD_URL: "https://app-staging.waflo.app",
      CUSTOMER_WEB_URL: "https://card-staging.waflo.app",
      API_PUBLIC_URL: "https://api-staging.waflo.app",
    });
    expect(platformDomains).toEqual({
      marketing: "waflo.app",
      dashboard: "app.waflo.app",
      customer: "card.waflo.app",
      api: "api.waflo.app",
      staging: {
        marketing: "staging.waflo.app",
        dashboard: "app-staging.waflo.app",
        customer: "card-staging.waflo.app",
        api: "api-staging.waflo.app",
      },
    });
    expect(() => stagingEnvironment({ API_PUBLIC_URL: "https://api.staging.waflo.app" })).toThrow(
      "authoritative https://api-staging.waflo.app URL",
    );
    expect(() =>
      stagingEnvironment({ MERCHANT_DASHBOARD_URL: "https://app.staging.waflo.app" }),
    ).toThrow("authoritative https://app-staging.waflo.app URL");
    expect(() =>
      stagingEnvironment({ CUSTOMER_WEB_URL: "https://card.staging.waflo.app" }),
    ).toThrow("authoritative https://card-staging.waflo.app URL");
  });

  it("keeps CORS and CSP explicit for staging without a wildcard or production API fallback", () => {
    const environment = stagingEnvironment();
    expect(environment.ALLOWED_ORIGINS.split(",")).toEqual([
      "https://staging.waflo.app",
      "https://app-staging.waflo.app",
      "https://card-staging.waflo.app",
    ]);
    const policy = createNextContentSecurityPolicy("production", {
      apiUrl: "https://api-staging.waflo.app/v1",
    });
    expect(policy).toContain("connect-src 'self' https://api-staging.waflo.app");
    expect(policy).toContain("frame-src 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain("https://api.waflo.app");
    expect(policy).not.toMatch(/(?:^|\s)\*(?:\s|;|$)/u);
  });

  it("requires the Google OAuth callback on the new staging API authority", () => {
    expect(
      stagingEnvironment({
        GOOGLE_SIGNIN_CLIENT_ID: "staging-google-client",
        GOOGLE_SIGNIN_CLIENT_SECRET: "staging-google-secret",
        GOOGLE_SIGNIN_REDIRECT_URI:
          "https://api-staging.waflo.app/v1/auth/external/google/callback",
      }).GOOGLE_SIGNIN_REDIRECT_URI,
    ).toBe("https://api-staging.waflo.app/v1/auth/external/google/callback");
    expect(() =>
      stagingEnvironment({
        GOOGLE_SIGNIN_CLIENT_ID: "staging-google-client",
        GOOGLE_SIGNIN_CLIENT_SECRET: "staging-google-secret",
        GOOGLE_SIGNIN_REDIRECT_URI:
          "https://api.staging.waflo.app/v1/auth/external/google/callback",
      }),
    ).toThrow("OAuth callbacks must be exact HTTPS URLs on the configured API origin");
  });

  it("accepts campaign related links only on configured staging or exact merchant hosts", () => {
    const configuredWafloUrls = [
      "https://staging.waflo.app",
      "https://app-staging.waflo.app",
      "https://card-staging.waflo.app",
      "https://api-staging.waflo.app",
    ];
    expect(
      normalizeWalletCampaignDestination({
        destinationUrl: "https://card-staging.waflo.app/card/member#private-fragment",
        configuredWafloUrls,
        merchantHostnames: ["rewards.example.com"],
        allowLocal: false,
      }),
    ).toBe("https://card-staging.waflo.app/card/member");
    expect(
      normalizeWalletCampaignDestination({
        destinationUrl: "https://rewards.example.com/weekend",
        configuredWafloUrls,
        merchantHostnames: ["rewards.example.com"],
        allowLocal: false,
      }),
    ).toBe("https://rewards.example.com/weekend");
    expect(() =>
      normalizeWalletCampaignDestination({
        destinationUrl: "https://unlisted.waflo.app/offer",
        configuredWafloUrls,
        merchantHostnames: [],
        allowLocal: false,
      }),
    ).toThrow("destination must use HTTPS and belong to this merchant or Waflo");
  });

  it("uses the shared staging Customer Web host with an explicit tenant and new Apple service URL", () => {
    expect(
      canonicalJoinUrl({
        merchantSlug: "cedar",
        programSlug: "cedar-circle",
        customerBaseUrl: "https://card-staging.waflo.app",
      }),
    ).toBe("https://card-staging.waflo.app/join/cedar-circle?tenant=cedar");

    const fixture = {
      organizationId: "00000000-0000-4000-8000-000000000001",
      organizationName: "Cedar",
      programId: "00000000-0000-4000-8000-000000000002",
      programVersionId: "00000000-0000-4000-8000-000000000003",
      programName: "Cedar Circle",
      description: "Loyalty Card",
      rewardSummary: "Reward",
      backgroundColor: "#ffffff",
      foregroundColor: "#000000",
      configurationFingerprint: "a".repeat(64),
      locale: "en",
      walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
      providerIdentity: "serial",
      publicMembershipId: "membership",
      displayName: "Customer",
      credentialPayload: "credential",
      currentStampCount: 0,
      requiredStampCount: 8,
      rewardReady: false,
      membershipStatus: "ACTIVE",
      programStatus: "PUBLISHED",
      transferred: false,
      stampRenderInput: {} as never,
    } satisfies WalletMembershipInput;
    const pass = mapAppleStoreCard(
      fixture,
      {
        passTypeIdentifier: "pass.app.waflo",
        teamIdentifier: "TEAM",
        organizationName: "Waflo",
        webServiceUrl: "https://api-staging.waflo.app/v1/apple-wallet",
      },
      "x".repeat(43),
    );
    expect(pass.webServiceURL).toBe("https://api-staging.waflo.app/v1/apple-wallet");
  });

  it("keeps machine-validated deployment and provider examples on the new hosts", () => {
    const sources = [
      readFileSync(".env.staging.example", "utf8"),
      readFileSync("deploy/vps/templates/staging/application.env.example", "utf8"),
      readFileSync("deploy/vps/templates/staging/compose.env.example", "utf8"),
      readFileSync("deploy/vps/scripts/common.sh", "utf8"),
      readFileSync("docs/release/real-provider-configuration.md", "utf8"),
    ].join("\n");
    expect(sources).toContain("https://api-staging.waflo.app/health");
    expect(sources).toContain("https://api-staging.waflo.app/ready");
    expect(sources).toContain("https://app-staging.waflo.app/en/login");
    expect(sources).toContain("https://card-staging.waflo.app/privacy");
    expect(sources).toContain("https://staging.waflo.app/en");
    expect(sources).toContain("https://api-staging.waflo.app/v1/webhooks/stripe");
    expect(sources).toContain("https://api-staging.waflo.app/v1/auth/external/google/callback");
    expect(sources).not.toMatch(/(?:api|app|card)\.staging\.waflo\.app/u);
  });
});

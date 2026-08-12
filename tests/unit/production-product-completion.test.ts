import { describe, expect, it, vi } from "vitest";
import { classifyApplePushResponse } from "../../apps/wallet-worker/src/apple-push.js";
import { ExternalAuthService } from "../../apps/api/src/auth/external-auth.service.js";
import type { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { WalletProviderRegistry } from "../../apps/api/src/wallet/wallet-provider.registry.js";
import { NotificationService } from "../../apps/api/src/notifications/notification.service.js";
import { parseEnvironment, parseVersionedSecretEntries } from "../../packages/config/src/index.js";

const OLD_KEY = "a".repeat(64);
const NEW_KEY = "b".repeat(64);
const CONTACT_KEY = "c".repeat(64);
const SESSION_KEY = "d".repeat(64);

function environment(overrides: NodeJS.ProcessEnv = {}): EnvironmentService {
  return {
    values: parseEnvironment({
      NODE_ENV: "test",
      CUSTOMER_DATA_ENCRYPTION_KEY_V1: OLD_KEY,
      CUSTOMER_CONTACT_LOOKUP_HMAC_KEY: CONTACT_KEY,
      CUSTOMER_SESSION_SECRET: SESSION_KEY,
      MEMBERSHIP_CREDENTIAL_SECRET_V1: OLD_KEY,
      APPLE_PASS_AUTH_SECRET_V1: OLD_KEY,
      OAUTH_FLOW_SECRET: "oauth".repeat(16),
      ...overrides,
    }),
  } as EnvironmentService;
}

function security(overrides: NodeJS.ProcessEnv = {}, client: object = {}) {
  return new CustomerSecurityService(environment(overrides), { client } as never);
}

describe("production environment and provider boundaries", () => {
  it("parses explicit multi-version secret sets and rejects malformed sets", () => {
    expect(
      parseVersionedSecretEntries(JSON.stringify({ 1: OLD_KEY, 2: NEW_KEY }), "legacy"),
    ).toEqual({
      1: OLD_KEY,
      2: NEW_KEY,
    });
    expect(() => parseVersionedSecretEntries("[]", "legacy")).toThrow("JSON object");
    expect(() => parseVersionedSecretEntries('{"not-a-version":"value"}', "legacy")).toThrow(
      "invalid entry",
    );
  });

  it("fails closed when an active key version is absent", () => {
    expect(() =>
      security({
        CUSTOMER_DATA_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: OLD_KEY }),
        CUSTOMER_DATA_ACTIVE_KEY_VERSION: "2",
      }),
    ).toThrow();
  });

  it("reads old customer ciphertext during rotation and writes with the active version", () => {
    const prior = security({
      CUSTOMER_DATA_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: OLD_KEY, 2: NEW_KEY }),
      CUSTOMER_DATA_ACTIVE_KEY_VERSION: "1",
    });
    const oldValue = prior.prepareEmail("00000000-0000-4000-8000-000000000001", "old@example.com");
    const rotated = security({
      CUSTOMER_DATA_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: OLD_KEY, 2: NEW_KEY }),
      CUSTOMER_DATA_ACTIVE_KEY_VERSION: "2",
    });
    const newValue = rotated.prepareEmail(
      "00000000-0000-4000-8000-000000000001",
      "new@example.com",
    );
    expect(oldValue.encryptionKeyVersion).toBe(1);
    expect(newValue.encryptionKeyVersion).toBe(2);
    expect(
      rotated.decryptEmail({
        id: oldValue.id,
        organizationId: "00000000-0000-4000-8000-000000000001",
        encryptedValue: oldValue.encryptedValue,
      }),
    ).toBe("old@example.com");
  });

  it("accepts historical Apple pass authentication secrets until retirement", () => {
    const oldWriter = security({
      APPLE_PASS_AUTH_SECRETS_JSON: JSON.stringify({ 1: OLD_KEY, 2: NEW_KEY }),
      APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION: "1",
    });
    const oldToken = oldWriter.appleAuthenticationToken("pass-instance", "serial");
    const rotating = security({
      APPLE_PASS_AUTH_SECRETS_JSON: JSON.stringify({ 1: OLD_KEY, 2: NEW_KEY }),
      APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION: "2",
    });
    expect(rotating.verifyAppleAuthenticationToken("pass-instance", "serial", oldToken)).toBe(true);
    const retired = security({
      APPLE_PASS_AUTH_SECRETS_JSON: JSON.stringify({ 2: NEW_KEY }),
      APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION: "2",
    });
    expect(retired.verifyAppleAuthenticationToken("pass-instance", "serial", oldToken)).toBe(false);
  });

  it("verifies historical membership credentials during rotation and rejects them after retirement", async () => {
    const oldWriter = security({
      MEMBERSHIP_CREDENTIAL_SECRETS_JSON: JSON.stringify({ 1: OLD_KEY, 2: NEW_KEY }),
      MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION: "1",
    });
    const oldCredential = oldWriter.createCredential(1);
    const persisted = {
      status: "ACTIVE",
      publicCredentialId: oldCredential.publicCredentialId,
      credentialVersion: 1,
      secretVersion: oldCredential.secretVersion,
      secretHash: oldCredential.secretHash,
      membership: {},
    };
    const client = {
      membershipCredential: { findUnique: vi.fn(async () => persisted) },
    };
    const rotating = security(
      {
        MEMBERSHIP_CREDENTIAL_SECRETS_JSON: JSON.stringify({ 1: OLD_KEY, 2: NEW_KEY }),
        MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION: "2",
      },
      client,
    );
    expect(await rotating.verifyCredentialPayload(oldCredential.payload)).toBe(persisted);
    const retired = security(
      {
        MEMBERSHIP_CREDENTIAL_SECRETS_JSON: JSON.stringify({ 2: NEW_KEY }),
        MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION: "2",
      },
      client,
    );
    expect(await retired.verifyCredentialPayload(oldCredential.payload)).toBeNull();
  });

  it("reports wallet providers unavailable when real signing configuration is incomplete", () => {
    const env = environment({
      APPLE_WALLET_MODE: "REAL",
      GOOGLE_WALLET_MODE: "REAL",
      APPLE_PASS_TYPE_IDENTIFIER: "pass.app.waflo",
      GOOGLE_WALLET_ISSUER_ID: "issuer",
    });
    const registry = new WalletProviderRegistry(env, security());
    expect(registry.publicCapabilities()).toEqual({
      googleWalletAvailable: false,
      appleWalletAvailable: false,
      googleWallet: "NOT_CONFIGURED",
      appleWallet: "NOT_CONFIGURED",
    });
  });

  it("exposes only safe public sign-in capability state", () => {
    const service = new ExternalAuthService({} as never, environment(), {} as never, {} as never);
    expect(service.publicCapabilities()).toEqual({
      googleSignIn: "NOT_CONFIGURED",
      appleSignIn: "NOT_CONFIGURED",
      googleSignInAvailable: false,
      appleSignInAvailable: false,
    });
    expect(JSON.stringify(service.publicCapabilities())).not.toMatch(
      /secret|private|token|certificate/i,
    );
  });

  it("rejects staging Stripe live keys", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DEPLOYMENT_ENVIRONMENT: "staging",
        STRIPE_SECRET_KEY: "sk_live_forbidden",
        STRIPE_PUBLISHABLE_KEY: "pk_live_forbidden",
      }),
    ).toThrow("Staging accepts Stripe test-mode keys only");
  });

  it("requires complete environment-isolated Stripe configuration", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DEPLOYMENT_ENVIRONMENT: "staging",
        STRIPE_SECRET_KEY: "sk_test_partial",
      }),
    ).toThrow("all three Price IDs must be complete or absent");
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DEPLOYMENT_ENVIRONMENT: "production",
        STRIPE_SECRET_KEY: "sk_test_wrong_environment",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        STRIPE_STARTER_MONTHLY_PRICE_ID: "price_starter",
        STRIPE_GROWTH_MONTHLY_PRICE_ID: "price_growth",
        STRIPE_SCALE_MONTHLY_PRICE_ID: "price_scale",
      }),
    ).toThrow("Production accepts Stripe live-mode keys only");
  });

  it("requires the production APNs host for real Wallet passes in staging", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DEPLOYMENT_ENVIRONMENT: "staging",
        APPLE_WALLET_MODE: "REAL",
        APPLE_PASS_TYPE_IDENTIFIER: "pass.app.waflo",
        APPLE_TEAM_IDENTIFIER: "TEAM123456",
        APPLE_PASS_CERTIFICATE_PATH_OR_BASE64: "/run/waflo-provider-secrets/pass.p12",
        APPLE_PASS_CERTIFICATE_PASSWORD: "password",
        APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64: "/run/waflo-provider-secrets/wwdr.pem",
        APPLE_PASS_WEB_SERVICE_URL: "https://api-staging.waflo.app/v1/apple-wallet",
        APPLE_APNS_ENVIRONMENT: "sandbox",
      }),
    ).toThrow("pass updates require the production APNs endpoint");
  });

  it("cleans up only APNs responses that prove a Wallet push token is invalid", () => {
    expect(classifyApplePushResponse(200)).toBe("SUCCESS");
    expect(classifyApplePushResponse(410, "Unregistered")).toBe("INVALID_TOKEN");
    expect(classifyApplePushResponse(400, "BadDeviceToken")).toBe("INVALID_TOKEN");
    expect(classifyApplePushResponse(400, "BadTopic")).toBe("REJECTED");
    expect(classifyApplePushResponse(403, "ExpiredProviderToken")).toBe("REJECTED");
    expect(classifyApplePushResponse(429, "TooManyRequests")).toBe("RETRY");
    expect(classifyApplePushResponse(503, "Shutdown")).toBe("RETRY");
  });

  it("rejects insecure deployed origins and arbitrary OAuth callback origins", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DEPLOYMENT_ENVIRONMENT: "staging",
        GOOGLE_SIGNIN_CLIENT_ID: "client",
        GOOGLE_SIGNIN_CLIENT_SECRET: "secret",
        GOOGLE_SIGNIN_REDIRECT_URI: "https://attacker.example/callback",
      }),
    ).toThrow("OAuth callbacks must be exact HTTPS URLs on the configured API origin");
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DEPLOYMENT_ENVIRONMENT: "staging",
        GOOGLE_SIGNIN_CLIENT_ID: "client",
        GOOGLE_SIGNIN_CLIENT_SECRET: "secret",
        GOOGLE_SIGNIN_REDIRECT_URI: "https://api.waflo.example/wrong/callback",
        API_PUBLIC_URL: "https://api.waflo.example",
      }),
    ).toThrow("OAuth callbacks must be exact HTTPS URLs on the configured API origin");
  });

  it("uses authenticated SMTP configuration and sanitizes terminal provider failure", async () => {
    const base = environment({
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "smtp-user",
      SMTP_PASSWORD: "smtp-password-never-log",
      SMTP_FROM: "Waflo <mail@example.test>",
    });
    const deployed = {
      values: { ...base.values, DEPLOYMENT_ENVIRONMENT: "production" as const },
    } as EnvironmentService;
    const notifications = new NotificationService(deployed);
    const send = vi.fn(async () => {
      throw new Error("smtp-password-never-log provider detail");
    });
    Object.defineProperty(notifications, "provider", { value: { send } });
    await expect(
      notifications.send({
        to: "merchant@example.test",
        locale: "en",
        kind: "new_login",
      }),
    ).rejects.toThrow("Notification delivery failed.");
    expect(notifications.configurationStatus()).toBe("READY");
    expect(send).toHaveBeenCalledTimes(3);
  });
});

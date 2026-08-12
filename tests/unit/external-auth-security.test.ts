import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ExternalAuthController } from "../../apps/api/src/auth/external-auth.controller.js";
import { ExternalAuthService } from "../../apps/api/src/auth/external-auth.service.js";
import type { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { hashOpaqueToken } from "../../packages/auth/src/index.js";
import { parseEnvironment } from "../../packages/config/src/index.js";
import {
  createExternalAuthTokenKeyring,
  decryptExternalAuthToken,
  encryptExternalAuthToken,
} from "../../packages/external-auth-security/src/index.js";

const KEY_ONE = Buffer.alloc(32, 1).toString("base64");
const KEY_TWO = Buffer.alloc(32, 2).toString("base64url");

function environment(overrides: NodeJS.ProcessEnv = {}): EnvironmentService {
  return {
    values: parseEnvironment({
      NODE_ENV: "test",
      DEPLOYMENT_ENVIRONMENT: "development",
      API_PUBLIC_URL: "http://localhost:4000",
      OAUTH_FLOW_SECRET: "unit-oauth-flow-secret-which-is-long-enough",
      ...overrides,
    }),
  } as EnvironmentService;
}

describe("external-auth security primitives and configuration", () => {
  it("uses authenticated, context-bound, versioned Apple token encryption across rotation", () => {
    const contextId = randomUUID();
    const oldKeyring = createExternalAuthTokenKeyring(1, { 1: KEY_ONE, 2: KEY_TWO });
    const encrypted = encryptExternalAuthToken("apple-refresh-token-never-plaintext", {
      contextId,
      purpose: "apple-refresh-token",
      keyring: oldKeyring,
    });
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.serialized).not.toContain("apple-refresh-token-never-plaintext");

    const rotated = createExternalAuthTokenKeyring(2, { 1: KEY_ONE, 2: KEY_TWO });
    expect(
      decryptExternalAuthToken(encrypted.serialized, {
        contextId,
        purpose: "apple-refresh-token",
        keyring: rotated,
      }),
    ).toBe("apple-refresh-token-never-plaintext");
    expect(() =>
      decryptExternalAuthToken(encrypted.serialized, {
        contextId: randomUUID(),
        purpose: "apple-refresh-token",
        keyring: rotated,
      }),
    ).toThrow();
  });

  it("persists only a browser-correlation hash and allocates independent flow cookies", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    const service = new ExternalAuthService(
      { client: { oAuthAuthorizationRequest: { create } } } as never,
      environment({
        GOOGLE_SIGNIN_CLIENT_ID: "google-client",
        GOOGLE_SIGNIN_CLIENT_SECRET: "google-secret",
        GOOGLE_SIGNIN_REDIRECT_URI: "http://localhost:4000/v1/auth/external/google/callback",
      }),
      {} as never,
      {} as never,
    );
    const first = await service.start("google", {
      locale: "en",
      allowRegistration: false,
      legalAccepted: false,
    });
    const second = await service.start("google", {
      locale: "en",
      allowRegistration: false,
      legalAccepted: false,
    });
    const firstWrite = create.mock.calls[0]?.[0].data as { browserBindingHash: string };
    expect(firstWrite.browserBindingHash).toBe(hashOpaqueToken(first.browserBinding.value));
    expect(JSON.stringify(firstWrite)).not.toContain(first.browserBinding.value);
    expect(first.browserBinding.cookieName).not.toBe(second.browserBinding.cookieName);
    expect(first.browserBinding.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 10 * 60 * 1_000,
    );
  });

  it("uses host-only HttpOnly SameSite=None Secure correlation cookies when deployed", () => {
    const setCookie = vi.fn();
    const controller = new ExternalAuthController(
      {} as never,
      {
        values: { DEPLOYMENT_ENVIRONMENT: "staging" },
      } as never,
    ) as unknown as {
      setBrowserBindingCookie(
        reply: { setCookie: typeof setCookie },
        provider: "apple",
        binding: { cookieName: string; value: string; expiresAt: Date },
      ): void;
    };
    const expiresAt = new Date(Date.now() + 5 * 60 * 1_000);
    controller.setBrowserBindingCookie({ setCookie }, "apple", {
      cookieName: "__Secure-waflo_oauth_a_flow",
      value: "correlation-value",
      expiresAt,
    });
    expect(setCookie).toHaveBeenCalledWith(
      "__Secure-waflo_oauth_a_flow",
      "correlation-value",
      expect.objectContaining({
        path: "/v1/auth/external/apple/callback",
        httpOnly: true,
        secure: true,
        sameSite: "none",
        expires: expiresAt,
      }),
    );
    expect(setCookie.mock.calls[0]?.[2]).not.toHaveProperty("domain");
  });

  it("fails Apple capability readiness for malformed private keys or missing token keyrings", () => {
    const withoutTokenKey = new ExternalAuthService(
      {} as never,
      environment({
        APPLE_SIGNIN_CLIENT_ID: "app.waflo.test",
        APPLE_SIGNIN_TEAM_ID: "TEAM123456",
        APPLE_SIGNIN_KEY_ID: "KEY1234567",
        APPLE_SIGNIN_PRIVATE_KEY: [
          "-----BEGIN",
          "PRIVATE KEY-----\ninvalid\n-----END",
          "PRIVATE KEY-----",
        ].join(" "),
        APPLE_SIGNIN_REDIRECT_URI: "http://localhost:4000/v1/auth/external/apple/callback",
      }),
      {} as never,
      {} as never,
    );
    expect(withoutTokenKey.providerStatus("apple")).toBe("NOT_CONFIGURED");

    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DEPLOYMENT_ENVIRONMENT: "staging",
        API_PUBLIC_URL: "https://api-staging.waflo.app",
        APPLE_SIGNIN_CLIENT_ID: "app.waflo.staging",
        APPLE_SIGNIN_TEAM_ID: "TEAM123456",
        APPLE_SIGNIN_KEY_ID: "KEY1234567",
        APPLE_SIGNIN_PRIVATE_KEY_BASE64: Buffer.from("private-key-placeholder").toString("base64"),
        APPLE_SIGNIN_REDIRECT_URI: "https://api-staging.waflo.app/v1/auth/external/apple/callback",
        EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: "too-short" }),
      }),
    ).toThrow("versioned 32-byte external-auth token encryption keyring");
  });
});

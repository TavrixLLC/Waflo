import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  createCustomerDataKeyring,
  decryptCustomerValue,
  deriveMembershipCredentialSecret,
  encryptCustomerValue,
  hashNormalizedEmail,
  maskEmail,
  normalizeEmail,
} from "../../packages/customer-security/src/index.js";
import {
  assertQrContainsNoPii,
  canonicalJoinUrl,
  createQrPng,
  decodeQrImage,
  formatMembershipQrPayload,
  parseMembershipQrPayload,
} from "../../packages/qr-core/src/index.js";
import { AppleWalletProvider, TestApplePassSigner } from "../../packages/wallet-apple/src/index.js";
import {
  createGoogleSaveJwt,
  GoogleWalletProvider,
  googleLoyaltyClassId,
  googleLoyaltyObjectId,
  mapGoogleLoyaltyObject,
} from "../../packages/wallet-google/src/index.js";
import {
  normalizeWalletProviderError,
  walletCommandIdempotencyKey,
  type WalletMembershipInput,
} from "../../packages/wallet-core/src/index.js";
import { WalletProviderError } from "../../packages/wallet-core/dist/index.js";
import { parseEnvironment } from "../../packages/config/src/index.js";
import {
  enrollmentBillingDecision,
  walletIncludedForPlan,
} from "../../packages/billing/src/index.js";
import {
  renderNotificationHtml,
  safeNotificationActionUrl,
} from "../../apps/api/src/notifications/notification.service.js";

const walletInput: WalletMembershipInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Cedar Coffee",
  programId: "00000000-0000-4000-8000-000000000002",
  programVersionId: "00000000-0000-4000-8000-000000000003",
  programName: "Cedar Circle",
  description: "A bilingual coffee loyalty card.",
  rewardSummary: "A complimentary drink after eight stamps.",
  backgroundColor: "#F7F4EE",
  foregroundColor: "#241916",
  configurationFingerprint: "a".repeat(64),
  locale: "en",
  walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
  providerIdentity: "waflo.00000000000040008000000000000004",
  publicMembershipId: "member_m8PNYl1aSr9bT0V4w89d3H2g",
  displayName: "Amina",
  credentialPayload: "wfl1.cred_m8PNYl1aSr9bT0V4w89d3H2g.1.Vm7vGmk6_s8-9WwGgM9A4B8h7jXyR3cQ",
  currentStampCount: 3,
  requiredStampCount: 8,
  rewardReady: false,
  membershipStatus: "ACTIVE",
  programStatus: "PUBLISHED",
  transferred: false,
  stampRenderInput: {
    organizationId: "00000000-0000-4000-8000-000000000001",
    programId: "00000000-0000-4000-8000-000000000002",
    programVersionId: "00000000-0000-4000-8000-000000000003",
    membershipId: "00000000-0000-4000-8000-000000000005",
    rendererSchemaVersion: "waflo-stamp-render-v1",
    locale: "en",
    requiredStampCount: 8,
    currentStampCount: 3,
    rewardReady: false,
    layoutType: "GRID",
    layoutConfiguration: { columns: 4 },
    visualTheme: {
      filledColor: "#E4572E",
      emptyColor: "#F3A712",
      accentColor: "#E4572E",
      backgroundColor: "#F7F4EE",
      foregroundColor: "#241916",
      stampSize: 48,
      spacing: 8,
    },
    filledArtwork: {
      kind: "svg",
      trusted: true,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#E4572E" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>',
    },
    emptyArtwork: {
      kind: "svg",
      trusted: true,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#F7F4EE" stroke="#241916" stroke-width="7" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>',
    },
    assetDigests: { filled: "b".repeat(64), empty: "c".repeat(64) },
    outputProfile: "APPLE_WALLET",
  },
};

describe("W3 customer security, QR, and Wallet domain", () => {
  it("encrypts customer email with tenant/record AAD and never stores plaintext", () => {
    const keyring = createCustomerDataKeyring(1, { 1: "10".repeat(32) });
    const encrypted = encryptCustomerValue("customer@example.com", {
      organizationId: "org-a",
      recordId: "contact-a",
      purpose: "customer-email",
      keyring,
    });
    expect(encrypted.serialized).toMatch(/^wce1\.1\./);
    expect(encrypted.serialized).not.toContain("customer");
    expect(
      decryptCustomerValue(encrypted.serialized, {
        organizationId: "org-a",
        recordId: "contact-a",
        purpose: "customer-email",
        keyring,
      }),
    ).toBe("customer@example.com");
    expect(() =>
      decryptCustomerValue(encrypted.serialized, {
        organizationId: "org-b",
        recordId: "contact-a",
        purpose: "customer-email",
        keyring,
      }),
    ).toThrow();
  });

  it("normalizes, masks, and keyed-hashes email without reversible lookup storage", () => {
    const normalized = normalizeEmail("  Person@Example.COM ");
    expect(normalized).toBe("person@example.com");
    expect(maskEmail(normalized)).toMatch(/^p\*+@e\*+\.com$/);
    expect(hashNormalizedEmail(normalized, Buffer.alloc(32, 7))).toMatch(/^[a-f0-9]{64}$/);
  });

  it("round-trips opaque membership credentials through rendered QR images", async () => {
    const versioned = { version: 1, secret: Buffer.alloc(32, 8) };
    const publicCredentialId = "cred_m8PNYl1aSr9bT0V4w89d3H2g";
    const payload = formatMembershipQrPayload({
      publicCredentialId,
      secretVersion: 1,
      secret: deriveMembershipCredentialSecret(publicCredentialId, 1, versioned),
    });
    assertQrContainsNoPii(payload, ["Amina", "customer@example.com", "3/8"]);
    expect(parseMembershipQrPayload(payload)).toMatchObject({
      publicCredentialId,
      secretVersion: 1,
    });
    const png = await createQrPng(payload, { width: 640, errorCorrectionLevel: "H" });
    await expect(decodeQrImage(png, "image/png")).resolves.toBe(payload);
  });

  it("creates canonical tenant program URLs without query data", () => {
    expect(
      canonicalJoinUrl({
        merchantSlug: "cedar",
        programSlug: "cedar-circle",
        customerBaseUrl: "https://waflo.app",
      }),
    ).toBe("https://cedar.waflo.app/join/cedar-circle");
  });

  it("packages an explicit Apple Test Adapter pass with manifest, signature, localization, and progress art", async () => {
    const provider = new AppleWalletProvider({
      mode: "TEST_ADAPTER",
      configuration: {
        passTypeIdentifier: "pass.app.waflo.test-adapter",
        teamIdentifier: "WAFLOTEST",
        organizationName: "Waflo Test Adapter",
        webServiceUrl: "https://api.example.test/v1/apple-wallet",
      },
      signer: new TestApplePassSigner("unit-test-signature"),
      authenticationToken: () => "x".repeat(43),
      passDownloadUrl: "https://example.test/pass",
    });
    const result = await provider.issueMembershipPass(walletInput);
    const files = unzipSync(result.artifact as Uint8Array);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "pass.json",
        "manifest.json",
        "signature",
        "icon.png",
        "icon@2x.png",
        "icon@3x.png",
        "logo.png",
        "strip.png",
        "en.lproj/pass.strings",
        "ar.lproj/pass.strings",
      ]),
    );
    const pass = JSON.parse(Buffer.from(files["pass.json"] ?? []).toString("utf8"));
    expect(pass.barcodes[0].message).toBe(walletInput.credentialPayload);
    expect(pass.voided).toBe(false);
    expect(Buffer.from(files.signature ?? [])).not.toHaveLength(0);
    expect(Buffer.from(files["manifest.json"] ?? []).toString("utf8")).not.toContain("signature");
  });

  it("maps Google Loyalty identity, opaque QR, public progress art, and transfer invalidation", () => {
    const classId = googleLoyaltyClassId("issuer-1", walletInput.programVersionId);
    const objectId = googleLoyaltyObjectId("issuer-1", walletInput.walletPassInstanceId);
    const active = mapGoogleLoyaltyObject(
      { ...walletInput, publicAssetBaseUrl: "https://assets.example.test/wpa_opaque" },
      objectId,
      classId,
    );
    expect(active).toMatchObject({
      id: objectId,
      classId,
      state: "ACTIVE",
      barcode: { value: walletInput.credentialPayload },
      imageModulesData: [{ id: "waflo-progress" }],
    });
    expect(
      mapGoogleLoyaltyObject({ ...walletInput, transferred: true }, objectId, classId).state,
    ).toBe("INACTIVE");
  });

  it("signs a Google Save JWT containing an object reference and exact origins", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const result = createGoogleSaveJwt({
      serviceAccount: {
        client_email: "wallet@example.test",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
      objectId: "issuer.object",
      allowedOrigins: ["https://merchant.waflo.app"],
      issuedAt: 1_800_000_000,
    });
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.claims).toMatchObject({
      iss: "wallet@example.test",
      origins: ["https://merchant.waflo.app"],
      payload: { loyaltyObjects: [{ id: "issuer.object" }] },
    });
  });

  it("converges a concurrent Google object create race onto the deterministic identity", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new WalletProviderError("NOT_FOUND", "missing", { retryable: false }))
      .mockRejectedValueOnce(
        new WalletProviderError("ALREADY_EXISTS", "raced", { retryable: false }),
      )
      .mockResolvedValueOnce({ value: {} });
    const provider = new GoogleWalletProvider({
      mode: "REAL",
      issuerId: "issuer-1",
      allowedOrigins: ["https://card.example.test"],
      testActionBaseUrl: "https://card.example.test/wallet-test/google",
      client: { request } as never,
    });

    await expect(provider.issueMembershipPass(walletInput)).resolves.toMatchObject({
      providerObjectId: walletInput.providerIdentity,
      state: "ACTIVE",
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "loyaltyObject",
      expect.objectContaining({ method: "POST" }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      `loyaltyObject/${encodeURIComponent(walletInput.providerIdentity)}`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("creates the complete inactive Google object when invalidation finds no provider object", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new WalletProviderError("NOT_FOUND", "missing", { retryable: false }))
      .mockResolvedValueOnce({ value: {} });
    const provider = new GoogleWalletProvider({
      mode: "REAL",
      issuerId: "issuer-1",
      allowedOrigins: ["https://card.example.test"],
      testActionBaseUrl: "https://card.example.test/wallet-test/google",
      client: { request } as never,
    });

    await expect(
      provider.invalidateMembershipPass(walletInput, "MEMBERSHIP_TRANSFERRED"),
    ).resolves.toEqual({ state: "INACTIVE" });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "loyaltyObject",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          id: walletInput.providerIdentity,
          state: "INACTIVE",
          barcode: {
            type: "QR_CODE",
            value: walletInput.credentialPayload,
            alternateText: "No longer valid",
          },
        }),
      }),
    );
  });

  it("classifies provider failures and makes command identity deterministic", () => {
    expect(normalizeWalletProviderError({ status: 429 }).category).toBe("RATE_LIMITED");
    expect(
      walletCommandIdempotencyKey({
        provider: "APPLE",
        commandType: "ISSUE",
        membershipId: "membership-a",
        credentialVersion: 2,
      }),
    ).toBe("wallet:apple:issue:membership-a:c2:p0");
  });

  it("probes Google REAL issuer access, caches success, and reports safe failure categories", async () => {
    const serviceAccount = {
      client_email: "wallet@example.test",
      private_key: "not-used-by-injected-client",
    };
    let calls = 0;
    const healthy = new GoogleWalletProvider({
      mode: "REAL",
      issuerId: "issuer-1",
      serviceAccount,
      allowedOrigins: ["https://merchant.example.test"],
      testActionBaseUrl: "https://merchant.example.test/wallet-test/google",
      client: {
        request: async () => {
          calls += 1;
          return { value: {} };
        },
      } as never,
    });
    await expect(healthy.healthCheck()).resolves.toMatchObject({
      status: "HEALTHY",
      configured: true,
      providerReachable: true,
      externallyCertified: false,
    });
    await expect(healthy.healthCheck()).resolves.toMatchObject({ status: "HEALTHY" });
    expect(calls).toBe(1);

    for (const [statusCode, status] of [
      [401, "CREDENTIAL_INVALID"],
      [403, "ISSUER_ACCESS_DENIED"],
      [429, "RATE_LIMITED"],
      [503, "API_UNAVAILABLE"],
    ] as const) {
      const provider = new GoogleWalletProvider({
        mode: "REAL",
        issuerId: "issuer-1",
        serviceAccount,
        allowedOrigins: [],
        testActionBaseUrl: "https://merchant.example.test/wallet-test/google",
        client: {
          request: async () => {
            throw { status: statusCode };
          },
        } as never,
      });
      await expect(provider.healthCheck()).resolves.toMatchObject({
        status,
        configured: true,
        providerReachable: false,
        externallyCertified: false,
      });
    }
  });

  it("uses fragment transfer links and only permits exact or merchant-wildcard origins", () => {
    const allowed = ["https://dashboard.waflo.app", "https://*.waflo.app"];
    expect(
      safeNotificationActionUrl(
        "https://cedar.waflo.app/transfer/confirm#transfer=t&token=s",
        allowed,
      ),
    ).toContain("#transfer=t&token=s");
    expect(
      safeNotificationActionUrl("https://waflo.app.evil.test/transfer#token=s", allowed),
    ).toBeNull();
    const html = renderNotificationHtml(
      {
        to: "customer@example.com",
        locale: "en",
        kind: "membership_transfer_confirmation",
        actionUrl: "https://cedar.waflo.app/transfer/confirm#transfer=t&token=s",
      },
      allowed,
    );
    expect(html).toContain("#transfer=t&amp;token=s");
    expect(html).not.toContain("?token=");
  });

  it("enforces W3 billing and production adapter/secret gates", () => {
    expect(enrollmentBillingDecision("trialing").allowed).toBe(true);
    expect(enrollmentBillingDecision("past_due")).toMatchObject({
      allowed: false,
      existingCardsViewable: true,
      walletAvailable: false,
    });
    expect(walletIncludedForPlan("starter")).toBe(true);
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        COOKIE_SECURE: "true",
        COOKIE_NAME: "__Host-waflo_session",
        CUSTOMER_COOKIE_NAME: "__Host-waflo_customer",
        APPLE_WALLET_MODE: "TEST_ADAPTER",
      }),
    ).toThrow();
  });

  it("persists database constraints for one active credential/transfer and append-only history", () => {
    const migration = readFileSync(
      "packages/database/prisma/migrations/20260729153000_w3_customer_membership_wallet/migration.sql",
      "utf8",
    );
    expect(migration).toContain("membership_credentials_one_active_per_membership");
    expect(migration).toContain("membership_transfer_one_active_per_membership");
    expect(migration).toContain("waflo_reject_append_only_change");
    expect(migration).toContain("program_enrollment_policy_immutable_guard");
  });
});

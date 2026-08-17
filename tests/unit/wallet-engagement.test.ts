import { describe, expect, it, vi } from "vitest";
import { WalletWorker } from "../../apps/wallet-worker/src/main.js";
import { parseEnvironment } from "../../packages/config/src/index.js";
import { locationUpdateSchema } from "../../packages/contracts/src/index.js";
import {
  walletCampaignCreateSchema,
  walletNearbyUpdateSchema,
} from "../../packages/contracts/src/wallet-engagement.js";
import { mapAppleStoreCard } from "../../packages/wallet-apple/src/index.js";
import {
  APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
  normalizeWalletPlainText,
  resolveWalletNearbyText,
  type WalletMembershipInput,
  type WalletProgramInput,
  walletNearbyVertical,
  walletTextCodePointLength,
} from "../../packages/wallet-core/src/index.js";
import {
  GoogleWalletProvider,
  mapGoogleLoyaltyClass,
} from "../../packages/wallet-google/src/index.js";

const nearbyLocation = {
  locationId: "00000000-0000-4000-8000-000000000010",
  displayName: "Karrada",
  latitude: 33.3024,
  longitude: 44.3882,
  relevantText: "You’re near Cedar Coffee. Your loyalty card is ready for your next coffee visit.",
};
const nearbyLocations = [nearbyLocation];
const nearbyRelevance = {
  enabled: true,
  desiredAppleMaxDistanceMeters: APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
  locations: nearbyLocations,
};

const programInput: WalletProgramInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Cedar Coffee",
  programId: "00000000-0000-4000-8000-000000000002",
  programVersionId: "00000000-0000-4000-8000-000000000003",
  programName: "Cedar Circle",
  description: "A loyalty card.",
  rewardSummary: "Reward after eight stamps.",
  backgroundColor: "#f7f4ee",
  foregroundColor: "#241916",
  configurationFingerprint: "a".repeat(64),
  locale: "en",
  nearbyRelevance,
};

const membershipInput: WalletMembershipInput = {
  ...programInput,
  walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
  providerIdentity: "issuer.waflo-object-1",
  publicMembershipId: "member_public_1",
  displayName: "Customer",
  credentialPayload: "wfl1.opaque.credential",
  currentStampCount: 2,
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
    currentStampCount: 2,
    rewardReady: false,
    layoutType: "GRID",
    layoutConfiguration: { columns: 4 },
    visualTheme: {
      filledColor: "#ae3115",
      emptyColor: "#f7f4ee",
      accentColor: "#ae3115",
      backgroundColor: "#f7f4ee",
      foregroundColor: "#241916",
      stampSize: 48,
      spacing: 8,
    },
    filledArtwork: { kind: "text", trusted: true, content: "FILLED" },
    emptyArtwork: { kind: "text", trusted: true, content: "EMPTY" },
    assetDigests: { filled: "b".repeat(64), empty: "c".repeat(64) },
    outputProfile: "APPLE_WALLET",
  },
};

describe("Wallet Engagement nearby copy", () => {
  it.each([
    ["COFFEE_WARM_LATTE", "COFFEE", "coffee"],
    ["RESTAURANT_MODERN_BISTRO", "RESTAURANT", "visit"],
    ["BARBERSHOP_MODERN_CUT", "BARBER", "ready when you are"],
    ["FITNESS", "GYM", "check-in"],
  ] as const)(
    "resolves %s through authoritative template metadata",
    (templateCode, vertical, phrase) => {
      const resolved = resolveWalletNearbyText({
        templateCode,
        businessCategory: "intentionally ignored",
        merchantName: "Cedar",
        locale: "en",
      });
      expect(resolved.vertical).toBe(vertical);
      expect(resolved.text).toContain("Cedar");
      expect(resolved.text.toLowerCase()).toContain(phrase);
    },
  );

  it("uses business category only after template metadata and falls back to GENERAL", () => {
    expect(walletNearbyVertical({ templateCode: "CUSTOM", businessCategory: "Bakery" })).toBe(
      "BAKERY",
    );
    expect(walletNearbyVertical({ templateCode: "CUSTOM", businessCategory: "Other" })).toBe(
      "GENERAL",
    );
  });

  it("is deterministic and localizes Arabic without gender or customer data", () => {
    const input = {
      templateCode: "RETAIL_PREMIUM_MEMBER",
      merchantName: "متجر سيدار",
      locationName: "الكرادة",
      locale: "ar" as const,
    };
    const first = resolveWalletNearbyText(input);
    const second = resolveWalletNearbyText(input);
    expect(first).toEqual(second);
    expect(first.text).toContain("متجر سيدار");
    expect(first.text).not.toMatch(/عميل|عميلة|customer/i);
    expect(walletTextCodePointLength(first.text)).toBeLessThanOrEqual(120);
  });

  it("uses a safe missing-name fallback and rejects controls, HTML, and customer templates", () => {
    expect(resolveWalletNearbyText({ templateCode: "CUSTOM", locale: "en" }).text).toContain(
      "this business",
    );
    expect(() => normalizeWalletPlainText("hello\u0000world", 120)).toThrow(/unsupported/);
    expect(() => normalizeWalletPlainText("<script>alert(1)</script>", 120)).toThrow(/unsupported/);
    expect(() => normalizeWalletPlainText("Hello {{customerName}}", 120)).toThrow(/templates/);
    expect(() => normalizeWalletPlainText("x".repeat(121), 120)).toThrow(/exceeds/);
  });

  it("supports a plain localized merchant override without changing the vertical", () => {
    expect(
      resolveWalletNearbyText({
        templateCode: "SALON_LUXURY_BEAUTY",
        merchantName: "Luma",
        locale: "en",
        customText: "Welcome back near Luma.",
      }),
    ).toEqual({ text: "Welcome back near Luma.", vertical: "SALON", usedCustomText: true });
  });
});

describe("Wallet provider-native nearby relevance", () => {
  it("maps Apple coordinates, relevantText, and requested maximum without changing pass identity", () => {
    const pass = mapAppleStoreCard(
      membershipInput,
      {
        passTypeIdentifier: "pass.app.waflo.test",
        teamIdentifier: "WAFLOTEST",
        organizationName: "Waflo",
        webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
      },
      "x".repeat(43),
    );
    expect(pass.serialNumber).toBe(membershipInput.providerIdentity);
    expect(pass.locations).toEqual([
      expect.objectContaining({
        latitude: 33.3024,
        longitude: 44.3882,
        relevantText: nearbyLocations[0]?.relevantText,
      }),
    ]);
    expect(pass.maxDistance).toBe(2000);
    expect(pass.storeCard.auxiliaryFields[0]?.changeMessage).toBe("%@");
  });

  it("removes Apple relevance when disabled and enforces the 10-location provider limit", () => {
    const disabled = mapAppleStoreCard(
      {
        ...membershipInput,
        nearbyRelevance: { ...nearbyRelevance, enabled: false },
      },
      {
        passTypeIdentifier: "pass.app.waflo.test",
        teamIdentifier: "WAFLOTEST",
        organizationName: "Waflo",
        webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
      },
      "x".repeat(43),
    );
    expect(disabled).not.toHaveProperty("locations");
    expect(disabled).not.toHaveProperty("maxDistance");
    expect(() =>
      mapAppleStoreCard(
        {
          ...membershipInput,
          nearbyRelevance: {
            ...nearbyRelevance,
            locations: Array.from({ length: 11 }, (_, index) => ({
              ...nearbyLocation,
              locationId: String(index),
            })),
          },
        },
        {
          passTypeIdentifier: "pass.app.waflo.test",
          teamIdentifier: "WAFLOTEST",
          organizationName: "Waflo",
          webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
        },
        "x".repeat(43),
      ),
    ).toThrow(/at most 10/);
  });

  it("maps Google MerchantLocations without radius or merchant-authored nearby text", () => {
    const loyaltyClass = mapGoogleLoyaltyClass(programInput, "issuer.class");
    expect(loyaltyClass.merchantLocations).toEqual([{ latitude: 33.3024, longitude: 44.3882 }]);
    expect(JSON.stringify(loyaltyClass.merchantLocations)).not.toMatch(
      /radius|maxDistance|relevantText|coffee/i,
    );
    expect(
      mapGoogleLoyaltyClass(
        { ...programInput, nearbyRelevance: { ...nearbyRelevance, enabled: false } },
        "issuer.class",
      ).merchantLocations,
    ).toEqual([]);
    expect(() =>
      mapGoogleLoyaltyClass(
        {
          ...programInput,
          nearbyRelevance: {
            ...nearbyRelevance,
            locations: Array.from({ length: 11 }, (_, index) => ({
              ...nearbyLocation,
              locationId: String(index),
            })),
          },
        },
        "issuer.class",
      ),
    ).toThrow(/at most 10/);
  });
});

describe("Google merchant-written Wallet messages", () => {
  it("uses object-level Add Message with TEXT_AND_NOTIFY and makes retry idempotent", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ value: { hasUsers: true } })
      .mockResolvedValueOnce({ value: {}, requestId: "provider-request-1" })
      .mockResolvedValueOnce({
        value: { hasUsers: true, messages: [{ id: "wfl_campaign_pass_stable" }] },
        requestId: "provider-request-2",
      });
    const provider = new GoogleWalletProvider({
      mode: "REAL",
      issuerId: "issuer",
      allowedOrigins: ["https://waflo.app"],
      testActionBaseUrl: "https://waflo.app/google-test",
      client: { request } as never,
    });
    const promotion = {
      messageId: "wfl_campaign_pass_stable",
      locale: "ar" as const,
      title: "رسالة جديدة",
      body: "هذه رسالة آمنة.",
      destinationUrl: "https://merchant.waflo.app/offers",
    };
    await provider.sendPromotionalMessage(membershipInput, promotion);
    await provider.sendPromotionalMessage(membershipInput, promotion);

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(
      2,
      `loyaltyObject/${encodeURIComponent(membershipInput.providerIdentity)}/addMessage`,
      {
        method: "POST",
        body: {
          message: expect.objectContaining({
            id: "wfl_campaign_pass_stable",
            header: "رسالة جديدة",
            messageType: "TEXT_AND_NOTIFY",
            localizedHeader: { defaultValue: { language: "ar", value: "رسالة جديدة" } },
          }),
        },
      },
    );
    expect(
      request.mock.calls.filter(([path]) => String(path).endsWith("/addMessage")),
    ).toHaveLength(1);
    expect(request.mock.calls[0]?.[0]).not.toContain("loyaltyClass");
  });

  it("prunes only explicitly canceled Waflo messages at the object limit", async () => {
    const messages = [
      { id: "partner_message" },
      ...Array.from({ length: 9 }, (_, index) => ({ id: `wfl_${9 - index}` })),
    ];
    const request = vi
      .fn()
      .mockResolvedValueOnce({ value: { hasUsers: true, messages } })
      .mockResolvedValue({ value: {} });
    const provider = new GoogleWalletProvider({
      mode: "REAL",
      issuerId: "issuer",
      allowedOrigins: ["https://waflo.app"],
      testActionBaseUrl: "https://waflo.app/google-test",
      client: { request } as never,
    });

    await provider.sendPromotionalMessage(membershipInput, {
      messageId: "wfl_new",
      locale: "en",
      title: "A new offer",
      body: "Your loyalty card has a new message.",
      obsoleteMessageIds: ["wfl_1"],
    });

    expect(request).toHaveBeenNthCalledWith(
      2,
      `loyaltyObject/${encodeURIComponent(membershipInput.providerIdentity)}`,
      {
        method: "PATCH",
        body: { messages: expect.not.arrayContaining([{ id: "wfl_1" }]) },
      },
    );
    expect(request.mock.calls[1]?.[1]?.body.messages).toHaveLength(9);
    expect(request.mock.calls[1]?.[1]?.body.messages).toContainEqual({ id: "partner_message" });
    expect(request.mock.calls[1]?.[1]?.body.messages).toContainEqual({ id: "wfl_2" });
    expect(request.mock.calls[2]?.[0]).toContain("/addMessage");
  });

  it("fails closed when no message is safely obsolete", async () => {
    const messages = [
      { id: "partner_message" },
      ...Array.from({ length: 9 }, (_, index) => ({ id: `wfl_active_${index}` })),
    ];
    const request = vi.fn().mockResolvedValue({ value: { hasUsers: true, messages } });
    const provider = new GoogleWalletProvider({
      mode: "REAL",
      issuerId: "issuer",
      allowedOrigins: ["https://waflo.app"],
      testActionBaseUrl: "https://waflo.app/google-test",
      client: { request } as never,
    });

    await expect(
      provider.sendPromotionalMessage(membershipInput, {
        messageId: "wfl_new",
        locale: "en",
        title: "A new offer",
        body: "Your loyalty card has a new message.",
      }),
    ).rejects.toMatchObject({
      category: "MESSAGE_CAPACITY_REACHED",
      options: { retryable: false },
    });
    expect(request.mock.calls.some(([path]) => String(path).endsWith("/addMessage"))).toBe(false);
  });

  it("uses authoritative hasUsers and skips objects with no active Wallet holder", async () => {
    const request = vi.fn().mockResolvedValue({
      value: { hasUsers: false, messages: [] },
      requestId: "lookup-request",
    });
    const provider = new GoogleWalletProvider({
      mode: "REAL",
      issuerId: "issuer",
      allowedOrigins: ["https://waflo.app"],
      testActionBaseUrl: "https://waflo.app/google-test",
      client: { request } as never,
    });
    await expect(
      provider.sendPromotionalMessage(membershipInput, {
        messageId: "wfl_new",
        locale: "en",
        title: "A new offer",
        body: "Your loyalty card has a new message.",
      }),
    ).resolves.toEqual({ state: "NO_ACTIVE_WALLET_HOLDER", providerRequestId: "lookup-request" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retries boundedly when Google cannot provide authoritative hasUsers state", async () => {
    const request = vi.fn().mockResolvedValue({
      value: { messages: [] },
      requestId: "lookup-unavailable",
    });
    const provider = new GoogleWalletProvider({
      mode: "REAL",
      issuerId: "issuer",
      allowedOrigins: ["https://waflo.app"],
      testActionBaseUrl: "https://waflo.app/google-test",
      client: { request } as never,
    });
    await expect(
      provider.sendPromotionalMessage(membershipInput, {
        messageId: "wfl_new",
        locale: "en",
        title: "A new offer",
        body: "Your loyalty card has a new message.",
      }),
    ).rejects.toMatchObject({
      category: "TEMPORARY_FAILURE",
      options: { retryable: true, providerRequestId: "lookup-unavailable" },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("Wallet command priority", () => {
  it("always checks operational work before promotional sends", async () => {
    const rpop = vi.fn().mockResolvedValueOnce("operational-command");
    const worker = new WalletWorker(
      {} as never,
      { rpop } as never,
      parseEnvironment(process.env),
      new Map(),
    );

    await expect(worker.popNextQueuedCommand()).resolves.toBe("operational-command");
    expect(rpop).toHaveBeenCalledTimes(1);
    expect(rpop).toHaveBeenCalledWith("waflo:wallet:commands:operational");

    rpop.mockReset();
    rpop.mockResolvedValueOnce(null).mockResolvedValueOnce("promotional-command");
    await expect(worker.popNextQueuedCommand()).resolves.toBe("promotional-command");
    expect(rpop.mock.calls).toEqual([
      ["waflo:wallet:commands:operational"],
      ["waflo:wallet:commands:promotional"],
    ]);
    worker.close();
  });
});

describe("Wallet Engagement input safety", () => {
  const validCampaign = {
    idempotencyKey: "00000000-0000-4000-8000-000000000099",
    locale: "EN",
    title: "A concise message",
    body: "Your loyalty card is ready for your next visit.",
    destinationUrl: "https://merchant.waflo.app/offers",
    providers: ["GOOGLE"],
    audienceRule: "ALL_ELIGIBLE_WALLET_HOLDERS",
  };

  it("normalizes plain content and rejects HTML, controls, customer variables, and excessive length", () => {
    expect(
      walletCampaignCreateSchema.parse({ ...validCampaign, body: "  Safe   message  " }).body,
    ).toBe("Safe message");
    for (const body of [
      "<b>unsafe</b>",
      "unsafe\u0000control",
      "Hello {{customerName}}",
      "Hello {customerName}",
      "Use sk_live_1234567890abcdef",
      "x".repeat(241),
    ]) {
      expect(() => walletCampaignCreateSchema.parse({ ...validCampaign, body })).toThrow();
    }
    expect(() =>
      walletCampaignCreateSchema.parse({ ...validCampaign, title: "x".repeat(61) }),
    ).toThrow();
  });

  it("accepts only one selectable v1 provider and at most 10 unique nearby locations", () => {
    expect(() =>
      walletCampaignCreateSchema.parse({ ...validCampaign, providers: ["APPLE"] }),
    ).toThrow();
    expect(() =>
      walletNearbyUpdateSchema.parse({
        enabled: true,
        locationIds: Array.from(
          { length: 11 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
        revision: 1,
      }),
    ).toThrow();
    expect(() =>
      walletNearbyUpdateSchema.parse({ enabled: true, locationIds: [], revision: 1 }),
    ).toThrow();
    expect(() =>
      walletNearbyUpdateSchema.parse({
        enabled: false,
        locationIds: [],
        appleCustomTextEn: "Welcome {customerName}",
        revision: 1,
      }),
    ).toThrow();
    expect(() =>
      walletNearbyUpdateSchema.parse({
        enabled: false,
        locationIds: [],
        appleCustomTextEn: "A guaranteed discount is waiting.",
        revision: 1,
      }),
    ).toThrow();
    expect(
      walletNearbyUpdateSchema.parse({
        enabled: false,
        locationIds: [],
        appleCustomTextEn: "You are near {merchant} at {location}.",
        revision: 1,
      }).appleCustomTextEn,
    ).toContain("{merchant}");
  });

  it("requires merchant coordinate updates to set both values with explicit map confirmation", () => {
    expect(() => locationUpdateSchema.parse({ latitude: 33.3 })).toThrow();
    expect(() => locationUpdateSchema.parse({ latitude: null })).toThrow();
    expect(() => locationUpdateSchema.parse({ latitude: null, longitude: null })).toThrow();
    expect(() => locationUpdateSchema.parse({ latitude: 33.3, longitude: 44.4 })).toThrow();
    expect(
      locationUpdateSchema.parse({
        latitude: 33.3,
        longitude: 44.4,
        coordinatesConfirmed: true,
      }),
    ).toEqual({
      latitude: 33.3,
      longitude: 44.4,
      coordinatesConfirmed: true,
    });
  });

  it("rejects unverified offer claims in custom Apple nearby wording", () => {
    expect(() =>
      resolveWalletNearbyText({
        templateCode: "COFFEE",
        merchantName: "Cedar Coffee",
        locale: "en",
        customText: "A guaranteed discount is waiting at {merchant}.",
      }),
    ).toThrow(/offer or discount claims/);
  });
});

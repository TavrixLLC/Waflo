import sharp from "../../apps/api/node_modules/sharp";
import { describe, expect, it } from "vitest";
import { processMerchantImage } from "../../apps/api/src/programs/image-processing.js";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import {
  contrastRatio,
  validateProgramConfiguration,
} from "../../apps/api/src/programs/validation-engine.js";

const crop = { x: 0, y: 0, width: 1, height: 1, zoom: 1 };
const jpeg = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAAAAAAAB//9k=",
  "base64",
);

describe("W2 Round 2 visual pipeline", () => {
  it("fully decodes, re-encodes, and creates real variants", async () => {
    const png = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: { r: 228, g: 87, b: 46, alpha: 0.7 },
      },
    })
      .png()
      .toBuffer();
    const processed = await processMerchantImage(png, "image/png", crop);

    expect(processed.source).toMatchObject({
      width: 320,
      height: 180,
      format: "png",
      orientation: null,
      hadAlpha: true,
    });
    expect(processed.variants.map((variant) => variant.code)).toEqual([
      "ORIGINAL_SAFE",
      "STAMP_256",
      "THUMBNAIL_96",
    ]);
    expect(processed.variants[1]).toMatchObject({
      width: 256,
      height: 256,
      mimeType: "image/png",
    });
    expect(processed.variants[2]).toMatchObject({
      width: 96,
      height: 96,
      mimeType: "image/png",
    });
    expect(new Set(processed.variants.map((variant) => variant.digest)).size).toBe(3);
    expect(processed.original.bytes.equals(png)).toBe(false);
  });

  it("rejects malformed bytes and MIME spoofing", async () => {
    await expect(
      processMerchantImage(Buffer.from("not an image"), "image/png", crop),
    ).rejects.toThrow();
    await expect(processMerchantImage(jpeg, "image/png", crop)).rejects.toThrow("does not match");
  });

  it("produces deterministic, structurally distinct platform compositions", () => {
    const stampSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><circle cx="20" cy="20" r="15"/></svg>';
    const base = {
      locale: "AR" as const,
      organizationName: "Waflo Coffee",
      programName: "مكافآت وافلو",
      shortDescription: "اجمع الأختام",
      rewardSummary: "قهوة مجانية",
      terms: "تطبق الشروط",
      progress: 4,
      goal: 8,
      stampSvg,
      backgroundColor: "#ffffff",
      foregroundColor: "#222222",
      accentColor: "#e4572e",
      secondaryColor: "#f3a712",
      customerWebVariant: "CARD" as const,
      apple: {
        headerLabel: "REWARDS",
        headerValue: "Waflo",
        secondaryLabel: "NEXT",
        barcodeLabel: "Preview",
        showBackContent: true,
      },
      google: {
        title: "Waflo",
        subtitle: "Rewards",
        detailsLabel: "Progress",
        barcodeLabel: "Preview",
      },
    };
    const customer = composeProgramPreview({ ...base, profile: "CUSTOMER_WEB" });
    const apple = composeProgramPreview({ ...base, profile: "APPLE_WALLET" });
    const google = composeProgramPreview({ ...base, profile: "GOOGLE_WALLET" });

    expect(new Set([customer.digest, apple.digest, google.digest]).size).toBe(3);
    expect(customer.svg).toContain("Customer Web preview");
    expect(apple.svg).toContain("Apple Wallet preview only");
    expect(google.svg).toContain("Google Wallet preview only");
    expect(customer.svg).toContain("مكافآت وافلو");
    expect(apple.width).not.toBe(customer.width);
  });
});

describe("W2 Round 2 validation engine", () => {
  it("returns typed, focusable issues across content, layout, and automatic previews", () => {
    const result = validateProgramConfiguration({
      plan: "STARTER",
      goal: 2,
      translations: [
        {
          locale: "EN",
          programName: "A very long loyalty program name that exceeds Apple limits",
          shortDescription:
            "This subtitle is deliberately long enough to exceed the Google preview field limit.",
          rewardSummary:
            "A reward summary that is deliberately much longer than the Apple field limit allows",
          termsAndConditions: "Terms",
          completionMessage: "Complete",
          rewardUnlockedMessage: "Ready",
        },
      ],
      rewards: [
        {
          thresholdStampCount: 1,
          maximumRedemptionsPerEarned: 1,
          stampAsset: null,
        },
        {
          thresholdStampCount: 1,
          maximumRedemptionsPerEarned: 1,
          stampAsset: null,
        },
      ],
      locations: [],
      visual: {
        backgroundColor: "#ffffff",
        foregroundColor: "#fefefe",
        accentColor: "#fdfdfd",
        layoutType: "PATH",
        stampSize: 96,
        stampSpacing: 32,
        applePreviewConfig: {},
        googlePreviewConfig: {},
        assets: [
          {
            role: "filledStamp",
            expectedCategory: "STAMP_FILLED",
            asset: null,
            required: true,
          },
        ],
      },
      expectedFingerprint: "expected",
      renderFingerprint: "stale",
      previewProfiles: [],
      completedTestSessions: [{ versionRevision: 1, validationFingerprint: "old" }],
      versionRevision: 2,
    });

    const issues = [...result.errors, ...result.warnings];
    const codes = issues.map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "TRANSLATION_REQUIRED",
        "MULTIPLE_REWARDS_PLAN_REQUIRED",
        "REWARD_THRESHOLD_DUPLICATE",
        "ACTIVE_LOCATION_REQUIRED",
        "ASSET_REQUIRED",
        "COLOR_CONTRAST_LOW",
        "PATH_LAYOUT_TOO_SHORT",
        "PREVIEW_STALE",
        "PREVIEW_PROFILE_MISSING",
      ]),
    );
    expect(
      issues.every(
        (item) =>
          typeof item.path === "string" &&
          typeof item.platform === "string" &&
          typeof item.suggestedAction === "string",
      ),
    ).toBe(true);
    expect(contrastRatio("#000000", "#ffffff")).toBeGreaterThan(20);
  });
});

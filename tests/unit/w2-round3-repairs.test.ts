import { createHash } from "node:crypto";
import {
  findProgramTemplate,
  latestProgramTemplates,
  programPlatformCapabilities,
} from "../../packages/contracts/src/index.js";
import { describe, expect, it } from "vitest";
import {
  artworkFor,
  canonicalArtworkBytes,
  LIBRARY_ARTWORK_SCHEMA_VERSION,
  libraryArtworkDigest,
} from "../../apps/api/src/programs/library-artwork.js";
import {
  applyTemplateToDraft,
  createQuickDraft,
  templateReplacementFields,
} from "../../apps/merchant-dashboard/components/program-studio-types.js";
import {
  type PreviewAsset,
  resolvePreviewAssetContent,
} from "../../apps/api/src/programs/preview-assets.js";
import {
  createProgramPreviewCacheKey,
  PREVIEW_RENDERER_SCHEMA_VERSION,
} from "../../apps/api/src/programs/preview-cache.js";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import type { ObjectStorage } from "../../apps/api/src/programs/object-storage.js";

const requiredTemplates = [
  "COFFEE",
  "COOKIES",
  "CAR_WASH",
  "SALON",
  "BARBERSHOP",
  "RESTAURANT",
  "RETAIL",
  "GENERAL_VISITS",
];

const requiredArtworkConcepts = [
  "COOKIE",
  "COFFEE_CUP",
  "CAR",
  "WATER_DROP",
  "STAR",
  "HEART",
  "FLOWER",
  "SCISSORS",
  "DONUT",
  "SHOPPING_BAG",
  "GENERAL_CIRCLE",
  "GIFT",
];

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is required by this test.`);
  return value;
}

function previewInput(
  profile: "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET",
  backgroundDataUri?: string,
) {
  return {
    profile,
    locale: "EN" as const,
    organizationName: "Waflo Coffee",
    programName: "Waflo rewards",
    shortDescription: "Collect a stamp on every visit.",
    rewardSummary: "A reward on us",
    terms: "Merchant terms apply.",
    progress: 3,
    goal: 8,
    stampSvg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
    backgroundColor: "#FFF8EE",
    foregroundColor: "#2F1D14",
    accentColor: "#8B5E3C",
    secondaryColor: "#D6A66C",
    ...(backgroundDataUri ? { backgroundDataUri } : {}),
    customerWebVariant: "CARD" as const,
    apple: {
      headerLabel: "REWARDS",
      headerValue: "Waflo",
      secondaryLabel: "NEXT REWARD",
      barcodeLabel: "Preview barcode",
      showBackContent: true,
    },
    google: {
      title: "Waflo rewards",
      subtitle: "Collect stamps",
      detailsLabel: "Reward progress",
      barcodeLabel: "Preview barcode",
    },
  };
}

function storedAsset(bytes: Buffer, digest?: string): PreviewAsset {
  return {
    id: "asset-1",
    sha256Digest: "source-digest",
    safeMetadata: {},
    mimeType: "image/png",
    source: "MERCHANT_UPLOAD",
    variants: [
      {
        variantCode: "STAMP_256",
        objectKey: "assets/asset-1.png",
        mimeType: "image/png",
        digest: digest ?? createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
}

function storageReturning(bytes: Buffer): ObjectStorage {
  return {
    put: async () => undefined,
    putImmutable: async () => "STORED",
    get: async () => bytes,
    delete: async () => undefined,
    ensureReady: async () => undefined,
  };
}

describe("W2 Round 3 template catalog and application", () => {
  it("retains every required W2 v2 launch template and publishes complete expanded defaults", () => {
    const historicalLaunch = requiredTemplates.map((code) =>
      required(findProgramTemplate(code, 2), `${code} v2`),
    );
    expect(historicalLaunch.map((template) => template.code)).toEqual(requiredTemplates);
    expect(historicalLaunch.every((template) => template.version === 2)).toBe(true);

    const templates = latestProgramTemplates();
    expect(templates).toHaveLength(32);
    expect(
      requiredTemplates.every((code) => templates.some((template) => template.code === code)),
    ).toBe(true);
    for (const template of templates) {
      expect(template.version).toBeGreaterThanOrEqual(1);
      expect(template.category).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.nameAr).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.descriptionAr).toBeTruthy();
      expect(template.recommendedStampGoal).toBeGreaterThanOrEqual(2);
      expect(template.copy.en.programName).toBeTruthy();
      expect(template.copy.ar.programName).toBeTruthy();
      expect(template.finalReward.thresholdStampCount).toBe(template.recommendedStampGoal);
      expect(template.artwork.filled.version).toBe(2);
      expect(template.artwork.empty.version).toBe(2);
      expect(template.artwork.milestone.version).toBe(2);
      expect(template.layout.type).toMatch(/^(ROW|GRID|PATH|RING)$/);
      expect(template.customerWeb.variant).toBeTruthy();
      expect(template.apple.barcodeLabel).toBeTruthy();
      expect(template.google.barcodeLabel).toBeTruthy();
    }
  });

  it("applies every selected template default and preserves only merchant-owned fields on switch", () => {
    const coffee = required(findProgramTemplate("COFFEE", 2), "Coffee v2");
    const carWash = required(findProgramTemplate("CAR_WASH", 2), "Car wash v2");
    const coffeeDraft = createQuickDraft(coffee, "pro");
    expect(coffeeDraft).toMatchObject({
      templateCode: "COFFEE",
      templateVersion: 2,
      requiredStampCount: coffee.recommendedStampGoal,
      earningDescription: coffee.earningDescription,
      translations: coffee.copy,
      visualTheme: {
        backgroundColor: coffee.colors.background,
        accentColor: coffee.colors.accent,
        layoutType: coffee.layout.type,
        customerWebVariant: coffee.customerWeb.variant,
        applePreviewConfig: coffee.apple,
        googlePreviewConfig: coffee.google,
      },
    });
    expect(coffeeDraft.rewards).toHaveLength(coffee.milestones.length + 1);

    coffeeDraft.internalName = "Merchant-owned name";
    coffeeDraft.locationIds = ["location-a"];
    coffeeDraft.translations.en.programName = "Edited by merchant";
    const switched = applyTemplateToDraft(carWash, coffeeDraft);
    expect(switched.internalName).toBe("Merchant-owned name");
    expect(switched.locationIds).toEqual(["location-a"]);
    expect(switched.templateCode).toBe("CAR_WASH");
    expect(switched.templateVersion).toBe(2);
    expect(switched.translations.en.programName).toBe(carWash.copy.en.programName);
    expect(switched.requiredStampCount).toBe(carWash.recommendedStampGoal);
    expect(switched.visualTheme.layoutType).toBe("PATH");
  });

  it("keeps the template-switch confirmation mapping explicit and complete", () => {
    expect(templateReplacementFields).toEqual([
      "stamp goal and earning rule",
      "English and Arabic customer copy",
      "reward definitions",
      "colors and stamp artwork",
      "layout and platform preview defaults",
    ]);
  });
});

describe("W2 Round 3 immutable artwork", () => {
  it("provides recognizable versioned filled, empty, and milestone identities", () => {
    const filledDigests = requiredArtworkConcepts.map((concept) => {
      const filled = required(artworkFor(`${concept}_FILLED`, 2), `${concept} filled`);
      const empty = required(artworkFor(`${concept}_EMPTY`, 2), `${concept} empty`);
      const milestone = required(artworkFor(`${concept}_MILESTONE`, 2), `${concept} milestone`);
      expect(filled.category).toBe("STAMP_FILLED");
      expect(empty.category).toBe("STAMP_EMPTY");
      expect(milestone.category).toBe("STAMP_MILESTONE");
      expect(filled.content).not.toBe(empty.content);
      expect(filled.content).not.toMatch(/\p{Extended_Pictographic}/u);
      return libraryArtworkDigest(filled);
    });
    expect(new Set(filledDigests).size).toBe(requiredArtworkConcepts.length);
  });

  it("renders a colored earned cookie and an outline remaining cookie", () => {
    const filled = required(artworkFor("COOKIE_FILLED", 2), "Cookie filled");
    const empty = required(artworkFor("COOKIE_EMPTY", 2), "Cookie empty");
    expect(filled.content).toContain('fill="#E9A04B"');
    expect(filled.content).toContain('fill="#6B351B"');
    expect(empty.content).toContain('fill="#FFFDF8"');
    expect(empty.content).toContain('stroke="#6B351B"');
    expect(libraryArtworkDigest(filled)).not.toBe(libraryArtworkDigest(empty));
  });

  it("content-addresses canonical bytes together with the library schema", () => {
    const coffee = required(artworkFor("COFFEE_CUP_FILLED", 2), "Coffee filled");
    const expected = createHash("sha256")
      .update(`waflo-library:${LIBRARY_ARTWORK_SCHEMA_VERSION}:`)
      .update(canonicalArtworkBytes(coffee))
      .digest("hex");
    expect(libraryArtworkDigest(coffee)).toBe(expected);
    expect(
      libraryArtworkDigest({
        ...coffee,
        content: coffee.content.replace("</svg>", '<circle cx="2" cy="2" r="1"/></svg>'),
      }),
    ).not.toBe(expected);
  });
});

describe("W2 Round 3 platform, preview cache, and truthful assets", () => {
  it("defines every required capability for every preview platform", () => {
    const requiredFeatures = [
      "logo",
      "heroArtwork",
      "backgroundArtwork",
      "backgroundColor",
      "foregroundColor",
      "textFields",
      "backContent",
      "links",
      "locationMetadata",
      "expiryPresentation",
      "customStampArtwork",
      "barcodeRegion",
    ];
    for (const platform of ["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const) {
      expect(Object.keys(programPlatformCapabilities[platform])).toEqual(requiredFeatures);
      for (const capability of Object.values(programPlatformCapabilities[platform])) {
        expect(capability.support).toMatch(/^(SUPPORTED|MAPPED|UNSUPPORTED)$/);
        expect(capability.explanation).toBeTruthy();
      }
    }
  });

  it("normalizes cache-key object order and includes every render identity input", () => {
    const base = {
      rendererSchemaVersion: PREVIEW_RENDERER_SCHEMA_VERSION,
      template: { code: "COFFEE", version: 2 },
      version: { id: "version-1", revision: 4 },
      progress: 3,
      locale: "EN",
      profile: "CUSTOMER_WEB",
      assets: { filled: "digest-a", empty: "digest-b" },
    };
    const original = createProgramPreviewCacheKey(base);
    expect(
      createProgramPreviewCacheKey({
        assets: { empty: "digest-b", filled: "digest-a" },
        profile: "CUSTOMER_WEB",
        locale: "EN",
        progress: 3,
        version: { revision: 4, id: "version-1" },
        template: { version: 2, code: "COFFEE" },
        rendererSchemaVersion: PREVIEW_RENDERER_SCHEMA_VERSION,
      }),
    ).toBe(original);
    for (const changed of [
      { ...base, progress: 4 },
      { ...base, locale: "AR" },
      { ...base, profile: "APPLE_WALLET" },
      { ...base, version: { ...base.version, revision: 5 } },
      { ...base, template: { ...base.template, version: 3 } },
      { ...base, assets: { ...base.assets, filled: "digest-c" } },
      { ...base, rendererSchemaVersion: PREVIEW_RENDERER_SCHEMA_VERSION + 1 },
    ]) {
      expect(createProgramPreviewCacheKey(changed)).not.toBe(original);
    }
  });

  it("renders selected background artwork only where supported and warns elsewhere", () => {
    const backgroundDataUri = `data:image/png;base64,${Buffer.from("background").toString("base64")}`;
    const customer = composeProgramPreview(previewInput("CUSTOMER_WEB", backgroundDataUri));
    const apple = composeProgramPreview(previewInput("APPLE_WALLET", backgroundDataUri));
    const google = composeProgramPreview(previewInput("GOOGLE_WALLET", backgroundDataUri));
    expect(customer.svg).toContain(backgroundDataUri);
    expect(customer.svg).toContain('opacity=".84"');
    expect(apple.svg).not.toContain(backgroundDataUri);
    expect(google.svg).not.toContain(backgroundDataUri);
    expect(apple.warnings.map((warning) => warning.code)).toContain(
      "APPLE_BACKGROUND_ARTWORK_UNSUPPORTED",
    );
    expect(google.warnings.map((warning) => warning.code)).toContain(
      "GOOGLE_BACKGROUND_ARTWORK_UNSUPPORTED",
    );
  });

  it("returns selected bytes only after a successful digest check", async () => {
    const bytes = Buffer.from("real-image-bytes");
    const resolved = await resolvePreviewAssetContent(
      storageReturning(bytes),
      storedAsset(bytes),
      "STAMP_256",
      "filled stamp",
      true,
    );
    expect(resolved?.dataUri).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
  });

  it("fails truthfully for missing, corrupted, digest-mismatched, and absent required assets", async () => {
    const bytes = Buffer.from("expected-image");
    const missingStorage = storageReturning(bytes);
    missingStorage.get = async () => {
      throw new Error("missing object");
    };
    for (const operation of [
      resolvePreviewAssetContent(
        missingStorage,
        storedAsset(bytes),
        "STAMP_256",
        "filled stamp",
        true,
      ),
      resolvePreviewAssetContent(
        storageReturning(Buffer.from("corrupted")),
        storedAsset(bytes),
        "STAMP_256",
        "filled stamp",
        true,
      ),
      resolvePreviewAssetContent(
        storageReturning(bytes),
        storedAsset(bytes, "0".repeat(64)),
        "STAMP_256",
        "filled stamp",
        true,
      ),
      resolvePreviewAssetContent(
        storageReturning(bytes),
        undefined,
        "STAMP_256",
        "filled stamp",
        true,
      ),
    ]) {
      await expect(operation).rejects.toMatchObject({
        code: "PROGRAM_ASSET_CONTENT_UNAVAILABLE",
      });
    }
  });
});

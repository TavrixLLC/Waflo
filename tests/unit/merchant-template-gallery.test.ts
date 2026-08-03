import { describe, expect, it } from "vitest";
import { artworkFor } from "../../apps/api/src/programs/library-artwork.js";
import {
  renderTemplateGalleryPreview,
  renderTemplateGalleryPreviews,
  renderTemplateGalleryThumbnail,
} from "../../apps/api/src/programs/template-gallery-preview.js";
import { contrastRatio } from "../../apps/api/src/programs/validation-engine.js";
import {
  businessRecommendationCategory,
  filterTemplates,
  hasTemplatePresentationMetadata,
  recommendedTemplates,
  templateCategory,
  templateGalleryCategories,
  templateStyleLabel,
} from "../../apps/merchant-dashboard/components/template-gallery-presentation.js";
import { findProgramTemplate, latestProgramTemplates } from "../../packages/contracts/src/index.js";

const merchantCategories = templateGalleryCategories.filter((category) => category !== "all");
const previewProfiles = ["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const;

function embeddedStampSvg(previewSvg: string): string {
  const encodedImages = [...previewSvg.matchAll(/data:image\/svg\+xml;base64,([^"']+)/gu)].map(
    (match) => match[1],
  );
  for (const encoded of encodedImages) {
    if (!encoded) continue;
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    if (decoded.includes("data-visual-state")) return decoded;
  }
  throw new Error("The composed gallery preview does not contain a rendered stamp grid.");
}

describe("merchant template-gallery presentation", () => {
  it("exposes 32 unique latest templates with four in every approved merchant category", () => {
    const templates = latestProgramTemplates();
    const counts = Object.fromEntries(
      merchantCategories.map((category) => [
        category,
        templates.filter((template) => templateCategory(template) === category).length,
      ]),
    );

    expect(templates).toHaveLength(32);
    expect(new Set(templates.map((template) => template.code))).toHaveProperty("size", 32);
    expect(counts).toEqual(Object.fromEntries(merchantCategories.map((category) => [category, 4])));
    expect(templates.every(hasTemplatePresentationMetadata)).toBe(true);
  });

  it("keeps historical launch versions resolvable while latest codes remain stable", () => {
    expect(findProgramTemplate("COFFEE", 1)?.version).toBe(1);
    expect(findProgramTemplate("COFFEE", 2)?.name).toBe("Coffee");
    expect(findProgramTemplate("COFFEE", 3)?.name).toBe("Classic Roast");
    expect(findProgramTemplate("COFFEE", 3)?.presentation).toBeUndefined();
    expect(findProgramTemplate("COFFEE")?.version).toBe(4);
    expect(findProgramTemplate("COFFEE")?.presentation?.visualRole).toBe("SIGNATURE");
    expect(findProgramTemplate("GENERAL_VISITS", 2)?.version).toBe(2);
    expect(findProgramTemplate("COFFEE_DARK_ESPRESSO", 1)?.version).toBe(1);
    expect(findProgramTemplate("COFFEE_DARK_ESPRESSO", 1)?.presentation).toBeUndefined();
    expect(findProgramTemplate("COFFEE_DARK_ESPRESSO", 2)?.presentation?.visualRole).toBe(
      "PREMIUM",
    );
  });

  it("recommends three deterministic category matches with a General fallback", () => {
    const templates = latestProgramTemplates();

    expect(businessRecommendationCategory("Cafe")).toEqual({
      category: "coffee",
      matchedBusiness: true,
    });
    expect(recommendedTemplates(templates, "Coffee shop").map((template) => template.code)).toEqual(
      ["COFFEE", "COFFEE_DARK_ESPRESSO", "COFFEE_WARM_LATTE"],
    );
    expect(recommendedTemplates(templates, "صالون تجميل").map((template) => template.code)).toEqual(
      ["SALON", "SALON_LUXURY_BEAUTY", "SALON_MODERN_NAILS"],
    );
    expect(
      recommendedTemplates(templates, "Unsupported profile value").map((template) => template.code),
    ).toEqual(["GENERAL_VISITS", "GENERAL_MODERN_REWARDS", "GENERAL_NEUTRAL_LOYALTY"]);
  });

  it("filters four designs per category and searches localized names and merchant styles", () => {
    const templates = latestProgramTemplates();

    expect(filterTemplates(templates, "coffee", "")).toHaveLength(4);
    expect(filterTemplates(templates, "all", "المخبوزات")).toHaveLength(4);
    expect(filterTemplates(templates, "all", "Premium").map((template) => template.code)).toEqual([
      "CAR_WASH_PREMIUM_AUTO",
      "SALON_LUXURY_BEAUTY",
      "RETAIL_PREMIUM_MEMBER",
    ]);
    expect(filterTemplates(templates, "all", "فاخر")).toHaveLength(3);
    expect(
      filterTemplates(templates, "all", "Modern Café").map((template) => template.code),
    ).toEqual(["COFFEE_MODERN_CAFE"]);
    expect(filterTemplates(templates, "all", "circular layout")).toEqual([]);
    const darkEspresso = findProgramTemplate("COFFEE_DARK_ESPRESSO");
    if (!darkEspresso) throw new Error("Dark Espresso is required.");
    expect(templateStyleLabel(darkEspresso, "ar")).toBe("داكن");
  });

  it("uses a distinct non-color visual definition for every latest template", () => {
    const templates = latestProgramTemplates();
    const signatures = templates.map((template) =>
      [
        template.artwork.filled.code,
        template.layout.type,
        JSON.stringify(template.layout.configuration),
        template.layout.stampSize,
        template.layout.stampSpacing,
        template.customerWeb.variant,
        JSON.stringify(template.presentation),
        template.recommendedStampGoal,
      ].join("|"),
    );

    expect(new Set(signatures)).toHaveProperty("size", templates.length);
  });

  it("assigns four visual roles and meaningfully different structures within each category", () => {
    const expectedRoles = new Set(["SIGNATURE", "PREMIUM", "FRIENDLY", "MINIMAL"]);
    const compositionCounts = new Map<string, number>();

    for (const category of merchantCategories) {
      const templates = latestProgramTemplates().filter(
        (template) => templateCategory(template) === category,
      );
      expect(new Set(templates.map((template) => template.presentation?.visualRole))).toEqual(
        expectedRoles,
      );
      expect(new Set(templates.map((template) => template.presentation?.composition)).size).toBe(4);

      for (let leftIndex = 0; leftIndex < templates.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < templates.length; rightIndex += 1) {
          const left = templates[leftIndex];
          const right = templates[rightIndex];
          if (!left?.presentation || !right?.presentation) {
            throw new Error("Every latest template requires refined presentation metadata.");
          }
          const leftAxes = [
            left.presentation.composition,
            left.presentation.motifTreatment,
            left.presentation.rewardTreatment,
            left.presentation.density,
            left.presentation.cornerTreatment,
            left.presentation.titleTreatment,
            left.layout.type,
            left.customerWeb.variant,
          ];
          const rightAxes = [
            right.presentation.composition,
            right.presentation.motifTreatment,
            right.presentation.rewardTreatment,
            right.presentation.density,
            right.presentation.cornerTreatment,
            right.presentation.titleTreatment,
            right.layout.type,
            right.customerWeb.variant,
          ];
          const differences = leftAxes.filter((value, index) => value !== rightAxes[index]).length;
          expect(
            differences,
            `${left.code} and ${right.code} must differ on at least three structural axes`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }

    for (const template of latestProgramTemplates()) {
      const composition = template.presentation?.composition;
      if (!composition) throw new Error(`${template.code} is missing a composition.`);
      compositionCounts.set(composition, (compositionCounts.get(composition) ?? 0) + 1);
    }
    expect(Object.fromEntries(compositionCounts)).toEqual({
      SPLIT_HERO: 4,
      HEADER_BAND: 4,
      STAMP_STAGE: 4,
      EDITORIAL: 4,
      DIAGONAL_FIELD: 4,
      LABEL_FRAME: 4,
      POSTER: 4,
      SIDE_TOTEM: 4,
    });
  });

  it("resolves all immutable artwork and keeps text contrast accessible", () => {
    for (const template of latestProgramTemplates()) {
      expect(artworkFor(template.artwork.filled), `${template.code} filled artwork`).toBeDefined();
      expect(artworkFor(template.artwork.empty), `${template.code} empty artwork`).toBeDefined();
      expect(
        artworkFor(template.artwork.milestone),
        `${template.code} historical milestone artwork`,
      ).toBeDefined();
      expect(
        contrastRatio(template.colors.background, template.colors.foreground),
        `${template.code} foreground contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("renderer-backed template gallery previews", () => {
  it("renders all 32 templates on Customer, Apple, and Google surfaces in English and Arabic", () => {
    for (const template of latestProgramTemplates()) {
      for (const locale of ["EN", "AR"] as const) {
        for (const profile of previewProfiles) {
          const preview = renderTemplateGalleryPreview(template, profile, locale);
          const localizedName =
            locale === "AR" ? template.copy.ar.programName : template.copy.en.programName;

          expect(preview.profile).toBe(profile);
          expect(preview.locale).toBe(locale);
          expect(preview.presentation).toBe("TEMPLATE");
          expect(preview.width).toBeGreaterThan(0);
          expect(preview.height).toBeGreaterThan(0);
          expect(preview.svg).toContain(localizedName);
          expect(preview.svg).not.toContain("undefined");
          if (locale === "AR") expect(preview.svg).toContain('direction="rtl"');
        }
      }
    }
  });

  it("renders deterministic output for every detailed preview set", () => {
    for (const template of latestProgramTemplates()) {
      const first = renderTemplateGalleryPreviews(template, "EN");
      const second = renderTemplateGalleryPreviews(template, "EN");
      expect(Object.values(first).map((preview) => preview.digest)).toEqual(
        Object.values(second).map((preview) => preview.digest),
      );
    }
  });

  it("renders four distinct Customer silhouettes in every merchant category", () => {
    for (const category of merchantCategories) {
      const signatures = latestProgramTemplates()
        .filter((template) => templateCategory(template) === category)
        .map((template) => {
          const preview = renderTemplateGalleryPreview(template, "CUSTOMER_WEB", "EN");
          const blocks = [...preview.svg.matchAll(/data-preview-block="([^"]+)"/gu)].map(
            (match) => match[1],
          );
          return `${template.presentation?.composition}|${blocks.join(",")}`;
        });
      expect(new Set(signatures), `${category} Customer silhouettes`).toHaveProperty("size", 4);
    }
  });

  it("keeps template art direction on Customer while Wallet framing stays provider-truthful", () => {
    for (const template of latestProgramTemplates()) {
      const customer = renderTemplateGalleryPreview(template, "CUSTOMER_WEB", "EN");
      expect(customer.svg).toContain(`data-visual-role="${template.presentation?.visualRole}"`);
      expect(customer.svg).toContain(
        `data-motif-treatment="${template.presentation?.motifTreatment}"`,
      );

      for (const profile of ["APPLE_WALLET", "GOOGLE_WALLET"] as const) {
        const preview = renderTemplateGalleryPreview(template, profile, "EN");
        expect(preview.svg).not.toContain("data-visual-role");
        expect(preview.svg).not.toContain("data-motif-treatment");
        expect(preview.svg).toContain(
          `data-wallet-provider="${profile === "APPLE_WALLET" ? "APPLE" : "GOOGLE"}"`,
        );
        expect(preview.svg).toContain("PREVIEW ONLY");
      }
    }
  });

  it("preserves exactly FILLED and EMPTY states across every latest surface and locale", () => {
    for (const template of latestProgramTemplates()) {
      for (const locale of ["EN", "AR"] as const) {
        for (const profile of previewProfiles) {
          const preview = renderTemplateGalleryPreview(template, profile, locale);
          const stampSvg = embeddedStampSvg(preview.svg);
          const states = [...stampSvg.matchAll(/data-visual-state="([A-Z_]+)"/gu)].map(
            (match) => match[1],
          );

          expect(new Set(states), `${template.code} ${locale} ${profile}`).toEqual(
            new Set(["FILLED", "EMPTY"]),
          );
          expect(states).toHaveLength(template.recommendedStampGoal);
          expect(stampSvg).not.toContain('data-visual-state="MILESTONE"');
          expect(stampSvg).not.toContain("showIndexLabels");
        }
      }
    }
  });

  it("presents Start from scratch as neutral instead of masquerading as General Visits", () => {
    const safeDefault = findProgramTemplate("GENERAL_VISITS");
    if (!safeDefault) throw new Error("The safe General Visits default is required.");

    for (const locale of ["EN", "AR"] as const) {
      for (const profile of previewProfiles) {
        const blank = renderTemplateGalleryPreview(safeDefault, profile, locale, "BLANK");
        const regular = renderTemplateGalleryPreview(safeDefault, profile, locale);
        expect(blank.presentation).toBe("BLANK");
        expect(blank.digest).not.toBe(regular.digest);
        expect(blank.svg).not.toContain(
          safeDefault.copy[locale === "AR" ? "ar" : "en"].programName,
        );
        expect(blank.svg).toContain(locale === "AR" ? "بطاقة ولائك" : "Your loyalty card");
        expect(blank.svg).toContain(locale === "AR" ? "مكافأتك" : "Your reward");
        expect(embeddedStampSvg(blank.svg)).not.toContain('data-visual-state="MILESTONE"');
      }
    }
  });

  it("keeps the initial thumbnail payload materially lighter than eager three-surface rendering", () => {
    const templates = latestProgramTemplates();
    const thumbnailBytes = Buffer.byteLength(
      JSON.stringify(templates.map((template) => renderTemplateGalleryThumbnail(template, "EN"))),
    );
    const eagerBytes = Buffer.byteLength(
      JSON.stringify(templates.map((template) => renderTemplateGalleryPreviews(template, "EN"))),
    );

    expect(thumbnailBytes).toBeLessThan(eagerBytes * 0.55);
  });
});

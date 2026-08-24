import { describe, expect, it } from "vitest";
import {
  applyBuilderTemplate,
  BUILDER_AUTOSAVE_DELAY_MS,
  BUILDER_PREVIEW_DELAY_MS,
  builderPreviewCacheKey,
  builderReadiness,
  builderReadinessWithValidation,
  builderSections,
  cardLocaleCompleteness,
  createBuilderDraft,
  isNeutralBuilderDraft,
  languageCompleteness,
  shouldScheduleBuilderAutosave,
  updateBuilderRewardCopy,
  updateBuilderStampGoal,
} from "../../apps/merchant-dashboard/components/program-card-builder-state.js";
import {
  optimisticProgramPreviewSvg,
  walletPreviewQrOverlay,
  walletPreviewQrRows,
} from "../../apps/merchant-dashboard/components/program-preview-optimistic.js";
import type {
  LocationItem,
  TemplateItem,
} from "../../apps/merchant-dashboard/components/program-studio-types.js";
import { latestProgramTemplates } from "../../packages/contracts/src/index.js";
import { createQrPreviewMarkup } from "../../packages/qr-core/src/index.js";

function template(code: string): TemplateItem {
  const match = latestProgramTemplates().find((item) => item.code === code);
  if (!match) throw new Error(`Missing test template ${code}.`);
  return match as unknown as TemplateItem;
}

const locations: LocationItem[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Main Branch", status: "ACTIVE" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Old Branch", status: "INACTIVE" },
];

describe("merchant loyalty-card Builder state", () => {
  it("collapses the seven-page wizard into six merchant-intent sections", () => {
    expect(builderSections).toEqual([
      "languages",
      "basics",
      "reward",
      "locations",
      "appearance",
      "review",
    ]);
    expect(builderSections).not.toContain("english");
    expect(builderSections).not.toContain("arabic");
    expect(builderSections).not.toContain("template");
  });

  it("initializes one valid Quick draft from template defaults and known active locations", () => {
    const coffee = template("COFFEE");
    const draft = createBuilderDraft(coffee, locations, { locale: "en" });

    expect(draft.templateCode).toBe(coffee.code);
    expect(draft.templateVersion).toBe(coffee.version);
    expect(draft.editingMode).toBe("quick");
    expect(draft.requiredStampCount).toBe(coffee.recommendedStampGoal);
    expect(draft.internalName).toBe(coffee.name);
    expect(draft.translations.en.earningDescription).toBe(coffee.earningDescription);
    expect(draft.locationIds).toEqual([locations[0]?.id]);
    expect(draft.rewards).toHaveLength(1);
    expect(builderReadiness(draft)).toEqual({
      basics: true,
      reward: true,
      languages: true,
      locations: true,
      appearance: true,
      ready: true,
    });
  });

  it("uses a neutral presentation adapter for Start from scratch", () => {
    const draft = createBuilderDraft(template("GENERAL_VISITS"), locations, {
      locale: "en",
      blank: true,
    });

    expect(draft.templateCode).toBe("GENERAL_VISITS");
    expect(draft.translations.en.programName).toBe("Your loyalty card");
    expect(draft.translations.en.shortDescription).toContain("qualifying visit");
    expect(draft.translations.en.programName).not.toMatch(/general visits/iu);
    expect(draft.translations.ar.programName).not.toMatch(/زيارات عامة/u);
    expect(isNeutralBuilderDraft(draft)).toBe(true);
  });

  it("changes only template identity and appearance while preserving merchant and policy data", () => {
    const original = createBuilderDraft(template("COFFEE"), locations, { locale: "en" });
    const customized = {
      ...updateBuilderRewardCopy(updateBuilderStampGoal(original, 11), "en", "House roast"),
      internalName: "Downtown coffee card",
      operationalTimezone: "Asia/Baghdad",
      maximumStampsPerOperation: 3,
      locationIds: [locations[0]?.id ?? ""],
    };
    const nextTemplate = template("COFFEE_DARK_ESPRESSO");
    const changed = applyBuilderTemplate(nextTemplate, customized);

    expect(changed.templateCode).toBe(nextTemplate.code);
    expect(changed.templateVersion).toBe(nextTemplate.version);
    expect(changed.visualTheme).toEqual(
      createBuilderDraft(nextTemplate, [], { locale: "en" }).visualTheme,
    );
    expect(changed.internalName).toBe(customized.internalName);
    expect(changed.requiredStampCount).toBe(11);
    expect(changed.translations).toEqual(customized.translations);
    expect(changed.rewards).toEqual(customized.rewards);
    expect(changed.locationIds).toEqual(customized.locationIds);
    expect(changed.maximumStampsPerOperation).toBe(3);
  });

  it("keeps milestone rewards separate when goal and final reward copy change", () => {
    const draft = createBuilderDraft(template("COFFEE"), locations, { locale: "en" });
    const finalReward = draft.rewards[0];
    if (!finalReward) throw new Error("Coffee requires a final reward.");
    const withMilestone = {
      ...draft,
      editingMode: "pro" as const,
      rewards: [
        ...draft.rewards,
        {
          ...finalReward,
          clientId: "milestone",
          thresholdStampCount: 3,
          sortOrder: 99,
          internalName: "Milestone",
        },
      ],
    };
    const goalChanged = updateBuilderStampGoal(withMilestone, 12);
    const copyChanged = updateBuilderRewardCopy(goalChanged, "en", "Free signature drink");

    expect(copyChanged.rewards.find((reward) => reward.clientId === "milestone")).toMatchObject({
      thresholdStampCount: 3,
      internalName: "Milestone",
    });
    expect(copyChanged.rewards.find((reward) => reward.thresholdStampCount === 12)).toMatchObject({
      internalName: "Free signature drink",
      translations: {
        en: { name: "Free signature drink", description: "Free signature drink" },
      },
    });
    const missingMilestoneCopy = {
      ...copyChanged,
      rewards: copyChanged.rewards.map((reward) =>
        reward.clientId === "milestone"
          ? {
              ...reward,
              translations: {
                ...reward.translations,
                en: { name: "", description: "" },
              },
            }
          : reward,
      ),
    };
    expect(cardLocaleCompleteness(missingMilestoneCopy, "en")).toMatchObject({
      complete: false,
      missing: 2,
      missingFields: ["rewards.1.name", "rewards.1.description"],
    });
  });

  it("reports truthful English and Arabic completeness", () => {
    const draft = createBuilderDraft(template("COFFEE"), locations, { locale: "en" });
    expect(languageCompleteness(draft.translations.en)).toMatchObject({
      complete: true,
      missing: 0,
    });
    expect(
      languageCompleteness({ ...draft.translations.ar, rewardUnlockedMessage: "" }),
    ).toMatchObject({
      complete: false,
      missing: 1,
      missingFields: ["rewardUnlockedMessage"],
    });
  });

  it("uses the same validation truth for section navigation and readiness", () => {
    const draft = createBuilderDraft(template("COFFEE"), locations, { locale: "en" });
    const result = builderReadinessWithValidation(draft, {
      status: "FAILED",
      configurationFingerprint: "validation",
      errors: [
        {
          code: "PROGRAM_LOCATION_INVALID",
          severity: "error",
          path: "locations",
          platform: "GENERAL",
          message: "Choose an active location.",
          suggestedAction: "Review participating locations.",
        },
      ],
      warnings: [],
    });

    expect(result).toMatchObject({
      basics: true,
      reward: true,
      languages: true,
      locations: false,
      appearance: true,
      ready: false,
    });
  });

  it("debounces autosave, requires explicit retry after failure, and keys previews by revision", () => {
    expect(BUILDER_AUTOSAVE_DELAY_MS).toBeGreaterThanOrEqual(800);
    expect(BUILDER_PREVIEW_DELAY_MS).toBeLessThanOrEqual(150);
    expect(shouldScheduleBuilderAutosave("changed", "saved", "saved")).toBe(true);
    expect(shouldScheduleBuilderAutosave("changed", "saved", "saving")).toBe(false);
    expect(shouldScheduleBuilderAutosave("changed", "saved", "failed")).toBe(false);
    expect(shouldScheduleBuilderAutosave("changed", "saved", "conflict")).toBe(false);
    expect(shouldScheduleBuilderAutosave("same", "same", "saved")).toBe(false);
    expect(builderPreviewCacheKey(7, "APPLE_WALLET", "AR", 4)).toBe("7:APPLE_WALLET:AR:4");
  });

  it("updates colors and localized copy immediately while retaining provider structure", () => {
    const source = createBuilderDraft(template("COFFEE"), locations, { locale: "en" });
    const next = updateBuilderRewardCopy(
      {
        ...source,
        visualTheme: {
          ...source.visualTheme,
          backgroundColor: "#101820",
          foregroundColor: "#F8F5EE",
          accentColor: "#D99032",
        },
      },
      "en",
      "A free signature drink",
    );
    const nested = `<svg fill="${source.visualTheme.backgroundColor}"><text>${source.translations.en.rewardSummary}</text></svg>`;
    const svg = `<svg data-provider-owned-layout="true" fill="${source.visualTheme.backgroundColor}"><text>${source.translations.en.programName}</text><image href="data:image/svg+xml;base64,${Buffer.from(nested).toString("base64")}"/></svg>`;

    const optimistic = optimisticProgramPreviewSvg({
      svg,
      sourceDraft: source,
      draft: next,
      locale: "en",
    });

    expect(optimistic).toContain('data-provider-owned-layout="true"');
    expect(optimistic).toContain(next.visualTheme.backgroundColor);
    expect(optimistic).toContain(next.translations.en.programName);
    const embedded = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/u.exec(optimistic)?.[1];
    expect(Buffer.from(embedded ?? "", "base64").toString("utf8")).toContain(
      "A free signature drink",
    );
  });

  it("keeps the fast Wallet canvas QR aligned with the authoritative preview QR", () => {
    const preview = createQrPreviewMarkup("waflo-wallet-preview-only");
    expect(preview.viewSize).toBe(37);
    expect(walletPreviewQrRows).toHaveLength(29);
    walletPreviewQrRows.forEach((hex, row) => {
      const bits = BigInt(`0x${hex}`);
      const runs: string[] = [];
      let column = 0;
      while (column < 29) {
        if (((bits >> BigInt(28 - column)) & 1n) === 0n) {
          column += 1;
          continue;
        }
        const start = column;
        while (column < 29 && ((bits >> BigInt(28 - column)) & 1n) === 1n) column += 1;
        runs.push(`M${start + 4} ${row + 4}h${column - start}v1h-${column - start}z`);
      }
      expect(preview.markup).toContain(`<path d="${runs.join("")}"/>`);
    });
    expect(walletPreviewQrOverlay("APPLE_WALLET")).toEqual({
      left: "33.2609%",
      top: "56.0377%",
      width: "33.4783%",
      height: "29.0566%",
    });
    expect(walletPreviewQrOverlay("GOOGLE_WALLET")).toEqual({
      left: "33.2609%",
      top: "21.0256%",
      width: "33.4783%",
      height: "19.7436%",
    });
  });
});

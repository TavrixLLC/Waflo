import type { Locale } from "@waflo/contracts";
import {
  applyTemplateToDraft,
  createQuickDraft,
  type LocationItem,
  type PreviewProfile,
  type ProgramDraftInput,
  type TemplateItem,
  type ValidationIssue,
  type ValidationResult,
} from "./program-studio-types";

export const BUILDER_AUTOSAVE_DELAY_MS = 2_000;
export const BUILDER_PREVIEW_DELAY_MS = 300;

export function shouldScheduleBuilderAutosave(
  serializedDraft: string,
  persistedDraft: string,
  state: BuilderSaveState,
): boolean {
  return (
    serializedDraft !== persistedDraft &&
    state !== "saving" &&
    state !== "failed" &&
    state !== "conflict"
  );
}

export function builderPreviewCacheKey(
  revision: number,
  profile: PreviewProfile,
  locale: "EN" | "AR",
  progress: number,
): string {
  return `${revision}:${profile}:${locale}:${progress}`;
}

export const builderSections = [
  "basics",
  "reward",
  "languages",
  "locations",
  "appearance",
  "review",
] as const;

export type BuilderSection = (typeof builderSections)[number] | "advanced";

export type BuilderSaveState = "saved" | "unsaved" | "saving" | "failed" | "conflict";

const requiredLanguageFields = [
  "programName",
  "shortDescription",
  "termsAndConditions",
  "completionMessage",
  "rewardUnlockedMessage",
] as const;

export interface LanguageCompleteness {
  complete: boolean;
  missing: number;
  missingFields: readonly (typeof requiredLanguageFields)[number][];
}

export interface BuilderReadiness {
  basics: boolean;
  reward: boolean;
  languages: boolean;
  locations: boolean;
  appearance: boolean;
  ready: boolean;
}

function neutralCopy(locale: "en" | "ar"): ProgramDraftInput["translations"]["en"] {
  if (locale === "ar") {
    return {
      programName: "بطاقة ولائك",
      shortDescription: "اجمع ختمًا مع كل زيارة مؤهلة.",
      rewardSummary: "مكافأتك",
      termsAndConditions: "تُطبق شروط المتجر على الزيارات والمكافآت المؤهلة.",
      completionMessage: "اكتمل هدف الأختام.",
      rewardUnlockedMessage: "مكافأتك جاهزة.",
      pausedMessage: "بطاقة الولاء متوقفة مؤقتًا.",
    };
  }
  return {
    programName: "Your loyalty card",
    shortDescription: "Earn a stamp with every qualifying visit.",
    rewardSummary: "Your reward",
    termsAndConditions: "Store terms apply to qualifying visits and rewards.",
    completionMessage: "Your stamp goal is complete.",
    rewardUnlockedMessage: "Your reward is ready.",
    pausedMessage: "This loyalty card is temporarily paused.",
  };
}

export function languageCompleteness(
  value: ProgramDraftInput["translations"]["en"],
): LanguageCompleteness {
  const missingFields = requiredLanguageFields.filter((field) => !value[field]?.trim());
  return {
    complete: missingFields.length === 0,
    missing: missingFields.length,
    missingFields,
  };
}

export function builderReadiness(draft: ProgramDraftInput): BuilderReadiness {
  const finalReward = draft.rewards.find(
    (reward) => reward.thresholdStampCount === draft.requiredStampCount,
  );
  const basics =
    draft.internalName.trim().length >= 2 &&
    draft.requiredStampCount >= 2 &&
    draft.requiredStampCount <= 30 &&
    draft.earningDescription.trim().length > 0;
  const reward = Boolean(
    finalReward?.translations.en.name.trim() &&
      finalReward.translations.ar.name.trim() &&
      draft.translations.en.rewardSummary.trim() &&
      draft.translations.ar.rewardSummary.trim(),
  );
  const languages =
    languageCompleteness(draft.translations.en).complete &&
    languageCompleteness(draft.translations.ar).complete;
  const locations = draft.locationIds.length > 0;
  const appearance = Boolean(
    draft.templateCode &&
      draft.templateVersion &&
      /^#[0-9A-Fa-f]{6}$/u.test(draft.visualTheme.backgroundColor) &&
      /^#[0-9A-Fa-f]{6}$/u.test(draft.visualTheme.foregroundColor) &&
      /^#[0-9A-Fa-f]{6}$/u.test(draft.visualTheme.accentColor),
  );
  return {
    basics,
    reward,
    languages,
    locations,
    appearance,
    ready: basics && reward && languages && locations && appearance,
  };
}

export function builderReadinessWithValidation(
  draft: ProgramDraftInput,
  validation: ValidationResult | null,
): BuilderReadiness {
  const local = builderReadiness(draft);
  if (!validation?.errors.length) return local;
  const invalidSections = new Set(
    validation.errors
      .map((issue) => builderSectionForIssue(issue))
      .filter((section) => section !== "review"),
  );
  return {
    basics: local.basics && !invalidSections.has("basics"),
    reward: local.reward && !invalidSections.has("reward"),
    languages: local.languages && !invalidSections.has("languages"),
    locations: local.locations && !invalidSections.has("locations"),
    appearance: local.appearance && !invalidSections.has("appearance"),
    ready: false,
  };
}

export function createBuilderDraft(
  template: TemplateItem,
  locations: readonly LocationItem[],
  options: { locale: Locale; blank?: boolean } = { locale: "en" },
): ProgramDraftInput {
  const draft = createQuickDraft(template, "quick");
  const activeLocationIds = locations
    .filter((location) => location.status.toUpperCase() === "ACTIVE")
    .map((location) => location.id);
  const title = options.blank
    ? options.locale === "ar"
      ? "بطاقة ولاء جديدة"
      : "New loyalty card"
    : options.locale === "ar"
      ? template.nameAr
      : template.name;

  if (!options.blank) {
    return { ...draft, internalName: title, locationIds: activeLocationIds };
  }

  const en = neutralCopy("en");
  const ar = neutralCopy("ar");
  return {
    ...draft,
    internalName: title,
    earningDescription: "One stamp per qualifying visit.",
    locationIds: activeLocationIds,
    translations: { en, ar },
    rewards: draft.rewards.map((reward, index) => ({
      ...reward,
      internalName: index === draft.rewards.length - 1 ? "Final visit reward" : reward.internalName,
      translations: {
        en: { name: en.rewardSummary, description: en.rewardSummary },
        ar: { name: ar.rewardSummary, description: ar.rewardSummary },
      },
    })),
    visualTheme: {
      ...draft.visualTheme,
      backgroundColor: "#F7F8F7",
      foregroundColor: "#2B3430",
      accentColor: "#5D6A64",
      secondaryColor: "#C9D0CC",
      mutedColor: "#717C76",
      layoutType: "GRID",
      layoutConfiguration: { columns: 4 },
      stampSize: 44,
      stampSpacing: 10,
      customerWebVariant: "MINIMAL",
      applePreviewConfig: {
        headerLabel: "LOYALTY CARD",
        headerValue: en.programName,
        secondaryLabel: "YOUR REWARD",
        barcodeLabel: "Preview barcode",
        showBackContent: true,
      },
      googlePreviewConfig: {
        title: en.programName,
        subtitle: en.shortDescription,
        detailsLabel: "Card progress",
        barcodeLabel: "Preview barcode",
      },
    },
  };
}

export function applyBuilderTemplate(
  template: TemplateItem,
  current: ProgramDraftInput,
  options: { blank?: boolean } = {},
): ProgramDraftInput {
  const replacement = createBuilderDraft(template, [], {
    locale: "en",
    ...(options.blank === undefined ? {} : { blank: options.blank }),
  });
  const applied = applyTemplateToDraft(template, current);
  return {
    ...current,
    templateCode: applied.templateCode,
    templateVersion: applied.templateVersion,
    visualTheme: replacement.visualTheme,
  };
}

export function updateBuilderStampGoal(
  current: ProgramDraftInput,
  requestedGoal: number,
): ProgramDraftInput {
  const goal = Math.min(30, Math.max(2, Math.round(requestedGoal)));
  const finalIndex = finalRewardIndex(current);
  return {
    ...current,
    requiredStampCount: goal,
    rewards: current.rewards.map((reward, index) =>
      index === finalIndex ? { ...reward, thresholdStampCount: goal } : reward,
    ),
  };
}

export function updateBuilderRewardCopy(
  current: ProgramDraftInput,
  locale: "en" | "ar",
  value: string,
): ProgramDraftInput {
  const finalIndex = finalRewardIndex(current);
  return {
    ...current,
    translations: {
      ...current.translations,
      [locale]: { ...current.translations[locale], rewardSummary: value },
    },
    rewards: current.rewards.map((reward, index) =>
      index === finalIndex
        ? {
            ...reward,
            internalName: locale === "en" && value.trim() ? value : reward.internalName,
            translations: {
              ...reward.translations,
              [locale]: {
                ...reward.translations[locale],
                name: value,
                description: value,
              },
            },
          }
        : reward,
    ),
  };
}

function finalRewardIndex(current: ProgramDraftInput): number {
  const thresholdIndex = current.rewards.findIndex(
    (reward) => reward.thresholdStampCount === current.requiredStampCount,
  );
  if (thresholdIndex >= 0) return thresholdIndex;
  return current.rewards.reduce(
    (selected, reward, index, rewards) =>
      reward.sortOrder >= (rewards[selected]?.sortOrder ?? -1) ? index : selected,
    0,
  );
}

export function builderSectionForIssue(issue: ValidationIssue): BuilderSection {
  if (issue.path.startsWith("content.en") || issue.path.startsWith("content.ar"))
    return "languages";
  if (issue.path.startsWith("locations")) return "locations";
  if (issue.path.startsWith("rewards")) return "reward";
  if (issue.path.startsWith("earning")) return "basics";
  if (issue.path.startsWith("policies")) return "advanced";
  if (
    issue.path.startsWith("artwork") ||
    issue.path.startsWith("visual") ||
    issue.path.startsWith("stampLayout") ||
    issue.path.startsWith("apple") ||
    issue.path.startsWith("google")
  )
    return "appearance";
  return "review";
}

export function isNeutralBuilderDraft(draft: ProgramDraftInput): boolean {
  return (
    draft.templateCode === "GENERAL_VISITS" &&
    draft.visualTheme.backgroundColor.toUpperCase() === "#F7F8F7" &&
    draft.visualTheme.accentColor.toUpperCase() === "#5D6A64" &&
    draft.visualTheme.customerWebVariant === "MINIMAL"
  );
}

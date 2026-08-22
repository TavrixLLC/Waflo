import type {
  ProgramDraftInput,
  ProgramTranslationInput,
  RewardInput,
} from "./program-studio-types";

function present(value: string | null | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function localizedProgramField(
  draft: ProgramDraftInput,
  locale: string,
  field: keyof ProgramTranslationInput,
): string | undefined {
  return (
    present(draft.translations[locale]?.[field]) ??
    present(draft.translations[draft.defaultLocale]?.[field])
  );
}

export function selectStudioLocalizedProgramContent(draft: ProgramDraftInput, locale: string) {
  const shortDescription =
    localizedProgramField(draft, locale, "shortDescription") ??
    present(draft.earningDescription) ??
    "";

  return {
    programName:
      localizedProgramField(draft, locale, "programName") ?? present(draft.internalName) ?? "",
    shortDescription,
    fullDescription: localizedProgramField(draft, locale, "fullDescription") ?? "",
    rewardSummary: localizedProgramField(draft, locale, "rewardSummary") ?? "",
    joinInstructions: localizedProgramField(draft, locale, "joinInstructions") ?? "",
    termsAndConditions: localizedProgramField(draft, locale, "termsAndConditions") ?? "",
    completionMessage: localizedProgramField(draft, locale, "completionMessage") ?? "",
    rewardUnlockedMessage: localizedProgramField(draft, locale, "rewardUnlockedMessage") ?? "",
    pausedMessage: localizedProgramField(draft, locale, "pausedMessage") ?? "",
    earningDescription: shortDescription,
  };
}

export function selectStudioLocalizedRewardContent(
  reward: RewardInput,
  locale: string,
  defaultLocale = "en",
) {
  const requested = reward.translations[locale];
  const fallback = reward.translations[defaultLocale];
  const name = present(requested?.name) ?? present(fallback?.name) ?? reward.internalName;

  return {
    name,
    description:
      present(requested?.description) ?? present(fallback?.description) ?? reward.internalName,
    redemptionInstructions:
      present(requested?.redemptionInstructions) ?? present(fallback?.redemptionInstructions) ?? "",
  };
}

export function selectStudioLocalizedServerRewardName(
  reward: {
    internalName: string;
    translations: Array<{ locale: "EN" | "AR"; name: string }>;
  },
  locale: "en" | "ar",
): string {
  const requestedLocale = locale === "ar" ? "AR" : "EN";
  return (
    present(
      reward.translations.find((translation) => translation.locale === requestedLocale)?.name,
    ) ??
    present(reward.translations.find((translation) => translation.locale === "EN")?.name) ??
    reward.internalName
  );
}

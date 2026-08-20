import {
  findProgramTemplate,
  type ProgramOperationalStatus,
  type ProgramTemplateArtworkReference,
  type ProgramTemplateDefinition,
} from "@waflo/contracts";

export type EditingMode = "quick" | "pro";
export type StampLayout = "ROW" | "GRID" | "PATH" | "RING";
export type PreviewProfile = "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET";
export type AssetCategory =
  | "LOGO"
  | "HERO"
  | "BACKGROUND"
  | "STAMP_FILLED"
  | "STAMP_EMPTY"
  | "STAMP_MILESTONE"
  | "GENERAL";

export interface ProgramTranslationInput {
  programName: string;
  shortDescription: string;
  fullDescription?: string | undefined;
  rewardSummary: string;
  joinInstructions?: string | undefined;
  termsAndConditions: string;
  completionMessage: string;
  rewardUnlockedMessage: string;
  pausedMessage?: string | undefined;
}

export type ProgramTranslationMap = Record<string, ProgramTranslationInput> & {
  en: ProgramTranslationInput;
  ar: ProgramTranslationInput;
};

export type RewardTranslationMap = Record<
  string,
  { name: string; description: string; redemptionInstructions?: string | undefined }
> & {
  en: { name: string; description: string; redemptionInstructions?: string | undefined };
  ar: { name: string; description: string; redemptionInstructions?: string | undefined };
};

export interface RewardInput {
  clientId: string;
  thresholdStampCount: number;
  rewardType: "TEXT_REWARD" | "FREE_ITEM" | "DISCOUNT_DESCRIPTION" | "CUSTOM";
  internalName: string;
  sortOrder: number;
  validityDurationDays?: number | null | undefined;
  requiresManagerApproval: boolean;
  maximumRedemptionsPerEarned: number;
  visualOverride?:
    | {
        stampAssetId?: string | null | undefined;
        accentOverride?: string | null | undefined;
      }
    | undefined;
  translations: RewardTranslationMap;
}

export interface ProgramDraftInput {
  internalName: string;
  defaultLocale: string;
  enabledLocales: string[];
  editingMode: EditingMode;
  templateCode?: string | undefined;
  templateVersion?: number | undefined;
  requiredStampCount: number;
  operationalTimezone: string;
  maximumStampsPerOperation: number;
  maximumStampsPerCustomerPerDay: number | null;
  minimumPurchaseAmountMinor: number | null;
  minimumPurchaseCurrency: string | null;
  staffOwnReversalWindowSeconds: number;
  managerReversalWindowMinutes: number;
  managerOverrideAllowed: boolean;
  resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION";
  translations: ProgramTranslationMap;
  earningDescription: string;
  rewards: RewardInput[];
  locationIds: string[];
  visualTheme: {
    backgroundColor: string;
    foregroundColor: string;
    accentColor: string;
    secondaryColor: string;
    mutedColor: string;
    filledStampAssetId?: string | undefined;
    emptyStampAssetId?: string | undefined;
    logoAssetId?: string | null | undefined;
    heroAssetId?: string | null | undefined;
    backgroundAssetId?: string | null | undefined;
    defaultMilestoneAssetId?: string | null | undefined;
    layoutType: StampLayout;
    layoutConfiguration: {
      columns?: number | undefined;
      maxPerRow?: number | undefined;
      serpentine?: boolean | undefined;
      startAngle?: number | undefined;
    };
    stampSize: number;
    stampSpacing: number;
    borderRadius: number;
    progressLabelVisible: boolean;
    rewardLabelVisible: boolean;
    customerWebVariant: "CARD" | "MINIMAL" | "HERO";
    applePreviewConfig: {
      headerLabel: string;
      headerValue: string;
      secondaryLabel: string;
      barcodeLabel: string;
      showBackContent: boolean;
    };
    googlePreviewConfig: {
      title: string;
      subtitle: string;
      detailsLabel: string;
      barcodeLabel: string;
    };
  };
  changeSummary?: string | undefined;
}

export interface ProgramItem {
  id: string;
  internalName: string;
  status: ProgramOperationalStatus;
  updatedAt?: string;
  currentDraftVersion: {
    id: string;
    versionNumber: number;
    revision: number;
    status: string;
    editingMode: "QUICK" | "PRO";
    stampRule?: { requiredStampCount: number } | null;
    translations?: Array<{ locale: "EN" | "AR"; programName: string; rewardSummary: string }>;
    visualTheme?: {
      backgroundColor: string;
      foregroundColor: string;
      accentColor: string;
      layoutType: StampLayout;
    } | null;
  } | null;
  currentPublishedVersion: {
    id: string;
    versionNumber: number;
    status: string;
    publishedAt?: string | null;
    stampRule?: { requiredStampCount: number } | null;
    translations?: Array<{ locale: "EN" | "AR"; programName: string; rewardSummary: string }>;
    visualTheme?: {
      backgroundColor: string;
      foregroundColor: string;
      accentColor: string;
      layoutType: StampLayout;
    } | null;
  } | null;
  _count?: { versions: number };
}

interface ServerTranslation {
  locale: "EN" | "AR";
  programName: string;
  shortDescription: string;
  fullDescription?: string | null;
  rewardSummary: string;
  joinInstructions?: string | null;
  termsAndConditions: string;
  completionMessage: string;
  rewardUnlockedMessage: string;
  pausedMessage?: string | null;
}

interface ServerReward {
  id: string;
  thresholdStampCount: number;
  rewardType: RewardInput["rewardType"];
  internalName: string;
  sortOrder: number;
  validityDurationDays?: number | null;
  requiresManagerApproval: boolean;
  maximumRedemptionsPerEarned: number;
  translations: Array<{
    locale: "EN" | "AR";
    name: string;
    description: string;
    redemptionInstructions?: string | null;
  }>;
  visualOverride?: {
    stampAssetId?: string | null;
    accentOverride?: string | null;
  } | null;
}

interface ServerCardLocale {
  id: string;
  locale: string;
  enabled: boolean;
  position: number;
  programName?: string | null;
  shortDescription?: string | null;
  fullDescription?: string | null;
  rewardSummary?: string | null;
  joinInstructions?: string | null;
  termsAndConditions?: string | null;
  completionMessage?: string | null;
  rewardUnlockedMessage?: string | null;
  pausedMessage?: string | null;
  rewardTranslations: Array<{
    rewardId: string;
    name?: string | null;
    description?: string | null;
    redemptionInstructions?: string | null;
  }>;
}

export interface ProgramVersion {
  id: string;
  versionNumber: number;
  status: string;
  editingMode: "QUICK" | "PRO";
  baseTemplateCode?: string | null;
  baseTemplateVersion?: number | null;
  revision: number;
  changeSummary?: string | null;
  validatedAt?: string | null;
  testReadyAt?: string | null;
  publishedAt?: string | null;
  supersededAt?: string | null;
  abandonedAt?: string | null;
  validationFingerprint?: string | null;
  operationalTimezone: string;
  staffOwnReversalWindowSeconds: number;
  managerReversalWindowMinutes: number;
  managerOverrideAllowed: boolean;
  defaultCardLocale?: string;
  cardLocales?: ServerCardLocale[];
  translations: ServerTranslation[];
  stampRule: {
    requiredStampCount: number;
    earningDescription: string;
    maximumStampsPerOperation: number;
    maximumStampsPerCustomerPerDay: number | null;
    minimumPurchaseAmountMinor: number | null;
    minimumPurchaseCurrency: string | null;
    resetBehaviorAfterReward: string;
  } | null;
  rewards: ServerReward[];
  locations: Array<{
    locationId: string;
    location?: { id: string; name: string; status: string };
  }>;
  visualTheme: {
    backgroundColor: string;
    foregroundColor: string;
    accentColor: string;
    secondaryColor: string;
    mutedColor: string;
    filledStampAssetId: string;
    emptyStampAssetId: string;
    logoAssetId?: string | null;
    heroAssetId?: string | null;
    backgroundAssetId?: string | null;
    defaultMilestoneAssetId?: string | null;
    layoutType: StampLayout;
    layoutConfiguration?: Record<string, unknown>;
    stampSize: number;
    stampSpacing: number;
    borderRadius: number;
    progressLabelVisible: boolean;
    rewardLabelVisible: boolean;
    customerWebVariant: "CARD" | "MINIMAL" | "HERO";
    applePreviewConfig?: Record<string, unknown>;
    googlePreviewConfig?: Record<string, unknown>;
  } | null;
}

export interface ProgramDetail
  extends Omit<ProgramItem, "currentDraftVersion" | "currentPublishedVersion"> {
  currentDraftVersion: ProgramVersion | null;
  currentPublishedVersion: ProgramVersion | null;
  versions: ProgramVersion[];
}

type TemplateArtworkPreview = ProgramTemplateArtworkReference & { previewUrl: string };

export interface TemplateGalleryPreview {
  svg: string;
  digest: string;
  width: number;
  height: number;
  warnings: Array<{
    code: string;
    severity: "warning";
    platform: PreviewProfile;
    message: string;
  }>;
  profile: PreviewProfile;
  locale: "EN" | "AR";
  presentation: "TEMPLATE" | "BLANK";
}

export interface TemplateItem extends Omit<ProgramTemplateDefinition, "artwork"> {
  availableOnPlans: readonly ["STARTER", "GROWTH", "SCALE"];
  galleryThumbnail: TemplateGalleryPreview;
  blankGalleryThumbnail?: TemplateGalleryPreview;
  artwork: {
    filled: TemplateArtworkPreview;
    empty: TemplateArtworkPreview;
    milestone: TemplateArtworkPreview;
  };
}

export interface LocationItem {
  id: string;
  name: string;
  status: string;
}

export interface AssetItem {
  id: string;
  category: AssetCategory;
  source: "WAFLO_LIBRARY" | "MERCHANT_UPLOAD";
  originalFilename: string;
  processingStatus: string;
  contentUrl: string;
  width?: number | null;
  height?: number | null;
  uploadDisposition?: "CREATED" | "REPLAYED" | "RESTORED" | "REPAIRED";
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  platform: string;
  message: string;
  suggestedAction: string;
}

export interface ValidationResult {
  status: "PASSED" | "VALID_WITH_WARNINGS" | "FAILED";
  configurationFingerprint: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export const studioSections = [
  "overview",
  "earning",
  "rewards",
  "locations",
  "english",
  "arabic",
  "visual",
  "artwork",
  "layout",
  "customer-preview",
  "apple-preview",
  "google-preview",
  "policies",
  "validation",
  "versions",
] as const;

export type StudioSection = (typeof studioSections)[number];

function translation(version: ProgramVersion, locale: "EN" | "AR"): ServerTranslation | undefined {
  return version.translations.find((item) => item.locale === locale);
}

function rewardTranslation(reward: ServerReward, locale: "EN" | "AR") {
  return reward.translations.find((item) => item.locale === locale);
}

function cardRewardTranslations(
  reward: ServerReward,
  cardLocales: readonly ServerCardLocale[],
): RewardTranslationMap {
  const result = Object.fromEntries(
    cardLocales.map((locale) => {
      const localized = locale.rewardTranslations.find((item) => item.rewardId === reward.id);
      const legacy = rewardTranslation(reward, locale.locale === "ar" ? "AR" : "EN");
      return [
        locale.locale,
        {
          name: localized?.name ?? legacy?.name ?? "",
          description: localized?.description ?? legacy?.description ?? "",
          redemptionInstructions:
            localized?.redemptionInstructions ?? legacy?.redemptionInstructions ?? undefined,
        },
      ];
    }),
  ) as RewardTranslationMap;
  result.en ??= {
    name: rewardTranslation(reward, "EN")?.name ?? "",
    description: rewardTranslation(reward, "EN")?.description ?? "",
  };
  result.ar ??= {
    name: rewardTranslation(reward, "AR")?.name ?? "",
    description: rewardTranslation(reward, "AR")?.description ?? "",
  };
  return result;
}

function stringConfig(value: Record<string, unknown>, key: string, fallback: string): string {
  return typeof value[key] === "string" ? (value[key] as string) : fallback;
}

function booleanConfig(value: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof value[key] === "boolean" ? (value[key] as boolean) : fallback;
}

export function versionToDraft(program: ProgramDetail, version: ProgramVersion): ProgramDraftInput {
  const en = translation(version, "EN");
  const ar = translation(version, "AR");
  const cardLocales: ServerCardLocale[] = version.cardLocales?.length
    ? version.cardLocales
    : [
        ...(en
          ? [
              {
                ...en,
                id: "legacy-en",
                locale: "en",
                enabled: true,
                position: 0,
                rewardTranslations: [],
              },
            ]
          : []),
        ...(ar
          ? [
              {
                ...ar,
                id: "legacy-ar",
                locale: "ar",
                enabled: true,
                position: 1,
                rewardTranslations: [],
              },
            ]
          : []),
      ];
  const cardTranslations = Object.fromEntries(
    cardLocales.map((item) => [
      item.locale,
      {
        programName: item.programName ?? program.internalName,
        shortDescription: item.shortDescription ?? "",
        fullDescription: item.fullDescription ?? undefined,
        rewardSummary: item.rewardSummary ?? "",
        joinInstructions: item.joinInstructions ?? undefined,
        termsAndConditions: item.termsAndConditions ?? "",
        completionMessage: item.completionMessage ?? "",
        rewardUnlockedMessage: item.rewardUnlockedMessage ?? "",
        pausedMessage: item.pausedMessage ?? undefined,
      },
    ]),
  ) as ProgramTranslationMap;
  cardTranslations.en ??= {
    programName: program.internalName,
    shortDescription: "",
    rewardSummary: "",
    termsAndConditions: "",
    completionMessage: "",
    rewardUnlockedMessage: "",
  };
  cardTranslations.ar ??= {
    programName: program.internalName,
    shortDescription: "",
    rewardSummary: "",
    termsAndConditions: "",
    completionMessage: "",
    rewardUnlockedMessage: "",
  };
  const visual = version.visualTheme;
  const apple = visual?.applePreviewConfig ?? {};
  const google = visual?.googlePreviewConfig ?? {};
  return {
    internalName: program.internalName,
    defaultLocale: version.defaultCardLocale ?? "en",
    enabledLocales: cardLocales.filter((item) => item.enabled).map((item) => item.locale),
    editingMode: version.editingMode.toLowerCase() as EditingMode,
    templateCode: version.baseTemplateCode ?? undefined,
    templateVersion: version.baseTemplateVersion ?? undefined,
    requiredStampCount: version.stampRule?.requiredStampCount ?? 8,
    operationalTimezone: version.operationalTimezone ?? "Asia/Baghdad",
    maximumStampsPerOperation: version.stampRule?.maximumStampsPerOperation ?? 5,
    maximumStampsPerCustomerPerDay: version.stampRule?.maximumStampsPerCustomerPerDay ?? null,
    minimumPurchaseAmountMinor: version.stampRule?.minimumPurchaseAmountMinor ?? null,
    minimumPurchaseCurrency: version.stampRule?.minimumPurchaseCurrency ?? null,
    staffOwnReversalWindowSeconds: version.staffOwnReversalWindowSeconds ?? 120,
    managerReversalWindowMinutes: version.managerReversalWindowMinutes ?? 1440,
    managerOverrideAllowed: version.managerOverrideAllowed ?? true,
    resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
    earningDescription: version.stampRule?.earningDescription ?? "One stamp per qualifying visit.",
    locationIds: version.locations.map((item) => item.locationId),
    translations: cardTranslations,
    rewards: version.rewards.map((reward) => ({
      clientId: reward.id,
      thresholdStampCount: reward.thresholdStampCount,
      rewardType: reward.rewardType,
      internalName: reward.internalName,
      sortOrder: reward.sortOrder,
      validityDurationDays: reward.validityDurationDays,
      requiresManagerApproval: reward.requiresManagerApproval,
      maximumRedemptionsPerEarned: reward.maximumRedemptionsPerEarned,
      visualOverride: reward.visualOverride
        ? {
            stampAssetId: reward.visualOverride.stampAssetId,
            accentOverride: reward.visualOverride.accentOverride,
          }
        : undefined,
      translations: cardRewardTranslations(reward, cardLocales),
    })),
    visualTheme: {
      backgroundColor: visual?.backgroundColor ?? "#F7F4EE",
      foregroundColor: visual?.foregroundColor ?? "#222222",
      accentColor: visual?.accentColor ?? "#E4572E",
      secondaryColor: visual?.secondaryColor ?? "#F3A712",
      mutedColor: visual?.mutedColor ?? "#6B7280",
      filledStampAssetId: visual?.filledStampAssetId,
      emptyStampAssetId: visual?.emptyStampAssetId,
      logoAssetId: visual?.logoAssetId,
      heroAssetId: visual?.heroAssetId,
      backgroundAssetId: visual?.backgroundAssetId,
      defaultMilestoneAssetId: visual?.defaultMilestoneAssetId,
      layoutType: visual?.layoutType ?? "GRID",
      layoutConfiguration: (visual?.layoutConfiguration ??
        {}) as ProgramDraftInput["visualTheme"]["layoutConfiguration"],
      stampSize: visual?.stampSize ?? 48,
      stampSpacing: visual?.stampSpacing ?? 8,
      borderRadius: visual?.borderRadius ?? 18,
      progressLabelVisible: visual?.progressLabelVisible ?? true,
      rewardLabelVisible: visual?.rewardLabelVisible ?? true,
      customerWebVariant: visual?.customerWebVariant ?? "CARD",
      applePreviewConfig: {
        headerLabel: stringConfig(apple, "headerLabel", "REWARDS"),
        headerValue: stringConfig(apple, "headerValue", program.internalName),
        secondaryLabel: stringConfig(apple, "secondaryLabel", "NEXT REWARD"),
        barcodeLabel: stringConfig(apple, "barcodeLabel", "Preview barcode"),
        showBackContent: booleanConfig(apple, "showBackContent", true),
      },
      googlePreviewConfig: {
        title: stringConfig(google, "title", en?.programName ?? program.internalName),
        subtitle: stringConfig(google, "subtitle", en?.shortDescription ?? ""),
        detailsLabel: stringConfig(google, "detailsLabel", "Reward progress"),
        barcodeLabel: stringConfig(google, "barcodeLabel", "Preview barcode"),
      },
    },
    changeSummary: version.changeSummary ?? undefined,
  };
}

function resolveTemplate(template: string | ProgramTemplateDefinition): ProgramTemplateDefinition {
  const resolved = typeof template === "string" ? findProgramTemplate(template) : template;
  if (!resolved) throw new Error(`Program template ${template} is not available.`);
  return resolved;
}

export const templateReplacementFields = [
  "stamp goal and earning rule",
  "English and Arabic customer copy",
  "reward definitions",
  "colors and stamp artwork",
  "layout and platform preview defaults",
] as const;

export function createQuickDraft(
  templateInput: string | ProgramTemplateDefinition,
  mode: EditingMode = "quick",
): ProgramDraftInput {
  const template = resolveTemplate(templateInput);
  const templateRewards = [...(mode === "pro" ? template.milestones : []), template.finalReward];
  return {
    internalName: "",
    defaultLocale: "en",
    enabledLocales: ["en"],
    editingMode: mode,
    templateCode: template.code,
    templateVersion: template.version,
    requiredStampCount: template.recommendedStampGoal,
    operationalTimezone: "Asia/Baghdad",
    maximumStampsPerOperation: 5,
    maximumStampsPerCustomerPerDay: null,
    minimumPurchaseAmountMinor: null,
    minimumPurchaseCurrency: null,
    staffOwnReversalWindowSeconds: 120,
    managerReversalWindowMinutes: 1440,
    managerOverrideAllowed: true,
    resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
    earningDescription: template.earningDescription,
    locationIds: [],
    translations: structuredClone(template.copy),
    rewards: templateRewards.map((reward, index) => ({
      clientId: crypto.randomUUID(),
      thresholdStampCount: reward.thresholdStampCount,
      rewardType: reward.rewardType,
      internalName: reward.internalName,
      sortOrder: index,
      validityDurationDays: reward.validityDurationDays,
      requiresManagerApproval: reward.requiresManagerApproval,
      maximumRedemptionsPerEarned: reward.maximumRedemptionsPerEarned,
      translations: structuredClone(reward.translations),
    })),
    visualTheme: {
      backgroundColor: template.colors.background,
      foregroundColor: template.colors.foreground,
      accentColor: template.colors.accent,
      secondaryColor: template.colors.secondary,
      mutedColor: template.colors.muted,
      layoutType: template.layout.type,
      layoutConfiguration: structuredClone(template.layout.configuration),
      stampSize: template.layout.stampSize,
      stampSpacing: template.layout.stampSpacing,
      borderRadius: 18,
      progressLabelVisible: true,
      rewardLabelVisible: true,
      customerWebVariant: template.customerWeb.variant,
      applePreviewConfig: structuredClone(template.apple),
      googlePreviewConfig: structuredClone(template.google),
    },
  };
}

export function applyTemplateToDraft(
  template: ProgramTemplateDefinition,
  current: ProgramDraftInput,
): ProgramDraftInput {
  const replacement = createQuickDraft(template, current.editingMode);
  return {
    ...replacement,
    internalName: current.internalName,
    locationIds: [...current.locationIds],
  };
}

export function apiDraft(input: ProgramDraftInput) {
  return {
    ...input,
    rewards: input.rewards.map(({ clientId: _clientId, ...reward }) => reward),
  };
}

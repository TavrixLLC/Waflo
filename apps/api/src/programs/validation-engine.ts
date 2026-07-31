import { programPlatformCapabilities } from "@waflo/contracts";

export type ValidationPlatform =
  | "GENERAL"
  | "CUSTOMER_WEB"
  | "APPLE_WALLET"
  | "GOOGLE_WALLET"
  | "TEST_MODE";

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  platform: ValidationPlatform;
  message: string;
  suggestedAction: string;
}

export interface ValidationEngineInput {
  plan: "STARTER" | "GROWTH" | "SCALE";
  goal: number;
  translations: Array<{
    locale: "EN" | "AR";
    programName: string;
    shortDescription: string;
    rewardSummary: string;
    termsAndConditions: string;
    completionMessage: string;
    rewardUnlockedMessage: string;
  }>;
  rewards: Array<{
    thresholdStampCount: number;
    maximumRedemptionsPerEarned: number;
    validityDurationDays: number | null;
    stampAsset: { category: string; processingStatus: string } | null;
  }>;
  operationalPolicy?: {
    operationalTimezone: string;
    maximumStampsPerOperation: number;
    maximumStampsPerCustomerPerDay: number | null;
    minimumPurchaseAmountMinor: number | null;
    minimumPurchaseCurrency: string | null;
    staffOwnReversalWindowSeconds: number;
    managerReversalWindowMinutes: number;
    managerOverrideAllowed: boolean;
    resetBehaviorAfterReward: string;
  };
  locations: Array<{ status: string }>;
  visual: {
    backgroundColor: string;
    foregroundColor: string;
    accentColor: string;
    layoutType: "ROW" | "GRID" | "PATH" | "RING";
    stampSize: number;
    stampSpacing: number;
    applePreviewConfig: unknown;
    googlePreviewConfig: unknown;
    assets: Array<{
      role: string;
      expectedCategory: string;
      asset: { category: string; processingStatus: string } | null;
      required: boolean;
    }>;
  } | null;
  expectedFingerprint: string;
  renderFingerprint: string | null;
  previewProfiles: string[];
  completedTestSessions: Array<{
    versionRevision: number;
    validationFingerprint: string | null;
  }>;
  versionRevision: number;
}

function issue(
  code: string,
  severity: "error" | "warning",
  path: string,
  platform: ValidationPlatform,
  message: string,
  suggestedAction: string,
): ValidationIssue {
  return { code, severity, path, platform, message, suggestedAction };
}

function rgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const color = rgb(hex);
  if (!color) return 0;
  const components = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = components;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const light = Math.max(firstLuminance, secondLuminance);
  const dark = Math.min(firstLuminance, secondLuminance);
  return (light + 0.05) / (dark + 0.05);
}

export function validateProgramConfiguration(input: ValidationEngineInput): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const policy = input.operationalPolicy ?? {
    operationalTimezone: "UTC",
    maximumStampsPerOperation: 5,
    maximumStampsPerCustomerPerDay: null,
    minimumPurchaseAmountMinor: null,
    minimumPurchaseCurrency: null,
    staffOwnReversalWindowSeconds: 120,
    managerReversalWindowMinutes: 1_440,
    managerOverrideAllowed: false,
    resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
  };
  if (!Number.isInteger(input.goal) || input.goal < 2 || input.goal > 30)
    issues.push(
      issue(
        "STAMP_GOAL_INVALID",
        "error",
        "earningRules.requiredStampCount",
        "GENERAL",
        "Stamp goal must be between 2 and 30.",
        "Choose a goal from 2 to 30.",
      ),
    );

  let timezoneValid = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: policy.operationalTimezone }).format(new Date(0));
    timezoneValid = policy.operationalTimezone.trim().length > 0;
  } catch {
    timezoneValid = false;
  }
  if (!timezoneValid)
    issues.push(
      issue(
        "OPERATIONAL_TIMEZONE_INVALID",
        "error",
        "policies.operationalTimezone",
        "GENERAL",
        "Choose a valid IANA operational timezone.",
        "Select the timezone used to calculate daily limits and analytics days.",
      ),
    );
  if (
    !Number.isInteger(policy.maximumStampsPerOperation) ||
    policy.maximumStampsPerOperation < 1 ||
    policy.maximumStampsPerOperation > 30
  )
    issues.push(
      issue(
        "MAXIMUM_STAMPS_PER_OPERATION_INVALID",
        "error",
        "policies.maximumStampsPerOperation",
        "GENERAL",
        "The per-operation stamp limit must be between 1 and 30.",
        "Choose a whole-number operation limit.",
      ),
    );
  if (
    policy.maximumStampsPerCustomerPerDay !== null &&
    (!Number.isInteger(policy.maximumStampsPerCustomerPerDay) ||
      policy.maximumStampsPerCustomerPerDay < 1 ||
      policy.maximumStampsPerCustomerPerDay > 1000)
  )
    issues.push(
      issue(
        "DAILY_STAMP_LIMIT_INVALID",
        "error",
        "policies.maximumStampsPerCustomerPerDay",
        "GENERAL",
        "The daily stamp limit must be between 1 and 1,000.",
        "Choose a whole-number daily limit or turn the limit off.",
      ),
    );
  if ((policy.minimumPurchaseAmountMinor === null) !== (policy.minimumPurchaseCurrency === null))
    issues.push(
      issue(
        "MINIMUM_PURCHASE_INCOMPLETE",
        "error",
        "policies.minimumPurchase",
        "GENERAL",
        "Minimum purchase amount and currency must be enabled together.",
        "Enter both values or turn minimum purchase off.",
      ),
    );
  if (
    policy.minimumPurchaseAmountMinor !== null &&
    (!Number.isInteger(policy.minimumPurchaseAmountMinor) || policy.minimumPurchaseAmountMinor < 0)
  )
    issues.push(
      issue(
        "MINIMUM_PURCHASE_AMOUNT_INVALID",
        "error",
        "policies.minimumPurchaseAmountMinor",
        "GENERAL",
        "Minimum purchase must use a non-negative whole number of minor currency units.",
        "Enter the amount in minor units without a decimal.",
      ),
    );
  if (policy.minimumPurchaseCurrency !== null && !/^[A-Z]{3}$/.test(policy.minimumPurchaseCurrency))
    issues.push(
      issue(
        "MINIMUM_PURCHASE_CURRENCY_INVALID",
        "error",
        "policies.minimumPurchaseCurrency",
        "GENERAL",
        "Minimum purchase currency must be a three-letter uppercase code.",
        "Use a code such as IQD, USD, or EUR.",
      ),
    );
  if (
    !Number.isInteger(policy.staffOwnReversalWindowSeconds) ||
    policy.staffOwnReversalWindowSeconds < 15 ||
    policy.staffOwnReversalWindowSeconds > 900
  )
    issues.push(
      issue(
        "STAFF_REVERSAL_WINDOW_INVALID",
        "error",
        "policies.staffOwnReversalWindowSeconds",
        "GENERAL",
        "The staff reversal window must be between 15 and 900 seconds.",
        "Choose a whole-number staff reversal window.",
      ),
    );
  if (
    !Number.isInteger(policy.managerReversalWindowMinutes) ||
    policy.managerReversalWindowMinutes < 1 ||
    policy.managerReversalWindowMinutes > 10080
  )
    issues.push(
      issue(
        "MANAGER_REVERSAL_WINDOW_INVALID",
        "error",
        "policies.managerReversalWindowMinutes",
        "GENERAL",
        "The manager reversal window must be between 1 minute and 7 days.",
        "Choose a whole-number manager reversal window.",
      ),
    );
  if (policy.resetBehaviorAfterReward !== "RESET_ON_FINAL_REWARD_REDEMPTION")
    issues.push(
      issue(
        "FINAL_REWARD_RESET_POLICY_INVALID",
        "error",
        "policies.resetBehaviorAfterReward",
        "GENERAL",
        "Final reward progress must reset only after successful redemption.",
        "Use the locked launch reset policy.",
      ),
    );

  for (const locale of ["EN", "AR"] as const) {
    const translation = input.translations.find((item) => item.locale === locale);
    if (
      !translation?.programName.trim() ||
      !translation.shortDescription.trim() ||
      !translation.rewardSummary.trim() ||
      !translation.termsAndConditions.trim() ||
      !translation.completionMessage.trim() ||
      !translation.rewardUnlockedMessage.trim()
    )
      issues.push(
        issue(
          "TRANSLATION_REQUIRED",
          "error",
          `content.${locale.toLowerCase()}`,
          "CUSTOMER_WEB",
          `${locale} customer content is incomplete.`,
          `Complete every required ${locale} content field.`,
        ),
      );
  }

  if (!input.rewards.length)
    issues.push(
      issue(
        "REWARD_REQUIRED",
        "error",
        "rewards",
        "GENERAL",
        "At least one reward is required.",
        "Add a final reward at the stamp goal.",
      ),
    );
  const thresholds = input.rewards.map((reward) => reward.thresholdStampCount);
  if (new Set(thresholds).size !== thresholds.length)
    issues.push(
      issue(
        "REWARD_THRESHOLD_DUPLICATE",
        "error",
        "rewards",
        "GENERAL",
        "Reward thresholds must be unique.",
        "Move one of the rewards to a different stamp position.",
      ),
    );
  if (input.rewards.some((reward) => reward.thresholdStampCount > input.goal))
    issues.push(
      issue(
        "REWARD_AFTER_GOAL",
        "error",
        "rewards",
        "GENERAL",
        "A reward threshold cannot be after the stamp goal.",
        "Move every reward to or before the final stamp.",
      ),
    );
  if (
    input.rewards.length &&
    !input.rewards.some((reward) => reward.thresholdStampCount === input.goal)
  )
    issues.push(
      issue(
        "FINAL_REWARD_REQUIRED",
        "error",
        "rewards",
        "GENERAL",
        "The program needs a final reward at the stamp goal.",
        "Add or move a reward to the final stamp.",
      ),
    );
  if (input.plan === "STARTER" && input.rewards.length > 1)
    issues.push(
      issue(
        "MULTIPLE_REWARDS_PLAN_REQUIRED",
        "error",
        "rewards",
        "GENERAL",
        "Multiple rewards require Growth or Scale.",
        "Remove milestone rewards or upgrade the plan.",
      ),
    );
  if (
    input.plan === "STARTER" &&
    input.rewards.some((reward) => reward.thresholdStampCount < input.goal)
  )
    issues.push(
      issue(
        "MILESTONE_PLAN_REQUIRED",
        "error",
        "rewards",
        "GENERAL",
        "Milestone rewards require Growth or Scale.",
        "Remove milestones or upgrade the plan.",
      ),
    );
  if (input.rewards.some((reward) => reward.maximumRedemptionsPerEarned < 1))
    issues.push(
      issue(
        "REWARD_REDEMPTION_LIMIT_INVALID",
        "error",
        "rewards",
        "TEST_MODE",
        "Each reward needs at least one redemption per earned unlock.",
        "Set the redemption allowance to at least one.",
      ),
    );
  const finalRewards = input.rewards.filter((reward) => reward.thresholdStampCount === input.goal);
  if (
    finalRewards.some(
      (reward) => reward.maximumRedemptionsPerEarned !== 1 || reward.validityDurationDays !== null,
    )
  )
    issues.push(
      issue(
        "FINAL_REWARD_LAUNCH_POLICY_INVALID",
        "error",
        "rewards",
        "GENERAL",
        "The final reward must allow one redemption and must not expire at launch.",
        "Set final reward redemptions to 1 and remove its validity duration.",
      ),
    );

  if (!input.locations.length || input.locations.some((location) => location.status !== "ACTIVE"))
    issues.push(
      issue(
        "ACTIVE_LOCATION_REQUIRED",
        "error",
        "locations",
        "GENERAL",
        "Select at least one currently active location.",
        "Open Locations and select active locations only.",
      ),
    );

  if (!input.visual) {
    issues.push(
      issue(
        "VISUAL_THEME_REQUIRED",
        "error",
        "visualIdentity",
        "CUSTOMER_WEB",
        "Visual identity is required.",
        "Choose colors and stamp artwork.",
      ),
    );
  } else {
    for (const role of input.visual.assets) {
      if (role.required && !role.asset)
        issues.push(
          issue(
            "ASSET_REQUIRED",
            "error",
            `artwork.${role.role}`,
            "CUSTOMER_WEB",
            `${role.role} artwork is required.`,
            `Choose a ready ${role.expectedCategory} asset.`,
          ),
        );
      if (
        role.asset &&
        (role.asset.processingStatus !== "READY" || role.asset.category !== role.expectedCategory)
      )
        issues.push(
          issue(
            "ASSET_ROLE_OR_READINESS_INVALID",
            "error",
            `artwork.${role.role}`,
            "CUSTOMER_WEB",
            `${role.role} must use a ready ${role.expectedCategory} asset.`,
            "Replace the asset with one that finished processing for this role.",
          ),
        );
    }
    const background = input.visual.assets.find((role) => role.role === "background");
    if (background?.asset) {
      issues.push(
        issue(
          "APPLE_BACKGROUND_ARTWORK_UNSUPPORTED",
          "warning",
          "applePreview.backgroundArtwork",
          "APPLE_WALLET",
          programPlatformCapabilities.APPLE_WALLET.backgroundArtwork.explanation,
          "Review the Apple preview; pass colors are used instead of the selected background.",
        ),
        issue(
          "GOOGLE_BACKGROUND_ARTWORK_UNSUPPORTED",
          "warning",
          "googlePreview.backgroundArtwork",
          "GOOGLE_WALLET",
          programPlatformCapabilities.GOOGLE_WALLET.backgroundArtwork.explanation,
          "Use hero artwork for Google or keep the background for Customer Web only.",
        ),
      );
    }
    const hero = input.visual.assets.find((role) => role.role === "hero");
    if (hero?.asset)
      issues.push(
        issue(
          "APPLE_HERO_ARTWORK_UNSUPPORTED",
          "warning",
          "applePreview.heroArtwork",
          "APPLE_WALLET",
          programPlatformCapabilities.APPLE_WALLET.heroArtwork.explanation,
          "Review the Apple preview; the hero is used by Customer Web and Google only.",
        ),
      );
    if (contrastRatio(input.visual.foregroundColor, input.visual.backgroundColor) < 4.5)
      issues.push(
        issue(
          "COLOR_CONTRAST_LOW",
          "error",
          "visualIdentity.foregroundColor",
          "CUSTOMER_WEB",
          "Foreground and background colors do not meet readable contrast.",
          "Choose colors with a contrast ratio of at least 4.5:1.",
        ),
      );
    if (contrastRatio(input.visual.accentColor, input.visual.backgroundColor) < 3)
      issues.push(
        issue(
          "EMPTY_STAMP_VISIBILITY_LOW",
          "warning",
          "visualIdentity.accentColor",
          "CUSTOMER_WEB",
          "Empty-stamp edges may be hard to distinguish.",
          "Increase contrast between the accent and background colors.",
        ),
      );
    if (input.visual.layoutType === "RING" && input.goal > 20)
      issues.push(
        issue(
          "RING_LAYOUT_DENSE",
          "warning",
          "stampLayout",
          "CUSTOMER_WEB",
          "Ring layouts become dense above 20 stamps.",
          "Use Grid or Path, or lower the stamp goal.",
        ),
      );
    if (input.visual.layoutType === "PATH" && input.goal < 3)
      issues.push(
        issue(
          "PATH_LAYOUT_TOO_SHORT",
          "error",
          "stampLayout",
          "CUSTOMER_WEB",
          "Path layout requires at least three stamps.",
          "Increase the stamp goal or use Row.",
        ),
      );
    if (input.visual.stampSize + input.visual.stampSpacing > 112)
      issues.push(
        issue(
          "STAMP_LAYOUT_SPACING_DENSE",
          "warning",
          "stampLayout.stampSpacing",
          "CUSTOMER_WEB",
          "Large stamps and spacing may overflow narrow screens.",
          "Reduce stamp size or spacing.",
        ),
      );
  }

  const english = input.translations.find((translation) => translation.locale === "EN");
  if ((english?.programName.length ?? 0) > 32 || (english?.rewardSummary.length ?? 0) > 64)
    issues.push(
      issue(
        "APPLE_TEXT_LIMIT",
        "warning",
        "applePreview",
        "APPLE_WALLET",
        "Apple preview fields may truncate.",
        "Shorten the English program name or reward summary.",
      ),
    );
  if ((english?.shortDescription.length ?? 0) > 64)
    issues.push(
      issue(
        "GOOGLE_TEXT_LIMIT",
        "warning",
        "googlePreview",
        "GOOGLE_WALLET",
        "Google preview subtitle may truncate.",
        "Shorten the English description.",
      ),
    );
  if (input.renderFingerprint !== input.expectedFingerprint)
    issues.push(
      issue(
        "PREVIEW_STALE",
        "error",
        "customerWebPreview",
        "CUSTOMER_WEB",
        "The stored previews do not match the latest draft revision.",
        "Open each preview after the latest edit, then validate again.",
      ),
    );
  for (const profile of ["CUSTOMER_WEB_CARD", "APPLE_WALLET_PREVIEW", "GOOGLE_WALLET_PREVIEW"]) {
    if (!input.previewProfiles.includes(profile))
      issues.push(
        issue(
          "PREVIEW_PROFILE_MISSING",
          "error",
          profile === "APPLE_WALLET_PREVIEW"
            ? "applePreview"
            : profile === "GOOGLE_WALLET_PREVIEW"
              ? "googlePreview"
              : "customerWebPreview",
          profile === "APPLE_WALLET_PREVIEW"
            ? "APPLE_WALLET"
            : profile === "GOOGLE_WALLET_PREVIEW"
              ? "GOOGLE_WALLET"
              : "CUSTOMER_WEB",
          "This preview profile has not been generated for the latest draft.",
          "Open this preview after the latest edit.",
        ),
      );
  }
  if (
    input.completedTestSessions.some(
      (session) =>
        session.versionRevision !== input.versionRevision ||
        session.validationFingerprint !== input.expectedFingerprint,
    )
  )
    issues.push(
      issue(
        "TEST_MODE_FINGERPRINT_STALE",
        "warning",
        "testMode",
        "TEST_MODE",
        "An older completed Test Mode journey no longer matches this draft.",
        "Run Test Mode again after validation.",
      ),
    );

  return {
    errors: issues.filter((item) => item.severity === "error"),
    warnings: issues.filter((item) => item.severity === "warning"),
  };
}

import type { ProgramOperationalStatus } from "@waflo/contracts";
import { localeRegistry, type InterfaceLocale } from "@waflo/i18n";

export const studioAreas = [
  "overview",
  "how-it-works",
  "customers-locations",
  "launch",
  "engagement",
  "settings",
] as const;

export type StudioArea = (typeof studioAreas)[number];

export type StudioOperationErrorContext =
  | "load"
  | "save"
  | "preview"
  | "readiness"
  | "lifecycle"
  | "create-draft";

function studioText(locale: InterfaceLocale) {
  return localeRegistry[locale].messages.merchant.loyalty.studio;
}

export function studioOperationError(
  context: StudioOperationErrorContext,
  locale: InterfaceLocale,
): string {
  const key = context === "create-draft" ? "createDraft" : context;
  return studioText(locale).operationErrors[key];
}

const studioAreaMessageKeys = {
  overview: "overview",
  "how-it-works": "howItWorks",
  "customers-locations": "customersLocations",
  engagement: "engagement",
  launch: "launch",
  settings: "settings",
} as const;

export function studioArea(
  locale: InterfaceLocale,
  area: StudioArea,
): { label: string; description: string } {
  return studioText(locale).areas[studioAreaMessageKeys[area]];
}

export function studioAreaForValidationPath(path: string): StudioArea {
  if (path.startsWith("earning") || path.startsWith("rewards") || path.startsWith("policies"))
    return "how-it-works";
  if (path.startsWith("locations") || path.startsWith("enrollment")) return "customers-locations";
  if (
    path.startsWith("content") ||
    path.startsWith("artwork") ||
    path.startsWith("visual") ||
    path.startsWith("stampLayout") ||
    path.startsWith("apple") ||
    path.startsWith("google")
  )
    return "overview";
  return "launch";
}

export function studioAreaForPublicationError(code: string): StudioArea {
  if (code === "PROGRAM_PUBLICATION_LOCATION_STALE") return "customers-locations";
  if (code === "PROGRAM_TEST_REQUIRED") return "launch";
  if (code === "PROGRAM_PUBLICATION_ASSET_STALE" || code === "PROGRAM_PUBLICATION_PREVIEW_STALE")
    return "overview";
  return "launch";
}

export interface MerchantStudioState {
  key: "draft" | "ready" | "live" | "paused" | "archived" | "scheduled" | "suspended";
  label: string;
  description: string;
  tone: "neutral" | "brand" | "success" | "warning" | "danger";
}

export type StudioJourneyStageState =
  | "complete"
  | "current"
  | "pending"
  | "blocked"
  | "paused"
  | "archived";

export type StudioPresentationAction =
  | { kind: "navigate"; label: string; area: StudioArea }
  | {
      kind: "lifecycle";
      label: string;
      action: "pause" | "resume" | "archive" | "restore";
    }
  | { kind: "publish" | "run-checks"; label: string };

export interface StudioJourneyStagePresentation {
  key: "design" | "checks" | "live";
  label: string;
  hint: string;
  state: StudioJourneyStageState;
  stateLabel: string;
  area: StudioArea;
}

export interface StudioLaunchRequirementPresentation {
  key: "automated" | "locations" | "plan";
  label: string;
  status: string;
  description: string;
  complete: boolean;
  blocking: boolean;
  action?: StudioPresentationAction | undefined;
}

export interface StudioLifecyclePresentation extends MerchantStudioState {
  guidance: {
    title: string;
    description: string;
    tone: MerchantStudioState["tone"];
  };
  journeyStages: StudioJourneyStagePresentation[];
  currentJourneyStage: StudioJourneyStagePresentation["key"];
  primaryAction: StudioPresentationAction;
  secondaryAction?: StudioPresentationAction;
  launch: {
    label: string;
    description: string;
    tone: MerchantStudioState["tone"];
    ready: boolean;
    canPublish: boolean;
    disabledReason?: string;
    action: StudioPresentationAction;
    requirements: StudioLaunchRequirementPresentation[];
  };
  capabilities: {
    canPublish: boolean;
    canPause: boolean;
    canResume: boolean;
    canRestore: boolean;
    canArchive: boolean;
  };
}

export interface StudioLifecyclePresentationInput {
  programStatus: ProgramOperationalStatus;
  draftVersionStatus: string | null;
  locale: InterfaceLocale;
  validationState: "not-run" | "passed" | "failed";
  designComplete: boolean;
  locationsReady: boolean;
  hasPublishedVersion: boolean;
  hasUnpublishedChanges?: boolean | undefined;
  publicationAllowed: boolean;
  planName: "STARTER" | "GROWTH" | "SCALE";
  validationIssues?: ReadonlyArray<{ code: string; path: string }> | undefined;
}

function lifecycleKey(
  programStatus: ProgramOperationalStatus,
  draftVersionStatus: string | null,
): MerchantStudioState["key"] {
  if (programStatus === "PUBLISHED") return "live";
  if (programStatus === "PAUSED") return "paused";
  if (programStatus === "ARCHIVED") return "archived";
  if (programStatus === "SCHEDULED") return "scheduled";
  if (programStatus === "SUSPENDED") return "suspended";
  if (draftVersionStatus === "VALIDATED" || draftVersionStatus === "TEST_READY") return "ready";
  return "draft";
}

function presentationAction(
  key: MerchantStudioState["key"],
  checksComplete: boolean,
  designComplete: boolean,
  locationsReady: boolean,
  locale: InterfaceLocale,
): { primary: StudioPresentationAction; secondary?: StudioPresentationAction } {
  const ar = locale === "ar";
  if (key === "live")
    return {
      primary: {
        kind: "navigate",
        area: "customers-locations",
        label: ar ? "عرض العملاء والمواقع" : "View customers",
      },
      secondary: {
        kind: "lifecycle",
        action: "pause",
        label: ar ? "إيقاف البطاقة مؤقتاً" : "Pause card",
      },
    };
  if (key === "paused")
    return {
      primary: {
        kind: "lifecycle",
        action: "resume",
        label: ar ? "استئناف البطاقة" : "Resume card",
      },
      secondary: {
        kind: "navigate",
        area: "settings",
        label: ar ? "مراجعة الإعدادات" : "Review settings",
      },
    };
  if (key === "archived")
    return {
      primary: {
        kind: "lifecycle",
        action: "restore",
        label: ar ? "استعادة البطاقة" : "Restore card",
      },
      secondary: {
        kind: "navigate",
        area: "settings",
        label: ar ? "عرض سجل التغييرات" : "View change history",
      },
    };
  if (key === "scheduled")
    return {
      primary: {
        kind: "navigate",
        area: "launch",
        label: ar ? "عرض جدول الإطلاق" : "View launch schedule",
      },
    };
  if (key === "suspended")
    return {
      primary: {
        kind: "navigate",
        area: "settings",
        label: ar ? "عرض حالة البطاقة" : "View card status",
      },
    };
  if (!designComplete)
    return {
      primary: {
        kind: "navigate",
        area: "overview",
        label: ar ? "مراجعة تصميم البطاقة" : "Review card design",
      },
    };
  if (!locationsReady)
    return {
      primary: {
        kind: "navigate",
        area: "customers-locations",
        label: ar ? "اختيار المواقع" : "Choose locations",
      },
    };
  if (!checksComplete)
    return {
      primary: {
        kind: "run-checks",
        label: ar ? "تشغيل فحوصات الجاهزية" : "Run readiness checks",
      },
    };
  return {
    primary: {
      kind: "navigate",
      area: "launch",
      label: ar ? "مراجعة الإطلاق" : "Review launch",
    },
  };
}

function guidanceFor(
  key: MerchantStudioState["key"],
  designComplete: boolean,
  locationsReady: boolean,
  locale: InterfaceLocale,
): StudioLifecyclePresentation["guidance"] {
  const ar = locale === "ar";
  if (key === "live")
    return {
      title: ar ? "بطاقة الولاء مباشرة" : "Your loyalty card is live",
      description: ar
        ? "يمكن للعملاء استخدام هذه البطاقة حالياً في المواقع المشاركة."
        : "Customers can currently use this card at participating locations.",
      tone: "success",
    };
  if (key === "paused")
    return {
      title: ar ? "بطاقة الولاء متوقفة مؤقتاً" : "Your loyalty card is paused",
      description: ar
        ? "استأنفها عندما تكون مستعداً لإتاحتها مرة أخرى."
        : "Resume it when you are ready to make it available again.",
      tone: "warning",
    };
  if (key === "archived")
    return {
      title: ar ? "بطاقة الولاء مؤرشفة" : "This loyalty card is archived",
      description: ar
        ? "استعدها لمتابعة إدارة إعداد البطاقة المحفوظ أو استخدامه."
        : "Restore it to continue managing or using the saved card setup.",
      tone: "neutral",
    };
  if (key === "scheduled")
    return {
      title: ar ? "البطاقة مجدولة للإطلاق" : "Your loyalty card is scheduled",
      description: ar
        ? "راجع حالة الإطلاق المجدول الحالية."
        : "Review the existing scheduled launch status.",
      tone: "brand",
    };
  if (key === "suspended")
    return {
      title: ar ? "البطاقة غير متاحة مؤقتاً" : "Your loyalty card is temporarily unavailable",
      description: ar
        ? "راجع الحالة الحالية؛ لا تنشئ هذه الشاشة انتقالاً جديداً للحالة."
        : "Review the current status; this screen does not create a new lifecycle transition.",
      tone: "danger",
    };
  if (key === "ready")
    return {
      title: ar ? "جاهزة للإطلاق" : "Ready to launch",
      description: ar ? "راجع بطاقة الولاء وانشرها." : "Review and publish your loyalty card.",
      tone: "brand",
    };
  if (!designComplete)
    return {
      title: ar ? "يحتاج إعداد البطاقة إلى متابعة" : "Card setup needs attention",
      description: ar ? "التالي: راجع تصميم البطاقة" : "Next: Review card design",
      tone: "brand",
    };
  if (!locationsReady)
    return {
      title: ar ? "مطلوب موقع مشارك" : "A participating location is required",
      description: ar ? "التالي: اختر موقعاً نشطاً" : "Next: Choose an active location",
      tone: "brand",
    };
  return {
    title: ar ? "اكتمل تصميم البطاقة" : "Card design complete",
    description: ar ? "التالي: شغّل فحوصات الجاهزية" : "Next: Run readiness checks",
    tone: "brand",
  };
}

function launchRequirements(
  input: StudioLifecyclePresentationInput,
  checksComplete: boolean,
): { requirements: StudioLaunchRequirementPresentation[]; planBlocked: boolean } {
  const ar = input.locale === "ar";
  const planBlocked = (input.validationIssues ?? []).some((issue) =>
    /PLAN|LIMIT|STARTER|GROWTH|SCALE/iu.test(`${issue.code} ${issue.path}`),
  );
  const automatedBlocked = input.validationState === "failed";
  return {
    planBlocked,
    requirements: [
      {
        key: "automated",
        label: ar ? "الفحوصات الآلية" : "Automated checks",
        status: checksComplete
          ? ar
            ? "ناجحة"
            : "Passed"
          : ar
            ? "تحتاج متابعة"
            : "Needs attention",
        description: checksComplete
          ? ar
            ? "اكتملت فحوصات الإعداد والأصول والمعاينات."
            : "Setup, asset, and preview checks passed."
          : automatedBlocked
            ? ar
              ? "توجد عناصر تمنع الإطلاق. افتح التفاصيل لإصلاحها."
              : "Launch blockers need to be fixed in the check details."
            : ar
              ? "شغّل الفحوصات الآلية قبل النشر."
              : "Run the automated checks before publishing.",
        complete: checksComplete,
        blocking: !checksComplete,
        action: checksComplete
          ? undefined
          : { kind: "run-checks", label: ar ? "تشغيل الفحوصات" : "Run checks" },
      },
      {
        key: "locations",
        label: ar ? "المواقع المشاركة" : "Participating locations",
        status: input.locationsReady
          ? ar
            ? "جاهزة"
            : "Ready"
          : ar
            ? "تمنع الإطلاق"
            : "Blocks launch",
        description: input.locationsReady
          ? ar
            ? "تم اختيار موقع نشط واحد على الأقل."
            : "At least one active location is selected."
          : ar
            ? "اختر موقعاً نشطاً واحداً على الأقل."
            : "Choose at least one active participating location.",
        complete: input.locationsReady,
        blocking: !input.locationsReady,
        action: input.locationsReady
          ? undefined
          : {
              kind: "navigate",
              area: "customers-locations",
              label: ar ? "اختيار المواقع" : "Choose locations",
            },
      },
      {
        key: "plan",
        label: ar ? "حدود الخطة" : "Plan limits",
        status: planBlocked
          ? ar
            ? "تمنع الإطلاق"
            : "Blocks launch"
          : checksComplete
            ? ar
              ? "جاهزة"
              : "Ready"
            : ar
              ? "بانتظار الفحوصات"
              : "Pending checks",
        description: planBlocked
          ? ar
            ? `يتطلب إعداد البطاقة مراجعة حدود خطة ${input.planName}.`
            : `This card setup exceeds a ${input.planName} plan limit.`
          : checksComplete
            ? ar
              ? `اجتاز الإعداد حدود خطة ${input.planName} الحالية.`
              : `The setup passed the current ${input.planName} plan checks.`
            : ar
              ? `تُراجع حدود خطة ${input.planName} ضمن الفحوصات الآلية وعند النشر.`
              : `${input.planName} limits are checked automatically and again at publish.`,
        complete: !planBlocked && checksComplete,
        blocking: planBlocked,
        action: planBlocked
          ? {
              kind: "run-checks",
              label: ar ? "مراجعة عائق الخطة" : "Review plan blocker",
            }
          : undefined,
      },
    ],
  };
}

export function deriveStudioLifecyclePresentation(
  input: StudioLifecyclePresentationInput,
): StudioLifecyclePresentation {
  const { programStatus, draftVersionStatus, locale } = input;
  const ar = locale === "ar";
  const domainKey = lifecycleKey(programStatus, draftVersionStatus);
  const operationallyCompleted = ["live", "paused", "scheduled", "suspended"].includes(domainKey);
  const updateInProgress = Boolean(input.hasUnpublishedChanges);
  const archivedAfterPublication = domainKey === "archived" && input.hasPublishedVersion;
  const checksComplete =
    (!updateInProgress && operationallyCompleted) ||
    archivedAfterPublication ||
    (input.validationState !== "failed" &&
      (input.validationState === "passed" ||
        ["VALIDATED", "TEST_READY", "PUBLISHED", "SUPERSEDED"].includes(draftVersionStatus ?? "")));
  const key =
    domainKey === "ready" && !(input.designComplete && input.locationsReady && checksComplete)
      ? "draft"
      : domainKey;
  const stateTones: Record<MerchantStudioState["key"], MerchantStudioState["tone"]> = {
    draft: "neutral",
    ready: "brand",
    live: "success",
    paused: "warning",
    archived: "neutral",
    scheduled: "brand",
    suspended: "danger",
  };
  const lifecycle = {
    key,
    ...studioText(locale).states[key],
    tone: stateTones[key],
  } as MerchantStudioState;
  const baseActions = presentationAction(
    key,
    checksComplete,
    input.designComplete,
    input.locationsReady,
    locale,
  );
  const actions = updateInProgress
    ? {
        primary: !checksComplete
          ? ({
              kind: "navigate",
              area: "launch",
              label: ar ? "مراجعة التغييرات" : "Review changes",
            } as const)
          : ({
              kind: "navigate",
              area: "launch",
              label: ar ? "مراجعة التغييرات" : "Review changes",
            } as const),
        secondary: baseActions.secondary,
      }
    : baseActions;
  const currentJourneyStage: StudioJourneyStagePresentation["key"] = [
    "live",
    "paused",
    "archived",
    "scheduled",
    "suspended",
  ].includes(key)
    ? "live"
    : !input.designComplete
      ? "design"
      : !checksComplete
        ? "checks"
        : "live";

  const stateFor = (stage: StudioJourneyStagePresentation["key"]): StudioJourneyStageState => {
    if (stage === "live") {
      if (key === "live") return "complete";
      if (key === "paused") return "paused";
      if (key === "archived") return "archived";
      if (key === "suspended") return "blocked";
      if (key === "scheduled" || key === "ready") return "current";
      return "pending";
    }
    if (key === "archived" && !archivedAfterPublication) {
      if (stage === "design") return input.designComplete ? "complete" : "archived";
      return checksComplete ? "complete" : "archived";
    }
    const complete =
      stage === "design"
        ? input.designComplete || operationallyCompleted || archivedAfterPublication
        : checksComplete;
    if (complete) return "complete";
    return currentJourneyStage === stage ? "current" : "pending";
  };

  const jc = studioText(locale).journey;
  const makeStage = (
    keyValue: StudioJourneyStagePresentation["key"],
    hint: string,
    area: StudioArea,
  ): StudioJourneyStagePresentation => {
    const state = stateFor(keyValue);
    return {
      key: keyValue,
      label: jc[keyValue],
      hint,
      state,
      stateLabel: jc[state],
      area,
    };
  };
  const journeyStages = [
    makeStage("design", ar ? "أساسيات البطاقة" : "Card essentials", "overview"),
    makeStage("checks", ar ? "الفحوصات الآلية" : "Automated checks", "launch"),
    makeStage(
      "live",
      key === "paused"
        ? ar
          ? "متوقفة مؤقتاً"
          : "Temporarily paused"
        : key === "archived"
          ? ar
            ? "البطاقة مؤرشفة"
            : "Card archived"
          : key === "suspended"
            ? ar
              ? "غير متاحة مؤقتاً"
              : "Temporarily unavailable"
            : key === "ready"
              ? ar
                ? "انشرها لإتاحتها"
                : "Publish to make available"
              : ar
                ? "متاحة للعملاء"
                : "Available to customers",
      "launch",
    ),
  ];

  const { requirements, planBlocked } = launchRequirements(input, checksComplete);
  const lifecycleOwnsLaunch =
    ["live", "paused", "archived", "scheduled", "suspended"].includes(key) &&
    !(updateInProgress && (key === "live" || key === "paused"));
  const launchReady =
    (key === "ready" || (updateInProgress && (key === "live" || key === "paused"))) &&
    input.designComplete &&
    checksComplete &&
    input.locationsReady &&
    !planBlocked &&
    input.publicationAllowed;
  const firstBlocker = requirements.find(
    (requirement) => requirement.blocking || !requirement.complete,
  );
  const launchAction: StudioPresentationAction = lifecycleOwnsLaunch
    ? actions.primary
    : launchReady
      ? {
          kind: "publish",
          label: updateInProgress
            ? ar
              ? "نشر التغييرات"
              : "Publish changes"
            : ar
              ? "إطلاق بطاقة الولاء"
              : "Launch loyalty card",
        }
      : (firstBlocker?.action ?? actions.primary);
  const launchLabel =
    updateInProgress && (key === "live" || key === "paused")
      ? launchReady
        ? ar
          ? "جاهزة لنشر التغييرات"
          : "Ready to publish changes"
        : ar
          ? "تغييرات بانتظار النشر"
          : "Changes waiting to be published"
      : key === "live"
        ? ar
          ? "البطاقة مباشرة"
          : "Card is live"
        : key === "paused"
          ? ar
            ? "البطاقة متوقفة مؤقتاً"
            : "Card is paused"
          : key === "archived"
            ? ar
              ? "البطاقة مؤرشفة"
              : "Card is archived"
            : key === "scheduled"
              ? ar
                ? "مجدولة للإطلاق"
                : "Scheduled to go live"
              : key === "suspended"
                ? ar
                  ? "الإطلاق غير متاح"
                  : "Launch unavailable"
                : launchReady
                  ? ar
                    ? "جاهزة للإطلاق"
                    : "Ready to launch"
                  : ar
                    ? "غير جاهزة للإطلاق"
                    : "Not ready to launch";
  const launchDescription =
    updateInProgress && (key === "live" || key === "paused")
      ? launchReady
        ? ar
          ? "اكتملت فحوصات التحديث. البطاقة الحالية لم تتغير بعد."
          : "The update has passed its checks. The current live card is unchanged."
        : (firstBlocker?.description ??
          (ar
            ? "أكمل فحوصات التحديث قبل النشر. البطاقة الحالية لم تتغير."
            : "Complete the update checks before publishing. The current live card is unchanged."))
      : lifecycleOwnsLaunch
        ? lifecycle.description
        : launchReady
          ? ar
            ? "اكتملت جميع المتطلبات المطلوبة. أكد النشر لإتاحتها للعملاء."
            : "Every required step is complete. Confirm publishing to make it available to customers."
          : (firstBlocker?.description ??
            (ar
              ? "أكمل المتطلبات المطلوبة قبل النشر."
              : "Complete the required steps before publishing."));

  return {
    ...lifecycle,
    guidance:
      updateInProgress && key === "live"
        ? {
            title: ar ? "البطاقة مباشرة · تغييرات غير منشورة" : "Live · Unpublished changes",
            description: ar
              ? "بطاقتك الحالية متاحة للعملاء. لديك تغييرات غير منشورة؛ راجعها وانشرها عندما تكون جاهزًا."
              : "Your current card is live. You have unpublished changes. Review and publish them when you are ready. Customers continue to see the current live version.",
            tone: "brand",
          }
        : guidanceFor(key, input.designComplete, input.locationsReady, locale),
    journeyStages,
    currentJourneyStage,
    primaryAction: actions.primary,
    ...(actions.secondary ? { secondaryAction: actions.secondary } : {}),
    launch: {
      label: launchLabel,
      description: launchDescription,
      tone:
        (key === "live" && !updateInProgress) || launchReady
          ? "success"
          : key === "paused"
            ? "warning"
            : key === "suspended"
              ? "danger"
              : key === "archived"
                ? "neutral"
                : "brand",
      ready: launchReady,
      canPublish: launchReady,
      ...(!launchReady && !lifecycleOwnsLaunch ? { disabledReason: launchDescription } : {}),
      action: launchAction,
      requirements,
    },
    capabilities: {
      canPublish: launchReady,
      canPause: key === "live",
      canResume: key === "paused",
      canRestore: key === "archived",
      canArchive: key !== "archived",
    },
  };
}

export function merchantStudioState(
  status: ProgramOperationalStatus,
  draftVersionStatus: string | null,
  locale: InterfaceLocale,
): MerchantStudioState {
  const key = lifecycleKey(status, draftVersionStatus);
  const tone: MerchantStudioState["tone"] =
    key === "live"
      ? "success"
      : key === "ready" || key === "scheduled"
        ? "brand"
        : key === "paused"
          ? "warning"
          : key === "suspended"
            ? "danger"
            : "neutral";
  return { key, ...studioText(locale).states[key], tone };
}

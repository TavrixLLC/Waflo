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
  if (key === "live")
    return {
      primary: {
        kind: "navigate",
        area: "customers-locations",
        label: studioText(locale).ui.viewCustomers,
      },
      secondary: {
        kind: "lifecycle",
        action: "pause",
        label: studioText(locale).ui.pauseCard,
      },
    };
  if (key === "paused")
    return {
      primary: {
        kind: "lifecycle",
        action: "resume",
        label: studioText(locale).ui.resumeCard,
      },
      secondary: {
        kind: "navigate",
        area: "settings",
        label: studioText(locale).ui.reviewSettings,
      },
    };
  if (key === "archived")
    return {
      primary: {
        kind: "lifecycle",
        action: "restore",
        label: studioText(locale).ui.restoreCard,
      },
      secondary: {
        kind: "navigate",
        area: "settings",
        label: studioText(locale).ui.viewChangeHistory,
      },
    };
  if (key === "scheduled")
    return {
      primary: {
        kind: "navigate",
        area: "launch",
        label: studioText(locale).ui.viewLaunchSchedule,
      },
    };
  if (key === "suspended")
    return {
      primary: {
        kind: "navigate",
        area: "settings",
        label: studioText(locale).ui.viewCardStatus,
      },
    };
  if (!designComplete)
    return {
      primary: {
        kind: "navigate",
        area: "overview",
        label: studioText(locale).ui.reviewCardDesign,
      },
    };
  if (!locationsReady)
    return {
      primary: {
        kind: "navigate",
        area: "customers-locations",
        label: studioText(locale).ui.chooseLocations,
      },
    };
  if (!checksComplete)
    return {
      primary: {
        kind: "run-checks",
        label: studioText(locale).ui.runReadinessChecks,
      },
    };
  return {
    primary: {
      kind: "navigate",
      area: "launch",
      label: studioText(locale).ui.reviewLaunch,
    },
  };
}

function guidanceFor(
  key: MerchantStudioState["key"],
  designComplete: boolean,
  locationsReady: boolean,
  locale: InterfaceLocale,
): StudioLifecyclePresentation["guidance"] {
  if (key === "live")
    return {
      title: studioText(locale).ui.yourLoyaltyCardIsLive,
      description: studioText(locale).ui.customersCanCurrentlyUseThisCardAtParticipatingLocations,
      tone: "success",
    };
  if (key === "paused")
    return {
      title: studioText(locale).ui.yourLoyaltyCardIsPaused,
      description: studioText(locale).ui.resumeItWhenYouAreReadyToMakeItAvailableAgain,
      tone: "warning",
    };
  if (key === "archived")
    return {
      title: studioText(locale).ui.thisLoyaltyCardIsArchived,
      description: studioText(locale).ui.restoreItToContinueManagingOrUsingTheSavedCardSetup,
      tone: "neutral",
    };
  if (key === "scheduled")
    return {
      title: studioText(locale).ui.yourLoyaltyCardIsScheduled,
      description: studioText(locale).ui.reviewTheExistingScheduledLaunchStatus,
      tone: "brand",
    };
  if (key === "suspended")
    return {
      title: studioText(locale).ui.yourLoyaltyCardIsTemporarilyUnavailable,
      description:
        studioText(locale).ui.reviewTheCurrentStatusThisScreenDoesNotCreateANewLifecycleTransition,
      tone: "danger",
    };
  if (key === "ready")
    return {
      title: studioText(locale).ui.readyToLaunch,
      description: studioText(locale).ui.reviewAndPublishYourLoyaltyCard,
      tone: "brand",
    };
  if (!designComplete)
    return {
      title: studioText(locale).ui.cardSetupNeedsAttention,
      description: studioText(locale).ui.nextReviewCardDesign,
      tone: "brand",
    };
  if (!locationsReady)
    return {
      title: studioText(locale).ui.aParticipatingLocationIsRequired,
      description: studioText(locale).ui.nextChooseAnActiveLocation,
      tone: "brand",
    };
  return {
    title: studioText(locale).ui.cardDesignComplete,
    description: studioText(locale).ui.nextRunReadinessChecks,
    tone: "brand",
  };
}

function launchRequirements(
  input: StudioLifecyclePresentationInput,
  checksComplete: boolean,
): { requirements: StudioLaunchRequirementPresentation[]; planBlocked: boolean } {
  const planBlocked = (input.validationIssues ?? []).some((issue) =>
    /PLAN|LIMIT|STARTER|GROWTH|SCALE/iu.test(`${issue.code} ${issue.path}`),
  );
  const automatedBlocked = input.validationState === "failed";
  return {
    planBlocked,
    requirements: [
      {
        key: "automated",
        label: studioText(input.locale).ui.automatedChecks,
        status: checksComplete
          ? studioText(input.locale).ui.passed
          : studioText(input.locale).ui.needsAttention,
        description: checksComplete
          ? studioText(input.locale).ui.setupAssetAndPreviewChecksPassed
          : automatedBlocked
            ? studioText(input.locale).ui.launchBlockersNeedToBeFixedInTheCheckDetails
            : studioText(input.locale).ui.runTheAutomatedChecksBeforePublishing,
        complete: checksComplete,
        blocking: !checksComplete,
        action: checksComplete
          ? undefined
          : { kind: "run-checks", label: studioText(input.locale).ui.runChecks },
      },
      {
        key: "locations",
        label: studioText(input.locale).ui.participatingLocations,
        status: input.locationsReady
          ? studioText(input.locale).ui.ready
          : studioText(input.locale).ui.blocksLaunch,
        description: input.locationsReady
          ? studioText(input.locale).ui.atLeastOneActiveLocationIsSelected
          : studioText(input.locale).ui.chooseAtLeastOneActiveParticipatingLocation,
        complete: input.locationsReady,
        blocking: !input.locationsReady,
        action: input.locationsReady
          ? undefined
          : {
              kind: "navigate",
              area: "customers-locations",
              label: studioText(input.locale).ui.chooseLocations,
            },
      },
      {
        key: "plan",
        label: studioText(input.locale).ui.planLimits,
        status: planBlocked
          ? studioText(input.locale).ui.blocksLaunch
          : checksComplete
            ? studioText(input.locale).ui.ready
            : studioText(input.locale).ui.pendingChecks,
        description: planBlocked
          ? studioText(input.locale).ui.planLimitExceeded.replace("{planName}", input.planName)
          : checksComplete
            ? studioText(input.locale).ui.planChecksPassed.replace("{planName}", input.planName)
            : studioText(input.locale).ui.planLimitsCheckedAutomatically.replace(
                "{planName}",
                input.planName,
              ),
        complete: !planBlocked && checksComplete,
        blocking: planBlocked,
        action: planBlocked
          ? {
              kind: "run-checks",
              label: studioText(input.locale).ui.reviewPlanBlocker,
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
              label: studioText(locale).ui.reviewChanges,
            } as const)
          : ({
              kind: "navigate",
              area: "launch",
              label: studioText(locale).ui.reviewChanges,
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
    makeStage("design", studioText(locale).ui.cardEssentials, "overview"),
    makeStage("checks", studioText(locale).ui.automatedChecks, "launch"),
    makeStage(
      "live",
      key === "paused"
        ? studioText(locale).ui.temporarilyPaused
        : key === "archived"
          ? studioText(locale).ui.cardArchived
          : key === "suspended"
            ? studioText(locale).ui.temporarilyUnavailable
            : key === "ready"
              ? studioText(locale).ui.publishToMakeAvailable
              : studioText(locale).ui.availableToCustomers,
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
            ? studioText(locale).ui.publishChanges
            : studioText(locale).ui.launchLoyaltyCard,
        }
      : (firstBlocker?.action ?? actions.primary);
  const launchLabel =
    updateInProgress && (key === "live" || key === "paused")
      ? launchReady
        ? studioText(locale).ui.readyToPublishChanges
        : studioText(locale).ui.changesWaitingToBePublished
      : key === "live"
        ? studioText(locale).ui.cardIsLive
        : key === "paused"
          ? studioText(locale).ui.cardIsPaused
          : key === "archived"
            ? studioText(locale).ui.cardIsArchived
            : key === "scheduled"
              ? studioText(locale).ui.scheduledToGoLive
              : key === "suspended"
                ? studioText(locale).ui.launchUnavailable
                : launchReady
                  ? studioText(locale).ui.readyToLaunch
                  : studioText(locale).ui.notReadyToLaunch;
  const launchDescription =
    updateInProgress && (key === "live" || key === "paused")
      ? launchReady
        ? studioText(locale).ui.theUpdateHasPassedItsChecksTheCurrentLiveCardIsUnchanged
        : (firstBlocker?.description ??
          studioText(locale).ui
            .completeTheUpdateChecksBeforePublishingTheCurrentLiveCardIsUnchanged)
      : lifecycleOwnsLaunch
        ? lifecycle.description
        : launchReady
          ? studioText(locale).ui
              .everyRequiredStepIsCompleteConfirmPublishingToMakeItAvailableToCustomers
          : (firstBlocker?.description ??
            studioText(locale).ui.completeTheRequiredStepsBeforePublishing);

  return {
    ...lifecycle,
    guidance:
      updateInProgress && key === "live"
        ? {
            title: studioText(locale).ui.liveUnpublishedChanges,
            description:
              studioText(locale).ui
                .yourCurrentCardIsLiveYouHaveUnpublishedChangesReviewAndPublishThemWhenYouAreReadyCustomersContinueToSeeTheCurrentLiveVersion,
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

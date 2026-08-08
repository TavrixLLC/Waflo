import type { Page, Route } from "@playwright/test";
import { artworkFor } from "../../apps/api/src/programs/library-artwork.js";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import {
  renderTemplateGalleryPreviews,
  renderTemplateGalleryThumbnail,
} from "../../apps/api/src/programs/template-gallery-preview.js";
import type { TemplateItem } from "../../apps/merchant-dashboard/components/program-studio-types.js";
import { createBuilderDraft } from "../../apps/merchant-dashboard/components/program-card-builder-state.js";
import { apiDraft } from "../../apps/merchant-dashboard/components/program-studio-types.js";
import { findProgramTemplate, latestProgramTemplates } from "../../packages/contracts/src/index.js";
import { renderStampSvg } from "../../packages/stamp-engine/src/index.js";

export const templateGalleryOrganizationId = "merchant-template-gallery-fixture";

function artworkPreviewUrl(content: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(content, "utf8").toString("base64")}`;
}

export function templateGalleryFixtures(locale: "EN" | "AR" = "EN"): TemplateItem[] {
  return latestProgramTemplates().map((template) => ({
    ...template,
    galleryThumbnail: renderTemplateGalleryThumbnail(template, locale),
    ...(template.code === "GENERAL_VISITS"
      ? { blankGalleryThumbnail: renderTemplateGalleryThumbnail(template, locale, "BLANK") }
      : {}),
    artwork: {
      filled: {
        ...template.artwork.filled,
        previewUrl: artworkPreviewUrl(artworkFor(template.artwork.filled)?.content ?? ""),
      },
      empty: {
        ...template.artwork.empty,
        previewUrl: artworkPreviewUrl(artworkFor(template.artwork.empty)?.content ?? ""),
      },
      milestone: {
        ...template.artwork.milestone,
        previewUrl: artworkPreviewUrl(artworkFor(template.artwork.milestone)?.content ?? ""),
      },
    },
  }));
}

async function fulfill(route: Route, data: unknown): Promise<void> {
  const origin = route.request().headers().origin ?? "http://localhost:3001";
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify({ data, requestId: "merchant-template-gallery-test" }),
  });
}

async function reject(
  route: Route,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const origin = route.request().headers().origin ?? "http://localhost:3001";
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify({
      error: { code, message, ...(details ? { details } : {}), requestId: "builder-error" },
    }),
  });
}

export async function mockTemplateGalleryApi(
  page: Page,
  {
    businessCategory = "Cafe",
    onCreate,
    onPatch,
    onBuilderPreview,
    onPreviewRequest,
    patchDelayMs = 0,
    previewDelayMs = 0,
    publishedPreviewAvailable = true,
    patchFailures = 0,
    patchConflicts = 0,
    selectedPlan = "GROWTH",
    studioState = "DRAFT",
    walletHealth = [],
    enrollmentOpen = true,
    billingStatus = "PENDING_ACTIVATION",
    publishDelayMs = 0,
    publicationFailures = 0,
    publicationFailureCode = "PUBLICATION_PROVIDER_UNAVAILABLE",
    onPublish,
    validationErrors = [],
    existingPrograms = [],
    fixtureLocations = [{ id: "gallery-location", name: "Gallery Main Branch", status: "ACTIVE" }],
    seededProgram = false,
    arabicEarningCopy = "present",
  }: {
    businessCategory?: string | null;
    onCreate?: (body: Record<string, unknown>) => void;
    onPatch?: (body: Record<string, unknown>) => void;
    onBuilderPreview?: (
      profile: string,
      locale: string,
      preview: { svg: string; width: number; height: number },
    ) => void;
    onPreviewRequest?: (templateCode: string, presentation: string) => void;
    patchDelayMs?: number;
    previewDelayMs?: number;
    publishedPreviewAvailable?: boolean;
    patchFailures?: number;
    patchConflicts?: number;
    selectedPlan?: "STARTER" | "GROWTH" | "SCALE";
    studioState?:
      | "DRAFT"
      | "CHECKED"
      | "READY"
      | "LIVE"
      | "LIVE_WITH_CHANGES"
      | "PAUSED"
      | "PAUSED_WITH_CHANGES"
      | "ARCHIVED"
      | "SCHEDULED"
      | "SUSPENDED";
    walletHealth?: Array<Record<string, unknown>>;
    enrollmentOpen?: boolean;
    billingStatus?: string;
    publishDelayMs?: number;
    publicationFailures?: number;
    publicationFailureCode?: string;
    onPublish?: (body: Record<string, unknown>, requestCount: number) => void;
    validationErrors?: Array<{
      code: string;
      path: string;
      message: string;
      suggestedAction: string;
      severity: "error";
    }>;
    existingPrograms?: Array<Record<string, unknown>>;
    fixtureLocations?: Array<{ id: string; name: string; status: string }>;
    seededProgram?: boolean;
    arabicEarningCopy?: "present" | "missing";
  } = {},
): Promise<void> {
  await page.route("https://fonts.googleapis.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/css", body: "" });
  });
  await page.route("https://fonts.gstatic.com/**", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
  const filledAssetId = "55555555-5555-4555-8555-555555555555";
  const emptyAssetId = "66666666-6666-4666-8666-666666666666";
  const seededTemplate = templateGalleryFixtures()[0];
  let storedDraft: Record<string, unknown> | null =
    seededProgram && seededTemplate
      ? apiDraft(
          createBuilderDraft(seededTemplate, fixtureLocations, { locale: "en", blank: false }),
        )
      : null;
  if (storedDraft && arabicEarningCopy === "missing") {
    const translations = storedDraft.translations as Record<"en" | "ar", Record<string, string>>;
    storedDraft = {
      ...storedDraft,
      translations: {
        ...translations,
        ar: { ...translations.ar, shortDescription: "" },
      },
    };
  }
  let revision = 1;
  let testStampCount = 0;
  let testCycleCount = 0;
  let validationRequestCount = 0;
  let remainingPatchFailures = patchFailures;
  let remainingPatchConflicts = patchConflicts;
  let remainingPublicationFailures = publicationFailures;
  let publicationRequestCount = 0;
  let currentStudioState = studioState;

  function currentArtwork() {
    if (!storedDraft) return null;
    const template = findProgramTemplate(
      String(storedDraft.templateCode),
      Number(storedDraft.templateVersion),
    );
    if (!template) return null;
    const visual = storedDraft.visualTheme as Record<string, unknown>;
    const blank =
      template.code === "GENERAL_VISITS" &&
      String(visual.backgroundColor).toUpperCase() === "#F7F8F7";
    const filled = blank
      ? artworkFor("NEUTRAL_MARK_FILLED", 2)
      : artworkFor(template.artwork.filled);
    const empty = blank ? artworkFor("NEUTRAL_MARK_EMPTY", 2) : artworkFor(template.artwork.empty);
    return filled && empty ? { filled, empty } : null;
  }

  function currentAssets() {
    const artwork = currentArtwork();
    if (!artwork) return [];
    return [
      {
        id: filledAssetId,
        category: "STAMP_FILLED",
        source: "WAFLO_LIBRARY",
        originalFilename: "built-in-stamped-icon.svg",
        processingStatus: "READY",
        contentUrl: `/v1/organizations/${templateGalleryOrganizationId}/assets/${filledAssetId}/content?variant=THUMBNAIL_96`,
      },
      {
        id: emptyAssetId,
        category: "STAMP_EMPTY",
        source: "WAFLO_LIBRARY",
        originalFilename: "built-in-empty-stamp.svg",
        processingStatus: "READY",
        contentUrl: `/v1/organizations/${templateGalleryOrganizationId}/assets/${emptyAssetId}/content?variant=THUMBNAIL_96`,
      },
    ];
  }

  function programDetail() {
    if (!storedDraft) return null;
    const translations = storedDraft.translations as Record<
      "en" | "ar",
      Record<string, string | undefined>
    >;
    const rewards = storedDraft.rewards as Array<Record<string, unknown>>;
    const visualTheme = storedDraft.visualTheme as Record<string, unknown>;
    const requiredStampCount = Number(storedDraft.requiredStampCount ?? 8);
    const publishedLifecycle = [
      "LIVE",
      "LIVE_WITH_CHANGES",
      "PAUSED",
      "PAUSED_WITH_CHANGES",
      "ARCHIVED",
      "SUSPENDED",
    ].includes(currentStudioState);
    const hasUpdateDraft = ["LIVE_WITH_CHANGES", "PAUSED_WITH_CHANGES"].includes(
      currentStudioState,
    );
    const version = {
      id: "33333333-3333-4333-8333-333333333333",
      versionNumber: 1,
      status:
        currentStudioState === "READY" || currentStudioState === "SCHEDULED" || hasUpdateDraft
          ? "TEST_READY"
          : currentStudioState === "CHECKED"
            ? "VALIDATED"
            : publishedLifecycle
              ? "PUBLISHED"
              : "DRAFT",
      editingMode: storedDraft.editingMode === "pro" ? "PRO" : "QUICK",
      baseTemplateCode: storedDraft.templateCode,
      baseTemplateVersion: storedDraft.templateVersion,
      revision,
      changeSummary: storedDraft.changeSummary ?? null,
      validatedAt: currentStudioState === "DRAFT" ? null : "2026-08-02T09:00:00.000Z",
      testReadyAt: [
        "READY",
        "LIVE",
        "LIVE_WITH_CHANGES",
        "PAUSED",
        "PAUSED_WITH_CHANGES",
        "ARCHIVED",
        "SCHEDULED",
        "SUSPENDED",
      ].includes(currentStudioState)
        ? "2026-08-02T09:30:00.000Z"
        : null,
      publishedAt: publishedLifecycle && !hasUpdateDraft ? "2026-08-02T10:00:00.000Z" : null,
      supersededAt: null,
      abandonedAt: null,
      validationFingerprint: null,
      operationalTimezone: storedDraft.operationalTimezone,
      staffOwnReversalWindowSeconds: storedDraft.staffOwnReversalWindowSeconds,
      managerReversalWindowMinutes: storedDraft.managerReversalWindowMinutes,
      managerOverrideAllowed: storedDraft.managerOverrideAllowed,
      translations: (["en", "ar"] as const).map((locale) => ({
        locale: locale.toUpperCase(),
        ...translations[locale],
      })),
      stampRule: {
        requiredStampCount,
        earningDescription: storedDraft.earningDescription,
        maximumStampsPerOperation: storedDraft.maximumStampsPerOperation,
        maximumStampsPerCustomerPerDay: storedDraft.maximumStampsPerCustomerPerDay,
        minimumPurchaseAmountMinor: storedDraft.minimumPurchaseAmountMinor,
        minimumPurchaseCurrency: storedDraft.minimumPurchaseCurrency,
        resetBehaviorAfterReward: storedDraft.resetBehaviorAfterReward,
      },
      rewards: rewards.map((reward, index) => {
        const rewardTranslations = reward.translations as Record<
          "en" | "ar",
          Record<string, string | undefined>
        >;
        return {
          ...reward,
          id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`,
          translations: (["en", "ar"] as const).map((locale) => ({
            locale: locale.toUpperCase(),
            ...rewardTranslations[locale],
          })),
        };
      }),
      locations: ((storedDraft.locationIds ?? []) as string[]).map((locationId) => ({
        locationId,
        location: { id: locationId, name: "Gallery Main Branch", status: "ACTIVE" },
      })),
      visualTheme: {
        ...visualTheme,
        filledStampAssetId: visualTheme.filledStampAssetId ?? filledAssetId,
        emptyStampAssetId: visualTheme.emptyStampAssetId ?? emptyAssetId,
      },
    };
    const publishedVersion = publishedLifecycle
      ? {
          ...version,
          id: "22222222-2222-4222-8222-222222222222",
          versionNumber: hasUpdateDraft ? 1 : version.versionNumber,
          status: "PUBLISHED",
          publishedAt: "2026-08-02T10:00:00.000Z",
          testReadyAt: "2026-08-02T09:30:00.000Z",
          translations: publishedPreviewAvailable ? version.translations : [],
          stampRule: publishedPreviewAvailable ? version.stampRule : null,
          visualTheme: publishedPreviewAvailable ? version.visualTheme : null,
        }
      : null;
    const editableVersion =
      publishedLifecycle && !hasUpdateDraft
        ? null
        : {
            ...version,
            versionNumber: hasUpdateDraft ? 2 : version.versionNumber,
          };
    return {
      id: "created-program-id",
      internalName: storedDraft.internalName,
      status: ["LIVE", "LIVE_WITH_CHANGES"].includes(currentStudioState)
        ? "PUBLISHED"
        : ["PAUSED", "PAUSED_WITH_CHANGES"].includes(currentStudioState)
          ? "PAUSED"
          : currentStudioState === "ARCHIVED"
            ? "ARCHIVED"
            : currentStudioState === "SCHEDULED"
              ? "SCHEDULED"
              : currentStudioState === "SUSPENDED"
                ? "SUSPENDED"
                : currentStudioState === "CHECKED"
                  ? "VALIDATED"
                  : "DRAFT",
      updatedAt: "2026-08-03T10:00:00.000Z",
      currentDraftVersion: editableVersion,
      currentPublishedVersion: publishedVersion,
      versions: [editableVersion, publishedVersion].filter(Boolean),
    };
  }

  function builderPreview(url: URL) {
    if (!storedDraft) return null;
    const locale = url.searchParams.get("locale") === "AR" ? "AR" : "EN";
    const requestedProfile = url.searchParams.get("profile");
    const profile =
      requestedProfile === "APPLE_WALLET" || requestedProfile === "GOOGLE_WALLET"
        ? requestedProfile
        : "CUSTOMER_WEB";
    const translations = storedDraft.translations as Record<"en" | "ar", Record<string, string>>;
    const content = translations[locale === "AR" ? "ar" : "en"];
    const goal = Number(storedDraft.requiredStampCount ?? 8);
    const progress = Math.max(0, Math.min(goal, Number(url.searchParams.get("progress") ?? 0)));
    const template = findProgramTemplate(
      String(storedDraft.templateCode),
      Number(storedDraft.templateVersion),
    );
    if (!template || !content) return null;
    const visual = storedDraft.visualTheme as Record<string, unknown>;
    const blank =
      template.code === "GENERAL_VISITS" &&
      String(visual.backgroundColor).toUpperCase() === "#F7F8F7";
    const filled = blank
      ? artworkFor("NEUTRAL_MARK_FILLED", 2)
      : artworkFor(template.artwork.filled);
    const empty = blank ? artworkFor("NEUTRAL_MARK_EMPTY", 2) : artworkFor(template.artwork.empty);
    if (!filled || !empty) return null;
    const backgroundColor = String(visual.backgroundColor);
    const foregroundColor = String(visual.foregroundColor);
    const accentColor = String(visual.accentColor);
    const secondaryColor = String(visual.secondaryColor);
    const layout = String(visual.layoutType) as "ROW" | "GRID" | "PATH" | "RING";
    const rewardReady = progress >= goal;
    const stamp = renderStampSvg({
      goal,
      progress,
      layout,
      layoutConfiguration: visual.layoutConfiguration as {
        columns?: number;
        maxPerRow?: number;
        serpentine?: boolean;
        startAngle?: number;
      },
      outputProfile: profile,
      filledColor: accentColor,
      emptyColor: profile === "CUSTOMER_WEB" ? backgroundColor : secondaryColor,
      accentColor: profile === "CUSTOMER_WEB" ? foregroundColor : accentColor,
      backgroundColor,
      foregroundColor,
      stampSize: Number(visual.stampSize),
      spacing: Number(visual.stampSpacing),
      filledArtwork: { kind: "svg", content: filled.content, trusted: true },
      emptyArtwork: { kind: "svg", content: empty.content, trusted: true },
      label: `${progress}/${goal}`,
      rewardLabel: rewardReady
        ? locale === "AR"
          ? `المكافأة جاهزة: ${content.rewardSummary}`
          : `Reward ready: ${content.rewardSummary}`
        : content.rewardSummary,
      rewardReady,
      progressLabelVisible: profile === "CUSTOMER_WEB" && Boolean(visual.progressLabelVisible),
      rewardLabelVisible: profile === "CUSTOMER_WEB" && Boolean(visual.rewardLabelVisible),
    });
    const result = composeProgramPreview({
      profile,
      locale,
      organizationName: locale === "AR" ? "مقهى المعرض" : "Gallery Coffee",
      programName: content.programName,
      shortDescription: content.shortDescription,
      rewardSummary: content.rewardSummary,
      terms: content.termsAndConditions,
      progress,
      goal,
      stampSvg: stamp.svg,
      stampLayout: layout,
      backgroundColor,
      foregroundColor,
      accentColor,
      secondaryColor,
      identityDataUri: artworkPreviewUrl(filled.content),
      customerWebVariant: visual.customerWebVariant as "CARD" | "MINIMAL" | "HERO",
      ...(blank
        ? {
            presentation: {
              visualRole: "MINIMAL" as const,
              composition: "EDITORIAL" as const,
              motifTreatment: "WATERMARK" as const,
              rewardTreatment: "RULE" as const,
              density: "AIRY" as const,
              cornerTreatment: "CRISP" as const,
              titleTreatment: "QUIET" as const,
            },
          }
        : template.presentation
          ? { presentation: template.presentation }
          : {}),
      apple: visual.applePreviewConfig as {
        headerLabel: string;
        headerValue: string;
        secondaryLabel: string;
        barcodeLabel: string;
        showBackContent: boolean;
      },
      google: visual.googlePreviewConfig as {
        title: string;
        subtitle: string;
        detailsLabel: string;
        barcodeLabel: string;
      },
    });
    return { ...result, profile };
  }

  function testSession() {
    const detail = programDetail();
    const version = detail?.currentDraftVersion ?? detail?.currentPublishedVersion;
    return {
      id: "77777777-7777-4777-8777-777777777777",
      status: "ACTIVE",
      currentStampCount: testStampCount,
      cycleCount: testCycleCount,
      version: {
        operationalTimezone: version?.operationalTimezone,
        staffOwnReversalWindowSeconds: version?.staffOwnReversalWindowSeconds,
        managerReversalWindowMinutes: version?.managerReversalWindowMinutes,
        managerOverrideAllowed: version?.managerOverrideAllowed,
        stampRule: version?.stampRule,
        rewards: version?.rewards,
      },
      events: [],
    };
  }

  await page.route(/https?:\/\/(?:localhost:4000|api\.waflo\.app)\/v1\/.*/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/v1/auth/csrf") {
      await fulfill(route, { csrfToken: "merchant-template-gallery-csrf" });
      return;
    }
    if (path === "/v1/auth/me") {
      await fulfill(route, {
        id: "merchant-template-gallery-owner",
        displayName: "Gallery Merchant",
        email: "gallery@example.test",
        preferredLocale: "EN",
        lastSelectedOrganizationId: templateGalleryOrganizationId,
        memberships: [
          {
            id: "merchant-template-gallery-membership",
            role: "OWNER",
            organization: {
              id: templateGalleryOrganizationId,
              name: "Gallery Coffee",
              merchantSlug: "gallery-coffee",
              defaultLocale: "EN",
              selectedPlan,
              onboardingState: "COMPLETE",
            },
          },
        ],
      });
      return;
    }
    if (path === `/v1/organizations/${templateGalleryOrganizationId}`) {
      await fulfill(route, {
        id: templateGalleryOrganizationId,
        businessCategory,
        billingProfile: {
          subscriptionStatus: billingStatus,
          trialStart: null,
          trialEnd: null,
        },
      });
      return;
    }
    if (path.endsWith("/programs/templates")) {
      await fulfill(
        route,
        templateGalleryFixtures(url.searchParams.get("locale") === "AR" ? "AR" : "EN"),
      );
      return;
    }
    const previewMatch = path.match(/\/programs\/templates\/([^/]+)\/previews$/u);
    if (previewMatch) {
      const templateCode = decodeURIComponent(previewMatch[1] ?? "");
      const versionValue = url.searchParams.get("version");
      const version = versionValue ? Number(versionValue) : undefined;
      const template = findProgramTemplate(templateCode, version);
      if (!template) {
        await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        return;
      }
      const locale = url.searchParams.get("locale") === "AR" ? "AR" : "EN";
      const presentation = url.searchParams.get("presentation") === "BLANK" ? "BLANK" : "TEMPLATE";
      onPreviewRequest?.(templateCode, presentation);
      await fulfill(route, renderTemplateGalleryPreviews(template, locale, presentation));
      return;
    }
    if (path.endsWith("/programs") && request.method() === "GET") {
      await fulfill(route, { items: existingPrograms, nextCursor: null });
      return;
    }
    if (path.endsWith("/programs") && request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      storedDraft = structuredClone(body);
      revision = 1;
      onCreate?.(body);
      await fulfill(route, {
        id: "created-program-id",
        internalName: body.internalName,
        status: "DRAFT",
        currentDraftVersion: {
          id: "33333333-3333-4333-8333-333333333333",
          versionNumber: 1,
          revision,
          status: "DRAFT",
          editingMode: body.editingMode === "pro" ? "PRO" : "QUICK",
        },
        currentPublishedVersion: null,
      });
      return;
    }
    if (
      path ===
        `/v1/organizations/${templateGalleryOrganizationId}/programs/created-program-id/versions` &&
      request.method() === "GET"
    ) {
      await fulfill(route, { items: programDetail()?.versions ?? [], nextCursor: null });
      return;
    }
    if (
      path === `/v1/organizations/${templateGalleryOrganizationId}/programs/created-program-id` &&
      request.method() === "GET"
    ) {
      const detail = programDetail();
      if (!detail) {
        await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        return;
      }
      await fulfill(route, detail);
      return;
    }
    if (
      path === `/v1/organizations/${templateGalleryOrganizationId}/programs/created-program-id` &&
      request.method() === "PATCH"
    ) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      onPatch?.(body);
      if (remainingPatchFailures > 0) {
        remainingPatchFailures -= 1;
        await reject(route, 503, "PROGRAM_DRAFT_SAVE_FAILED", "Draft save unavailable.");
        return;
      }
      if (remainingPatchConflicts > 0) {
        remainingPatchConflicts -= 1;
        revision += 1;
        await reject(route, 409, "STALE_PROGRAM_DRAFT", "Draft revision is stale.", {
          expectedRevision: revision,
          receivedRevision: body.revision,
        });
        return;
      }
      if (patchDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, patchDelayMs));
      const { revision: _requestRevision, ...nextDraft } = body;
      storedDraft = structuredClone(nextDraft);
      revision += 1;
      await fulfill(route, { currentDraftVersion: programDetail()?.currentDraftVersion });
      return;
    }
    if (
      path ===
        `/v1/organizations/${templateGalleryOrganizationId}/programs/created-program-id/preview` &&
      request.method() === "GET"
    ) {
      const preview = builderPreview(url);
      if (!preview) {
        await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        return;
      }
      if (previewDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, previewDelayMs));
      onBuilderPreview?.(preview.profile, url.searchParams.get("locale") ?? "EN", preview);
      await fulfill(route, preview);
      return;
    }
    if (
      path ===
        `/v1/organizations/${templateGalleryOrganizationId}/programs/created-program-id/validate` &&
      request.method() === "POST"
    ) {
      validationRequestCount += 1;
      const activeValidationErrors = validationRequestCount > 1 ? validationErrors : [];
      await fulfill(route, {
        status: activeValidationErrors.length ? "FAILED" : "PASSED",
        configurationFingerprint: "builder-test-fingerprint",
        errors: activeValidationErrors,
        warnings: [],
      });
      return;
    }
    if (
      path.endsWith("/programs/created-program-id/test-sessions") &&
      request.method() === "POST"
    ) {
      testStampCount = 0;
      testCycleCount = 0;
      await fulfill(route, testSession());
      return;
    }
    const testBase = `/v1/organizations/${templateGalleryOrganizationId}/programs/test-sessions/77777777-7777-4777-8777-777777777777`;
    if (path === testBase && request.method() === "GET") {
      await fulfill(route, testSession());
      return;
    }
    if (path === `${testBase}/stamps` && request.method() === "POST") {
      const goal = Number(storedDraft?.requiredStampCount ?? 8);
      testStampCount = Math.min(goal, testStampCount + 1);
      await fulfill(route, { accepted: true });
      return;
    }
    if (path === `${testBase}/reset` && request.method() === "POST") {
      testStampCount = 0;
      await fulfill(route, { accepted: true });
      return;
    }
    if (path.startsWith(`${testBase}/redeem/`) && request.method() === "POST") {
      testStampCount = 0;
      testCycleCount += 1;
      await fulfill(route, { accepted: true });
      return;
    }
    if (path.endsWith("/programs/created-program-id/publish") && request.method() === "POST") {
      publicationRequestCount += 1;
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      onPublish?.(body, publicationRequestCount);
      if (publishDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, publishDelayMs));
      if (remainingPublicationFailures > 0) {
        remainingPublicationFailures -= 1;
        await reject(route, 503, publicationFailureCode, "Publication could not be completed.");
        return;
      }
      const remainedPaused = currentStudioState === "PAUSED_WITH_CHANGES";
      currentStudioState = remainedPaused ? "PAUSED" : "LIVE";
      await fulfill(route, {
        status: "COMPLETED",
        trialStarted: billingStatus === "PENDING_ACTIVATION",
        trialStart: billingStatus === "PENDING_ACTIVATION" ? "2026-08-06T10:00:00.000Z" : null,
        trialEnd: billingStatus === "PENDING_ACTIVATION" ? "2026-08-21T10:00:00.000Z" : null,
      });
      return;
    }
    const lifecycleMatch = path.match(
      /\/programs\/created-program-id\/(pause|resume|archive|restore)$/u,
    );
    if (lifecycleMatch && request.method() === "POST") {
      const action = lifecycleMatch[1];
      if (action === "pause") currentStudioState = "PAUSED";
      if (action === "resume") currentStudioState = "LIVE";
      if (action === "archive") currentStudioState = "ARCHIVED";
      if (action === "restore") currentStudioState = "LIVE";
      await fulfill(route, { status: programDetail()?.status });
      return;
    }
    if (path.endsWith("/programs/created-program-id/draft") && request.method() === "POST") {
      currentStudioState =
        currentStudioState === "PAUSED" ? "PAUSED_WITH_CHANGES" : "LIVE_WITH_CHANGES";
      await fulfill(route, programDetail());
      return;
    }
    if (path.endsWith("/audit") && request.method() === "GET") {
      const stateAction =
        currentStudioState === "PAUSED"
          ? "program.paused"
          : currentStudioState === "ARCHIVED"
            ? "program.archived"
            : "program.published";
      await fulfill(route, {
        items: [
          {
            id: "audit-publication-event",
            action: stateAction,
            targetType: "loyalty_program",
            targetId: "created-program-id",
            createdAt: "2026-08-06T10:00:00.000Z",
            actor: { id: "merchant-template-gallery-owner", displayName: "Gallery Merchant" },
            metadata: {
              publicationType: "FIRST_PUBLICATION",
              programId: "created-program-id",
            },
          },
        ],
        nextCursor: null,
      });
      return;
    }
    if (path.endsWith("/locations")) {
      await fulfill(route, { items: fixtureLocations });
      return;
    }
    const assetContentMatch = path.match(/\/assets\/([^/]+)\/content$/u);
    if (assetContentMatch) {
      const artwork = currentArtwork();
      const content =
        assetContentMatch[1] === filledAssetId ? artwork?.filled.content : artwork?.empty.content;
      if (!content) {
        await route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "access-control-allow-origin": request.headers().origin ?? "http://localhost:3001",
          "access-control-allow-credentials": "true",
        },
        body: content,
      });
      return;
    }
    if (path.endsWith("/assets")) {
      await fulfill(route, { items: currentAssets(), nextCursor: null });
      return;
    }
    if (path.endsWith("/wallet/providers")) {
      await fulfill(route, walletHealth);
      return;
    }
    if (path.endsWith("/programs/created-program-id/enrollment") && request.method() === "GET") {
      const detail = programDetail();
      const policy = {
        emailCollectionMode: "OPTIONAL",
        primaryCustomerLocale: "en",
        allowLocaleSelection: true,
        marketingConsentVisible: true,
        marketingConsentDefault: false,
        customerTermsRequired: true,
        transferWithoutEmailAllowed: false,
        enrollmentOpen,
      };
      await fulfill(route, {
        programId: "created-program-id",
        status: detail?.status ?? "DRAFT",
        publicSlug: "gallery-coffee-rewards",
        publicUrl: "http://localhost:3002/enroll/gallery-coffee-rewards",
        enrollmentLinkStatus:
          detail?.status === "PUBLISHED"
            ? "ACTIVE"
            : ["PAUSED", "ARCHIVED", "SUSPENDED"].includes(detail?.status ?? "")
              ? "BLOCKED"
              : "NOT_PUBLISHED",
        editableVersion: detail?.currentDraftVersion
          ? {
              id: detail.currentDraftVersion.id,
              versionNumber: detail.currentDraftVersion.versionNumber,
              status: detail.currentDraftVersion.status,
              policy,
            }
          : null,
        publishedVersion: detail?.currentPublishedVersion
          ? {
              id: detail.currentPublishedVersion.id,
              versionNumber: detail.currentPublishedVersion.versionNumber,
              status: detail.currentPublishedVersion.status,
              policy,
            }
          : null,
      });
      return;
    }
    if (
      (path.endsWith("/enrollment") || path.endsWith("/public-slug")) &&
      request.method() === "PATCH"
    ) {
      await fulfill(route, { saved: true });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

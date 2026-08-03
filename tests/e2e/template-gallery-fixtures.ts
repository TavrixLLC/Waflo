import type { Page, Route } from "@playwright/test";
import { artworkFor } from "../../apps/api/src/programs/library-artwork.js";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import {
  renderTemplateGalleryPreviews,
  renderTemplateGalleryThumbnail,
} from "../../apps/api/src/programs/template-gallery-preview.js";
import type { TemplateItem } from "../../apps/merchant-dashboard/components/program-studio-types.js";
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
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "http://localhost:3001",
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
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "http://localhost:3001",
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
    patchFailures = 0,
    patchConflicts = 0,
    selectedPlan = "GROWTH",
    existingPrograms = [],
    fixtureLocations = [{ id: "gallery-location", name: "Gallery Main Branch", status: "ACTIVE" }],
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
    patchFailures?: number;
    patchConflicts?: number;
    selectedPlan?: "STARTER" | "GROWTH" | "SCALE";
    existingPrograms?: Array<Record<string, unknown>>;
    fixtureLocations?: Array<{ id: string; name: string; status: string }>;
  } = {},
): Promise<void> {
  const filledAssetId = "55555555-5555-4555-8555-555555555555";
  const emptyAssetId = "66666666-6666-4666-8666-666666666666";
  let storedDraft: Record<string, unknown> | null = null;
  let revision = 1;
  let testStampCount = 0;
  let testCycleCount = 0;
  let remainingPatchFailures = patchFailures;
  let remainingPatchConflicts = patchConflicts;

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
    const version = {
      id: "33333333-3333-4333-8333-333333333333",
      versionNumber: 1,
      status: "DRAFT",
      editingMode: storedDraft.editingMode === "pro" ? "PRO" : "QUICK",
      baseTemplateCode: storedDraft.templateCode,
      baseTemplateVersion: storedDraft.templateVersion,
      revision,
      changeSummary: storedDraft.changeSummary ?? null,
      validatedAt: null,
      testReadyAt: null,
      publishedAt: null,
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
    return {
      id: "created-program-id",
      internalName: storedDraft.internalName,
      status: "DRAFT",
      updatedAt: "2026-08-03T10:00:00.000Z",
      currentDraftVersion: version,
      currentPublishedVersion: null,
      versions: [version],
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
    const version = detail?.currentDraftVersion;
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

  await page.route("http://localhost:4000/v1/**", async (route) => {
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
      await fulfill(route, { id: templateGalleryOrganizationId, businessCategory });
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
      await fulfill(route, {
        status: "PASSED",
        configurationFingerprint: "builder-test-fingerprint",
        errors: [],
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
          "access-control-allow-origin": "http://localhost:3001",
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
      await fulfill(route, []);
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

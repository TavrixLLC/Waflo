import { describe, expect, it } from "vitest";
import {
  deriveProgramSharingPresentation,
  enrollmentOperationalCopy,
  hasSavedUnpublishedChanges,
  isLocalPreviewUrl,
  publicationFailurePresentation,
  publicationMode,
  selectCustomerPreviewSource,
  walletSurfacePresentation,
} from "../../apps/merchant-dashboard/components/program-publication-presentation.js";

describe("merchant publication presentation", () => {
  it("distinguishes a first launch from a published-card update", () => {
    expect(publicationMode(false)).toBe("first-launch");
    expect(publicationMode(true)).toBe("update");
    expect(hasSavedUnpublishedChanges({ hasPublishedVersion: true, hasDraftVersion: true })).toBe(
      true,
    );
    expect(hasSavedUnpublishedChanges({ hasPublishedVersion: true, hasDraftVersion: false })).toBe(
      false,
    );
  });

  it("selects the current published customer preview independently of pending changes", () => {
    expect(
      selectCustomerPreviewSource({
        hasCurrentPublishedVersion: true,
        currentPublishedPreview: "published-card",
        savedDraft: null,
        draftPreviewSupported: true,
      }),
    ).toEqual({ source: "published", preview: "published-card" });

    expect(
      selectCustomerPreviewSource({
        hasCurrentPublishedVersion: true,
        currentPublishedPreview: "published-card",
        savedDraft: "saved-draft",
        draftPreviewSupported: true,
      }),
    ).toEqual({ source: "published", preview: "published-card" });
  });

  it("uses a supported first-launch draft without treating it as published", () => {
    expect(
      selectCustomerPreviewSource({
        hasCurrentPublishedVersion: false,
        currentPublishedPreview: null,
        savedDraft: "saved-draft",
        draftPreviewSupported: true,
      }),
    ).toEqual({ source: "draft", preview: "saved-draft" });
  });

  it("does not substitute draft content when a published preview payload is unavailable", () => {
    expect(
      selectCustomerPreviewSource({
        hasCurrentPublishedVersion: true,
        currentPublishedPreview: null,
        savedDraft: "saved-draft",
        draftPreviewSupported: true,
      }),
    ).toEqual({ source: "unavailable", preview: null });

    expect(
      selectCustomerPreviewSource({
        hasCurrentPublishedVersion: false,
        currentPublishedPreview: null,
        savedDraft: "archived-draft",
        draftPreviewSupported: false,
      }),
    ).toEqual({ source: "unavailable", preview: null });
  });

  it("maps actionable publication failures without exposing raw server errors", () => {
    expect(publicationFailurePresentation("PROGRAM_TEST_REQUIRED", false)).toMatchObject({
      action: "checks",
      retrySafe: false,
      title: "Launch checks changed",
    });
    expect(
      publicationFailurePresentation("PROGRAM_PUBLICATION_LOCATION_STALE", false),
    ).toMatchObject({ action: "locations", retrySafe: false });
    expect(publicationFailurePresentation("PROGRAM_LIMIT_REACHED", false)).toMatchObject({
      action: "billing",
      retrySafe: false,
    });
    expect(publicationFailurePresentation("PROGRAM_PUBLICATION_ASSET_STALE", false)).toMatchObject({
      action: "design",
      retrySafe: false,
    });
    const conflict = publicationFailurePresentation("STALE_PROGRAM_DRAFT", false);
    expect(conflict).toMatchObject({
      action: "reload",
      actionLabel: "Load latest changes",
      retrySafe: false,
    });
    expect(publicationFailurePresentation("FORBIDDEN", false)).toMatchObject({
      action: "studio",
      retrySafe: false,
    });
    const retry = publicationFailurePresentation("NETWORK_ERROR", false);
    expect(retry).toMatchObject({
      action: "retry",
      retrySafe: true,
      remainsSafe: "Your saved changes and current live card remain unchanged.",
    });
    expect(`${retry.whatHappened} ${retry.remainsSafe}`).not.toMatch(
      /idempoten|same request|request identity/iu,
    );
    expect(`${conflict.whatHappened} ${conflict.actionLabel}`).not.toMatch(/version/iu);
  });

  it("keeps Customer Web truth separate from Wallet provider health", () => {
    expect(walletSurfacePresentation(undefined, false)).toMatchObject({
      label: "Status unavailable",
      tone: "neutral",
    });
    expect(
      walletSurfacePresentation(
        {
          provider: "APPLE",
          mode: "DISABLED",
          status: "NOT_CONFIGURED",
          configured: false,
          providerReachable: null,
          productionCertified: false,
        },
        false,
      ),
    ).toMatchObject({ label: "Unavailable", tone: "neutral" });
    expect(
      walletSurfacePresentation(
        {
          provider: "GOOGLE",
          mode: "REAL_PROVIDER",
          status: "DEGRADED",
          configured: true,
          providerReachable: false,
          productionCertified: false,
        },
        false,
      ),
    ).toMatchObject({ label: "Temporarily unavailable", tone: "warning" });
  });

  it("communicates paused and archived customer access precisely", () => {
    expect(enrollmentOperationalCopy("PAUSED", true, false).explanation).toContain(
      "Existing customers can view",
    );
    expect(enrollmentOperationalCopy("ARCHIVED", true, false).explanation).toContain(
      "removed from discovery",
    );
    expect(enrollmentOperationalCopy("PUBLISHED", false, false)).toMatchObject({
      label: "Customer enrollment is off",
      tone: "warning",
    });
  });

  it.each([
    {
      lifecycle: "PUBLISHED",
      enrollmentOpen: true,
      state: "enrollment_open",
      primaryAction: "share",
      canShare: true,
      canDownloadQr: true,
    },
    {
      lifecycle: "PUBLISHED",
      enrollmentOpen: false,
      state: "enrollment_disabled",
      primaryAction: "review-enrollment",
      canShare: false,
      canDownloadQr: false,
    },
    {
      lifecycle: "PAUSED",
      enrollmentOpen: true,
      state: "paused",
      primaryAction: "resume",
      canShare: false,
      canDownloadQr: false,
    },
    {
      lifecycle: "ARCHIVED",
      enrollmentOpen: true,
      state: "archived",
      primaryAction: "restore",
      canShare: false,
      canDownloadQr: false,
    },
  ] as const)("derives $state sharing from lifecycle and enrollment together", (scenario) => {
    expect(
      deriveProgramSharingPresentation({
        lifecycle: scenario.lifecycle,
        enrollmentPolicy: { enrollmentOpen: scenario.enrollmentOpen },
        hasPublishedVersion: true,
        publicUrl: "https://cards.waflo.example/enroll/cafe",
        slug: "cafe",
        qrAvailability: true,
        customerAccessState: "available",
        locale: "en",
      }),
    ).toMatchObject({
      state: scenario.state,
      primaryAction: scenario.primaryAction,
      canShare: scenario.canShare,
      canCopyJoinLink: scenario.canShare,
      canOpenJoinPage: scenario.canShare,
      canDownloadQr: scenario.canDownloadQr,
    });
  });

  it("labels development-only links without mistaking production URLs", () => {
    expect(isLocalPreviewUrl("http://localhost:3002/enroll/cafe")).toBe(true);
    expect(isLocalPreviewUrl("https://cards.waflo.example/enroll/cafe")).toBe(false);
    expect(isLocalPreviewUrl("not a url")).toBe(false);
  });
});

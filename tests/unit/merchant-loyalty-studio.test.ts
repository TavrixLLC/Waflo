import { describe, expect, it } from "vitest";
import {
  deriveStudioLifecyclePresentation,
  merchantStudioState,
  studioAreaForPublicationError,
  studioAreaForValidationPath,
  studioAreas,
  studioOperationError,
} from "../../apps/merchant-dashboard/components/program-studio-presentation.js";

const baseLifecycleInput = {
  programStatus: "DRAFT" as const,
  draftVersionStatus: "DRAFT",
  locale: "en" as const,
  validationState: "not-run" as const,
  testState: "incomplete" as const,
  designComplete: true,
  locationsReady: true,
  hasPublishedVersion: false,
  publicationAllowed: true,
  planName: "GROWTH" as const,
};

describe("merchant Loyalty Studio information architecture", () => {
  it("uses safe task-oriented failure language without backend diagnostics", () => {
    const english = studioOperationError("save", "en");
    const arabic = studioOperationError("preview", "ar");

    expect(english).toContain("last saved version is still safe");
    expect(english).not.toMatch(/request|revision|enum|provider/iu);
    expect(arabic).toContain("لم تتغير بطاقتك المحفوظة");
    expect(arabic).not.toMatch(/request|revision|enum|provider/iu);
  });

  it("exposes six task-oriented areas in the intended order", () => {
    expect(studioAreas).toEqual([
      "overview",
      "how-it-works",
      "customers-locations",
      "test",
      "launch",
      "settings",
    ]);
  });

  it("routes readiness fixes to a merchant task instead of a backend section", () => {
    expect(studioAreaForValidationPath("earning.maximumStampsPerOperation")).toBe("how-it-works");
    expect(studioAreaForValidationPath("rewards.finalReward")).toBe("how-it-works");
    expect(studioAreaForValidationPath("locations.active")).toBe("customers-locations");
    expect(studioAreaForValidationPath("content.ar.programName")).toBe("overview");
    expect(studioAreaForValidationPath("apple.preview")).toBe("overview");
    expect(studioAreaForValidationPath("test.completed")).toBe("test");
  });

  it("routes publication failures to the place where a merchant can act", () => {
    expect(studioAreaForPublicationError("PROGRAM_PUBLICATION_LOCATION_STALE")).toBe(
      "customers-locations",
    );
    expect(studioAreaForPublicationError("PROGRAM_TEST_REQUIRED")).toBe("test");
    expect(studioAreaForPublicationError("PROGRAM_PUBLICATION_ASSET_STALE")).toBe("overview");
    expect(studioAreaForPublicationError("PROGRAM_PUBLICATION_VALIDATION_STALE")).toBe("launch");
  });
});

describe("merchant Loyalty Studio lifecycle presentation", () => {
  it.each([
    ["DRAFT", "DRAFT", "draft", "Draft"],
    ["TEST", "TEST_READY", "ready", "Ready to launch"],
    ["PUBLISHED", null, "live", "Live"],
    ["PAUSED", null, "paused", "Paused"],
    ["ARCHIVED", null, "archived", "Archived"],
  ] as const)("maps %s to the expected merchant state", (status, draftStatus, key, label) => {
    expect(merchantStudioState(status, draftStatus, "en")).toMatchObject({ key, label });
  });

  it("provides complete Arabic lifecycle labels and explanations", () => {
    for (const [status, draftStatus] of [
      ["DRAFT", "DRAFT"],
      ["TEST", "TEST_READY"],
      ["PUBLISHED", null],
      ["PAUSED", null],
      ["ARCHIVED", null],
    ] as const) {
      const presentation = merchantStudioState(status, draftStatus, "ar");
      expect(presentation.label).toMatch(/[\u0600-\u06ff]/u);
      expect(presentation.description).toMatch(/[\u0600-\u06ff]/u);
    }
  });

  it.each([
    {
      name: "draft before checks",
      input: {},
      label: "Draft",
      guidance: "Card design complete",
      primary: "Run readiness checks",
      liveStage: "pending",
      launch: "Run checks",
      setting: "canArchive",
    },
    {
      name: "draft after checks",
      input: { draftVersionStatus: "VALIDATED", validationState: "passed" },
      label: "Draft",
      guidance: "Automated checks passed",
      primary: "Start test",
      liveStage: "pending",
      launch: "Go to Test",
      setting: "canArchive",
    },
    {
      name: "ready",
      input: {
        draftVersionStatus: "TEST_READY",
        validationState: "passed",
        testState: "complete",
      },
      label: "Ready to launch",
      guidance: "Ready to launch",
      primary: "Review launch",
      liveStage: "current",
      launch: "Launch loyalty card",
      setting: "canArchive",
    },
    {
      name: "live",
      input: {
        programStatus: "PUBLISHED",
        draftVersionStatus: "PUBLISHED",
        hasPublishedVersion: true,
      },
      label: "Live",
      guidance: "Your loyalty card is live",
      primary: "View customers",
      liveStage: "complete",
      launch: "View customers",
      setting: "canPause",
    },
    {
      name: "paused",
      input: {
        programStatus: "PAUSED",
        draftVersionStatus: "PUBLISHED",
        hasPublishedVersion: true,
      },
      label: "Paused",
      guidance: "Your loyalty card is paused",
      primary: "Resume card",
      liveStage: "paused",
      launch: "Resume card",
      setting: "canResume",
    },
    {
      name: "archived",
      input: {
        programStatus: "ARCHIVED",
        draftVersionStatus: "PUBLISHED",
        hasPublishedVersion: true,
        publicationAllowed: false,
      },
      label: "Archived",
      guidance: "This loyalty card is archived",
      primary: "Restore card",
      liveStage: "archived",
      launch: "Restore card",
      setting: "canRestore",
    },
    {
      name: "scheduled",
      input: {
        programStatus: "SCHEDULED",
        draftVersionStatus: "TEST_READY",
        publicationAllowed: false,
      },
      label: "Scheduled to go live",
      guidance: "Your loyalty card is scheduled",
      primary: "View launch schedule",
      liveStage: "current",
      launch: "View launch schedule",
      setting: "canArchive",
    },
    {
      name: "suspended",
      input: {
        programStatus: "SUSPENDED",
        draftVersionStatus: "PUBLISHED",
        hasPublishedVersion: true,
        publicationAllowed: false,
      },
      label: "Temporarily unavailable",
      guidance: "Your loyalty card is temporarily unavailable",
      primary: "View card status",
      liveStage: "blocked",
      launch: "View card status",
      setting: "canArchive",
    },
  ] as const)("normalizes $name across every Studio surface", (scenario) => {
    const presentation = deriveStudioLifecyclePresentation({
      ...baseLifecycleInput,
      ...scenario.input,
    });

    expect(presentation.label).toBe(scenario.label);
    expect(presentation.description).not.toHaveLength(0);
    expect(presentation.guidance.title).toBe(scenario.guidance);
    expect(presentation.primaryAction.label).toBe(scenario.primary);
    expect(presentation.journeyStages.find((stage) => stage.key === "live")?.state).toBe(
      scenario.liveStage,
    );
    expect(presentation.launch.action.label).toBe(scenario.launch);
    expect(presentation.capabilities[scenario.setting]).toBe(true);
  });

  it("never sends a live, paused, or archived card back to draft work", () => {
    for (const programStatus of ["PUBLISHED", "PAUSED", "ARCHIVED"] as const) {
      const presentation = deriveStudioLifecyclePresentation({
        ...baseLifecycleInput,
        programStatus,
        draftVersionStatus: "PUBLISHED",
        hasPublishedVersion: true,
        publicationAllowed: programStatus !== "ARCHIVED",
      });
      expect(presentation.primaryAction.label).not.toMatch(
        /Run readiness checks|Start test|Review launch|Launch loyalty card/u,
      );
    }
  });

  it("keeps the ready journey truthful and separates saved changes from the live card", () => {
    const ready = deriveStudioLifecyclePresentation({
      ...baseLifecycleInput,
      draftVersionStatus: "TEST_READY",
      validationState: "passed",
      testState: "complete",
    });
    expect(ready.journeyStages.find((stage) => stage.key === "live")).toMatchObject({
      state: "current",
      hint: "Publish to make available",
    });

    const changes = deriveStudioLifecyclePresentation({
      ...baseLifecycleInput,
      programStatus: "PUBLISHED",
      draftVersionStatus: "TEST_READY",
      validationState: "passed",
      testState: "complete",
      hasPublishedVersion: true,
      hasUnpublishedChanges: true,
    });
    expect(changes).toMatchObject({
      label: "Live",
      guidance: {
        title: "Saved changes · Not live yet",
        description:
          "Review the saved changes before publishing them. The current live card is unchanged.",
      },
      primaryAction: { label: "Review changes" },
    });
  });

  it("keeps automated checks scoped when the demo cycle is incomplete", () => {
    const presentation = deriveStudioLifecyclePresentation({
      ...baseLifecycleInput,
      draftVersionStatus: "VALIDATED",
      validationState: "passed",
    });
    expect(presentation.launch.label).toBe("Not ready to launch");
    expect(presentation.launch.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "automated", status: "Passed", complete: true }),
        expect.objectContaining({ key: "test", status: "Required", blocking: true }),
      ]),
    );
    expect(presentation.launch.action).toMatchObject({ label: "Go to Test", area: "test" });
  });

  it("reports location, plan, and asset blockers without weakening publish guards", () => {
    const location = deriveStudioLifecyclePresentation({
      ...baseLifecycleInput,
      validationState: "passed",
      testState: "complete",
      draftVersionStatus: "TEST_READY",
      locationsReady: false,
    });
    expect(location.launch.requirements.find((item) => item.key === "locations")).toMatchObject({
      status: "Blocks launch",
      blocking: true,
      action: { label: "Choose locations", area: "customers-locations" },
    });
    expect(location.launch.canPublish).toBe(false);

    const plan = deriveStudioLifecyclePresentation({
      ...baseLifecycleInput,
      validationState: "failed",
      validationIssues: [{ code: "PROGRAM_PLAN_LIMIT_REACHED", path: "plan.limit" }],
    });
    expect(plan.launch.requirements.find((item) => item.key === "plan")).toMatchObject({
      status: "Blocks launch",
      blocking: true,
      action: { label: "Review plan blocker", kind: "run-checks" },
    });

    const asset = deriveStudioLifecyclePresentation({
      ...baseLifecycleInput,
      validationState: "failed",
      validationIssues: [{ code: "PROGRAM_ASSET_REQUIRED", path: "artwork.logo" }],
    });
    expect(asset.launch.requirements.find((item) => item.key === "automated")).toMatchObject({
      status: "Needs attention",
      blocking: true,
    });
    expect(studioAreaForValidationPath("artwork.logo")).toBe("overview");
  });

  it("localizes every repaired lifecycle surface in Arabic", () => {
    for (const programStatus of [
      "DRAFT",
      "PUBLISHED",
      "PAUSED",
      "ARCHIVED",
      "SCHEDULED",
      "SUSPENDED",
    ] as const) {
      const presentation = deriveStudioLifecyclePresentation({
        ...baseLifecycleInput,
        locale: "ar",
        programStatus,
        draftVersionStatus: programStatus === "DRAFT" ? "TEST_READY" : "PUBLISHED",
        hasPublishedVersion: ["PUBLISHED", "PAUSED", "ARCHIVED", "SUSPENDED"].includes(
          programStatus,
        ),
        publicationAllowed: !["ARCHIVED", "SCHEDULED", "SUSPENDED"].includes(programStatus),
      });
      expect(
        [
          presentation.label,
          presentation.description,
          presentation.guidance.title,
          presentation.guidance.description,
          presentation.primaryAction.label,
          presentation.launch.label,
          presentation.launch.description,
        ].every((value) => /[\u0600-\u06ff]/u.test(value)),
      ).toBe(true);
    }
  });
});

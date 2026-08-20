import { describe, expect, it } from "vitest";
import { deriveOverviewNextStep } from "../../apps/merchant-dashboard/components/overview-next-step.js";
import type { ProgramItem } from "../../apps/merchant-dashboard/components/program-studio-types.js";

function program(state: "draft" | "ready" | "live" | "unpublished" | "archived"): ProgramItem {
  const draft = {
    id: "draft",
    versionNumber: 2,
    revision: 1,
    status: state === "ready" ? "VALIDATED" : "DRAFT",
    editingMode: "QUICK" as const,
  };
  const published = {
    id: "published",
    versionNumber: 1,
    status: "PUBLISHED",
  };
  return {
    id: state,
    internalName: `${state} card`,
    status:
      state === "archived"
        ? "ARCHIVED"
        : state === "live" || state === "unpublished"
          ? "PUBLISHED"
          : state === "ready"
            ? "VALIDATED"
            : "DRAFT",
    currentDraftVersion:
      state === "draft" || state === "ready" || state === "unpublished" ? draft : null,
    currentPublishedVersion: state === "live" || state === "unpublished" ? published : null,
  };
}

describe("Overview next-step truth", () => {
  it("distinguishes zero cards from archived-only history", () => {
    expect(deriveOverviewNextStep([])).toBe("first");
    expect(deriveOverviewNextStep([program("archived")])).toBe("archived");
  });

  it.each(["draft", "ready", "live", "unpublished"] as const)(
    "derives the authoritative %s action",
    (state) => expect(deriveOverviewNextStep([program(state)])).toBe(state),
  );

  it("prioritizes unpublished live changes over other cards", () => {
    expect(
      deriveOverviewNextStep([program("archived"), program("draft"), program("unpublished")]),
    ).toBe("unpublished");
  });
});

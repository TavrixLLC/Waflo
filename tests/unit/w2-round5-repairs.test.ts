import { decideProgramPublicationState } from "../../packages/contracts/src/index.js";
import { describe, expect, it } from "vitest";

describe("W2 Round 5 publication operational-state policy", () => {
  it.each(["DRAFT", "VALIDATED", "TEST"] as const)(
    "allows first publication from %s and results in PUBLISHED",
    (programStatus) => {
      expect(
        decideProgramPublicationState({
          programStatus,
          hasCurrentPublishedVersion: false,
        }),
      ).toEqual({
        allowed: true,
        previousOperationalState: programStatus,
        resultingOperationalState: "PUBLISHED",
        publicationType: "FIRST_PUBLICATION",
        remainedPaused: false,
        preservePausedAt: false,
      });
    },
  );

  it("keeps a published replacement published", () => {
    expect(
      decideProgramPublicationState({
        programStatus: "PUBLISHED",
        hasCurrentPublishedVersion: true,
      }),
    ).toMatchObject({
      allowed: true,
      resultingOperationalState: "PUBLISHED",
      publicationType: "REPLACEMENT_PUBLICATION",
      remainedPaused: false,
      preservePausedAt: false,
    });
  });

  it("keeps a paused replacement paused and preserves pausedAt", () => {
    expect(
      decideProgramPublicationState({
        programStatus: "PAUSED",
        hasCurrentPublishedVersion: true,
      }),
    ).toEqual({
      allowed: true,
      previousOperationalState: "PAUSED",
      resultingOperationalState: "PAUSED",
      publicationType: "REPLACEMENT_PUBLICATION",
      remainedPaused: true,
      preservePausedAt: true,
    });
  });

  it.each(["ARCHIVED", "SUSPENDED", "SCHEDULED"] as const)(
    "blocks publication from %s",
    (programStatus) => {
      const decision = decideProgramPublicationState({
        programStatus,
        hasCurrentPublishedVersion: programStatus !== "ARCHIVED",
      });
      expect(decision).toMatchObject({
        allowed: false,
        previousOperationalState: programStatus,
      });
      if (programStatus === "ARCHIVED")
        expect(decision).toMatchObject({ requiredAction: "RESTORE_PROGRAM" });
    },
  );

  it("blocks inconsistent first and replacement state combinations", () => {
    expect(
      decideProgramPublicationState({
        programStatus: "PUBLISHED",
        hasCurrentPublishedVersion: false,
      }).allowed,
    ).toBe(false);
    expect(
      decideProgramPublicationState({
        programStatus: "TEST",
        hasCurrentPublishedVersion: true,
      }).allowed,
    ).toBe(false);
  });
});

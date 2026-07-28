import { describe, expect, it } from "vitest";
import {
  applyTestStamps,
  canPublish,
  idempotencyMatches,
  preserveOperationalStatus,
} from "../../apps/api/src/programs/program-rules.js";

describe("W2 program invariants", () => {
  it.each(["PUBLISHED", "PAUSED", "ARCHIVED", "SUSPENDED"] as const)(
    "preserves live state %s while editing",
    (status) => {
      expect(preserveOperationalStatus(status)).toBe(status);
    },
  );

  it("separates completed cycles from the visible remainder", () => {
    expect(applyTestStamps(7, 5, 8)).toEqual({ remainder: 4, completedCycles: 1 });
    expect(applyTestStamps(1, 17, 8)).toEqual({ remainder: 2, completedCycles: 2 });
  });

  it("requires Test Mode completion and binds replay keys to a program", () => {
    expect(canPublish("VALIDATED", new Date(), true)).toBe(false);
    expect(canPublish("TEST_READY", new Date(), true)).toBe(true);
    expect(idempotencyMatches("program-a", "program-b")).toBe(false);
  });
});

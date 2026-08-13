import { describe, expect, it } from "vitest";
import {
  isExactActiveReviewDevice,
  isExactReviewSessionBinding,
  isReviewWindowActive,
  REVIEW_FIXTURE_IDS,
  REVIEW_SCENARIOS,
  reviewInvariantLockKeys,
  reviewSessionMetadata,
  sessionModeFromMetadata,
} from "../../apps/api/src/review-access/review-session.js";
import {
  reviewAccessAuthorizeSchema,
  reviewResetSchema,
  reviewScenarioSelectSchema,
} from "../../packages/contracts/src/w4.js";

describe("M3E Review Access security boundary", () => {
  it("accepts only the distinct human-enterable review credential format", () => {
    const base = {
      installationId: "install-review-device-0001",
      publicKey:
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA7AOmurWm8Mzcaea5HRin3NIaC9QlC/ClOY/CttddgQ0=\n-----END PUBLIC KEY-----",
      platform: "ANDROID",
      appVersion: "1.0.0",
    };
    expect(
      reviewAccessAuthorizeSchema.safeParse({ ...base, reviewAccessCode: "ABCD-2345" }).success,
    ).toBe(true);
    for (const reviewAccessCode of ["123456", "ABCI-2345", "ABCD-23456", {}]) {
      expect(reviewAccessAuthorizeSchema.safeParse({ ...base, reviewAccessCode }).success).toBe(
        false,
      );
    }
  });

  it("uses fixed scenario identifiers and rejects arbitrary records", () => {
    expect(REVIEW_SCENARIOS).toHaveLength(7);
    expect(new Set(REVIEW_SCENARIOS.map((scenario) => scenario.id)).size).toBe(7);
    expect(
      reviewScenarioSelectSchema.safeParse({
        scenarioId: "CUSTOMER_ACTIVE_5_OF_8",
        commandId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
    expect(
      reviewScenarioSelectSchema.safeParse({
        scenarioId: "ARBITRARY_RECORD",
        commandId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
    expect(
      reviewResetSchema.safeParse({ commandId: "not-a-uuid", tenantId: "anything" }).success,
    ).toBe(false);
  });

  it("persists an explicit REVIEW session classification", () => {
    expect(sessionModeFromMetadata(reviewSessionMetadata({ platform: "ANDROID" }))).toBe("REVIEW");
    expect(sessionModeFromMetadata({ sessionMode: "NORMAL" })).toBe("NORMAL");
    expect(sessionModeFromMetadata(null)).toBe("NORMAL");
  });

  it("closes review authorization and existing sessions at the configured window", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    expect(isReviewWindowActive(true, "2026-08-14T12:00:01.000Z", now)).toBe(true);
    expect(isReviewWindowActive(false, "2026-08-14T12:00:01.000Z", now)).toBe(false);
    expect(isReviewWindowActive(true, "2026-08-14T12:00:00.000Z", now)).toBe(false);
    expect(isReviewWindowActive(true, "not-a-date", now)).toBe(false);
  });

  it("allows Review Tools only for the exact server-bound review tenant", () => {
    const valid = {
      sessionMode: "REVIEW",
      organizationId: REVIEW_FIXTURE_IDS.organization,
      organizationMemberId: REVIEW_FIXTURE_IDS.member,
      locationId: REVIEW_FIXTURE_IDS.location,
    };
    expect(isExactReviewSessionBinding(valid)).toBe(true);
    for (const invalid of [
      { ...valid, sessionMode: "NORMAL" },
      { ...valid, organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { ...valid, organizationMemberId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { ...valid, locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      undefined,
    ]) {
      expect(isExactReviewSessionBinding(invalid)).toBe(false);
    }
  });

  it("permits re-entry only for the same active review device binding", () => {
    const device = {
      organizationId: REVIEW_FIXTURE_IDS.organization,
      organizationMemberId: REVIEW_FIXTURE_IDS.member,
      installationId: "install-review-device-0001",
      publicKey: "review-public-key",
      trustLevel: "REVIEW",
      status: "ACTIVE",
    };
    const expected = {
      installationId: device.installationId,
      publicKey: device.publicKey,
    };
    expect(isExactActiveReviewDevice(device, expected)).toBe(true);
    for (const invalid of [
      { ...device, organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { ...device, organizationMemberId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { ...device, installationId: "different-installation" },
      { ...device, publicKey: "different-key" },
      { ...device, trustLevel: "PAIRED" },
      { ...device, status: "REVOKED" },
      undefined,
    ]) {
      expect(isExactActiveReviewDevice(invalid, expected)).toBe(false);
    }
  });

  it("serializes reset/scenario changes with real loyalty mutations", () => {
    expect(reviewInvariantLockKeys()).toEqual([`organization:${REVIEW_FIXTURE_IDS.organization}`]);
    expect(reviewInvariantLockKeys()).not.toContain(
      `review-tenant:${REVIEW_FIXTURE_IDS.organization}`,
    );
  });
});

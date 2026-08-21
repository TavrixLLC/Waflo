import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  membershipResolveResultSchema,
  operationCommandStatusResultSchema,
  purchaseCurrencySchema,
  staffDeviceContextResultSchema,
  stampOperationResultSchema,
} from "../../packages/contracts/src/index.js";
import {
  assertStaffMobileAppVersion,
  parseStaffMobileSemanticVersion,
} from "../../packages/staff-device-security/src/index.js";

const digest = "a".repeat(64);
const membershipPublicId = "mem_1234567890abcdef1234567890abcdef";

function resolveFixture(locale: "en" | "ar") {
  return {
    membershipPublicId,
    membershipStatus: "ACTIVE",
    customerDisplayName: locale === "ar" ? "سارة أحمد" : "Sara Ahmed",
    programName: locale === "ar" ? "مكافآت القهوة" : "Coffee rewards",
    locale,
    progress: 5,
    goal: 8,
    rewardReady: false,
    completedCycles: 2,
    projectionVersion: 17,
    locationEligibility: { earning: true, redemption: true },
    operationLimits: {
      maximumStampsPerOperation: 5,
      maximumStampsPerCustomerPerDay: 10,
      dailyRemainingStamps: 4,
    },
    operationalTimezone: "Asia/Baghdad",
    operationalDate: "2026-08-07",
    purchaseRequirement: {
      required: true,
      minimumAmountMinor: 5_000,
      currency: "IQD",
    },
    stampVisuals: {
      filled: { state: "FILLED", contentDigest: digest },
      empty: { state: "EMPTY", contentDigest: "b".repeat(64) },
    },
    availableRewards: [
      {
        publicId: "10000000-0000-4000-8000-000000000001",
        name: locale === "ar" ? "حلوى مجانية" : "Free pastry",
        description: locale === "ar" ? "مكافأة مرحلية" : "Milestone reward",
        threshold: 4,
        finalReward: false,
        status: "AVAILABLE",
        redemptionCount: 0,
        maximumRedemptionCount: 1,
        expiresAt: null,
        requiresManagerApproval: false,
      },
    ],
  };
}

describe("M2 mobile contract compatibility", () => {
  it("requires display-ready organization and current Location context", () => {
    const context = {
      organizationId: "10000000-0000-4000-8000-000000000001",
      organization: {
        id: "10000000-0000-4000-8000-000000000001",
        displayName: "Today Coffee",
      },
      role: "STAFF",
      locationId: "20000000-0000-4000-8000-000000000001",
      currentLocation: {
        id: "20000000-0000-4000-8000-000000000001",
        displayName: "Today Coffee — Karrada",
      },
      devicePublicId: "30000000-0000-4000-8000-000000000001",
      deviceSessionId: "40000000-0000-4000-8000-000000000001",
      platform: "ANDROID",
      appVersion: "1.0.0",
      minimumSupportedAppVersion: "1.0.0",
      appVersionSupported: true,
      requestId: "device-context-request",
    } as const;

    expect(staffDeviceContextResultSchema.parse(context)).toEqual(context);
    expect(
      staffDeviceContextResultSchema.safeParse({
        ...context,
        organization: { ...context.organization, displayName: "   " },
      }).success,
    ).toBe(false);
    expect(
      staffDeviceContextResultSchema.safeParse({
        ...context,
        currentLocation: { ...context.currentLocation, displayName: "" },
      }).success,
    ).toBe(false);
  });

  it("normalizes a three-letter currency string and rejects malformed runtime values", () => {
    expect(purchaseCurrencySchema.parse(" iqd ")).toBe("IQD");
    for (const invalid of [{ code: "IQD" }, ["IQD"], "12A", "US$", "EURO", ""]) {
      expect(purchaseCurrencySchema.safeParse(invalid).success).toBe(false);
    }

    const generated = z.toJSONSchema(purchaseCurrencySchema, { io: "input" }) as {
      type?: string;
      pattern?: string;
      minLength?: number;
      maxLength?: number;
    };
    expect(generated).toMatchObject({
      type: "string",
      pattern: "^[A-Za-z]{3}$",
      minLength: 3,
      maxLength: 3,
    });
  });

  it("parses semantic mobile versions and preserves the configured minimum", () => {
    expect(parseStaffMobileSemanticVersion("2.10.3")).toEqual([2, 10, 3]);
    expect(() =>
      assertStaffMobileAppVersion({
        platform: "IOS",
        appVersion: "1.4.9",
        minimumVersion: "1.5.0",
      }),
    ).toThrowError(expect.objectContaining({ code: "STAFF_APP_VERSION_UNSUPPORTED" }));
    expect(() =>
      assertStaffMobileAppVersion({
        platform: "ANDROID",
        appVersion: "1.5.0",
        minimumVersion: "1.5.0",
      }),
    ).not.toThrow();
    expect(() =>
      assertStaffMobileAppVersion({
        platform: "TEST_CLIENT",
        appVersion: "w4-test-client/1.0",
        minimumVersion: "9.0.0",
      }),
    ).not.toThrow();
  });

  it("accepts English and Arabic localized resolve results with only public operational data", () => {
    for (const locale of ["en", "ar"] as const) {
      const parsed = membershipResolveResultSchema.parse(resolveFixture(locale));
      expect(parsed.locale).toBe(locale);
      expect(parsed.programName).toBe(locale === "ar" ? "مكافآت القهوة" : "Coffee rewards");
      expect(JSON.stringify(parsed).toLocaleLowerCase("en-US")).not.toMatch(
        /customeremail|phone|databaseid|qrpayload|credential|secret/u,
      );
    }
  });

  it("locks the active stamp grid to FILLED and EMPTY artwork without a reward state", () => {
    const fixture = resolveFixture("en");
    const parsed = membershipResolveResultSchema.parse(fixture);
    expect(Object.values(parsed.stampVisuals).map((visual) => visual.state)).toEqual([
      "FILLED",
      "EMPTY",
    ]);
    expect(
      membershipResolveResultSchema.safeParse({
        ...fixture,
        stampVisuals: {
          ...fixture.stampVisuals,
          reward: { state: "REWARD", contentDigest: digest },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps stamp mutation and command recovery results strict and mobile-safe", () => {
    const result = {
      operationPublicId: "20000000-0000-4000-8000-000000000001",
      commandId: "30000000-0000-4000-8000-000000000001",
      replayed: false,
      beforeProgress: 4,
      progress: 5,
      goal: 8,
      rewardReady: false,
      completedCycles: 1,
      projectionVersion: 12,
      unlockedRewards: [],
      requestId: "synthetic-request-1",
    };
    expect(stampOperationResultSchema.parse(result)).toEqual(result);
    expect(
      stampOperationResultSchema.safeParse({ ...result, membershipDatabaseId: "internal" }).success,
    ).toBe(false);

    expect(
      operationCommandStatusResultSchema.parse({
        commandId: result.commandId,
        operationPublicId: result.operationPublicId,
        operationType: "ISSUE_STAMP",
        status: "COMPLETED",
        result,
        safeFailureCode: null,
        createdAt: "2026-08-07T12:00:00.000Z",
        completedAt: "2026-08-07T12:00:01.000Z",
      }).status,
    ).toBe("COMPLETED");
  });
});

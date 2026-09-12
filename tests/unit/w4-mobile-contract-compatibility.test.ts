import { describe, expect, it } from "vitest";
import { staffDeviceFailureDisposition } from "../../apps/api/src/security/guards.js";
import { intersectLocationCapabilities } from "../../apps/api/src/staff-devices/mobile-device-context.js";
import { parseEnvironment } from "../../packages/config/src/index.js";
import {
  compareSemanticVersions,
  mobileStaffDeviceContextSchema,
  parseStrictSemanticVersion,
} from "../../packages/contracts/src/index.js";
import {
  assertDeviceOperational,
  assertStaffMobileAppVersion,
  StaffDeviceSecurityError,
} from "../../packages/staff-device-security/src/index.js";

function operationalInput() {
  return {
    deviceStatus: "ACTIVE",
    sessionRevokedAt: null as Date | null,
    sessionExpiresAt: new Date("2026-08-02T00:00:00.000Z"),
    memberStatus: "ACTIVE",
    now: new Date("2026-08-01T00:00:00.000Z"),
  };
}

function errorCode(input: Parameters<typeof assertDeviceOperational>[0]): string | null {
  try {
    assertDeviceOperational(input);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(StaffDeviceSecurityError);
    return (error as StaffDeviceSecurityError).code;
  }
}

describe("M1 strict semantic app-version policy", () => {
  it.each([
    ["1.10.0", "1.9.9", 1],
    ["2.0.0", "10.0.0", -1],
    ["1.0.0-alpha.2", "1.0.0-alpha.10", -1],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0+ios.7", "1.0.0+android.9", 0],
  ])("compares %s against %s without lexical ordering", (left, right, expected) => {
    expect(Math.sign(compareSemanticVersions(left, right))).toBe(expected);
  });

  it.each(["1", "1.0", "01.0.0", "1.0.0-01", "v1.0.0", "1.0.0.0", "1.0.0+", " 1.0.0"])(
    "rejects unsafe version %s",
    (version) => {
      expect(() => parseStrictSemanticVersion(version)).toThrow();
    },
  );

  it("uses documented development defaults and rejects an unsafe configured version", () => {
    expect(parseEnvironment({ NODE_ENV: "development" })).toMatchObject({
      STAFF_MOBILE_MINIMUM_IOS_VERSION: "1.0.0",
      STAFF_MOBILE_MINIMUM_ANDROID_VERSION: "1.0.0",
    });
    expect(
      parseEnvironment({
        NODE_ENV: "development",
        STAFF_MOBILE_MINIMUM_APP_VERSION: "1.2.3",
      }),
    ).toMatchObject({
      STAFF_MOBILE_MINIMUM_IOS_VERSION: "1.2.3",
      STAFF_MOBILE_MINIMUM_ANDROID_VERSION: "1.2.3",
    });
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        STAFF_MOBILE_MINIMUM_IOS_VERSION: "latest",
      }),
    ).toThrow("STAFF_MOBILE_MINIMUM_IOS_VERSION");
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        STAFF_MOBILE_MINIMUM_IOS_VERSION: "0.0.0",
        STAFF_MOBILE_MINIMUM_ANDROID_VERSION: "0.0.0+disabled",
      }),
    ).toThrow("must enforce a non-zero release");
  });
});

describe("M1 device-state mapping", () => {
  it("keeps the documented state precedence", () => {
    const base = operationalInput();
    expect(
      errorCode({
        ...base,
        deviceStatus: "COMPROMISED",
        memberStatus: "SUSPENDED",
        sessionRevokedAt: new Date(),
        sessionExpiresAt: new Date(0),
        appVersionStatus: "UPDATE_REQUIRED",
      }),
    ).toBe("STAFF_DEVICE_COMPROMISED");
    expect(errorCode({ ...base, deviceStatus: "REVOKED" })).toBe("STAFF_DEVICE_REVOKED");
    expect(errorCode({ ...base, memberStatus: "SUSPENDED" })).toBe("STAFF_DEVICE_MEMBER_INACTIVE");
    expect(errorCode({ ...base, sessionRevokedAt: new Date() })).toBe("STAFF_DEVICE_NOT_ACTIVE");
    expect(errorCode({ ...base, sessionExpiresAt: new Date(0) })).toBe(
      "STAFF_DEVICE_SESSION_EXPIRED",
    );
    expect(errorCode({ ...base, deviceStatus: "PENDING" })).toBe("STAFF_DEVICE_NOT_ACTIVE");
  });

  it("keeps the canonical M2 app-version error and Test Client exemption", () => {
    expect(() =>
      assertStaffMobileAppVersion({
        platform: "ANDROID",
        appVersion: "1.0.0",
        minimumVersion: "2.0.0",
      }),
    ).toThrowError(expect.objectContaining({ code: "STAFF_APP_VERSION_UNSUPPORTED" }));
    expect(() =>
      assertStaffMobileAppVersion({
        platform: "TEST_CLIENT",
        appVersion: "w4-test-client/1.0",
        minimumVersion: "2.0.0",
      }),
    ).not.toThrow();
  });

  it("maps new states to stable audit and risk dispositions", () => {
    expect(staffDeviceFailureDisposition("STAFF_DEVICE_COMPROMISED")).toMatchObject({
      auditSeverity: "CRITICAL",
      riskRuleCode: "DEVICE_COMPROMISED",
      riskScore: 100,
    });
    expect(staffDeviceFailureDisposition("STAFF_DEVICE_REVOKED").riskRuleCode).toBe(
      "DEVICE_REVOKED",
    );
    expect(staffDeviceFailureDisposition("STAFF_APP_VERSION_UNSUPPORTED")).toMatchObject({
      riskRuleCode: "APP_UPDATE_REQUIRED",
      httpStatus: 426,
    });
  });
});

describe("M1 mobile-safe context", () => {
  it("validates the typed DTO and rejects internal fields", () => {
    const dto = {
      organization: { publicId: "today", displayName: "Today Coffee" },
      staff: {
        publicId: "10000000-0000-4000-8000-000000000001",
        displayName: "Amina",
        role: "STAFF",
      },
      device: {
        publicId: "20000000-0000-4000-8000-000000000001",
        displayName: "Front counter",
        status: "ACTIVE",
        platform: "ANDROID",
        appVersion: "1.4.0",
      },
      currentLocation: {
        publicId: "30000000-0000-4000-8000-000000000001",
        displayName: "Main branch",
        earningAllowed: true,
        redemptionAllowed: true,
      },
      assignedLocations: [],
      appPolicy: { minimumSupportedVersion: "1.2.0", updateRequired: false },
      requestId: "fixture-request",
    };
    expect(mobileStaffDeviceContextSchema.parse(dto)).toEqual(dto);
    expect(() =>
      mobileStaffDeviceContextSchema.parse({ ...dto, organizationId: "internal" }),
    ).toThrow();
  });

  it("intersects Staff and device capabilities and removes inactive assignments", () => {
    expect(
      intersectLocationCapabilities(
        [
          {
            locationId: "one",
            earningAllowed: false,
            redemptionAllowed: true,
            active: true,
            revokedAt: null,
          },
          {
            locationId: "two",
            earningAllowed: true,
            redemptionAllowed: true,
            active: false,
            revokedAt: null,
          },
        ],
        [
          {
            locationId: "one",
            earningAllowed: true,
            redemptionAllowed: false,
            active: true,
          },
          {
            locationId: "two",
            earningAllowed: true,
            redemptionAllowed: true,
            active: true,
          },
        ],
      ),
    ).toEqual([{ locationId: "one", earningAllowed: false, redemptionAllowed: false }]);
  });
});

import { describe, expect, it } from "vitest";
import {
  enrollmentInputSchema,
  programEnrollmentPolicySchema,
} from "../../packages/contracts/src/index.js";
import { normalizePhone } from "../../packages/customer-security/src/index.js";
import { layoutStampPositions } from "../../packages/stamp-engine/src/index.js";

describe("phone collection and Grid-only compatibility", () => {
  it("normalizes supported Iraqi local numbers to E.164", () => {
    expect(normalizePhone("0770 123 4567")).toBe("+9647701234567");
    expect(normalizePhone("+964 770 123 4567")).toBe("+9647701234567");
    expect(() => normalizePhone("not a phone")).toThrow("valid phone number");
  });

  it("accepts phone enrollment data and rejects the removed email payload", () => {
    expect(
      enrollmentInputSchema.parse({
        displayName: "Sara",
        phone: "0770 123 4567",
        preferredLocale: "en",
        programTermsAccepted: true,
        wafloPrivacyAccepted: true,
        marketingPhoneConsent: false,
        formStartedAt: Date.now(),
        website: "",
      }),
    ).toMatchObject({ phone: "0770 123 4567" });
    expect(() =>
      enrollmentInputSchema.parse({
        displayName: "Sara",
        email: "sara@example.test",
        preferredLocale: "en",
        programTermsAccepted: true,
        wafloPrivacyAccepted: true,
        formStartedAt: Date.now(),
        website: "",
      }),
    ).toThrow();
    expect(
      programEnrollmentPolicySchema.parse({
        phoneCollectionMode: "REQUIRED",
        primaryCustomerLocale: "en",
        allowLocaleSelection: true,
        marketingConsentVisible: false,
        transferWithoutEmailAllowed: false,
        enrollmentOpen: true,
      }).phoneCollectionMode,
    ).toBe("REQUIRED");
  });

  it("resolves obsolete layout values to the Grid coordinates", () => {
    const grid = layoutStampPositions(9, "GRID");
    expect(layoutStampPositions(9, "ROW")).toEqual(grid);
    expect(layoutStampPositions(9, "PATH")).toEqual(grid);
    expect(layoutStampPositions(9, "RING")).toEqual(grid);
    expect(layoutStampPositions(9, "CIRCLE")).toEqual(grid);
  });
});

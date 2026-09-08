import { describe, expect, it } from "vitest";
import {
  billingDowngradeErrorMessage,
  billingDowngradeViolationMessage,
} from "../../apps/merchant-dashboard/components/billing-presentation.js";
import { googleLinkErrorMessage } from "../../apps/merchant-dashboard/components/security-presentation.js";

describe("Dashboard billing and Google-link presentation", () => {
  it("localizes downgrade codes and retains usage facts without backend prose", () => {
    const violation = { code: "ACTIVE_PROGRAMS", actual: 7, limit: 3 };
    expect(billingDowngradeViolationMessage(violation, "en")).toBe(
      "Archive loyalty cards until the active card count fits the target plan. Current: 7; allowed: 3.",
    );
    expect(billingDowngradeViolationMessage(violation, "ar")).toContain("أرشف بطاقات الولاء");
    expect(billingDowngradeViolationMessage(violation, "ar")).toContain("7");
    expect(billingDowngradeErrorMessage(undefined, "ar")).toContain("لا يمكن خفض الخطة");
  });

  it("uses stable Google-link error codes and keeps password feedback inline-safe", () => {
    expect(googleLinkErrorMessage(undefined, false, "en")).toContain("current Waflo password");
    expect(googleLinkErrorMessage("REAUTHENTICATION_REQUIRED", true, "en")).toContain(
      "could not verify that password",
    );
    expect(googleLinkErrorMessage("REAUTHENTICATION_REQUIRED", true, "ar")).toContain(
      "تعذر التحقق",
    );
    expect(googleLinkErrorMessage("PROVIDER_NOT_CONFIGURED", true, "en")).toContain(
      "not configured",
    );
  });
});

import { describe, expect, it } from "vitest";
import { walletSurfacePresentation } from "../../apps/merchant-dashboard/components/program-publication-presentation.js";

describe("Wallet availability semantics", () => {
  it("keeps configured artifact generation separate from final device eligibility", () => {
    const apple = walletSurfacePresentation(
      {
        provider: "APPLE",
        mode: "REAL",
        status: "EXTERNALLY_UNCERTIFIED",
        configured: true,
        providerConfigured: true,
        artifactAvailable: true,
        installationAvailable: true,
        deviceEligibility: "UNKNOWN",
        providerReachable: false,
        externallyCertified: false,
        safeMessage: "Local signing valid",
        demo: false,
      },
      false,
    );
    expect(apple).toMatchObject({ label: "Configured", tone: "success" });
    expect(apple.explanation).toContain("pass artifacts can be generated");
    expect(apple.explanation).toContain("compatible Apple device");

    const google = walletSurfacePresentation(
      {
        provider: "GOOGLE",
        mode: "REAL",
        status: "HEALTHY",
        configured: true,
        providerConfigured: true,
        artifactAvailable: true,
        installationAvailable: true,
        deviceEligibility: "UNKNOWN",
        providerReachable: true,
        externallyCertified: false,
        safeMessage: "Issuer access verified",
        demo: false,
      },
      false,
    );
    expect(google).toMatchObject({ label: "Configured", tone: "success" });
    expect(google.explanation).toContain("Google save link");
  });
});

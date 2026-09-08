import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("customer Wallet readiness presentation", () => {
  it("keeps enrollment confirmation independent of provider outbox preparation", () => {
    const enrollment = source("apps/customer-web/app/join/[programSlug]/enrollment-form.tsx");
    expect(enrollment).toContain('"View card"');
    expect(enrollment).not.toContain("View card while Wallet prepares");
    expect(enrollment).not.toContain("wallet-readiness");
    expect(enrollment).not.toContain("walletReadiness");
  });

  it("uses bounded canonical card revalidation rather than a repeating preparation poll", () => {
    const card = source("apps/customer-web/app/card/[publicMembershipId]/customer-card.tsx");
    expect(card).toContain("const delays = [1_000, 2_000, 4_000]");
    expect(card).toContain("walletConvergenceAttempts");
    expect(card).not.toContain("window.setInterval");
    expect(card).not.toContain("walletStatusLabel");
    expect(card).toContain('variant="secondary"');
  });

  it("derives exactly one Google authorization banner from canonical server status", () => {
    const settings = source("apps/merchant-dashboard/components/dashboard-screens.tsx");
    expect(settings).toContain("googleReauthenticationRequired");
    expect(settings).toContain("googleReauthenticationVerified");
    expect(settings).toContain(
      'apiFetch<ReauthenticationStatus>("/v1/auth/external/reauthentication")',
    );
    expect(settings).not.toContain(
      '!identitySettings?.passwordEnabled && reauthentication?.status === "VERIFIED"',
    );
  });
});

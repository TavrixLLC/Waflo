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

  it("uses adaptive canonical readiness revalidation without a manual refresh escape hatch", () => {
    const card = source("apps/customer-web/app/card/[publicMembershipId]/customer-card.tsx");
    expect(card).toContain(
      "const walletConvergenceDelays = [250, 500, 1_000, 2_000, 4_000, 8_000, 15_000]",
    );
    expect(card).toContain("walletConvergenceAttempts");
    expect(card).not.toContain("window.setInterval");
    expect(card).toContain("walletDescription");
    expect(card).toContain("walletIsPreparing");
    expect(card).toContain("walletReadinessGeneration");
    expect(card).toContain("wallet-readiness");
    expect(card).not.toContain(">Check again<");
    expect(card).toContain("activeCardRequest.current?.abort()");
    expect(card).toContain("cardRequestGeneration");
    expect(card).toContain("activeReadinessRequest.current?.abort()");
    expect(card).toContain('aria-live="polite"');
  });

  it("uses official Apple and Google Wallet badge files without a styled inner card", () => {
    const card = source("apps/customer-web/app/card/[publicMembershipId]/customer-card.tsx");
    const styles = source("apps/customer-web/app/globals.css");
    expect(card).toContain("/wallet-buttons/apple-add-to-wallet-en.svg");
    expect(card).toContain("/wallet-buttons/google-add-to-wallet-en.svg");
    expect(styles).toContain(".wallet-button img");
    expect(styles).toContain("background: transparent;");
    expect(styles).toContain("box-shadow: none;");
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

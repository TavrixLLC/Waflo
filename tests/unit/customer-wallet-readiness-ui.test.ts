import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("customer Wallet readiness presentation", () => {
  it("sends enrollment straight into the dedicated Wallet preparation journey", () => {
    const enrollment = source("apps/customer-web/app/join/[programSlug]/enrollment-form.tsx");
    const styles = source("apps/customer-web/app/globals.css");
    expect(enrollment).toContain('new URLSearchParams({ wallet: "prepare" })');
    expect(enrollment).toContain("window.location.assign(");
    expect(enrollment).not.toContain("enrollment-success");
    expect(enrollment).toContain("enrollment-terms");
    expect(enrollment).not.toContain("wafloPrivacyAccepted: true");
    expect(enrollment).toContain("...(phone.trim() ? { phone: phone.trim() } : {})");
    expect(styles).toContain(".join-layout--compact .enrollment-summary");
    expect(styles).toContain(".enrollment-summary .program-story__progress");
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

  it("replaces the interim web-card preview with an honest staged Wallet preparation state", () => {
    const card = source("apps/customer-web/app/card/[publicMembershipId]/customer-card.tsx");
    const styles = source("apps/customer-web/app/globals.css");
    expect(card).toContain("WalletPassPreparation");
    expect(card).toContain('data-testid="wallet-preparation"');
    expect(card).toContain("Preparing your Wallet pass");
    expect(card).toContain("Designing your card");
    expect(card).toContain("Applying final details");
    expect(card).toContain("Securing and publishing your pass");
    expect(card).toContain("Checking device compatibility");
    expect(card).toContain("Ready to add");
    expect(card).toContain('role="progressbar"');
    expect(card).toContain("if (waitingForWallet) {");
    expect(card).toContain("walletJourney ? (");
    expect(card).toContain('data-testid="wallet-ready-summary"');
    expect(card).toContain("Your Wallet card is ready");
    expect(card).not.toContain("window.setInterval");
    expect(styles).toContain(".wallet-preparation__checkpoints");
    expect(styles).toContain(".wallet-preparation__orbit--outer");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
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

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { safeCheckoutElementsDiagnosticMessage } from "../../apps/merchant-dashboard/lib/checkout-elements-diagnostics";

describe("Checkout Elements development diagnostics", () => {
  it("keeps the provider message while redacting Stripe credentials and client secrets", () => {
    const message = safeCheckoutElementsDiagnosticMessage(
      "Checkout failed for cs_test_example_secret_example with Bearer sk_test_example, pk_test_example, whsec_example, and client_secret=opaque.",
    );

    expect(message).toContain("Checkout failed for [REDACTED]");
    expect(message).not.toContain("cs_test_example_secret_example");
    expect(message).not.toContain("sk_test_example");
    expect(message).not.toContain("pk_test_example");
    expect(message).not.toContain("whsec_example");
    expect(message).not.toContain("opaque");
  });

  it("normalizes provider text without serializing arbitrary objects", () => {
    expect(safeCheckoutElementsDiagnosticMessage("Stripe\nCheckout\tinitialization failed")).toBe(
      "Stripe Checkout initialization failed",
    );
  });

  it("renders the raw initialization message only in development", () => {
    const onboarding = readFileSync(
      resolve(process.cwd(), "apps/merchant-dashboard/components/onboarding.tsx"),
      "utf8",
    );

    expect(onboarding).toContain(
      'const showRawCheckoutElementsDiagnostics = process.env.NODE_ENV === "development"',
    );
    expect(onboarding).toContain('data-testid="checkout-elements-error-message"');
  });
});

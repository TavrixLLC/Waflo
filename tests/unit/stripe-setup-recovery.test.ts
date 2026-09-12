import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  confirmSetupWithRecovery,
  isOperationTimeoutError,
  withOperationTimeout,
} from "../../apps/merchant-dashboard/lib/stripe-setup-recovery";

interface TestSetupIntent {
  id: string;
  status: string;
}

describe("Stripe SetupIntent confirmation recovery", () => {
  it("returns an immediately confirmed SetupIntent without a recovery request", async () => {
    const retrieve = vi.fn();
    const outcome = await confirmSetupWithRecovery<TestSetupIntent>({
      confirm: async () => ({ setupIntent: { id: "seti_confirmed", status: "succeeded" } }),
      retrieve,
      confirmationTimeoutMs: 20,
      recoveryTimeoutMs: 20,
    });

    expect(outcome).toEqual({
      kind: "succeeded",
      setupIntent: { id: "seti_confirmed", status: "succeeded" },
      recovered: false,
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("recovers the authoritative SetupIntent after a confirmation timeout", async () => {
    const outcome = await confirmSetupWithRecovery<TestSetupIntent>({
      confirm: () => new Promise(() => undefined),
      retrieve: async () => ({ setupIntent: { id: "seti_recovered", status: "succeeded" } }),
      confirmationTimeoutMs: 5,
      recoveryTimeoutMs: 20,
    });

    expect(outcome).toEqual({
      kind: "succeeded",
      setupIntent: { id: "seti_recovered", status: "succeeded" },
      recovered: true,
    });
  });

  it("returns explicit Stripe validation failures without retrying confirmation", async () => {
    const providerError = new Error("card declined");
    const retrieve = vi.fn();
    const outcome = await confirmSetupWithRecovery<TestSetupIntent>({
      confirm: async () => ({ error: providerError }),
      retrieve,
      confirmationTimeoutMs: 20,
      recoveryTimeoutMs: 20,
    });

    expect(outcome).toMatchObject({
      kind: "incomplete",
      providerError,
      timedOut: false,
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("checks the SetupIntent after an ambiguous provider rejection", async () => {
    const providerError = new Error("provider connection closed");
    const outcome = await confirmSetupWithRecovery<TestSetupIntent>({
      confirm: async () => Promise.reject(providerError),
      retrieve: async () => ({
        setupIntent: { id: "seti_unconfirmed", status: "requires_payment_method" },
      }),
      confirmationTimeoutMs: 20,
      recoveryTimeoutMs: 20,
    });

    expect(outcome).toEqual({
      kind: "incomplete",
      setupIntent: { id: "seti_unconfirmed", status: "requires_payment_method" },
      providerError,
      timedOut: false,
    });
  });

  it("returns a bounded failure when confirmation and recovery do not finish", async () => {
    const outcome = await confirmSetupWithRecovery<TestSetupIntent>({
      confirm: () => new Promise(() => undefined),
      retrieve: () => new Promise(() => undefined),
      confirmationTimeoutMs: 5,
      recoveryTimeoutMs: 5,
    });

    expect(outcome.kind).toBe("incomplete");
    if (outcome.kind === "incomplete") expect(outcome.timedOut).toBe(true);
  });

  it("runs timeout cleanup for abortable requests", async () => {
    const onTimeout = vi.fn();
    const result = withOperationTimeout(
      new Promise(() => undefined),
      5,
      "test operation",
      onTimeout,
    );

    await expect(result).rejects.toSatisfy(isOperationTimeoutError);
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});

describe("onboarding Checkout Session payment integration", () => {
  it("uses the Checkout Elements state machine and never combines hidden billing fields with defaults", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/merchant-dashboard/components/onboarding.tsx"),
      "utf8",
    );

    expect(source).toContain("CheckoutElementsProvider");
    expect(source).toContain("useCheckoutElements()");
    expect(source).toContain("checkoutState.checkout.confirm({");
    expect(source).toContain("!checkoutState.checkout.canConfirm");
    expect(source).toContain("defaultValues:");
    expect(source).not.toContain('fields: { billingDetails: "never" }');
    expect(source).not.toContain("confirmSetup(");
    expect(source).not.toContain("retrieveSetupIntent(");
    expect(source).toMatch(/finally\s*\{\s*setLoading\(false\);\s*\}/);
  });

  it("lets the Customer-owned Checkout Session control duplicate identity and return fields", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/merchant-dashboard/components/onboarding.tsx"),
      "utf8",
    );
    const secureForm = source.slice(
      source.indexOf("function SecurePaymentForm"),
      source.indexOf("export function BusinessOnboarding"),
    );
    const checkoutProvider = source.slice(
      source.indexOf("<CheckoutElementsProvider"),
      source.indexOf("<SecurePaymentForm", source.indexOf("<CheckoutElementsProvider")),
    );

    expect(secureForm).toContain(
      'checkoutState.checkout.confirm({\n        redirect: "if_required",\n      });',
    );
    expect(secureForm).not.toContain("returnUrl:");
    expect(secureForm).not.toContain("email: billingIdentity.email");
    expect(secureForm).not.toContain("billingAddress:");
    expect(checkoutProvider).toContain("defaultValues:");
    expect(checkoutProvider).not.toMatch(/defaultValues:\s*\{\s*email:/u);
  });

  it("recovers canonical billing data and a completed trial review without browser session state", () => {
    const onboarding = readFileSync(
      resolve(process.cwd(), "apps/merchant-dashboard/components/onboarding.tsx"),
      "utf8",
    );
    const billing = readFileSync(
      resolve(process.cwd(), "apps/api/src/billing/billing.service.ts"),
      "utf8",
    );

    expect(onboarding).toContain("billingIdentityFromServer(model)");
    expect(onboarding).toContain("await loadBillingIdentity(currentOrganizationId)");
    expect(onboarding).toContain("recoverCompletedTrialPreview");
    expect(onboarding).not.toContain("draft.billingIdentity && (draft.step ?? 2) >= 4");
    expect(billing).toContain("onboardingSetup:");
    expect(billing).toContain("trialSetupCommandForSession");
    expect(billing).toContain("command.stripeSessionId !== checkoutSessionId");
  });

  it("creates a setup-only Checkout Session without line items, invoices, or subscriptions", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/api/src/billing/billing.service.ts"),
      "utf8",
    );
    const prepare = source.slice(
      source.indexOf("async prepareTrialSetup"),
      source.indexOf("private async completedTrialCheckoutSession"),
    );
    expect(prepare).toContain("stripe.checkout.sessions.create(");
    expect(prepare).toContain('mode: "setup"');
    expect(prepare).toContain('ui_mode: "elements"');
    expect(prepare).toContain('payment_method_types: ["card"]');
    expect(prepare).not.toContain("line_items:");
    expect(prepare).not.toContain("invoices.create");
    expect(prepare).not.toContain("subscriptions.create");
    expect(prepare).toContain("stripeSessionId: checkoutSession.id");
  });
});

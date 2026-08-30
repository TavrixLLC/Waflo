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

describe("onboarding payment integration", () => {
  it("uses Checkout Sessions' embedded Payment Element and releases submit loading state", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/merchant-dashboard/components/onboarding.tsx"),
      "utf8",
    );

    expect(source).toContain("CheckoutElementsProvider");
    expect(source).toContain("useCheckoutElements");
    expect(source).toContain("checkoutState.checkout.confirm({");
    expect(source).toContain("checkoutSessionId");
    expect(source).not.toContain("stripe.confirmSetup(");
    expect(source).not.toContain("stripe.retrieveSetupIntent(");
    expect(source).toMatch(/finally\s*\{\s*setLoading\(false\);\s*\}/);
  });
});

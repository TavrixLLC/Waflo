import { createHash } from "node:crypto";
import type Stripe from "stripe";

export const SUBSCRIPTION_CHANGE_PREVIEW_TTL_MS = 10 * 60 * 1000;

export interface StripeSubscriptionPreviewProvider {
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  createInvoicePreview(input: {
    subscriptionId: string;
    subscriptionItemId: string;
    targetPriceId: string;
    prorationDate: number;
  }): Promise<Stripe.Invoice>;
  updateSubscriptionItem(input: {
    subscriptionId: string;
    subscriptionItemId: string;
    targetPriceId: string;
    targetPlan: string;
    targetCadence: string;
    prorationDate: number;
    prorationBehavior: "create_prorations";
  }): Promise<Stripe.Subscription>;
}

export function stripeSubscriptionFingerprint(
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
): string {
  const priceId = typeof item.price === "string" ? item.price : item.price.id;
  return createHash("sha256")
    .update(
      JSON.stringify({
        subscriptionId: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        itemId: item.id,
        priceId,
        quantity: item.quantity ?? 1,
        currentPeriodStart: item.current_period_start,
        currentPeriodEnd: item.current_period_end,
      }),
      "utf8",
    )
    .digest("hex");
}

export interface StripeInvoicePreviewSummary {
  amountDueNow: number;
  creditAmount: number;
  nextRenewalAmount: number | null;
  nextRenewalAt: Date | null;
  lines: Array<{ amountMinor: number; currency: string; description: string | null }>;
}

export function summarizeStripeInvoicePreview(
  invoice: Stripe.Invoice,
): StripeInvoicePreviewSummary {
  const prorationLines = invoice.lines.data.filter(
    (line) => line.parent?.subscription_item_details?.proration === true,
  );
  const creditAmount = prorationLines.reduce(
    (sum, line) => sum + (line.amount < 0 ? Math.abs(line.amount) : 0),
    0,
  );
  return {
    amountDueNow: invoice.amount_due,
    creditAmount,
    nextRenewalAmount: null,
    nextRenewalAt: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    lines: prorationLines.map((line) => ({
      amountMinor: line.amount,
      currency: line.currency.toUpperCase(),
      description: line.description ?? null,
    })),
  };
}

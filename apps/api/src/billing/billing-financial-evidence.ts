import Stripe from "stripe";

export const STRIPE_FINANCIAL_EVENT_TYPES = [
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export type StripeFinancialEventType = (typeof STRIPE_FINANCIAL_EVENT_TYPES)[number];

export interface StripeInvoiceFinancialSnapshot {
  eventId: string;
  eventType: StripeFinancialEventType;
  invoiceId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  type: "BILLED" | "COLLECTED" | "PAYMENT_FAILED";
  currency: string;
  amountMinor: bigint;
  priceCandidates: ReadonlyArray<{ stripePriceId: string; amountMinor: bigint }>;
  providerOccurredAt: Date;
  livemode: boolean;
}

function providerId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

export function isStripeFinancialEvent(
  event: Stripe.Event,
): event is Stripe.Event & { type: StripeFinancialEventType; data: { object: Stripe.Invoice } } {
  return STRIPE_FINANCIAL_EVENT_TYPES.includes(event.type as StripeFinancialEventType);
}

export function stripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent?.subscription_details?.subscription;
  const fromParent = providerId(parent);
  if (fromParent) return fromParent;
  const lineSubscriptions = new Set(
    invoice.lines.data
      .map((line) => providerId(line.subscription))
      .filter((value): value is string => value !== null),
  );
  return lineSubscriptions.size === 1 ? ([...lineSubscriptions][0] ?? null) : null;
}

export function stripeInvoicePriceCandidates(invoice: Stripe.Invoice) {
  const amounts = new Map<string, bigint>();
  for (const line of invoice.lines.data) {
    const price = line.pricing?.price_details?.price;
    const stripePriceId = providerId(price);
    if (!stripePriceId) continue;
    const amount = BigInt(line.amount);
    amounts.set(stripePriceId, (amounts.get(stripePriceId) ?? 0n) + amount);
  }
  return [...amounts.entries()]
    .map(([stripePriceId, amountMinor]) => ({ stripePriceId, amountMinor }))
    .sort((left, right) =>
      left.amountMinor === right.amountMinor ? 0 : left.amountMinor > right.amountMinor ? -1 : 1,
    );
}

export function stripeInvoiceFinancialSnapshot(
  event: Stripe.Event,
): StripeInvoiceFinancialSnapshot | null {
  if (!isStripeFinancialEvent(event)) return null;
  const invoice = event.data.object;
  const stripeSubscriptionId = stripeInvoiceSubscriptionId(invoice);
  const stripeCustomerId = providerId(invoice.customer);
  const currency = invoice.currency.toUpperCase();
  if (
    !stripeSubscriptionId ||
    !stripeCustomerId ||
    !/^[A-Z]{3}$/u.test(currency) ||
    !Number.isSafeInteger(event.created)
  ) {
    return null;
  }
  const type =
    event.type === "invoice.finalized"
      ? "BILLED"
      : event.type === "invoice.paid"
        ? "COLLECTED"
        : "PAYMENT_FAILED";
  const amount = event.type === "invoice.paid" ? invoice.amount_paid : invoice.amount_due;
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  return {
    eventId: event.id,
    eventType: event.type,
    invoiceId: invoice.id,
    stripeSubscriptionId,
    stripeCustomerId,
    type,
    currency,
    amountMinor: BigInt(amount),
    priceCandidates: stripeInvoicePriceCandidates(invoice),
    providerOccurredAt: new Date(event.created * 1000),
    livemode: event.livemode,
  };
}

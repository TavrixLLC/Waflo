import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import Stripe from "stripe";

const exec = promisify(execFile);
const evidencePath =
  "C:\\Users\\Alhamza Nazhan\\Desktop\\TestRES\\dashboard-operational-fixes-2026-09-06\\stripe-local-live-evidence.json";
const runId = process.env.LOCAL_EXISTING_RUN_ID?.trim();
if (!/^[0-9a-f]{8}$/u.test(runId ?? ""))
  throw new Error("A verified local fixture identifier is required.");
if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe TEST key is unavailable locally.");

const email = `stripe-browser-${runId}@waflo.local`;
const query = `select s.stripe_subscription_id from subscriptions s join organization_members m on m.organization_id = s.organization_id join users u on u.id = m.user_id where u.email = '${email}' order by s.created_at desc limit 1;`;
const { stdout } = await exec("docker", [
  "exec",
  "waflo-postgres-1",
  "psql",
  "-U",
  "waflo",
  "-d",
  "waflo",
  "-At",
  "-c",
  query,
]);
const subscriptionId = stdout.trim();
if (!subscriptionId) throw new Error("Local durable Stripe subscription was not found.");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  appInfo: { name: "Waflo local verification", version: "1.0.0" },
});
const [subscription, invoices, existing] = await Promise.all([
  stripe.subscriptions.retrieve(subscriptionId),
  stripe.invoices.list({ subscription: subscriptionId, limit: 100 }),
  readFile(evidencePath, "utf8").then(JSON.parse),
]);
const provider = {
  queriedAgainst: "Stripe TEST",
  subscriptionExists: true,
  subscriptionStatus: subscription.status,
  metadataPlan: subscription.metadata.plan ?? null,
  metadataCadence: subscription.metadata.cadence ?? null,
  initialChargeAmountMinor: 0,
  invoices: {
    count: invoices.data.length,
    paidAmountMinorTotal: invoices.data.reduce((total, invoice) => total + invoice.amount_paid, 0),
    unexpectedPositivePayment: invoices.data.some((invoice) => invoice.amount_paid > 0),
  },
  identifiers: "not captured",
};
existing.provider = provider;
await writeFile(evidencePath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");

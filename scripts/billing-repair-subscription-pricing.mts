import { runBillingRepairSubscriptionPricingCli } from "./billing-repair-subscription-pricing-cli.ts";

void runBillingRepairSubscriptionPricingCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Subscription pricing repair failed: ${message}\n`);
  process.exitCode = 1;
});

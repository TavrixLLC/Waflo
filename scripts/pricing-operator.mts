/** Secure, machine-readable operator CLI. All mutations require --write. */
import { parseEnvironment } from "@waflo/config";
import { createPrismaClient } from "@waflo/database";
import { PricingCatalogService } from "../apps/api/src/billing/pricing-catalog.service.ts";

const [command = "inspect", ...args] = process.argv.slice(2).filter((arg) => arg !== "--write");
const write = process.argv.includes("--write");
const prisma = createPrismaClient();
const environment = parseEnvironment(process.env);
const catalog = new PricingCatalogService(
  { client: prisma } as never,
  {
    values: environment,
    stripeConfigured: Boolean(environment.STRIPE_SECRET_KEY && environment.STRIPE_WEBHOOK_SECRET),
  } as never,
);
const requiredWrite = new Set([
  "draft",
  "validate",
  "publish",
  "retire",
  "annual-schedule",
  "annual-cancel",
  "annual-replace",
]);
if (requiredWrite.has(command) && !write)
  throw new Error(`${command} is mutating; repeat with --write after reviewing dry-run inputs.`);

try {
  let result: unknown;
  switch (command) {
    case "inspect":
      result = await catalog.inspect();
      break;
    case "draft":
      result = await catalog.createDraft({
        marketCode: args[0] ?? "",
        plan: (args[1] ?? "") as "starter",
        cadence: (args[2] ?? "") as "MONTHLY",
        currency: args[3] ?? "",
        amountMinor: BigInt(args[4] ?? "-1"),
      });
      break;
    case "validate":
      result = await catalog.validateDraft(args[0] ?? "");
      break;
    case "publish":
      result = await catalog.publish(args[0] ?? "");
      break;
    case "retire":
      result = await catalog.retire(args[0] ?? "");
      break;
    case "annual-preview":
      result = await catalog.annualPreview(args[0] ?? "GLOBAL");
      break;
    case "annual-schedule":
      result = { scheduled: await catalog.scheduleAnnualRepricing() };
      break;
    case "annual-cancel":
      result = await catalog.cancelAnnualRepricing(args[0] ?? "");
      break;
    case "annual-replace":
      result = await catalog.replaceAnnualRepricing(args[0] ?? "", args[1] ?? "");
      break;
    default:
      throw new Error(
        "Commands: inspect, draft, validate, publish, retire, annual-preview, annual-schedule, annual-cancel, annual-replace",
      );
  }
  process.stdout.write(
    `${JSON.stringify(result, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
  );
} finally {
  await prisma.$disconnect();
}

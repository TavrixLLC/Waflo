import { getPrismaClient } from "@waflo/database";
import { adminRoles, provisionAdminAccount } from "../apps/api/src/admin/admin-provisioning.ts";

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function passwordFromStdin(): Promise<string> {
  if (!process.argv.includes("--password-stdin")) {
    throw new Error(
      "Write mode requires --password-stdin; passwords are never accepted as arguments.",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/[\r\n]+$/u, "");
}

const email = value("--email");
const displayName = value("--display-name");
const roleInput = value("--role") ?? "READ_ONLY";
const localeInput = value("--locale") ?? "EN";
const write = process.argv.includes("--write");

if (!email || !displayName) throw new Error("--email and --display-name are required.");
if (!adminRoles.includes(roleInput as (typeof adminRoles)[number])) {
  throw new Error(`--role must be one of: ${adminRoles.join(", ")}.`);
}
if (!(["EN", "AR"] as const).includes(localeInput as "EN" | "AR")) {
  throw new Error("--locale must be EN or AR.");
}

const client = getPrismaClient();
try {
  const result = await provisionAdminAccount(client, {
    email,
    displayName,
    role: roleInput as (typeof adminRoles)[number],
    preferredLocale: localeInput as "EN" | "AR",
    write,
    ...(write ? { password: await passwordFromStdin() } : {}),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await client.$disconnect();
}

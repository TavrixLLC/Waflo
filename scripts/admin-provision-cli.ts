import { getPrismaClient, type PrismaClient } from "@waflo/database";
import {
  adminRoles,
  type ProvisionAdminInput,
  provisionAdminAccount,
} from "../apps/api/src/admin/admin-provisioning.ts";
import { normalizeEmail } from "../packages/auth/src/index.ts";

export class AdminProvisionCliError extends Error {}

export interface AdminProvisionCliOptions {
  readonly email: string;
  readonly displayName: string;
  readonly role: (typeof adminRoles)[number];
  readonly preferredLocale: "EN" | "AR";
  readonly write: boolean;
}

export interface AdminProvisionCliDependencies {
  readonly getClient?: () => PrismaClient;
  readonly readSecret?: (prompt: string) => Promise<string>;
}

function usage(): string {
  return [
    "Usage: pnpm admin:provision -- --email <email> --display-name <name> [--role <role>] [--locale EN|AR] [--dry-run|--write]",
    `Roles: ${adminRoles.join(", ")}`,
    "Dry-run is the default. Write mode securely prompts for the password twice in an interactive terminal.",
  ].join("\n");
}

function optionValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new AdminProvisionCliError(`${name} requires a value.`);
  }
  return value;
}

function validEmail(value: string): boolean {
  // The service remains the source of normalization. This only prevents an
  // obviously malformed operator command before a database connection opens.
  const normalized = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized);
}

export function parseAdminProvisionArgs(argv: readonly string[]): AdminProvisionCliOptions {
  let email: string | undefined;
  let displayName: string | undefined;
  let role = "READ_ONLY";
  let preferredLocale = "EN";
  let write = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--email") {
      email = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === "--display-name") {
      displayName = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === "--role") {
      role = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === "--locale") {
      preferredLocale = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === "--write") {
      write = true;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      throw new AdminProvisionCliError(usage());
    } else {
      throw new AdminProvisionCliError(`Unsupported argument: ${argument}.\n${usage()}`);
    }
  }

  if (write && dryRun)
    throw new AdminProvisionCliError("Use either --dry-run or --write, not both.");
  if (!email || !displayName) {
    throw new AdminProvisionCliError(`--email and --display-name are required.\n${usage()}`);
  }
  if (!validEmail(email))
    throw new AdminProvisionCliError("--email must be a valid email address.");
  if (!adminRoles.includes(role as (typeof adminRoles)[number])) {
    throw new AdminProvisionCliError(`--role must be one of: ${adminRoles.join(", ")}.`);
  }
  if (preferredLocale !== "EN" && preferredLocale !== "AR") {
    throw new AdminProvisionCliError("--locale must be EN or AR.");
  }

  return {
    email,
    displayName,
    role: role as (typeof adminRoles)[number],
    preferredLocale: preferredLocale as "EN" | "AR",
    write,
  };
}

function interactiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/** Reads one secret without echoing it, argv exposure, or shell history. */
export async function readHiddenTerminalSecret(prompt: string): Promise<string> {
  if (!interactiveTerminal()) {
    throw new AdminProvisionCliError(
      "Write mode requires an interactive TTY so the password can be entered securely.",
    );
  }

  process.stderr.write(prompt);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0003")
          return finish(new AdminProvisionCliError("Password entry cancelled."));
        if (character === "\u0008" || character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

export async function provisionAdminFromCli(
  options: AdminProvisionCliOptions,
  dependencies: AdminProvisionCliDependencies = {},
) {
  const input: ProvisionAdminInput = {
    email: options.email,
    displayName: options.displayName,
    role: options.role,
    preferredLocale: options.preferredLocale,
    write: options.write,
  };

  if (!options.write) return provisionAdminAccount({} as PrismaClient, input);

  const readSecret = dependencies.readSecret ?? readHiddenTerminalSecret;
  const password = await readSecret("Password: ");
  const confirmation = await readSecret("Confirm password: ");
  if (password !== confirmation) throw new AdminProvisionCliError("Passwords do not match.");

  const client = (dependencies.getClient ?? getPrismaClient)();
  try {
    return await provisionAdminAccount(client, { ...input, password });
  } finally {
    await client.$disconnect();
  }
}

export async function runAdminProvisionCli(argv = process.argv.slice(2)): Promise<void> {
  const result = await provisionAdminFromCli(parseAdminProvisionArgs(argv));
  // The domain result intentionally excludes the supplied password and hash.
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export function adminProvisionUsage(): string {
  return usage();
}

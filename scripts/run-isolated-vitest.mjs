import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const STAGES = ["unit", "integration", "http", "concurrency", "failure"];
const TEST_DATABASE_PREFIX = "waflo_test_";
const packageRequire = createRequire(new URL("../packages/database/package.json", import.meta.url));
const { Client } = packageRequire("pg");

function parseArguments() {
  const [selection = "all", ...rawArguments] = process.argv.slice(2);
  if (selection !== "all" && !STAGES.includes(selection)) {
    throw new Error(
      `Unknown Vitest stage "${selection}". Expected all or one of: ${STAGES.join(", ")}.`,
    );
  }
  const repeatArgument = rawArguments.find((argument) => argument.startsWith("--repeat="));
  const repeat = repeatArgument ? Number.parseInt(repeatArgument.slice("--repeat=".length), 10) : 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 25) {
    throw new Error("--repeat must be an integer between 1 and 25.");
  }
  const vitestArguments = rawArguments.filter((argument) => argument !== repeatArgument);
  if (selection === "all" && (vitestArguments.length > 0 || repeat !== 1)) {
    throw new Error("Focused Vitest arguments require an explicit project stage.");
  }
  return {
    stages: selection === "all" ? STAGES : [selection],
    vitestArguments,
    repeat,
  };
}

function testDatabaseName() {
  const unique = `${Date.now().toString(36)}_${process.pid}_${randomUUID().slice(0, 8)}`
    .replaceAll("-", "_")
    .toLowerCase();
  return `${TEST_DATABASE_PREFIX}${unique}`.slice(0, 63);
}

function assertSafeTestDatabaseName(name) {
  if (!/^waflo_test_[a-z0-9_]+$/.test(name) || name.length > 63) {
    throw new Error(`Refusing to manage unsafe test database name "${name}".`);
  }
}

function databaseUrls(name) {
  const configured = process.env.DATABASE_URL;
  if (!configured) {
    throw new Error("DATABASE_URL is required for isolated repository tests.");
  }
  const base = new URL(configured);
  if (base.protocol !== "postgres:" && base.protocol !== "postgresql:") {
    throw new Error("Isolated repository tests require PostgreSQL.");
  }
  const admin = new URL(base);
  admin.searchParams.delete("schema");
  const test = new URL(base);
  test.pathname = `/${name}`;
  test.searchParams.set("schema", "public");
  return { admin: admin.toString(), test: test.toString() };
}

function isolatedTestEnvironment(overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: "test",
    DEPLOYMENT_ENVIRONMENT: "development",
    CUSTOMER_DATA_ENCRYPTION_KEY_V1: "a".repeat(64),
    CUSTOMER_CONTACT_LOOKUP_HMAC_KEY: "b".repeat(64),
    CUSTOMER_SESSION_SECRET: "c".repeat(64),
    MEMBERSHIP_CREDENTIAL_SECRET_V1: "d".repeat(64),
    LEDGER_HASH_SECRET_V1: "e".repeat(64),
    MERCHANT_TRANSACTION_REFERENCE_HMAC_KEY_V1: "f".repeat(64),
    DEVICE_SESSION_SECRET: "1".repeat(64),
    OAUTH_FLOW_SECRET: "2".repeat(64),
    APPLE_PASS_AUTH_SECRET_V1: "3".repeat(64),
    SCALE_LOCATION_LIMIT: "100",
    SCALE_TEAM_LIMIT: "100",
    ...overrides,
  };
}

function corepackCommand(arguments_) {
  if (process.platform !== "win32") {
    return { command: "corepack", arguments: arguments_ };
  }
  return {
    command: process.execPath,
    arguments: [
      resolve(dirname(process.execPath), "node_modules/corepack/dist/corepack.js"),
      ...arguments_,
    ],
  };
}

async function run(command, arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} was terminated by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function createDatabase(adminUrl, name) {
  assertSafeTestDatabaseName(name);
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(adminUrl, name) {
  assertSafeTestDatabaseName(name);
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

async function prepareDatabase(environment) {
  const migrate = corepackCommand(["pnpm", "--filter", "@waflo/database", "migrate:deploy"]);
  const migrateCode = await run(migrate.command, migrate.arguments, environment);
  if (migrateCode !== 0) {
    throw new Error(`Database migration failed with exit code ${migrateCode}.`);
  }
  const seed = corepackCommand(["pnpm", "--filter", "@waflo/database", "seed"]);
  const seedCode = await run(seed.command, seed.arguments, environment);
  if (seedCode !== 0) {
    throw new Error(`Database seed failed with exit code ${seedCode}.`);
  }
}

async function runVitestStage(stage, vitestArguments, environment, repetition, repeat) {
  const repetitionLabel = repeat > 1 ? ` (${repetition}/${repeat})` : "";
  process.stdout.write(`\n[isolated-vitest] Running ${stage}${repetitionLabel}.\n`);
  const vitest = corepackCommand([
    "pnpm",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "--project",
    stage,
    ...vitestArguments,
  ]);
  return run(vitest.command, vitest.arguments, environment);
}

async function main() {
  const { stages, vitestArguments, repeat } = parseArguments();
  const needsDatabase = stages.some((stage) => stage !== "unit");
  if (!needsDatabase) {
    let unitExitCode = 0;
    for (let repetition = 1; repetition <= repeat; repetition += 1) {
      unitExitCode = await runVitestStage(
        "unit",
        vitestArguments,
        isolatedTestEnvironment(),
        repetition,
        repeat,
      );
      if (unitExitCode !== 0) break;
    }
    process.exitCode = unitExitCode;
    return;
  }

  const name = testDatabaseName();
  const urls = databaseUrls(name);
  const environment = isolatedTestEnvironment({
    DATABASE_URL: urls.test,
    WAFLO_TEST_DATABASE_NAME: name,
    WAFLO_TEST_RUN_ID: name.slice(TEST_DATABASE_PREFIX.length),
    APPLE_PASS_TYPE_IDENTIFIER:
      process.env.APPLE_PASS_TYPE_IDENTIFIER || "pass.app.waflo.test-adapter",
  });
  let created = false;
  let exitCode = 1;
  try {
    process.stdout.write(`[isolated-vitest] Creating ${name}.\n`);
    await createDatabase(urls.admin, name);
    created = true;
    await prepareDatabase(environment);
    exitCode = 0;
    for (const stage of stages) {
      for (let repetition = 1; repetition <= repeat; repetition += 1) {
        const stageCode = await runVitestStage(
          stage,
          vitestArguments,
          environment,
          repetition,
          repeat,
        );
        if (stageCode !== 0) {
          exitCode = stageCode;
          break;
        }
      }
      if (exitCode !== 0) break;
    }
  } finally {
    if (created) {
      process.stdout.write(`[isolated-vitest] Dropping ${name}.\n`);
      try {
        await dropDatabase(urls.admin, name);
      } catch (error) {
        exitCode = 1;
        process.stderr.write(
          `[isolated-vitest] Cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(
    `[isolated-vitest] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});

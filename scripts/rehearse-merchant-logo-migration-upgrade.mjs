import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { parse as parseDotenv } from "dotenv";

const root = path.resolve(import.meta.dirname, "..");
const migrationName = "20260818143000_organization_brand_logo";
const migrationsDirectory = path.join(root, "packages", "database", "prisma", "migrations");
const schemaPath = path.join(root, "packages", "database", "prisma", "schema.prisma");
const localEnvironmentPath = path.join(root, ".env");
const localEnvironment = existsSync(localEnvironmentPath)
  ? parseDotenv(readFileSync(localEnvironmentPath, "utf8"))
  : {};
for (const [key, value] of Object.entries(localEnvironment)) process.env[key] ??= value;

const databaseRequire = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
);
const { Client } = databaseRequire("pg");
const suffix = `${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`.replaceAll("-", "_");
const databaseName = `waflo_test_brand_logo_upgrade_${suffix}`.slice(0, 63);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "waflo-brand-logo-upgrade-"));
const temporaryMigrations = path.join(temporaryRoot, "migrations");
const temporaryConfig = path.join(temporaryRoot, "prisma.config.mjs");

function assertSafeDatabaseName(name) {
  if (!/^waflo_test_brand_logo_upgrade_[a-z0-9_]+$/u.test(name) || name.length > 63) {
    throw new Error("Refusing to manage an unsafe migration rehearsal database.");
  }
}

function databaseUrls(name) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for migration rehearsal.");
  const base = new URL(process.env.DATABASE_URL);
  const admin = new URL(base);
  admin.searchParams.delete("schema");
  const test = new URL(base);
  test.pathname = `/${name}`;
  test.searchParams.set("schema", "public");
  return { admin: admin.toString(), test: test.toString() };
}

function pnpmCommand(arguments_) {
  if (process.platform !== "win32")
    return { command: "corepack", arguments: ["pnpm", ...arguments_] };
  return {
    command: process.execPath,
    arguments: [
      path.resolve(path.dirname(process.execPath), "node_modules/corepack/dist/corepack.js"),
      "pnpm",
      ...arguments_,
    ],
  };
}

function run(command, arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function copyPreLogoMigrationHistory() {
  await cp(migrationsDirectory, temporaryMigrations, {
    recursive: true,
    filter: (source) => !source.includes(migrationName),
  });
  await writeFile(
    temporaryConfig,
    [
      'import { defineConfig, env } from "prisma/config";',
      "export default defineConfig({",
      `  schema: ${JSON.stringify(schemaPath)},`,
      `  migrations: { path: ${JSON.stringify(temporaryMigrations)} },`,
      '  datasource: { url: env("DATABASE_URL") },',
      "});",
      "",
    ].join("\n"),
  );
}

async function createDatabase(connectionString, name) {
  assertSafeDatabaseName(name);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(connectionString, name) {
  assertSafeDatabaseName(name);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

const report = {
  databaseName,
  PREEXISTING_DATA_PRESERVED: "NO",
  FK_VALIDATION: "FAIL",
  NULL_BACKWARD_COMPATIBILITY: "FAIL",
  MIGRATION_UPGRADE: "FAIL",
};
let adminUrl = "";
let created = false;

try {
  assertSafeDatabaseName(databaseName);
  await copyPreLogoMigrationHistory();
  const urls = databaseUrls(databaseName);
  adminUrl = urls.admin;
  await createDatabase(urls.admin, databaseName);
  created = true;
  const environment = {
    ...process.env,
    DATABASE_URL: urls.test,
    WAFLO_TEST_DATABASE_NAME: databaseName,
    NODE_ENV: "test",
  };

  const preUpgrade = pnpmCommand([
    "--filter",
    "@waflo/database",
    "exec",
    "prisma",
    "migrate",
    "deploy",
    "--config",
    temporaryConfig,
  ]);
  if ((await run(preUpgrade.command, preUpgrade.arguments, environment)) !== 0) {
    throw new Error("Pre-logo migration history did not apply.");
  }

  const beforeClient = new Client({ connectionString: urls.test });
  await beforeClient.connect();
  let organizationId = "";
  const representativeUserId = "90000000-0000-4000-8000-000000000002";
  const representativeAssetId = "90000000-0000-4000-8000-000000000003";
  try {
    const column = await beforeClient.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'brand_logo_asset_id'`,
    );
    if ((column.rowCount ?? 0) !== 0)
      throw new Error("Logo column exists before the target migration.");
    await beforeClient.query(
      `INSERT INTO users (id, "displayName", email, normalized_email, password_hash, terms_version, privacy_version, legal_accepted_at, updated_at)
       VALUES ($1, 'Migration rehearsal owner', 'migration-rehearsal@waflo.local', 'migration-rehearsal@waflo.local', 'not-used-by-rehearsal', 'v1', 'v1', NOW(), NOW())`,
      [representativeUserId],
    );
    const organization = await beforeClient.query(
      `INSERT INTO organizations (id, name, normalized_name, merchant_slug, status, default_locale, timezone, created_at, updated_at)
       VALUES ('90000000-0000-4000-8000-000000000001', 'Upgrade rehearsal', 'upgrade rehearsal', 'upgrade-rehearsal', 'ACTIVE', 'EN', 'Asia/Baghdad', NOW(), NOW())
       RETURNING id`,
    );
    organizationId = organization.rows[0].id;
    await beforeClient.query(
      `INSERT INTO merchant_assets (id, organization_id, category, source, original_object_key, original_filename, mime_type, file_size, width, height, sha256_digest, processing_status, created_by_user_id)
       VALUES ($1, $2, 'LOGO', 'MERCHANT_UPLOAD', 'organizations/upgrade-rehearsal/logo.png', 'logo.png', 'image/png', 128, 64, 64, $3, 'READY', $4)`,
      [representativeAssetId, organizationId, "a".repeat(64), representativeUserId],
    );
  } finally {
    await beforeClient.end();
  }

  const upgrade = pnpmCommand(["--filter", "@waflo/database", "migrate:deploy"]);
  if ((await run(upgrade.command, upgrade.arguments, environment)) !== 0) {
    throw new Error("Target merchant-logo migration did not apply.");
  }

  const upgradedClient = new Client({ connectionString: urls.test });
  await upgradedClient.connect();
  try {
    const persistedOrganization = await upgradedClient.query(
      `SELECT id, name, brand_logo_asset_id FROM organizations WHERE id = $1`,
      [organizationId],
    );
    if (
      persistedOrganization.rowCount !== 1 ||
      persistedOrganization.rows[0].brand_logo_asset_id !== null
    ) {
      throw new Error("Existing organization was not preserved with a nullable logo reference.");
    }
    report.PREEXISTING_DATA_PRESERVED = "YES";
    report.NULL_BACKWARD_COMPATIBILITY = "PASS";

    const index = await upgradedClient.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'organizations' AND indexname = 'organizations_brand_logo_asset_id_idx'`,
    );
    if ((index.rowCount ?? 0) !== 1) throw new Error("Logo-reference index is missing.");

    const invalid = await upgradedClient
      .query(
        `UPDATE organizations SET brand_logo_asset_id = '90000000-0000-4000-8000-000000000099' WHERE id = $1`,
        [organizationId],
      )
      .then(() => false)
      .catch((error) => (error?.code === "23503" ? true : Promise.reject(error)));
    if (!invalid) throw new Error("Invalid merchant-asset FK was accepted.");

    await upgradedClient.query(`UPDATE organizations SET brand_logo_asset_id = $1 WHERE id = $2`, [
      representativeAssetId,
      organizationId,
    ]);
    const assigned = await upgradedClient.query(
      `SELECT brand_logo_asset_id FROM organizations WHERE id = $1`,
      [organizationId],
    );
    if (assigned.rows[0].brand_logo_asset_id !== representativeAssetId) {
      throw new Error("Valid merchant-asset FK was not persisted.");
    }
    report.FK_VALIDATION = "PASS";
    report.MIGRATION_UPGRADE = "PASS";
  } finally {
    await upgradedClient.end();
  }
} finally {
  if (created && adminUrl) await dropDatabase(adminUrl, databaseName);
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

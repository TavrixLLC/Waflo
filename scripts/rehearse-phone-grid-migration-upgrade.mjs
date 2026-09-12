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
const migrationName = "20260829160000_phone_collection_and_grid_only";
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
const databaseName = `waflo_test_phone_grid_upgrade_${suffix}`.slice(0, 63);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "waflo-phone-grid-upgrade-"));
const temporaryMigrations = path.join(temporaryRoot, "migrations");
const temporaryConfig = path.join(temporaryRoot, "prisma.config.mjs");

const ids = {
  user: "91000000-0000-4000-8000-000000000001",
  organizationA: "91000000-0000-4000-8000-000000000011",
  organizationB: "91000000-0000-4000-8000-000000000012",
  programA: "91000000-0000-4000-8000-000000000021",
  programB: "91000000-0000-4000-8000-000000000022",
  programC: "91000000-0000-4000-8000-000000000023",
  programNoPolicy: "91000000-0000-4000-8000-000000000024",
  superseded: "91000000-0000-4000-8000-000000000031",
  publishedA: "91000000-0000-4000-8000-000000000032",
  publishedB: "91000000-0000-4000-8000-000000000033",
  draftRequired: "91000000-0000-4000-8000-000000000034",
  draftHidden: "91000000-0000-4000-8000-000000000035",
  draftNoPolicy: "91000000-0000-4000-8000-000000000036",
};

function assertSafeDatabaseName(name) {
  if (!/^waflo_test_phone_grid_upgrade_[a-z0-9_]+$/u.test(name) || name.length > 63) {
    throw new Error("Refusing to manage an unsafe migration rehearsal database.");
  }
}

function databaseUrls(name) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for the phone/Grid migration rehearsal.");
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

async function copyPreMigrationHistory() {
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

async function insertProgram(client, input) {
  await client.query(
    `INSERT INTO loyalty_programs (
       id, organization_id, internal_name, public_slug, program_type, status,
       latest_version_number, created_by_user_id, created_at, updated_at, published_at
     ) VALUES ($1, $2, $3, $4, 'STAMP', $5::"LoyaltyProgramStatus", $6, $7, NOW(), NOW(),
       CASE WHEN $5::"LoyaltyProgramStatus" = 'PUBLISHED' THEN NOW() ELSE NULL END)`,
    [
      input.id,
      input.organizationId,
      input.internalName,
      input.publicSlug,
      input.status,
      input.latestVersionNumber,
      ids.user,
    ],
  );
}

async function insertVersion(client, input) {
  await client.query(
    `INSERT INTO loyalty_program_versions (
       id, program_id, organization_id, version_number, status, editing_mode,
       configuration_schema_version, revision, created_by_user_id, created_at,
       updated_at, published_at, superseded_at
     ) VALUES ($1, $2, $3, $4, $5::"LoyaltyProgramVersionStatus", 'QUICK', 1, 1, $6, NOW(), NOW(),
       CASE WHEN $5::"LoyaltyProgramVersionStatus" = 'PUBLISHED' THEN NOW() ELSE NULL END,
       CASE WHEN $5::"LoyaltyProgramVersionStatus" = 'SUPERSEDED' THEN NOW() ELSE NULL END)`,
    [input.id, input.programId, input.organizationId, input.versionNumber, input.status, ids.user],
  );
}

async function insertPolicy(client, input) {
  await client.query(
    `INSERT INTO program_enrollment_policies (
       id, organization_id, program_version_id, email_collection_mode,
       primary_customer_locale, allow_locale_selection, marketing_consent_visible,
       marketing_consent_default, customer_terms_required,
       transfer_without_email_allowed, enrollment_open, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'EN', true, false, false, true, true, true, NOW(), NOW())`,
    [input.id, input.organizationId, input.versionId, input.emailCollectionMode],
  );
}

async function seedPreMigrationFixture(client) {
  await client.query(
    `INSERT INTO users (
       id, "displayName", email, normalized_email, password_hash, terms_version,
       privacy_version, legal_accepted_at, updated_at
     ) VALUES ($1, 'Phone migration rehearsal owner',
       'phone-migration-rehearsal@waflo.local', 'phone-migration-rehearsal@waflo.local',
       'not-used-by-rehearsal', 'v1', 'v1', NOW(), NOW())`,
    [ids.user],
  );
  await client.query(
    `INSERT INTO organizations (
       id, name, normalized_name, merchant_slug, status, default_locale, timezone,
       created_at, updated_at
     ) VALUES
       ($1, 'Phone migration rehearsal A', 'phone migration rehearsal a',
        'phone-migration-rehearsal-a', 'ACTIVE', 'EN', 'Asia/Baghdad', NOW(), NOW()),
       ($2, 'Phone migration rehearsal B', 'phone migration rehearsal b',
        'phone-migration-rehearsal-b', 'ACTIVE', 'EN', 'Asia/Baghdad', NOW(), NOW())`,
    [ids.organizationA, ids.organizationB],
  );

  await insertProgram(client, {
    id: ids.programA,
    organizationId: ids.organizationA,
    internalName: "Historic protected policy lineage",
    publicSlug: "historic-protected-policy",
    status: "DRAFT",
    latestVersionNumber: 2,
  });
  await insertVersion(client, {
    id: ids.superseded,
    programId: ids.programA,
    organizationId: ids.organizationA,
    versionNumber: 1,
    status: "DRAFT",
  });
  await insertPolicy(client, {
    id: "91000000-0000-4000-8000-000000000041",
    organizationId: ids.organizationA,
    versionId: ids.superseded,
    emailCollectionMode: "REQUIRED",
  });
  await client.query(
    `UPDATE loyalty_program_versions
     SET status = 'PUBLISHED', published_at = NOW()
     WHERE id = $1`,
    [ids.superseded],
  );
  await insertVersion(client, {
    id: ids.publishedA,
    programId: ids.programA,
    organizationId: ids.organizationA,
    versionNumber: 2,
    status: "DRAFT",
  });
  await insertPolicy(client, {
    id: "91000000-0000-4000-8000-000000000042",
    organizationId: ids.organizationA,
    versionId: ids.publishedA,
    emailCollectionMode: "HIDDEN",
  });
  await client.query(
    `UPDATE loyalty_program_versions
     SET status = 'SUPERSEDED', superseded_at = NOW()
     WHERE id = $1`,
    [ids.superseded],
  );
  await client.query(
    `UPDATE loyalty_program_versions
     SET status = 'PUBLISHED', published_at = NOW()
     WHERE id = $1`,
    [ids.publishedA],
  );
  await client.query(
    `UPDATE loyalty_programs
     SET status = 'PUBLISHED', current_published_version_id = $1
     WHERE id = $2`,
    [ids.publishedA, ids.programA],
  );

  await insertProgram(client, {
    id: ids.programB,
    organizationId: ids.organizationB,
    internalName: "Published and editable policy lineage",
    publicSlug: "published-and-editable-policy",
    status: "DRAFT",
    latestVersionNumber: 2,
  });
  await insertVersion(client, {
    id: ids.publishedB,
    programId: ids.programB,
    organizationId: ids.organizationB,
    versionNumber: 1,
    status: "DRAFT",
  });
  await insertPolicy(client, {
    id: "91000000-0000-4000-8000-000000000043",
    organizationId: ids.organizationB,
    versionId: ids.publishedB,
    emailCollectionMode: "OPTIONAL",
  });
  await client.query(
    `UPDATE loyalty_program_versions
     SET status = 'PUBLISHED', published_at = NOW()
     WHERE id = $1`,
    [ids.publishedB],
  );
  await insertVersion(client, {
    id: ids.draftRequired,
    programId: ids.programB,
    organizationId: ids.organizationB,
    versionNumber: 2,
    status: "DRAFT",
  });
  await client.query(
    `UPDATE loyalty_programs
     SET status = 'PUBLISHED', current_published_version_id = $1, current_draft_version_id = $2
     WHERE id = $3`,
    [ids.publishedB, ids.draftRequired, ids.programB],
  );

  await insertProgram(client, {
    id: ids.programC,
    organizationId: ids.organizationA,
    internalName: "Draft-only policy lineage",
    publicSlug: "draft-only-policy",
    status: "DRAFT",
    latestVersionNumber: 1,
  });
  await insertVersion(client, {
    id: ids.draftHidden,
    programId: ids.programC,
    organizationId: ids.organizationA,
    versionNumber: 1,
    status: "DRAFT",
  });
  await client.query(`UPDATE loyalty_programs SET current_draft_version_id = $1 WHERE id = $2`, [
    ids.draftHidden,
    ids.programC,
  ]);

  await insertProgram(client, {
    id: ids.programNoPolicy,
    organizationId: ids.organizationB,
    internalName: "No-policy migration lineage",
    publicSlug: "no-policy-migration",
    status: "DRAFT",
    latestVersionNumber: 1,
  });
  await insertVersion(client, {
    id: ids.draftNoPolicy,
    programId: ids.programNoPolicy,
    organizationId: ids.organizationB,
    versionNumber: 1,
    status: "DRAFT",
  });
  await client.query(`UPDATE loyalty_programs SET current_draft_version_id = $1 WHERE id = $2`, [
    ids.draftNoPolicy,
    ids.programNoPolicy,
  ]);

  await insertPolicy(client, {
    id: "91000000-0000-4000-8000-000000000044",
    organizationId: ids.organizationB,
    versionId: ids.draftRequired,
    emailCollectionMode: "REQUIRED",
  });
  await insertPolicy(client, {
    id: "91000000-0000-4000-8000-000000000045",
    organizationId: ids.organizationA,
    versionId: ids.draftHidden,
    emailCollectionMode: "HIDDEN",
  });
}

async function protectedSnapshot(client) {
  const result = await client.query(
    `SELECT policy.id, policy.organization_id, policy.program_version_id,
       policy.email_collection_mode::text, policy.primary_customer_locale::text,
       policy.allow_locale_selection, policy.marketing_consent_visible,
       policy.marketing_consent_default, policy.customer_terms_required,
       policy.transfer_without_email_allowed, policy.enrollment_open,
       policy.created_at::text, policy.updated_at::text, version.status::text,
       policy.xmin::text AS row_xmin
     FROM program_enrollment_policies AS policy
     JOIN loyalty_program_versions AS version ON version.id = policy.program_version_id
     WHERE version.status IN ('PUBLISHED', 'SUPERSEDED')
     ORDER BY policy.id`,
  );
  return result.rows;
}

async function assertUpgrade(client, beforeProtected) {
  const phoneColumn = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'program_enrollment_policies'
       AND column_name = 'phone_collection_mode'`,
  );
  if (phoneColumn.rowCount !== 1) throw new Error("Phone collection column is missing.");

  const afterProtected = await protectedSnapshot(client);
  if (JSON.stringify(afterProtected) !== JSON.stringify(beforeProtected)) {
    throw new Error("Published or superseded enrollment policy history was rewritten.");
  }

  const policies = await client.query(
    `SELECT policy.program_version_id, version.status::text AS version_status,
       policy.email_collection_mode::text AS email_collection_mode,
       policy.phone_collection_mode::text AS phone_collection_mode
     FROM program_enrollment_policies AS policy
     JOIN loyalty_program_versions AS version ON version.id = policy.program_version_id
     ORDER BY policy.program_version_id`,
  );
  if (policies.rowCount !== 5) throw new Error("Migration created or removed enrollment policies.");

  const expectedPhoneModes = new Map([
    [ids.superseded, "OPTIONAL"],
    [ids.publishedA, "OPTIONAL"],
    [ids.publishedB, "OPTIONAL"],
    [ids.draftRequired, "REQUIRED"],
    [ids.draftHidden, "HIDDEN"],
  ]);
  for (const policy of policies.rows) {
    if (expectedPhoneModes.get(policy.program_version_id) !== policy.phone_collection_mode) {
      throw new Error(`Unexpected phone mode for policy version ${policy.program_version_id}.`);
    }
  }
  if (policies.rows.some((policy) => policy.program_version_id === ids.draftNoPolicy)) {
    throw new Error("Migration created a policy for the no-policy case.");
  }

  const currentPublished = await client.query(
    `SELECT policy.phone_collection_mode::text AS phone_collection_mode
     FROM loyalty_programs AS program
     JOIN program_enrollment_policies AS policy
       ON policy.program_version_id = program.current_published_version_id
     WHERE program.current_published_version_id IS NOT NULL
     ORDER BY program.id`,
  );
  if (
    currentPublished.rowCount !== 2 ||
    currentPublished.rows.some((row) => row.phone_collection_mode !== "OPTIONAL")
  ) {
    throw new Error(
      "Current published programs are not on the supported phone collection contract.",
    );
  }

  const migration = await client.query(
    `SELECT finished_at, rolled_back_at
     FROM _prisma_migrations
     WHERE migration_name = $1`,
    [migrationName],
  );
  if (
    migration.rowCount !== 1 ||
    migration.rows[0].finished_at === null ||
    migration.rows[0].rolled_back_at !== null
  ) {
    throw new Error("Phone/Grid migration was not recorded as a successful upgrade.");
  }
}

const report = {
  databaseName,
  LEGACY_UNSAFE_UPDATE_REPRODUCED: "NO",
  PROTECTED_HISTORY_PRESERVED: "NO",
  DRAFT_PHONE_NORMALIZATION: "NO",
  MULTI_PROGRAM_UPGRADE: "NO",
  NO_POLICY_COMPATIBILITY: "NO",
  MIGRATION_UPGRADE: "FAIL",
};
let adminUrl = "";
let created = false;

try {
  assertSafeDatabaseName(databaseName);
  await copyPreMigrationHistory();
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
    throw new Error("Pre-phone migration history did not apply.");
  }

  const beforeClient = new Client({ connectionString: urls.test });
  await beforeClient.connect();
  let beforeProtected;
  try {
    const phoneColumn = await beforeClient.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'program_enrollment_policies'
         AND column_name = 'phone_collection_mode'`,
    );
    if (phoneColumn.rowCount !== 0) {
      throw new Error("Phone collection column exists before the target migration.");
    }
    await seedPreMigrationFixture(beforeClient);
    beforeProtected = await protectedSnapshot(beforeClient);
  } finally {
    await beforeClient.end();
  }

  // The pre-fix migration ran this same update only after adding the column and
  // enum. Reproduce that protected-row trigger failure without changing fixture
  // state: the failed statement is atomic and leaves the pre-migration data intact.
  const unsafeClient = new Client({ connectionString: urls.test });
  await unsafeClient.connect();
  try {
    await unsafeClient.query(
      `DO $$
       BEGIN
         CREATE TYPE "PhoneCollectionMode" AS ENUM ('HIDDEN', 'OPTIONAL', 'REQUIRED');
       EXCEPTION WHEN duplicate_object THEN NULL;
       END $$;
       ALTER TABLE program_enrollment_policies
         ADD COLUMN phone_collection_mode "PhoneCollectionMode" NOT NULL DEFAULT 'OPTIONAL';`,
    );
    const unsafeUpdateRejected = await unsafeClient
      .query(
        `UPDATE program_enrollment_policies
         SET phone_collection_mode = email_collection_mode::text::"PhoneCollectionMode"`,
      )
      .then(() => false)
      .catch(
        (error) =>
          error?.code === "P0001" &&
          /published and superseded enrollment policy is immutable/u.test(error.message),
      );
    if (!unsafeUpdateRejected) {
      throw new Error("The legacy unsafe update did not reproduce the immutable-policy failure.");
    }
    report.LEGACY_UNSAFE_UPDATE_REPRODUCED = "YES";
    await unsafeClient.query(
      `ALTER TABLE program_enrollment_policies DROP COLUMN phone_collection_mode;
       DROP TYPE "PhoneCollectionMode";`,
    );
  } finally {
    await unsafeClient.end();
  }

  const upgrade = pnpmCommand(["--filter", "@waflo/database", "migrate:deploy"]);
  if ((await run(upgrade.command, upgrade.arguments, environment)) !== 0) {
    throw new Error("Target phone/Grid migration did not apply.");
  }

  const upgradedClient = new Client({ connectionString: urls.test });
  await upgradedClient.connect();
  try {
    await assertUpgrade(upgradedClient, beforeProtected);
    report.PROTECTED_HISTORY_PRESERVED = "YES";
    report.DRAFT_PHONE_NORMALIZATION = "YES";
    report.MULTI_PROGRAM_UPGRADE = "YES";
    report.NO_POLICY_COMPATIBILITY = "YES";
    report.MIGRATION_UPGRADE = "PASS";
  } finally {
    await upgradedClient.end();
  }
} finally {
  if (created && adminUrl) await dropDatabase(adminUrl, databaseName);
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

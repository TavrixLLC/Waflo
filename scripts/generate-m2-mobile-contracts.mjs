import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  issueStampSchema,
  m2ContractVersion,
  membershipResolveResultSchema,
  membershipResolveSchema,
  operationCommandStatusResultSchema,
  operationPublicStatusResultSchema,
  purchaseCurrencySchema,
  redeemRewardSchema,
  redemptionOperationResultSchema,
  reverseOperationResultSchema,
  stampOperationResultSchema,
  staffDeviceContextResultSchema,
} from "../packages/contracts/dist/index.js";

const generatorVersion = "waflo-m2-contract-generator-v1";
const root = process.cwd();
const outputDirectory = resolve(
  process.env.M2_OUTPUT_DIRECTORY ?? "artifacts/handoff-w4-m2-provenance-repair/mobile-contracts",
);

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function schema(value) {
  const generated = z.toJSONSchema(value, { io: "input" });
  delete generated.$schema;
  return generated;
}

function envelope(dataSchema) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["data", "requestId"],
    properties: {
      data: dataSchema,
      requestId: { type: "string", minLength: 1, maxLength: 160 },
    },
  };
}

function reference(name) {
  return { $ref: `#/components/schemas/${name}` };
}

const trackedStatus = git("status", "--porcelain", "--untracked-files=no");
if (trackedStatus) {
  throw new Error("M2 contracts must be generated from a clean committed source tree.");
}
const backendCommitSha = git("rev-parse", "HEAD");
const parentCommitSha = git("rev-parse", "HEAD^");

const schemas = {
  PurchaseCurrency: schema(purchaseCurrencySchema),
  StaffDeviceContextResult: schema(staffDeviceContextResultSchema),
  MembershipResolveRequest: schema(membershipResolveSchema),
  MembershipResolveResult: schema(membershipResolveResultSchema),
  StampRequest: schema(issueStampSchema),
  StampOperationResult: schema(stampOperationResultSchema),
  RedeemRequest: schema(redeemRewardSchema),
  RedemptionOperationResult: schema(redemptionOperationResultSchema),
  ReverseOperationResult: schema(reverseOperationResultSchema),
  OperationCommandStatusResult: schema(operationCommandStatusResultSchema),
  OperationPublicStatusResult: schema(operationPublicStatusResultSchema),
};

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Waflo M2 Staff Mobile Compatibility API",
    version: m2ContractVersion,
    description:
      "Typed mobile compatibility surface over the authoritative signed W4 Staff-device API.",
  },
  paths: {
    "/v1/staff/device-context": {
      get: {
        operationId: "getStaffMobileDeviceContext",
        security: [{ staffDeviceSignature: [] }],
        responses: {
          200: {
            description: "Mobile app version and signed device operational context.",
            content: {
              "application/json": { schema: envelope(reference("StaffDeviceContextResult")) },
            },
          },
        },
      },
    },
    "/v1/staff/memberships/resolve": {
      post: {
        operationId: "resolveMembershipForStaffMobile",
        security: [{ staffDeviceSignature: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: reference("MembershipResolveRequest") } },
        },
        responses: {
          200: {
            description: "Mobile-safe membership operational data.",
            content: {
              "application/json": { schema: envelope(reference("MembershipResolveResult")) },
            },
          },
        },
      },
    },
    "/v1/staff/operations/stamps": {
      post: {
        operationId: "issueStaffMobileStamps",
        security: [{ staffDeviceSignature: [] }],
        parameters: [
          {
            name: "x-idempotency-key",
            in: "header",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: reference("StampRequest") } },
        },
        responses: {
          200: {
            description: "Completed or idempotently replayed stamp operation.",
            content: {
              "application/json": { schema: envelope(reference("StampOperationResult")) },
            },
          },
        },
      },
    },
    "/v1/staff/operations/redeem": {
      post: {
        operationId: "redeemStaffMobileReward",
        security: [{ staffDeviceSignature: [] }],
        parameters: [
          {
            name: "x-idempotency-key",
            in: "header",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: reference("RedeemRequest") } },
        },
        responses: {
          200: {
            description: "Completed or idempotently replayed reward redemption.",
            content: {
              "application/json": { schema: envelope(reference("RedemptionOperationResult")) },
            },
          },
        },
      },
    },
    "/v1/staff/operations/{operationPublicId}": {
      get: {
        operationId: "getStaffMobileOperation",
        security: [{ staffDeviceSignature: [] }],
        parameters: [
          {
            name: "operationPublicId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          200: {
            description: "Public operation status with a filtered result payload.",
            content: {
              "application/json": {
                schema: envelope(reference("OperationPublicStatusResult")),
              },
            },
          },
        },
      },
    },
    "/v1/staff/operations/commands/{commandId}": {
      get: {
        operationId: "recoverStaffMobileCommand",
        security: [{ staffDeviceSignature: [] }],
        parameters: [
          {
            name: "commandId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          200: {
            description: "PROCESSING, COMPLETED, or FAILED command recovery for the same device.",
            content: {
              "application/json": {
                schema: envelope(reference("OperationCommandStatusResult")),
              },
            },
          },
          404: { description: "Not found, wrong device, or cross-tenant access." },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      staffDeviceSignature: {
        type: "apiKey",
        in: "header",
        name: "x-waflo-signature",
        description:
          "Ed25519 Waflo device-request-v1 signature; session, device, request, timestamp, nonce, and body digest headers are also required.",
      },
    },
    schemas,
  },
};

const m2Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://contracts.waflo.local/m2.schema.json",
  title: "Waflo M2 Mobile Contracts",
  contractVersion: m2ContractVersion,
  $defs: schemas,
};

const stableErrorCodes = {
  contractVersion: m2ContractVersion,
  codes: [
    "STAFF_DEVICE_NOT_ACTIVE",
    "STAFF_DEVICE_SIGNATURE_INVALID",
    "STAFF_DEVICE_BODY_DIGEST_INVALID",
    "STAFF_DEVICE_CLOCK_SKEW",
    "STAFF_DEVICE_NONCE_REPLAYED",
    "STAFF_APP_VERSION_UNSUPPORTED",
    "MEMBERSHIP_CREDENTIAL_INVALID",
    "MEMBERSHIP_NOT_OPERATIONAL",
    "LOCATION_NOT_AUTHORIZED",
    "STAFF_ASSIGNMENT_REQUIRED",
    "STAMP_OPERATION_LIMIT_EXCEEDED",
    "DAILY_STAMP_LIMIT_REACHED",
    "PURCHASE_AMOUNT_REQUIRED",
    "PURCHASE_AMOUNT_BELOW_MINIMUM",
    "PURCHASE_CURRENCY_MISMATCH",
    "FINAL_REWARD_PENDING_REDEMPTION",
    "REWARD_NOT_AVAILABLE",
    "MANAGER_APPROVAL_REQUIRED",
    "OPERATION_IDEMPOTENCY_CONFLICT",
    "OPERATION_IN_PROGRESS",
    "OPERATION_NOT_FOUND",
  ],
};

const membershipResolveFixture = {
  membershipPublicId: "mem_1234567890abcdef1234567890abcdef",
  membershipStatus: "ACTIVE",
  customerDisplayName: "Synthetic customer",
  programName: "Synthetic coffee rewards",
  locale: "en",
  progress: 5,
  goal: 8,
  rewardReady: false,
  completedCycles: 1,
  projectionVersion: 15,
  locationEligibility: { earning: true, redemption: true },
  operationLimits: {
    maximumStampsPerOperation: 5,
    maximumStampsPerCustomerPerDay: 10,
    dailyRemainingStamps: 4,
  },
  operationalTimezone: "Asia/Baghdad",
  operationalDate: "2026-08-07",
  purchaseRequirement: { required: true, minimumAmountMinor: 5_000, currency: "IQD" },
  stampVisuals: {
    filled: { state: "FILLED", contentDigest: "a".repeat(64) },
    empty: { state: "EMPTY", contentDigest: "b".repeat(64) },
  },
  availableRewards: [
    {
      publicId: "10000000-0000-4000-8000-000000000001",
      name: "Synthetic milestone",
      description: "Separate from the active stamp grid.",
      threshold: 4,
      finalReward: false,
      status: "AVAILABLE",
      redemptionCount: 0,
      maximumRedemptionCount: 1,
      expiresAt: null,
      requiresManagerApproval: false,
    },
  ],
};

const stampSuccessFixture = {
  operationPublicId: "20000000-0000-4000-8000-000000000001",
  commandId: "30000000-0000-4000-8000-000000000001",
  replayed: false,
  beforeProgress: 4,
  progress: 5,
  goal: 8,
  rewardReady: false,
  completedCycles: 1,
  projectionVersion: 16,
  unlockedRewards: [],
  requestId: "synthetic-request-1",
};

const stampFinalReadyFixture = {
  ...stampSuccessFixture,
  operationPublicId: "20000000-0000-4000-8000-000000000002",
  commandId: "30000000-0000-4000-8000-000000000002",
  beforeProgress: 7,
  progress: 8,
  rewardReady: true,
  projectionVersion: 17,
  unlockedRewards: [
    {
      publicId: "10000000-0000-4000-8000-000000000002",
      threshold: 8,
      status: "AVAILABLE",
      final: true,
    },
  ],
  requestId: "synthetic-request-2",
};

const redeemMilestoneFixture = {
  operationPublicId: "20000000-0000-4000-8000-000000000003",
  commandId: "30000000-0000-4000-8000-000000000003",
  replayed: false,
  redemptionPublicId: "40000000-0000-4000-8000-000000000001",
  rewardStatus: "REDEEMED",
  finalReward: false,
  beforeProgress: 5,
  progress: 5,
  goal: 8,
  rewardReady: false,
  completedCycles: 1,
  projectionVersion: 18,
  requestId: "synthetic-request-3",
};

const redeemFinalResetFixture = {
  ...redeemMilestoneFixture,
  operationPublicId: "20000000-0000-4000-8000-000000000004",
  commandId: "30000000-0000-4000-8000-000000000004",
  redemptionPublicId: "40000000-0000-4000-8000-000000000002",
  finalReward: true,
  beforeProgress: 8,
  progress: 0,
  completedCycles: 2,
  projectionVersion: 19,
  requestId: "synthetic-request-4",
};

const commandBase = {
  commandId: stampSuccessFixture.commandId,
  operationPublicId: stampSuccessFixture.operationPublicId,
  operationType: "ISSUE_STAMP",
  createdAt: "2026-08-07T12:00:00.000Z",
};
const fixtures = new Map([
  [
    "membership-resolve.fixture.json",
    membershipResolveResultSchema.parse(membershipResolveFixture),
  ],
  ["stamp-success.fixture.json", stampOperationResultSchema.parse(stampSuccessFixture)],
  ["stamp-final-ready.fixture.json", stampOperationResultSchema.parse(stampFinalReadyFixture)],
  ["redeem-milestone.fixture.json", redemptionOperationResultSchema.parse(redeemMilestoneFixture)],
  [
    "redeem-final-reset.fixture.json",
    redemptionOperationResultSchema.parse(redeemFinalResetFixture),
  ],
  [
    "operation-processing.fixture.json",
    operationCommandStatusResultSchema.parse({
      ...commandBase,
      status: "PROCESSING",
      result: null,
      safeFailureCode: null,
      completedAt: null,
    }),
  ],
  [
    "operation-failed.fixture.json",
    operationCommandStatusResultSchema.parse({
      ...commandBase,
      status: "FAILED",
      result: null,
      safeFailureCode: "PURCHASE_CURRENCY_MISMATCH",
      completedAt: "2026-08-07T12:00:01.000Z",
    }),
  ],
  [
    "operation-completed.fixture.json",
    operationCommandStatusResultSchema.parse({
      ...commandBase,
      status: "COMPLETED",
      result: stampSuccessFixture,
      safeFailureCode: null,
      completedAt: "2026-08-07T12:00:01.000Z",
    }),
  ],
  ["stamp-visual.fixture.json", membershipResolveFixture.stampVisuals],
]);

await mkdir(outputDirectory, { recursive: true });
const generated = new Map([
  ["openapi.m2.json", openapi],
  ["m2.schema.json", m2Schema],
  ["stable-error-codes.m2.json", stableErrorCodes],
  ...fixtures,
]);
for (const [name, value] of generated) {
  await writeFile(resolve(outputDirectory, name), json(value), "utf8");
}

const generatedFiles = {};
for (const [name, value] of generated) generatedFiles[name] = sha256(json(value));
const sourcePaths = [
  "package.json",
  "pnpm-lock.yaml",
  "turbo.json",
  "packages/contracts/src/index.ts",
  "packages/contracts/src/m2.ts",
  "packages/contracts/src/w4.ts",
  "packages/config/src/index.ts",
  "packages/staff-device-security/src/index.ts",
  ".env.example",
  "apps/api/src/common/request-context.ts",
  "apps/api/src/security/guards.ts",
  "apps/api/src/loyalty/staff-operations.controller.ts",
  "apps/api/src/loyalty/loyalty-operation.service.ts",
  "apps/api/src/staff-devices/staff-device.service.ts",
  "apps/api/src/staff-devices/staff-device.controller.ts",
  "scripts/generate-m2-mobile-contracts.mjs",
  "scripts/verify-m2-mobile-contracts.mjs",
  "tests/unit/m2-mobile-contracts.test.ts",
  "tests/http/w4-staff-operations.test.ts",
  "tests/concurrency/w4-loyalty-concurrency.test.ts",
  "docs/w4/flutter-handoff.md",
  "docs/w4/m2-mobile-compatibility.md",
];
const sourceFiles = {};
for (const path of sourcePaths) {
  sourceFiles[path] = sha256(execFileSync("git", ["show", `${backendCommitSha}:${path}`]));
}
const migrationCount = git(
  "ls-tree",
  "-r",
  "--name-only",
  backendCommitSha,
  "packages/database/prisma/migrations",
)
  .split("\n")
  .filter((path) => path.endsWith("/migration.sql")).length;
const bundleSha256 = sha256(
  Object.entries(generatedFiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, hash]) => `${name}:${hash}`)
    .join("\n"),
);
const sourceManifest = {
  contractVersion: m2ContractVersion,
  generatorVersion,
  backendCommitSha,
  parentCommitSha,
  reconstruction: {
    classification: "PARTIAL_W4_RECOVERY_WITH_M2_COMPATIBILITY_RECONSTRUCTION",
    historicalM2CommitRecovered: false,
  },
  generatedFiles,
  bundleSha256,
  sourceFiles,
  migrations: {
    migrationCount,
    migrationAddedForM2: false,
  },
  safety: {
    containsValidQrCredential: false,
    containsAccessToken: false,
    containsPrivateKey: false,
    containsSigningSecret: false,
    containsCustomerEmailOrPhone: false,
    fixturesAreSynthetic: true,
  },
};
await writeFile(resolve(outputDirectory, "source-manifest.json"), json(sourceManifest), "utf8");

const finalFiles = (await readdir(outputDirectory)).sort();
process.stdout.write(
  `${JSON.stringify(
    {
      generatorVersion,
      backendCommitSha,
      outputDirectory,
      files: finalFiles,
      bundleSha256,
    },
    null,
    2,
  )}\n`,
);

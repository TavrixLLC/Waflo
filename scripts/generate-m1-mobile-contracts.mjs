import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { toJSONSchema } from "../packages/contracts/node_modules/zod/index.js";

process.env.NODE_ENV = "test";
process.env.TEST_STAFF_CLIENT_ENABLED = "true";
process.env.SCALE_LOCATION_LIMIT = "100";
process.env.SCALE_TEAM_LIMIT = "100";

const root = process.cwd();
const outputDirectory = resolve(
  process.env.M1_OUTPUT_DIRECTORY ?? "artifacts/handoff-w4-mobile-contract-patch/mobile-contracts",
);
await mkdir(outputDirectory, { recursive: true });

const contracts = await import("../packages/contracts/dist/index.js");
const { createApiApplication } = await import("../apps/api/dist/app.js");

function jsonSchema(schema) {
  const value = toJSONSchema(schema, { target: "draft-2020-12" });
  delete value.$schema;
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(name, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(resolve(outputDirectory, name), contents, "utf8");
  return { name, sha256: sha256(contents) };
}

function run(command, arguments_, workingDirectory = root) {
  const result = spawnSync(command, arguments_, {
    cwd: workingDirectory,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`.trim(),
  };
}

function git(arguments_) {
  const gitArguments = ["-c", "safe.directory=C:/WafloProject/waflo", "-C", root, ...arguments_];
  const result = run("git", gitArguments);
  if (result.status !== 0) throw new Error(`git ${arguments_.join(" ")} failed: ${result.output}`);
  return result.output;
}

const app = await createApiApplication({ logger: false });
let authoritativeOpenApi;
try {
  const response = await app.inject({ method: "GET", url: "/docs/openapi.json" });
  if (response.statusCode !== 200) {
    throw new Error(`OpenAPI generation returned HTTP ${response.statusCode}.`);
  }
  authoritativeOpenApi = response.json();
} finally {
  await app.close();
}

const mobilePaths = [
  "/v1/staff/devices/pairing/claim",
  "/v1/staff/devices/pairing/challenge",
  "/v1/staff/devices/pairing/complete",
  "/v1/staff/devices/session/refresh",
  "/v1/staff/devices/session/logout",
  "/v1/staff/device-context",
  "/v1/staff/memberships/resolve",
  "/v1/staff/operations/stamps",
  "/v1/staff/operations/redeem",
  "/v1/staff/operations/reverse",
  "/v1/staff/operations/{operationPublicId}",
];
const filteredPaths = Object.fromEntries(
  mobilePaths.flatMap((path) => {
    const definition = authoritativeOpenApi.paths?.[path];
    if (!definition) throw new Error(`Authoritative OpenAPI is missing ${path}.`);
    return [[path, definition]];
  }),
);

const schemaDefinitions = {
  StrictSemanticVersion: jsonSchema(contracts.strictSemanticVersionSchema),
  DevicePairingClaimRequest: jsonSchema(contracts.devicePairingClaimSchema),
  DevicePairingClaimResponse: jsonSchema(contracts.devicePairingClaimResponseSchema),
  DevicePairingRecoveryRequest: jsonSchema(contracts.devicePairingChallengeSchema),
  DevicePairingRecoveryResponse: jsonSchema(contracts.devicePairingRecoveryResponseSchema),
  DevicePairingCompleteRequest: jsonSchema(contracts.devicePairingCompleteSchema),
  DevicePairingCompleteResponse: jsonSchema(contracts.devicePairingCompleteResponseSchema),
  StaffDeviceSessionRefreshRequest: jsonSchema(contracts.staffDeviceSessionRefreshSchema),
  StaffDeviceSessionRefreshResponse: jsonSchema(contracts.staffDeviceSessionRefreshResponseSchema),
  MobilePublicDeviceContext: jsonSchema(contracts.mobileStaffDeviceContextSchema),
  StaffDeviceContextResult: jsonSchema(contracts.staffDeviceContextResultSchema),
  RequestSigningFixture: jsonSchema(contracts.requestSigningFixtureSchema),
  ApiError: {
    type: "object",
    additionalProperties: false,
    required: ["error"],
    properties: {
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "requestId"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          requestId: { type: "string" },
        },
      },
    },
  },
};

function envelope(reference) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["data", "requestId"],
    properties: {
      data: { $ref: `#/components/schemas/${reference}` },
      requestId: { type: "string" },
    },
  };
}

const operationSchemas = [
  [
    "/v1/staff/devices/pairing/claim",
    "post",
    "DevicePairingClaimRequest",
    "DevicePairingClaimResponse",
  ],
  [
    "/v1/staff/devices/pairing/challenge",
    "post",
    "DevicePairingRecoveryRequest",
    "DevicePairingRecoveryResponse",
  ],
  [
    "/v1/staff/devices/pairing/complete",
    "post",
    "DevicePairingCompleteRequest",
    "DevicePairingCompleteResponse",
  ],
  [
    "/v1/staff/devices/session/refresh",
    "post",
    "StaffDeviceSessionRefreshRequest",
    "StaffDeviceSessionRefreshResponse",
  ],
];
for (const [path, method, requestSchema, responseSchema] of operationSchemas) {
  const operation = filteredPaths[path]?.[method];
  if (!operation) throw new Error(`OpenAPI operation missing: ${method.toUpperCase()} ${path}`);
  operation.requestBody = {
    required: true,
    content: {
      "application/json": { schema: { $ref: `#/components/schemas/${requestSchema}` } },
    },
  };
  operation.responses["200"] = {
    description: "Successful mobile response",
    content: { "application/json": { schema: envelope(responseSchema) } },
  };
}
const contextOperation = filteredPaths["/v1/staff/device-context"]?.get;
if (!contextOperation) throw new Error("OpenAPI operation missing: GET /v1/staff/device-context");
contextOperation.responses["200"] = {
  description: "Mobile-safe active device context",
  content: { "application/json": { schema: envelope("StaffDeviceContextResult") } },
};

const signedHeaders = [
  ["authorization", "Device session bearer token"],
  ["x-waflo-device-id", "Paired device public ID"],
  ["x-waflo-device-session-id", "Device session ID"],
  ["x-waflo-request-id", "Unique request ID"],
  ["x-waflo-timestamp", "ISO-8601 request time"],
  ["x-waflo-nonce", "Fresh request nonce"],
  ["x-waflo-body-sha256", "Lowercase hexadecimal SHA-256 body digest"],
  ["x-waflo-signature", "Base64url Ed25519 signature"],
];
for (const path of mobilePaths.filter(
  (path) => !path.includes("/pairing/") && !path.endsWith("/session/refresh"),
)) {
  for (const operation of Object.values(filteredPaths[path] ?? {})) {
    if (!operation || typeof operation !== "object" || !("responses" in operation)) continue;
    operation.parameters = [
      ...(operation.parameters ?? []),
      ...signedHeaders.map(([name, description]) => ({
        in: "header",
        name,
        description,
        required: true,
        schema: { type: "string" },
      })),
    ];
  }
}

const openApiM1 = {
  ...authoritativeOpenApi,
  info: {
    ...authoritativeOpenApi.info,
    title: "Waflo M1 Staff Mobile API",
    version: "w4-m1-contract-v1",
    description: "Mobile-safe subset of the approved W4 backend contract.",
  },
  paths: filteredPaths,
  components: {
    schemas: schemaDefinitions,
  },
};

const m1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://waflo.app/contracts/m1.schema.json",
  title: "Waflo W4-to-M1 Mobile Contract",
  type: "object",
  $defs: schemaDefinitions,
};

const deviceContextFixture = {
  data: {
    organizationId: "80000000-0000-4000-8000-000000000001",
    role: "STAFF",
    locationId: "80000000-0000-4000-8000-000000000002",
    devicePublicId: "20000000-0000-4000-8000-000000000001",
    deviceSessionId: "80000000-0000-4000-8000-000000000003",
    platform: "ANDROID",
    appVersion: "1.4.0",
    minimumSupportedAppVersion: "1.2.0",
    appVersionSupported: true,
    organization: { publicId: "today", displayName: "Today Coffee" },
    staff: {
      publicId: "10000000-0000-4000-8000-000000000001",
      displayName: "Fixture Staff",
      role: "STAFF",
    },
    device: {
      publicId: "20000000-0000-4000-8000-000000000001",
      displayName: "Fixture counter device",
      status: "ACTIVE",
      platform: "ANDROID",
      appVersion: "1.4.0",
    },
    currentLocation: {
      publicId: "30000000-0000-4000-8000-000000000001",
      displayName: "Main branch",
      earningAllowed: true,
      redemptionAllowed: true,
    },
    assignedLocations: [
      {
        publicId: "30000000-0000-4000-8000-000000000001",
        displayName: "Main branch",
        earningAllowed: true,
        redemptionAllowed: true,
      },
    ],
    appPolicy: { minimumSupportedVersion: "1.2.0", updateRequired: false },
    requestId: "40000000-0000-4000-8000-000000000001",
  },
  requestId: "40000000-0000-4000-8000-000000000001",
  publicProjectionContainsInternalDatabaseIds: false,
  containsLegacyM2DatabaseIds: true,
  containsCredential: false,
};

const fixtureChallenge = "fixture-challenge-not-valid-for-any-environment";
const pairingRecoveryFixture = {
  scenario: "claim-response-ambiguous-then-recover",
  request: { pairingPublicId: "50000000-0000-4000-8000-000000000001" },
  response: {
    data: {
      pairingPublicId: "50000000-0000-4000-8000-000000000001",
      challenge: fixtureChallenge,
      challengeExpiresAt: "2026-08-01T12:02:00.000Z",
      signatureAlgorithm: "Ed25519",
      message: `waflo-pair-challenge-v1\n50000000-0000-4000-8000-000000000001\n${fixtureChallenge}\nfixture-installation-not-valid`,
    },
    requestId: "60000000-0000-4000-8000-000000000001",
  },
  pairingSecretIncluded: false,
  organizationOrStaffDataIncluded: false,
};

const requestSigningFixture = {
  envelopeVersion: "waflo-device-request-v1",
  algorithm: "Ed25519",
  method: "POST",
  canonicalPath: "/v1/staff/operations/stamps",
  requestId: "70000000-0000-4000-8000-000000000001",
  timestamp: "2026-08-01T12:00:00.000Z",
  nonce: "fixture-nonce-not-valid-for-production",
  bodySha256: "0".repeat(64),
  deviceSessionId: "70000000-0000-4000-8000-000000000002",
  organizationId: "70000000-0000-4000-8000-000000000003",
  separator: "\\n",
  containsCredential: false,
};

contracts.staffDeviceContextResultSchema.parse(deviceContextFixture.data);
contracts.devicePairingRecoveryResponseSchema.parse(pairingRecoveryFixture.response.data);
contracts.requestSigningFixtureSchema.parse(requestSigningFixture);

const bundleFiles = [];
bundleFiles.push(await writeJson("openapi.m1.json", openApiM1));
bundleFiles.push(await writeJson("m1.schema.json", m1Schema));
bundleFiles.push(
  await writeJson("stable-error-codes.json", {
    version: "waflo-m1-stable-errors-v1",
    errors: contracts.M1_STABLE_ERROR_CODES,
  }),
);
bundleFiles.push(await writeJson("device-context.fixture.json", deviceContextFixture));
bundleFiles.push(await writeJson("pairing-recovery.fixture.json", pairingRecoveryFixture));
bundleFiles.push(await writeJson("request-signing.fixture.json", requestSigningFixture));

const migrationDirectories = (
  await readdir(resolve("packages/database/prisma/migrations"), { withFileTypes: true })
).filter((entry) => entry.isDirectory());
const migrationCommand = run(
  process.execPath,
  [resolve("packages/database/node_modules/prisma/build/index.js"), "migrate", "status"],
  resolve("packages/database"),
);

const changed = git(["diff", "--name-only", "HEAD"]).split(/\r?\n/).filter(Boolean);
const untracked = git(["ls-files", "--others", "--exclude-standard"])
  .split(/\r?\n/)
  .filter(Boolean);
const sourcePaths = [...new Set([...changed, ...untracked])]
  .filter((path) => !path.startsWith("artifacts/handoff-w4-mobile-contract-patch/"))
  .sort();
const sourceFiles = [];
for (const path of sourcePaths) {
  const absolute = resolve(path);
  if (!(await stat(absolute)).isFile()) continue;
  sourceFiles.push({ path: path.replaceAll("\\", "/"), sha256: sha256(await readFile(absolute)) });
}
const generatedChecksum = sha256(
  bundleFiles
    .map((file) => `${file.name}:${file.sha256}`)
    .sort()
    .join("\n"),
);
const sourceChecksum = sha256(sourceFiles.map((file) => `${file.path}:${file.sha256}`).join("\n"));
const manifest = {
  version: "waflo-w4-m1-source-manifest-v1",
  generatedAt: new Date().toISOString(),
  backendCommitSha: git(["rev-parse", "HEAD"]),
  workingTreeSourceChecksum: sourceChecksum,
  migration: {
    count: migrationDirectories.length,
    status: migrationCommand.status === 0 ? "UP_TO_DATE" : "CHECK_FAILED",
    statusOutput: migrationCommand.output,
  },
  sourceFiles,
  bundleFiles,
  generatedChecksumAlgorithm: "SHA-256",
  generatedChecksum,
  containsCredentials: false,
  containsRealQrValues: false,
};
await writeJson("source-manifest.json", manifest);
process.stdout.write(
  `Generated M1 mobile contracts in ${outputDirectory}\nSHA-256: ${generatedChecksum}\nSources: ${sourceFiles.length}\nMigrations: ${migrationDirectories.length} (${manifest.migration.status})\n`,
);

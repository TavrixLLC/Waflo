import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

process.env.NODE_ENV ??= "test";
const outputDirectory = resolve("artifacts/handoff-w4-round-1/provider-artifacts");
await mkdir(outputDirectory, { recursive: true });
const { createApiApplication } = await import("../apps/api/dist/app.js");
const app = await createApiApplication({ logger: false });
try {
  const response = await app.inject({ method: "GET", url: "/docs/openapi.json" });
  if (response.statusCode !== 200) {
    throw new Error(`OpenAPI generation returned HTTP ${response.statusCode}.`);
  }
  const openApi = response.json();
  await writeFile(
    resolve(outputDirectory, "openapi.json"),
    `${JSON.stringify(openApi, null, 2)}\n`,
    "utf8",
  );
  const flutterContract = {
    version: "waflo-w4-flutter-contract-v1",
    pairingQr: "waflo-pair-v1.<public-id>.<one-time-secret>.<environment>",
    pairing: {
      claim: "POST /v1/staff/devices/pairing/claim",
      challenge: "POST /v1/staff/devices/pairing/challenge",
      complete: "POST /v1/staff/devices/pairing/complete",
    },
    session: {
      refresh: "POST /v1/staff/devices/session/refresh",
      logout: "POST /v1/staff/devices/session/logout",
      context: "GET /v1/staff/device-context",
    },
    operations: {
      resolve: "POST /v1/staff/memberships/resolve",
      issue: "POST /v1/staff/operations/stamps",
      redeem: "POST /v1/staff/operations/redeem",
      reverse: "POST /v1/staff/operations/reverse",
      status: "GET /v1/staff/operations/{operationPublicId}",
    },
    signing: {
      algorithm: "Ed25519",
      envelopeVersion: "waflo-device-request-v1",
      fields: [
        "method",
        "canonicalPath",
        "requestId",
        "timestamp",
        "nonce",
        "bodySha256",
        "deviceSessionId",
        "organizationId",
      ],
      separator: "\\n",
      retry: "Keep the operation idempotency UUID; generate a fresh nonce and timestamp.",
      maximumClockSkewSecondsEnvironment: "DEVICE_REQUEST_MAX_CLOCK_SKEW_SECONDS",
    },
    localizationKeys: [
      "operation.completed",
      "operation.replayed",
      "operation.pending_approval",
      "error.device_not_active",
      "error.signature_invalid",
      "error.clock_skew",
      "error.nonce_replayed",
      "error.location_not_authorized",
      "error.daily_cap",
      "error.purchase_required",
      "error.currency_mismatch",
      "error.final_reward_pending",
    ],
  };
  await writeFile(
    resolve(outputDirectory, "flutter-contract.json"),
    `${JSON.stringify(flutterContract, null, 2)}\n`,
    "utf8",
  );
  const fixtures = {
    canonicalRequest: {
      method: "POST",
      canonicalPath: "/v1/staff/operations/stamps",
      requestId: "00000000-0000-4000-8000-000000000001",
      timestamp: "2026-07-30T12:00:00.000Z",
      nonce: "fixture-nonce-not-valid-for-production",
      bodySha256: "0".repeat(64),
      deviceSessionId: "00000000-0000-4000-8000-000000000002",
      organizationId: "00000000-0000-4000-8000-000000000003",
    },
    safeError: {
      error: {
        code: "STAFF_DEVICE_NONCE_REPLAYED",
        message: "This Staff device request has already been used.",
      },
    },
    containsCredential: false,
    containsPrivateKey: false,
  };
  await writeFile(
    resolve(outputDirectory, "stable-fixtures.json"),
    `${JSON.stringify(fixtures, null, 2)}\n`,
    "utf8",
  );
} finally {
  await app.close();
}

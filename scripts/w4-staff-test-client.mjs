import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

const envelopeVersion = "waflo-device-request-v1";
const baseUrl = (process.env.W4_TEST_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const pairingToken = process.env.W4_TEST_PAIRING_TOKEN;
const action = process.env.W4_TEST_ACTION ?? "context";

if (process.env.NODE_ENV === "production") {
  throw new Error("The W4 Staff Test Client is disabled in production.");
}
if (!pairingToken) {
  throw new Error("W4_TEST_PAIRING_TOKEN is required and is never printed.");
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const installationId = `w4-test-client-${randomUUID()}`;
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

async function api(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const code = payload?.error?.code ?? payload?.code ?? `HTTP_${response.status}`;
    throw new Error(`${code}: Staff Test Client request failed.`);
  }
  return payload?.data ?? payload;
}

const claim = await api("/v1/staff/devices/pairing/claim", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    pairingToken,
    installationId,
    publicKey: publicKeyPem,
    platform: "TEST_CLIENT",
    appVersion: "w4-test-client/1.0",
    osVersion: process.version,
    model: "Node.js development client",
  }),
});
const challengeSignature = sign(null, Buffer.from(claim.message, "utf8"), privateKey).toString(
  "base64url",
);
const paired = await api("/v1/staff/devices/pairing/complete", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    pairingPublicId: claim.pairingPublicId,
    challenge: claim.challenge,
    signature: challengeSignature,
    displayName: "W4 ephemeral Staff Test Client",
  }),
});

function bodyDigest(body) {
  return createHash("sha256").update(body).digest("hex");
}

function canonicalEnvelope(input) {
  return [
    envelopeVersion,
    input.method,
    input.path,
    input.requestId,
    input.timestamp,
    input.nonce,
    input.digest,
    paired.session.id,
    paired.context.organizationId,
  ].join("\n");
}

async function signedRequest(path, input = {}) {
  const method = input.method ?? "GET";
  const serialized = input.payload === undefined ? "" : JSON.stringify(input.payload);
  const requestId = randomUUID();
  const timestamp =
    input.timestamp ??
    (action === "clock-skew" ? "2025-01-01T00:00:00.000Z" : new Date().toISOString());
  const nonce = input.nonce ?? randomUUID();
  const digest = bodyDigest(serialized);
  const signature = sign(
    null,
    Buffer.from(canonicalEnvelope({ method, path, requestId, timestamp, nonce, digest }), "utf8"),
    privateKey,
  ).toString("base64url");
  return api(path, {
    method,
    headers: {
      authorization: `Device ${paired.session.token}`,
      "content-type": "application/json",
      "x-waflo-device-id": paired.device.publicId,
      "x-waflo-device-session-id": paired.session.id,
      "x-waflo-request-id": requestId,
      "x-waflo-timestamp": timestamp,
      "x-waflo-nonce": nonce,
      "x-waflo-body-sha256": digest,
      "x-waflo-signature": signature,
      ...(input.idempotencyKey ? { "x-idempotency-key": input.idempotencyKey } : {}),
    },
    ...(serialized ? { body: serialized } : {}),
  });
}

const qrPayload = process.env.W4_TEST_MEMBERSHIP_QR;
let result;
if (action === "context" || action === "clock-skew") {
  result = await signedRequest("/v1/staff/device-context");
} else if (action === "resolve") {
  if (!qrPayload) throw new Error("W4_TEST_MEMBERSHIP_QR is required for resolve.");
  result = await signedRequest("/v1/staff/memberships/resolve", {
    method: "POST",
    payload: { qrPayload },
  });
} else if (action === "issue" || action === "replay") {
  if (!qrPayload) throw new Error("W4_TEST_MEMBERSHIP_QR is required for issue.");
  const idempotencyKey = randomUUID();
  const operation = {
    method: "POST",
    idempotencyKey,
    payload: {
      qrPayload,
      amount: Number(process.env.W4_TEST_STAMP_AMOUNT ?? "1"),
    },
  };
  result = await signedRequest("/v1/staff/operations/stamps", operation);
  if (action === "replay") {
    result = {
      first: result,
      replay: await signedRequest("/v1/staff/operations/stamps", operation),
    };
  }
} else {
  throw new Error(`Unsupported W4_TEST_ACTION: ${action}`);
}

console.log(
  JSON.stringify(
    {
      action,
      devicePublicId: paired.device.publicId,
      locationId: paired.context.locationId,
      result,
      privateKeyPersisted: false,
      sensitiveInputPrinted: false,
    },
    null,
    2,
  ),
);

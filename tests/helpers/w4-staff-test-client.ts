import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  bodySha256,
  canonicalDeviceRequestEnvelope,
} from "../../packages/staff-device-security/src/index.js";

export interface PairedStaffTestClient {
  readonly privateKey: KeyObject;
  readonly publicKeyPem: string;
  readonly devicePublicId: string;
  readonly deviceSessionId: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly accessToken: string;
}

export function createEphemeralStaffDeviceKeypair() {
  const keys = generateKeyPairSync("ed25519");
  return {
    privateKey: keys.privateKey,
    publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

export function signPairingMessage(privateKey: KeyObject, message: string): string {
  return sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64url");
}

export async function signedStaffInject(
  app: NestFastifyApplication,
  client: PairedStaffTestClient,
  input: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    url: string;
    payload?: unknown;
    idempotencyKey?: string;
    nonce?: string;
    timestamp?: string;
    bodyDigest?: string;
    signingBodyDigest?: string;
    accessToken?: string;
  },
) {
  const canonicalPath = input.url.split("?")[0] ?? input.url;
  const serializedBody = input.payload === undefined ? "" : JSON.stringify(input.payload);
  const bodyDigest = input.bodyDigest ?? bodySha256(serializedBody);
  const requestId = randomUUID();
  const timestamp = input.timestamp ?? new Date().toISOString();
  const nonce = input.nonce ?? randomUUID();
  const signature = sign(
    null,
    Buffer.from(
      canonicalDeviceRequestEnvelope({
        method: input.method,
        canonicalPath,
        requestId,
        timestamp,
        nonce,
        bodyDigest: input.signingBodyDigest ?? bodyDigest,
        deviceSessionId: client.deviceSessionId,
        organizationId: client.organizationId,
      }),
      "utf8",
    ),
    client.privateKey,
  ).toString("base64url");
  return app.inject({
    method: input.method,
    url: input.url,
    headers: {
      authorization: `Device ${input.accessToken ?? client.accessToken}`,
      "content-type": "application/json",
      "x-waflo-device-id": client.devicePublicId,
      "x-waflo-device-session-id": client.deviceSessionId,
      "x-waflo-request-id": requestId,
      "x-waflo-timestamp": timestamp,
      "x-waflo-nonce": nonce,
      "x-waflo-body-sha256": bodyDigest,
      "x-waflo-signature": signature,
      ...(input.idempotencyKey ? { "x-idempotency-key": input.idempotencyKey } : {}),
    },
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  });
}

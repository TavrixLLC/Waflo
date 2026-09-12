import { createCipheriv, createDecipheriv, createPrivateKey, randomBytes } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

export const APPLE_IDENTITY_ISSUER = "https://appleid.apple.com";

export interface ExternalAuthTokenKeyring {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export interface EncryptedExternalAuthToken {
  readonly keyVersion: number;
  readonly serialized: string;
}

function decodeKey(value: string | Buffer): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  const trimmed = value.trim();
  const decoded = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, trimmed.includes("-") || trimmed.includes("_") ? "base64url" : "base64");
  if (decoded.length !== 32) {
    throw new Error("External-auth token encryption keys must decode to exactly 32 bytes.");
  }
  return decoded;
}

export function createExternalAuthTokenKeyring(
  activeVersion: number,
  entries: Readonly<Record<number, string | Buffer>>,
): ExternalAuthTokenKeyring {
  const keys = new Map<number, Buffer>();
  for (const [rawVersion, value] of Object.entries(entries)) {
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("External-auth token encryption key versions must be positive integers.");
    }
    keys.set(version, decodeKey(value));
  }
  if (!Number.isInteger(activeVersion) || activeVersion < 1 || !keys.has(activeVersion)) {
    throw new Error("The active external-auth token encryption key version is unavailable.");
  }
  return { activeVersion, keys };
}

function associatedData(contextId: string, purpose: string): Buffer {
  if (!/^[0-9a-f-]{36}$/i.test(contextId) || !/^[a-z-]{3,40}$/.test(purpose)) {
    throw new Error("External-auth token encryption context is invalid.");
  }
  return Buffer.from(`waflo:external-auth-token:${contextId}:${purpose}`, "utf8");
}

export function encryptExternalAuthToken(
  plaintext: string,
  input: {
    contextId: string;
    purpose: "apple-refresh-token" | "apple-access-token";
    keyring: ExternalAuthTokenKeyring;
  },
): EncryptedExternalAuthToken {
  if (!plaintext || plaintext.length > 32_768) {
    throw new Error("External-auth token material is invalid.");
  }
  const key = input.keyring.keys.get(input.keyring.activeVersion);
  if (!key) throw new Error("Active external-auth token encryption key is unavailable.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData(input.contextId, input.purpose));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    keyVersion: input.keyring.activeVersion,
    serialized: [
      "wae1",
      String(input.keyring.activeVersion),
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join("."),
  };
}

export function decryptExternalAuthToken(
  serialized: string,
  input: {
    contextId: string;
    purpose: "apple-refresh-token" | "apple-access-token";
    keyring: ExternalAuthTokenKeyring;
  },
): string {
  const [format, rawVersion, rawNonce, rawCiphertext, rawTag, extra] = serialized.split(".");
  const version = Number(rawVersion);
  if (
    format !== "wae1" ||
    extra !== undefined ||
    !Number.isInteger(version) ||
    !rawNonce ||
    !rawCiphertext ||
    !rawTag
  ) {
    throw new Error("Encrypted external-auth token material is malformed.");
  }
  const key = input.keyring.keys.get(version);
  if (!key)
    throw new Error(`External-auth token encryption key version ${version} is unavailable.`);
  const nonce = Buffer.from(rawNonce, "base64url");
  const tag = Buffer.from(rawTag, "base64url");
  if (nonce.length !== 12 || tag.length !== 16) {
    throw new Error("Encrypted external-auth token material is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(associatedData(input.contextId, input.purpose));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(rawCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function resolveApplePrivateKey(
  raw: string | undefined,
  base64: string | undefined,
): string | null {
  const value = raw
    ? raw.replace(/\\n/g, "\n")
    : base64
      ? Buffer.from(base64, "base64").toString("utf8")
      : "";
  if (!value.includes("BEGIN PRIVATE KEY")) return null;
  try {
    const key = createPrivateKey(value);
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function createAppleClientSecret(input: {
  privateKey: string;
  teamId: string;
  keyId: string;
  clientId: string;
  now?: Date;
}): Promise<string> {
  const key = await importPKCS8(input.privateKey, "ES256");
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: input.keyId })
    .setIssuer(input.teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setAudience(APPLE_IDENTITY_ISSUER)
    .setSubject(input.clientId)
    .sign(key);
}

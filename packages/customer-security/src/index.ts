import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const EMAIL_MAX_LENGTH = 254;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

export interface VersionedSecret {
  readonly version: number;
  readonly secret: Buffer;
}

export interface CustomerDataKeyring {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export interface EncryptedCustomerValue {
  readonly keyVersion: number;
  readonly serialized: string;
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function decodeSecret(value: string, expectedBytes = 32): Buffer {
  const trimmed = value.trim();
  const decoded = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, trimmed.includes("-") || trimmed.includes("_") ? "base64url" : "base64");
  if (decoded.length !== expectedBytes) {
    throw new Error(`Secret must decode to exactly ${expectedBytes} bytes.`);
  }
  return decoded;
}

export function createCustomerDataKeyring(
  activeVersion: number,
  entries: Readonly<Record<number, string | Buffer>>,
): CustomerDataKeyring {
  const keys = new Map<number, Buffer>();
  for (const [version, value] of Object.entries(entries)) {
    const parsedVersion = Number(version);
    keys.set(parsedVersion, Buffer.isBuffer(value) ? Buffer.from(value) : decodeSecret(value));
  }
  if (!Number.isInteger(activeVersion) || activeVersion < 1 || !keys.has(activeVersion)) {
    throw new Error("The active customer-data encryption key version is not configured.");
  }
  return { activeVersion, keys };
}

function associatedData(organizationId: string, recordId: string, purpose: string): Buffer {
  if (!organizationId || !recordId || !purpose) throw new Error("Encryption context is required.");
  return Buffer.from(`waflo:${purpose}:${organizationId}:${recordId}`, "utf8");
}

export function encryptCustomerValue(
  plaintext: string,
  input: {
    organizationId: string;
    recordId: string;
    purpose: string;
    keyring: CustomerDataKeyring;
  },
): EncryptedCustomerValue {
  const key = input.keyring.keys.get(input.keyring.activeVersion);
  if (!key) throw new Error("Active customer-data encryption key is unavailable.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData(input.organizationId, input.recordId, input.purpose));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyVersion: input.keyring.activeVersion,
    serialized: [
      "wce1",
      String(input.keyring.activeVersion),
      base64Url(nonce),
      base64Url(ciphertext),
      base64Url(tag),
    ].join("."),
  };
}

export function decryptCustomerValue(
  serialized: string,
  input: {
    organizationId: string;
    recordId: string;
    purpose: string;
    keyring: CustomerDataKeyring;
  },
): string {
  const parts = serialized.split(".");
  if (parts.length !== 5 || parts[0] !== "wce1") {
    throw new Error("Unsupported encrypted customer-data format.");
  }
  const keyVersion = Number(parts[1]);
  const noncePart = parts[2];
  const ciphertextPart = parts[3];
  const tagPart = parts[4];
  if (!Number.isInteger(keyVersion) || !noncePart || !ciphertextPart || !tagPart) {
    throw new Error("Malformed encrypted customer-data value.");
  }
  const key = input.keyring.keys.get(keyVersion);
  if (!key) throw new Error(`Customer-data encryption key version ${keyVersion} is unavailable.`);
  const nonce = decodeBase64Url(noncePart);
  const tag = decodeBase64Url(tagPart);
  if (nonce.length !== 12 || tag.length !== 16) {
    throw new Error("Malformed encrypted customer-data value.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(associatedData(input.organizationId, input.recordId, input.purpose));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(decodeBase64Url(ciphertextPart)),
    decipher.final(),
  ]).toString("utf8");
}

export function normalizeEmail(value: string): string {
  const normalized = value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
  if (
    normalized.length < 3 ||
    normalized.length > EMAIL_MAX_LENGTH ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error("Enter a valid email address.");
  }
  return normalized;
}

export function hashNormalizedEmail(normalizedEmail: string, hmacKey: Buffer | string): string {
  return createHmac("sha256", hmacKey).update(normalizedEmail, "utf8").digest("hex");
}

export function maskEmail(value: string): string {
  const normalized = normalizeEmail(value);
  const at = normalized.lastIndexOf("@");
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const domainDot = domain.lastIndexOf(".");
  const domainName = domainDot > 0 ? domain.slice(0, domainDot) : domain;
  const suffix = domainDot > 0 ? domain.slice(domainDot) : "";
  const maskedLocal =
    local.length <= 1
      ? "*"
      : `${local[0]}${"*".repeat(Math.min(6, Math.max(2, local.length - 1)))}`;
  const maskedDomain =
    domainName.length <= 1
      ? "*"
      : `${domainName[0]}${"*".repeat(Math.min(5, Math.max(2, domainName.length - 1)))}`;
  return `${maskedLocal}@${maskedDomain}${suffix}`;
}

export function createOpaqueCustomerToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 24) throw new Error("Opaque tokens require 24 bytes.");
  return base64Url(randomBytes(bytes));
}

export function hashCustomerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function constantTimeTokenEquals(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function createPublicIdentifier(prefix: string, bytes = 18): string {
  if (!/^[a-z]{2,8}$/.test(prefix)) throw new Error("Invalid public identifier prefix.");
  return `${prefix}_${base64Url(randomBytes(bytes))}`;
}

export function assertPublicIdentifier(value: string, prefix: string): string {
  const token = value.startsWith(`${prefix}_`) ? value.slice(prefix.length + 1) : "";
  if (!PUBLIC_ID_PATTERN.test(token)) throw new Error("Invalid public identifier.");
  return value;
}

export function deriveMembershipCredentialSecret(
  publicCredentialId: string,
  credentialVersion: number,
  versionedSecret: VersionedSecret,
): string {
  const context = `waflo:membership-credential:${credentialVersion}:${publicCredentialId}`;
  return createHmac("sha256", versionedSecret.secret)
    .update(context, "utf8")
    .digest()
    .subarray(0, 24)
    .toString("base64url");
}

export function membershipCredentialHash(
  publicCredentialId: string,
  credentialVersion: number,
  versionedSecret: VersionedSecret,
): string {
  return createHash("sha256")
    .update(
      deriveMembershipCredentialSecret(publicCredentialId, credentialVersion, versionedSecret),
      "utf8",
    )
    .digest("hex");
}

export function deriveAppleAuthenticationToken(
  walletPassInstanceId: string,
  serialNumber: string,
  versionedSecret: VersionedSecret,
): string {
  return createHmac("sha256", versionedSecret.secret)
    .update(`waflo:apple-pass:${walletPassInstanceId}:${serialNumber}`, "utf8")
    .digest("base64url");
}

export function deriveEnrollmentSessionToken(
  enrollmentCommandId: string,
  sessionSecret: Buffer | string,
): string {
  const value = createHmac("sha256", sessionSecret)
    .update(`waflo:enrollment-session:${enrollmentCommandId}`, "utf8")
    .digest("base64url");
  return `wcs1.${value}`;
}

export function deriveTransferSessionToken(
  transferCommandId: string,
  sessionSecret: Buffer | string,
): string {
  const value = createHmac("sha256", sessionSecret)
    .update(`waflo:transfer-session:${transferCommandId}`, "utf8")
    .digest("base64url");
  return `wcs1.${value}`;
}

export function transferConfirmationFragment(baseUrl: string, rawToken: string): string {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = `token=${encodeURIComponent(rawToken)}`;
  return url.toString();
}

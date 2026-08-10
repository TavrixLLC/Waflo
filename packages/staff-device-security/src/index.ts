import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";

export const DEVICE_REQUEST_ENVELOPE_VERSION = "waflo-device-request-v1" as const;
export const DEVICE_PAIRING_TOKEN_VERSION = "waflo-pair-v1" as const;

export class StaffDeviceSecurityError extends Error {
  readonly code:
    | "DEVICE_PAIRING_INVALID"
    | "STAFF_DEVICE_SIGNATURE_INVALID"
    | "STAFF_DEVICE_CLOCK_SKEW"
    | "STAFF_DEVICE_NONCE_REPLAYED"
    | "STAFF_DEVICE_NOT_ACTIVE"
    | "STAFF_DEVICE_COMPROMISED"
    | "STAFF_DEVICE_REVOKED"
    | "STAFF_DEVICE_MEMBER_INACTIVE"
    | "STAFF_DEVICE_SESSION_EXPIRED"
    | "STAFF_DEVICE_BODY_DIGEST_INVALID"
    | "STAFF_APP_VERSION_UNSUPPORTED";

  constructor(
    code:
      | "DEVICE_PAIRING_INVALID"
      | "STAFF_DEVICE_SIGNATURE_INVALID"
      | "STAFF_DEVICE_CLOCK_SKEW"
      | "STAFF_DEVICE_NONCE_REPLAYED"
      | "STAFF_DEVICE_NOT_ACTIVE"
      | "STAFF_DEVICE_COMPROMISED"
      | "STAFF_DEVICE_REVOKED"
      | "STAFF_DEVICE_MEMBER_INACTIVE"
      | "STAFF_DEVICE_SESSION_EXPIRED"
      | "STAFF_DEVICE_BODY_DIGEST_INVALID"
      | "STAFF_APP_VERSION_UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "StaffDeviceSecurityError";
  }
}

export function parseStaffMobileSemanticVersion(value: string): readonly [number, number, number] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
  if (!match) {
    throw new StaffDeviceSecurityError(
      "STAFF_APP_VERSION_UNSUPPORTED",
      "A semantic mobile app version is required.",
    );
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 999_999)) {
    throw new StaffDeviceSecurityError(
      "STAFF_APP_VERSION_UNSUPPORTED",
      "The mobile app version is outside the supported range.",
    );
  }
  return parts as unknown as readonly [number, number, number];
}

export function assertStaffMobileAppVersion(input: {
  readonly platform: "IOS" | "ANDROID" | "TEST_CLIENT";
  readonly appVersion: string;
  readonly minimumVersion: string;
}): void {
  if (input.platform === "TEST_CLIENT") return;
  const current = parseStaffMobileSemanticVersion(input.appVersion);
  const minimum = parseStaffMobileSemanticVersion(input.minimumVersion);
  for (let index = 0; index < 3; index += 1) {
    const currentPart = current[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (currentPart > minimumPart) return;
    if (currentPart < minimumPart) {
      throw new StaffDeviceSecurityError(
        "STAFF_APP_VERSION_UNSUPPORTED",
        "This Staff mobile app version is no longer supported.",
      );
    }
  }
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBoundedBase64Url(value: string, maximumBytes: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > maximumBytes * 2) {
    throw new StaffDeviceSecurityError("DEVICE_PAIRING_INVALID", "Invalid encoded value.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.length > maximumBytes) {
    throw new StaffDeviceSecurityError("DEVICE_PAIRING_INVALID", "Invalid encoded value.");
  }
  return decoded;
}

export interface PairingTokenPayload {
  readonly publicId: string;
  readonly secret: string;
  readonly environmentId: string;
}

export function createPairingToken(input: {
  readonly publicId: string;
  readonly environmentId: string;
}): PairingTokenPayload & { readonly token: string; readonly tokenHash: string } {
  if (!/^[0-9a-f-]{36}$/i.test(input.publicId)) {
    throw new StaffDeviceSecurityError("DEVICE_PAIRING_INVALID", "Invalid pairing public ID.");
  }
  if (!/^[a-z0-9-]{2,32}$/i.test(input.environmentId)) {
    throw new StaffDeviceSecurityError("DEVICE_PAIRING_INVALID", "Invalid environment identifier.");
  }
  const secret = randomBytes(32).toString("base64url");
  const token = [
    DEVICE_PAIRING_TOKEN_VERSION,
    base64UrlEncode(input.publicId),
    secret,
    base64UrlEncode(input.environmentId),
  ].join(".");
  return {
    token,
    tokenHash: hashPairingToken(token),
    publicId: input.publicId,
    secret,
    environmentId: input.environmentId,
  };
}

export function parsePairingToken(token: string): PairingTokenPayload {
  if (token.length > 512) {
    throw new StaffDeviceSecurityError("DEVICE_PAIRING_INVALID", "Pairing token is too long.");
  }
  const [version, publicIdPart, secret, environmentPart, extra] = token.split(".");
  if (
    version !== DEVICE_PAIRING_TOKEN_VERSION ||
    !publicIdPart ||
    !secret ||
    !environmentPart ||
    extra !== undefined
  ) {
    throw new StaffDeviceSecurityError("DEVICE_PAIRING_INVALID", "Invalid pairing token.");
  }
  const publicId = decodeBoundedBase64Url(publicIdPart, 64).toString("utf8");
  const environmentId = decodeBoundedBase64Url(environmentPart, 32).toString("utf8");
  decodeBoundedBase64Url(secret, 64);
  if (!/^[0-9a-f-]{36}$/i.test(publicId) || !/^[a-z0-9-]{2,32}$/i.test(environmentId)) {
    throw new StaffDeviceSecurityError("DEVICE_PAIRING_INVALID", "Invalid pairing token.");
  }
  return { publicId, secret, environmentId };
}

export function hashPairingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashOpaqueDeviceToken(token: string, secret: string): string {
  if (secret.length < 32) {
    throw new StaffDeviceSecurityError(
      "DEVICE_PAIRING_INVALID",
      "Device session secret is too short.",
    );
  }
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function createOpaqueDeviceSessionToken(secret: string): {
  readonly token: string;
  readonly tokenHash: string;
} {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashOpaqueDeviceToken(token, secret) };
}

export function safeDigestEquals(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function bodySha256(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export interface CanonicalDeviceRequest {
  readonly method: string;
  readonly canonicalPath: string;
  readonly requestId: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodyDigest: string;
  readonly deviceSessionId: string;
  readonly organizationId: string;
}

function assertSingleLine(value: string, label: string, maximum: number): void {
  if (!value || value.length > maximum || /[\r\n\0]/.test(value)) {
    throw new StaffDeviceSecurityError("STAFF_DEVICE_SIGNATURE_INVALID", `${label} is invalid.`);
  }
}

export function canonicalDeviceRequestEnvelope(input: CanonicalDeviceRequest): string {
  const method = input.method.toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_SIGNATURE_INVALID",
      "Request method is invalid.",
    );
  }
  if (
    !input.canonicalPath.startsWith("/") ||
    input.canonicalPath.includes("?") ||
    input.canonicalPath.includes("#")
  ) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_SIGNATURE_INVALID",
      "Canonical request path is invalid.",
    );
  }
  for (const [label, value, maximum] of [
    ["path", input.canonicalPath, 512],
    ["request ID", input.requestId, 128],
    ["timestamp", input.timestamp, 40],
    ["nonce", input.nonce, 128],
    ["device session ID", input.deviceSessionId, 64],
    ["organization ID", input.organizationId, 64],
  ] as const) {
    assertSingleLine(value, label, maximum);
  }
  if (!/^[a-f0-9]{64}$/i.test(input.bodyDigest)) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_BODY_DIGEST_INVALID",
      "Request body digest is invalid.",
    );
  }
  return [
    DEVICE_REQUEST_ENVELOPE_VERSION,
    method,
    input.canonicalPath,
    input.requestId,
    input.timestamp,
    input.nonce,
    input.bodyDigest.toLowerCase(),
    input.deviceSessionId,
    input.organizationId,
  ].join("\n");
}

export function normalizeEd25519PublicKey(publicKey: string): string {
  if (publicKey.length > 1_024) {
    throw new StaffDeviceSecurityError("DEVICE_PAIRING_INVALID", "Device public key is too long.");
  }
  try {
    const key = publicKey.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(publicKey)
      : createPublicKey({
          key: Buffer.from(publicKey, "base64"),
          format: "der",
          type: "spki",
        });
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("Wrong key type.");
    }
    return key.export({ format: "der", type: "spki" }).toString("base64");
  } catch {
    throw new StaffDeviceSecurityError(
      "DEVICE_PAIRING_INVALID",
      "A valid Ed25519 public key is required.",
    );
  }
}

export function verifyDeviceRequestSignature(input: {
  readonly publicKey: string;
  readonly envelope: CanonicalDeviceRequest;
  readonly signature: string;
}): void {
  const normalized = normalizeEd25519PublicKey(input.publicKey);
  let signature: Buffer;
  try {
    signature = Buffer.from(input.signature, "base64url");
  } catch {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_SIGNATURE_INVALID",
      "Device signature is invalid.",
    );
  }
  if (signature.length !== 64) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_SIGNATURE_INVALID",
      "Device signature is invalid.",
    );
  }
  const key = createPublicKey({
    key: Buffer.from(normalized, "base64"),
    format: "der",
    type: "spki",
  });
  const valid = verify(
    null,
    Buffer.from(canonicalDeviceRequestEnvelope(input.envelope), "utf8"),
    key,
    signature,
  );
  if (!valid) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_SIGNATURE_INVALID",
      "Device signature could not be verified.",
    );
  }
}

export function verifyEd25519Message(input: {
  readonly publicKey: string;
  readonly message: string;
  readonly signature: string;
}): void {
  const normalized = normalizeEd25519PublicKey(input.publicKey);
  const signature = Buffer.from(input.signature, "base64url");
  if (signature.length !== 64) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_SIGNATURE_INVALID",
      "Device signature is invalid.",
    );
  }
  const key = createPublicKey({
    key: Buffer.from(normalized, "base64"),
    format: "der",
    type: "spki",
  });
  if (!verify(null, Buffer.from(input.message, "utf8"), key, signature)) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_SIGNATURE_INVALID",
      "Device signature could not be verified.",
    );
  }
}

export function assertDeviceRequestTimestamp(input: {
  readonly timestamp: string;
  readonly now: Date;
  readonly maximumClockSkewSeconds: number;
}): Date {
  if (
    !Number.isInteger(input.maximumClockSkewSeconds) ||
    input.maximumClockSkewSeconds < 15 ||
    input.maximumClockSkewSeconds > 900
  ) {
    throw new StaffDeviceSecurityError("STAFF_DEVICE_CLOCK_SKEW", "Clock-skew policy is unsafe.");
  }
  const timestamp = new Date(input.timestamp);
  if (
    Number.isNaN(timestamp.getTime()) ||
    Math.abs(input.now.getTime() - timestamp.getTime()) > input.maximumClockSkewSeconds * 1_000
  ) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_CLOCK_SKEW",
      "Device request timestamp is outside the accepted window.",
    );
  }
  return timestamp;
}

export function assertBodyDigest(body: string | Buffer, suppliedDigest: string): void {
  if (!safeDigestEquals(bodySha256(body), suppliedDigest)) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_BODY_DIGEST_INVALID",
      "Request body digest does not match.",
    );
  }
}

export function assertDeviceOperational(input: {
  readonly deviceStatus: string;
  readonly sessionRevokedAt: Date | null;
  readonly sessionExpiresAt: Date;
  readonly memberStatus: string;
  readonly now: Date;
}): void {
  if (input.deviceStatus === "COMPROMISED") {
    throw new StaffDeviceSecurityError("STAFF_DEVICE_COMPROMISED", "Staff device is compromised.");
  }
  if (input.deviceStatus === "REVOKED") {
    throw new StaffDeviceSecurityError("STAFF_DEVICE_REVOKED", "Staff device is revoked.");
  }
  if (input.deviceStatus !== "ACTIVE" || input.sessionRevokedAt !== null) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_NOT_ACTIVE",
      "Staff device session is not active.",
    );
  }
  if (input.sessionExpiresAt.getTime() <= input.now.getTime()) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_SESSION_EXPIRED",
      "Staff device session has expired.",
    );
  }
  if (input.memberStatus !== "ACTIVE") {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_MEMBER_INACTIVE",
      "Staff member is not active.",
    );
  }
}

export function assertTestClientAllowed(input: {
  readonly platform: string;
  readonly nodeEnvironment: string;
  readonly testClientEnabled: boolean;
}): void {
  if (
    input.platform === "TEST_CLIENT" &&
    (input.nodeEnvironment === "production" || !input.testClientEnabled)
  ) {
    throw new StaffDeviceSecurityError(
      "STAFF_DEVICE_NOT_ACTIVE",
      "The development Staff Test Client is disabled.",
    );
  }
}

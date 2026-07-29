import jsQR from "jsqr";
import QRCode from "qrcode";
import sharp from "sharp";

type JsQrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
) => { data: string } | null;

const jsQrDecoder =
  (jsQR as unknown as { default?: JsQrDecoder }).default ?? (jsQR as unknown as JsQrDecoder);

const PUBLIC_CREDENTIAL_PATTERN = /^cred_[A-Za-z0-9_-]{16,80}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;
const PROGRAM_SLUG_PATTERN = /^(?=.{3,50}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface MembershipQrPayloadV1 {
  readonly version: "wfl1";
  readonly publicCredentialId: string;
  readonly secretVersion: number;
  readonly secret: string;
}

export function formatMembershipQrPayload(input: Omit<MembershipQrPayloadV1, "version">): string {
  if (!PUBLIC_CREDENTIAL_PATTERN.test(input.publicCredentialId)) {
    throw new Error("Invalid public credential identifier.");
  }
  if (
    !Number.isInteger(input.secretVersion) ||
    input.secretVersion < 1 ||
    input.secretVersion > 99
  ) {
    throw new Error("Invalid membership credential secret version.");
  }
  if (!SECRET_PATTERN.test(input.secret)) throw new Error("Invalid membership credential secret.");
  return `wfl1.${input.publicCredentialId}.${input.secretVersion}.${input.secret}`;
}

export function parseMembershipQrPayload(value: string): MembershipQrPayloadV1 {
  if (value.length > 220) throw new Error("Membership QR payload is too long.");
  const parts = value.split(".");
  const publicCredentialId = parts[1] ?? "";
  const secretVersion = Number(parts[2]);
  const secret = parts[3] ?? "";
  if (
    parts.length !== 4 ||
    parts[0] !== "wfl1" ||
    !PUBLIC_CREDENTIAL_PATTERN.test(publicCredentialId) ||
    !Number.isInteger(secretVersion) ||
    secretVersion < 1 ||
    secretVersion > 99 ||
    !SECRET_PATTERN.test(secret)
  ) {
    throw new Error("Invalid or unsupported membership QR payload.");
  }
  return { version: "wfl1", publicCredentialId, secretVersion, secret };
}

export function validateProgramPublicSlug(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!PROGRAM_SLUG_PATTERN.test(normalized)) {
    throw new Error("Program slug must be 3–50 lowercase letters, numbers, or single hyphens.");
  }
  return normalized;
}

export function slugifyProgramName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 50)
    .replace(/-+$/g, "");
  const candidate = normalized.length >= 3 ? normalized : fallback;
  return validateProgramPublicSlug(candidate);
}

export function canonicalJoinUrl(input: {
  merchantSlug: string;
  programSlug: string;
  customerBaseUrl: string;
}): string {
  const base = new URL(input.customerBaseUrl);
  const local = base.hostname === "localhost" || base.hostname.endsWith(".lvh.me");
  base.hostname = local
    ? `${input.merchantSlug}.${base.hostname}`
    : `${input.merchantSlug}.${base.hostname}`;
  base.pathname = `/join/${validateProgramPublicSlug(input.programSlug)}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export async function createQrPng(
  value: string,
  options: { width?: number; margin?: number; errorCorrectionLevel?: "M" | "Q" | "H" } = {},
): Promise<Buffer> {
  return QRCode.toBuffer(value, {
    type: "png",
    width: options.width ?? 512,
    margin: options.margin ?? 4,
    errorCorrectionLevel: options.errorCorrectionLevel ?? "Q",
    color: { dark: "#241916", light: "#FFFFFFFF" },
  });
}

export async function createQrSvg(
  value: string,
  options: { width?: number; margin?: number; errorCorrectionLevel?: "M" | "Q" | "H" } = {},
): Promise<string> {
  return QRCode.toString(value, {
    type: "svg",
    width: options.width ?? 512,
    margin: options.margin ?? 4,
    errorCorrectionLevel: options.errorCorrectionLevel ?? "Q",
    color: { dark: "#241916", light: "#FFFFFFFF" },
  });
}

const TRANSFER_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function decodeQrImage(
  bytes: Buffer,
  mimeType: string,
  limits: { maxBytes?: number; maxPixels?: number } = {},
): Promise<string> {
  const maxBytes = limits.maxBytes ?? 2 * 1024 * 1024;
  const maxPixels = limits.maxPixels ?? 12_000_000;
  if (!TRANSFER_IMAGE_MIME_TYPES.has(mimeType.toLocaleLowerCase("en-US"))) {
    throw new Error("Unsupported QR image type.");
  }
  if (bytes.length < 32 || bytes.length > maxBytes) throw new Error("Invalid QR image.");
  const image = sharp(bytes, {
    failOn: "error",
    limitInputPixels: maxPixels,
    sequentialRead: true,
  }).rotate();
  const metadata = await image.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > maxPixels ||
    (metadata.pages !== undefined && metadata.pages > 1)
  ) {
    throw new Error("Invalid QR image.");
  }
  const { data, info } = await image
    .removeAlpha()
    .ensureAlpha(1)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const decoded = jsQrDecoder(pixels, info.width, info.height, {
    inversionAttempts: "attemptBoth",
  });
  if (!decoded?.data) throw new Error("No valid QR code was found.");
  return decoded.data;
}

export function assertQrContainsNoPii(payload: string, piiValues: readonly string[]): void {
  const normalizedPayload = payload.toLocaleLowerCase("en-US");
  for (const value of piiValues) {
    const normalized = value.trim().toLocaleLowerCase("en-US");
    if (normalized && normalizedPayload.includes(normalized)) {
      throw new Error("QR payload contains customer data.");
    }
  }
}

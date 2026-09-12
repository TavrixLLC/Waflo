const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const serialPattern = /^[A-Za-z0-9._-]{1,255}$/;
const colorPattern = /^#[0-9a-f]{6}$/i;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const requiredPassBuilderImageSlots = [
  "icon",
  "logo",
  "primaryLogo",
  "artwork",
  "strip",
] as const;

export const passBuilderImageSlots = requiredPassBuilderImageSlots;

export type PassBuilderImageSlot = (typeof passBuilderImageSlots)[number];
export type RequiredPassBuilderImageSlot = (typeof requiredPassBuilderImageSlots)[number];

export interface ImageVariants {
  readonly times1: string;
  readonly times2: string;
  readonly times3: string;
}

export interface PassBuilderRequest {
  readonly operationId: string;
  readonly merchantId: string;
  readonly signingKeyId: string;
  readonly templateId: string;
  readonly pass: {
    readonly passTypeIdentifier: string;
    readonly teamIdentifier: string;
    readonly serialNumber: string;
    readonly organizationName: string;
    readonly description: string;
    readonly logoText: string;
    readonly foregroundColor: string;
    readonly backgroundColor: string;
    readonly labelColor: string;
    readonly webServiceURL: string;
    readonly authenticationToken: string;
    readonly voided: boolean;
    readonly barcode: {
      readonly format:
        | "QR"
        | "PDF417"
        | "AZTEC"
        | "CODE128"
        | "EAN13"
        | "CODABAR"
        | "CODE39"
        | "I2OF5";
      readonly message: string;
      readonly messageEncoding: string;
    };
    readonly fieldValues: {
      readonly progress: string;
      readonly progress_detail: string;
      readonly program: string;
      readonly member: string;
      readonly status: string;
      readonly reward: string;
      readonly security: string;
      readonly operator: string;
    };
  };
  readonly images: Readonly<Record<RequiredPassBuilderImageSlot, ImageVariants>>;
}

export interface SigningIdentity {
  readonly id: string;
  readonly merchantIds: readonly string[];
  readonly passTypeIdentifier: string;
  readonly teamIdentifier: string;
  readonly certificatePath: string;
  readonly certificatePasswordFile: string;
  readonly wwdrCertificatePath: string;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  name: string,
  options: { min?: number; max: number; pattern?: RegExp },
): string {
  if (typeof value !== "string") throw new RequestValidationError(`${name} must be a string.`);
  if (value.length < (options.min ?? 0) || value.length > options.max) {
    throw new RequestValidationError(`${name} has an invalid length.`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    throw new RequestValidationError(`${name} has an invalid format.`);
  }
  return value;
}

function imageVariants(value: unknown, name: string): ImageVariants {
  const input = record(value, name);
  const variant = (key: "times1" | "times2" | "times3") =>
    stringValue(input[key], `${name}.${key}`, { min: 4, max: 8_000_000, pattern: base64Pattern });
  return { times1: variant("times1"), times2: variant("times2"), times3: variant("times3") };
}

export function parsePassBuilderRequest(value: unknown): PassBuilderRequest {
  const input = record(value, "request");
  const pass = record(input.pass, "pass");
  const barcode = record(pass.barcode, "pass.barcode");
  const fields = record(pass.fieldValues, "pass.fieldValues");
  const images = record(input.images, "images");
  // The current iOS 26-and-earlier fallback is a native Store Card. Its
  // theme artwork is the required Strip image set, so reject the retired
  // Generic-only thumbnail payload instead of silently accepting a request
  // that can never be represented by this template.
  if ("thumbnail" in images) {
    throw new RequestValidationError(
      "images.thumbnail is unsupported by the Store Card template; use images.strip.",
    );
  }
  const id = (name: string, candidate: unknown) =>
    stringValue(candidate, name, { min: 1, max: 128, pattern: identifierPattern });
  const text = (name: string, candidate: unknown, max: number, min = 0) =>
    stringValue(candidate, name, { min, max });
  const color = (name: string, candidate: unknown) =>
    stringValue(candidate, name, { min: 7, max: 7, pattern: colorPattern });
  const webServiceURL = text("pass.webServiceURL", pass.webServiceURL, 2048, 8);
  try {
    if (new URL(webServiceURL).protocol !== "https:") throw new Error();
  } catch {
    throw new RequestValidationError("pass.webServiceURL must be an HTTPS URL.");
  }
  const barcodeFormat = text("pass.barcode.format", barcode.format, 16, 2);
  if ("altText" in barcode) {
    throw new RequestValidationError("pass.barcode must not include visible caption text.");
  }
  if (
    !new Set(["QR", "PDF417", "AZTEC", "CODE128", "EAN13", "CODABAR", "CODE39", "I2OF5"]).has(
      barcodeFormat,
    )
  ) {
    throw new RequestValidationError("pass.barcode.format is unsupported.");
  }
  if (typeof pass.voided !== "boolean") {
    throw new RequestValidationError("pass.voided must be a boolean.");
  }

  const parsedImages: Record<RequiredPassBuilderImageSlot, ImageVariants> = Object.fromEntries(
    requiredPassBuilderImageSlots.map((slot) => [
      slot,
      imageVariants(images[slot], `images.${slot}`),
    ]),
  ) as Record<RequiredPassBuilderImageSlot, ImageVariants>;
  return {
    operationId: id("operationId", input.operationId),
    merchantId: id("merchantId", input.merchantId),
    signingKeyId: id("signingKeyId", input.signingKeyId),
    templateId: id("templateId", input.templateId),
    pass: {
      passTypeIdentifier: text("pass.passTypeIdentifier", pass.passTypeIdentifier, 255, 6),
      teamIdentifier: text("pass.teamIdentifier", pass.teamIdentifier, 64, 1),
      serialNumber: stringValue(pass.serialNumber, "pass.serialNumber", {
        min: 1,
        max: 255,
        pattern: serialPattern,
      }),
      organizationName: text("pass.organizationName", pass.organizationName, 80, 1),
      description: text("pass.description", pass.description, 160, 1),
      logoText: text("pass.logoText", pass.logoText, 48),
      foregroundColor: color("pass.foregroundColor", pass.foregroundColor),
      backgroundColor: color("pass.backgroundColor", pass.backgroundColor),
      labelColor: color("pass.labelColor", pass.labelColor),
      webServiceURL,
      authenticationToken: text("pass.authenticationToken", pass.authenticationToken, 256, 24),
      voided: pass.voided,
      barcode: {
        format: barcodeFormat as PassBuilderRequest["pass"]["barcode"]["format"],
        message: text("pass.barcode.message", barcode.message, 2048, 1),
        messageEncoding: text("pass.barcode.messageEncoding", barcode.messageEncoding, 80, 1),
      },
      fieldValues: {
        progress: text("pass.fieldValues.progress", fields.progress, 40, 1),
        progress_detail: text("pass.fieldValues.progress_detail", fields.progress_detail, 40, 1),
        program: text("pass.fieldValues.program", fields.program, 80, 1),
        member: text("pass.fieldValues.member", fields.member, 80, 1),
        status: text("pass.fieldValues.status", fields.status, 80, 1),
        reward: text("pass.fieldValues.reward", fields.reward, 500),
        security: text("pass.fieldValues.security", fields.security, 500),
        operator: text("pass.fieldValues.operator", fields.operator, 500),
      },
    },
    images: parsedImages,
  };
}

export function parseSigningIdentities(value: unknown): ReadonlyMap<string, SigningIdentity> {
  const root = record(value, "identity configuration");
  if (!Array.isArray(root.identities) || root.identities.length === 0) {
    throw new Error("At least one signing identity is required.");
  }
  const entries = root.identities.map((value, index) => {
    const item = record(value, `identities[${index}]`);
    const id = stringValue(item.id, `identities[${index}].id`, {
      min: 1,
      max: 128,
      pattern: identifierPattern,
    });
    const absolutePath = (key: string) => {
      const result = stringValue(item[key], `identities[${index}].${key}`, {
        min: 1,
        max: 2048,
      });
      if (!result.startsWith("/")) throw new Error(`${key} must be an absolute path.`);
      return result;
    };
    if (!Array.isArray(item.merchantIds) || item.merchantIds.length === 0) {
      throw new Error(`identities[${index}].merchantIds must be a non-empty array.`);
    }
    const merchantIds = item.merchantIds.map((merchantId, merchantIndex) =>
      merchantId === "*"
        ? "*"
        : stringValue(merchantId, `identities[${index}].merchantIds[${merchantIndex}]`, {
            min: 1,
            max: 128,
            pattern: identifierPattern,
          }),
    );
    if (merchantIds.includes("*") && merchantIds.length !== 1) {
      throw new Error(`identities[${index}].merchantIds wildcard must be the only entry.`);
    }
    if (new Set(merchantIds).size !== merchantIds.length) {
      throw new Error(`identities[${index}].merchantIds must be unique.`);
    }
    return [
      id,
      {
        id,
        merchantIds,
        passTypeIdentifier: stringValue(
          item.passTypeIdentifier,
          `identities[${index}].passTypeIdentifier`,
          { min: 6, max: 255 },
        ),
        teamIdentifier: stringValue(item.teamIdentifier, `identities[${index}].teamIdentifier`, {
          min: 1,
          max: 64,
        }),
        certificatePath: absolutePath("certificatePath"),
        certificatePasswordFile: absolutePath("certificatePasswordFile"),
        wwdrCertificatePath: absolutePath("wwdrCertificatePath"),
      },
    ] as const;
  });
  const map = new Map(entries);
  if (map.size !== entries.length) throw new Error("Signing identity IDs must be unique.");
  return map;
}

export class RequestValidationError extends Error {
  readonly code = "PASS_REQUEST_INVALID";
}

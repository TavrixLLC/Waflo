import { createHash } from "node:crypto";
import { cardLocalePresentation } from "@waflo/contracts";
import { renderPublishedMembershipStampSvg } from "@waflo/stamp-engine";
import {
  composeAppleGenericStripArtwork,
  composeApplePosterArtwork,
  walletArtworkInputFromStampRender,
} from "@waflo/wallet-artwork";
import { type WalletMembershipInput, WalletProviderError } from "@waflo/wallet-core";
import sharp from "sharp";

export const adoptedApplePassBuilderRevision = "8908b955a42da8294ce7506719aa1f186d096c02" as const;

export interface ApplePassGeneratorConfiguration {
  readonly passTypeIdentifier: string;
  readonly teamIdentifier: string;
  readonly organizationName: string;
  readonly webServiceUrl: string;
}

export interface WalletPassGenerationInput {
  readonly membership: WalletMembershipInput;
  readonly configuration: ApplePassGeneratorConfiguration;
  readonly authenticationToken: string;
}

export interface WalletPassValidationResult {
  readonly valid: boolean;
  readonly warnings: readonly string[];
}

export interface WalletPassGeneratorHealth {
  readonly status:
    | "READY"
    | "DEGRADED"
    | "EXPIRED"
    | "EXPIRING"
    | "IDENTIFIER_MISMATCH"
    | "TEAM_MISMATCH";
  readonly expiresAt?: string;
}

export interface WalletPassGenerator {
  readonly kind: "legacy" | "apple-pass-builder";
  generatePass(input: WalletPassGenerationInput): Promise<Buffer>;
  validatePass(input: WalletPassGenerationInput): Promise<WalletPassValidationResult>;
  healthCheck(configuration: ApplePassGeneratorConfiguration): Promise<WalletPassGeneratorHealth>;
}

export interface AppleGenericPassDocument {
  readonly formatVersion: 1;
  readonly passTypeIdentifier: string;
  readonly serialNumber: string;
  readonly teamIdentifier: string;
  readonly organizationName: string;
  readonly description: string;
  readonly logoText: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly labelColor: string;
  readonly webServiceURL: string;
  readonly authenticationToken: string;
  readonly voided: boolean;
  readonly barcodes: readonly [
    {
      readonly format: "PKBarcodeFormatQR";
      readonly message: string;
      readonly messageEncoding: "iso-8859-1";
    },
  ];
  readonly generic: ApplePassFields;
  readonly posterGeneric: ApplePassFields;
}

export interface ApplePassFields {
  readonly headerFields?: readonly ApplePassField[];
  readonly primaryFields?: readonly ApplePassField[];
  readonly secondaryFields?: readonly ApplePassField[];
  readonly auxiliaryFields?: readonly ApplePassField[];
  readonly footerFields?: readonly ApplePassField[];
  readonly backFields?: readonly ApplePassField[];
}

export interface ApplePassField {
  readonly key: string;
  readonly label?: string;
  readonly value: string | number;
  readonly changeMessage?: string;
  readonly textAlignment?: "PKTextAlignmentNatural";
}

const naturalTextAlignment = "PKTextAlignmentNatural" as const;

function appleRgb(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Apple Wallet color must be six-digit hex.");
  const values = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  );
  return `rgb(${values.join(", ")})`;
}

function membershipStatus(input: WalletMembershipInput): string {
  if (input.transferred) return "Transferred";
  if (input.programStatus === "PAUSED") return "Temporarily paused";
  if (input.rewardReady) return "Reward ready";
  return "Active";
}

/**
 * Native field hierarchy for the iOS 26-and-earlier Generic/Store Card face.
 *
 * Keep merchant identity in logoText and reserve the compact header tier for
 * progress. Apple places a legacy primary field on top of the strip artwork,
 * so the reward deliberately uses the secondary tier below it. Program,
 * member, and status are useful details, but overwhelm the compact legacy
 * face, so they deliberately live on the back. The Poster Generic mapping
 * intentionally does not consume this helper.
 */
export function mapLegacyApplePresentation(input: WalletMembershipInput): ApplePassFields {
  return {
    headerFields: [
      {
        key: "progress",
        label: "STAMPS",
        value: `${input.currentStampCount}/${input.requiredStampCount}`,
        textAlignment: naturalTextAlignment,
      },
    ],
    // On pre-Poster Apple Wallet, primary fields are composited over strip
    // artwork. Keep this empty so native text cannot obscure the stamps.
    primaryFields: [],
    secondaryFields: [
      {
        key: "reward",
        label: "REWARD",
        value: input.rewardSummary.slice(0, 500),
        textAlignment: naturalTextAlignment,
      },
    ],
    auxiliaryFields: [],
    backFields: [
      {
        key: "program",
        label: "PROGRAM",
        value: input.programName.slice(0, 80),
      },
      {
        key: "member",
        label: "MEMBER",
        value: input.displayName.slice(0, 80),
      },
      {
        key: "status",
        label: "STATUS",
        value: membershipStatus(input),
        changeMessage: "%@",
      },
      {
        key: "security",
        label: "SECURITY",
        value:
          "This QR is an opaque, revocable Waflo membership credential. Do not share screenshots.",
      },
      {
        key: "operator",
        label: "WAFLO",
        value: "Waflo is owned and operated by Tavrix LLC.",
      },
    ],
  };
}

export function mapAppleGenericPass(
  input: WalletMembershipInput,
  configuration: ApplePassGeneratorConfiguration,
  authenticationToken: string,
): AppleGenericPassDocument {
  const posterProgress = `${input.currentStampCount}/${input.requiredStampCount}`;
  const inactive =
    input.transferred ||
    input.membershipStatus !== "ACTIVE" ||
    input.programStatus === "ARCHIVED" ||
    input.programStatus === "SUSPENDED";
  const member = {
    key: "member",
    label: "MEMBER",
    value: input.displayName.slice(0, 80),
  };
  const program = {
    key: "program",
    value: input.programName.slice(0, 80),
  };
  const status = {
    key: "status",
    label: "STATUS",
    value: membershipStatus(input),
    changeMessage: "%@",
  };
  const posterBackFields = [
    {
      key: "reward",
      label: "REWARD",
      value: input.rewardSummary.slice(0, 500),
    },
    {
      key: "security",
      label: "SECURITY",
      value:
        "This QR is an opaque, revocable Waflo membership credential. Do not share screenshots.",
    },
    {
      key: "operator",
      label: "WAFLO",
      value: "Waflo is owned and operated by Tavrix LLC.",
    },
  ];
  return {
    formatVersion: 1,
    passTypeIdentifier: configuration.passTypeIdentifier,
    serialNumber: input.providerIdentity,
    teamIdentifier: configuration.teamIdentifier,
    organizationName: configuration.organizationName,
    description: input.description.slice(0, 160),
    logoText: input.organizationName.slice(0, 48),
    foregroundColor: appleRgb(input.foregroundColor),
    backgroundColor: appleRgb(input.backgroundColor),
    labelColor: appleRgb(input.foregroundColor),
    webServiceURL: configuration.webServiceUrl.replace(/\/+$/, ""),
    authenticationToken,
    voided: inactive,
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: input.credentialPayload,
        messageEncoding: "iso-8859-1",
      },
    ],
    generic: mapLegacyApplePresentation(input),
    posterGeneric: {
      // Identity, progress, reward, and the QR are image-first on Poster Generic.
      // Semantic values remain on the back/details side for accessibility.
      backFields: [
        { ...program, label: "PROGRAM" },
        member,
        status,
        {
          key: "progress_detail",
          label: "STAMPS",
          value: posterProgress,
        },
        ...posterBackFields,
      ],
    },
  };
}

interface ImageVariants {
  readonly times1: string;
  readonly times2: string;
  readonly times3: string;
}

interface PassBuilderServiceRequest {
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
      readonly format: "QR";
      readonly message: string;
      readonly messageEncoding: string;
    };
    readonly fieldValues: Readonly<Record<string, string>>;
  };
  readonly images: Readonly<
    Record<"icon" | "logo" | "primaryLogo" | "artwork" | "strip", ImageVariants> &
      Partial<Record<"thumbnail", ImageVariants>>
  >;
}

export interface ApplePassBuilderGeneratorOptions {
  readonly serviceUrl: string;
  readonly authToken: string;
  readonly signingKeyId: string;
  readonly signingKeyIdsByMerchant?: Readonly<Record<string, string>>;
  readonly templateId?: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

const signingIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function parseAppleSigningKeyMap(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Apple signing-key map must be an object.");
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [merchantId, signingKeyId] of Object.entries(value)) {
    if (!signingIdentifierPattern.test(merchantId) || typeof signingKeyId !== "string") {
      throw new Error("Apple signing-key map contains an invalid entry.");
    }
    if (!signingIdentifierPattern.test(signingKeyId)) {
      throw new Error("Apple signing-key map contains an invalid signing key ID.");
    }
    result[merchantId] = signingKeyId;
  }
  return result;
}

interface ImmutableBrandImages {
  readonly icon: ImageVariants;
  readonly logo: ImageVariants;
  readonly primaryLogo: ImageVariants;
}

let immutableBrandImages: Promise<ImmutableBrandImages> | null = null;

async function brandImage(width: number, height: number, scale: number, includeText: boolean) {
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const markSize = Math.min(scaledHeight, includeText ? scaledWidth / 3 : scaledWidth);
  const text = includeText
    ? `<text x="${markSize + Math.max(5 * scale, scaledWidth * 0.04)}" y="${scaledHeight * 0.7}" font-family="Arial,sans-serif" font-size="${scaledHeight * 0.48}" font-weight="700" fill="#241916">WAFLO</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${scaledWidth}" height="${scaledHeight}" viewBox="0 0 ${scaledWidth} ${scaledHeight}"><rect x="0" y="0" width="${markSize}" height="${scaledHeight}" rx="${Math.max(4 * scale, scaledHeight * 0.18)}" fill="#E4572E"/><path d="M${markSize * 0.2} ${scaledHeight * 0.28}l${markSize * 0.16} ${scaledHeight * 0.46} ${markSize * 0.14}-${scaledHeight * 0.27} ${markSize * 0.14} ${scaledHeight * 0.27} ${markSize * 0.16}-${scaledHeight * 0.46}" fill="none" stroke="#fff" stroke-width="${Math.max(2 * scale, markSize * 0.09)}" stroke-linecap="round" stroke-linejoin="round"/>${text}</svg>`;
  return (await sharp(Buffer.from(svg, "utf8")).png().toBuffer()).toString("base64");
}

async function brandVariants(width: number, height: number, includeText: boolean) {
  const [times1, times2, times3] = await Promise.all([
    brandImage(width, height, 1, includeText),
    brandImage(width, height, 2, includeText),
    brandImage(width, height, 3, includeText),
  ] as const);
  return { times1, times2, times3 };
}

function defaultBrandImages() {
  immutableBrandImages ??= Promise.all([
    brandVariants(38, 38, false),
    // Legacy Generic already renders merchant identity through logoText. A
    // compact mark-only logo prevents a second wordmark from consuming the
    // header row. Poster Generic uses the separate primaryLogo slot below.
    brandVariants(38, 38, false),
    brandVariants(126, 30, true),
  ]).then(([icon, logo, primaryLogo]) => ({ icon, logo, primaryLogo }));
  return immutableBrandImages;
}

async function personalizedVariants(
  input: WalletMembershipInput,
): Promise<Pick<PassBuilderServiceRequest["images"], "artwork" | "strip">> {
  const walletLocale = cardLocalePresentation(input.locale).locale;
  const stampRenderInput = { ...input.stampRenderInput, locale: walletLocale };
  const rendered = renderPublishedMembershipStampSvg({
    ...stampRenderInput,
    outputProfile: "APPLE_WALLET",
  });
  const compositionInput = walletArtworkInputFromStampRender(
    {
      stampRenderInput,
      rewardLabel: input.rewardSummary,
      organizationName: input.organizationName,
      programName: input.programName,
      memberName: input.displayName,
      credentialPayload: input.credentialPayload,
      ...(input.qrCenterLogo ? { qrCenterLogo: { bytes: input.qrCenterLogo } } : {}),
    },
    rendered,
  );
  const [poster, genericStrip] = await Promise.all([
    composeApplePosterArtwork(compositionInput),
    composeAppleGenericStripArtwork(compositionInput),
  ]);
  const variants = (
    composed: Awaited<ReturnType<typeof composeApplePosterArtwork>>,
  ): ImageVariants => ({
    times1: composed.times1.bytes.toString("base64"),
    times2: composed.times2.bytes.toString("base64"),
    times3: composed.times3.bytes.toString("base64"),
  });
  return {
    strip: variants(genericStrip),
    artwork: variants(poster),
  };
}

function merchantThumbnailVariants(input: WalletMembershipInput): ImageVariants | undefined {
  const images = input.applePassImages;
  if (!images) return undefined;
  const times1 = images["thumbnail.png"];
  const times2 = images["thumbnail@2x.png"];
  const times3 = images["thumbnail@3x.png"];
  const supplied = [times1, times2, times3].filter((value) => value !== undefined).length;
  if (supplied === 0) return undefined;
  if (supplied !== 3 || !times1 || !times2 || !times3) {
    throw new Error("Apple thumbnail image set must include 1x, 2x, and 3x variants.");
  }
  if ([times1, times2, times3].some((value) => value.byteLength === 0)) {
    throw new Error("Apple thumbnail image set contains an empty variant.");
  }
  return {
    times1: Buffer.from(times1).toString("base64"),
    times2: Buffer.from(times2).toString("base64"),
    times3: Buffer.from(times3).toString("base64"),
  };
}

function hexFromRgb(value: string): string {
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
  if (!match) throw new Error("Apple Wallet RGB color is invalid.");
  return `#${match
    .slice(1)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

export class ApplePassBuilderGenerator implements WalletPassGenerator {
  readonly kind = "apple-pass-builder" as const;
  private readonly serviceUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly signingKeyIdsByMerchant: Readonly<Record<string, string>>;

  constructor(private readonly options: ApplePassBuilderGeneratorOptions) {
    this.serviceUrl = options.serviceUrl.replace(/\/+$/, "");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    if (!/^https?:\/\//.test(this.serviceUrl))
      throw new Error("Pass Builder service URL is invalid.");
    if (!/^[A-Za-z0-9._~-]{32,256}$/.test(options.authToken))
      throw new Error("Pass Builder service auth token is invalid.");
    if (!signingIdentifierPattern.test(options.signingKeyId)) {
      throw new Error("Pass Builder signing key ID is invalid.");
    }
    this.signingKeyIdsByMerchant = options.signingKeyIdsByMerchant
      ? parseAppleSigningKeyMap(options.signingKeyIdsByMerchant)
      : {};
  }

  async generatePass(input: WalletPassGenerationInput): Promise<Buffer> {
    const request = await this.request(input);
    const response = await this.call("/v1/passes/generate", request);
    if (response.headers.get("content-type")?.split(";", 1)[0] !== "application/vnd.apple.pkpass") {
      throw new WalletProviderError(
        "PROVIDER_UNAVAILABLE",
        "Pass Builder returned invalid content.",
        {
          retryable: true,
        },
      );
    }
    const artifact = Buffer.from(await response.arrayBuffer());
    if (
      artifact.length < 1_000 ||
      artifact.length > 25_000_000 ||
      !artifact.subarray(0, 2).equals(Buffer.from("PK"))
    ) {
      throw new WalletProviderError("OBJECT_INVALID", "Pass Builder returned an invalid pass.", {
        retryable: false,
      });
    }
    return artifact;
  }

  async validatePass(input: WalletPassGenerationInput): Promise<WalletPassValidationResult> {
    const response = await this.call("/v1/passes/validate", await this.request(input));
    const body = (await response.json()) as { valid?: unknown; warnings?: unknown };
    return {
      valid: body.valid === true,
      warnings: Array.isArray(body.warnings)
        ? body.warnings.filter((item): item is string => typeof item === "string").slice(0, 20)
        : [],
    };
  }

  async healthCheck(): Promise<WalletPassGeneratorHealth> {
    try {
      const response = await this.fetchImplementation(`${this.serviceUrl}/health`, {
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
      if (!response.ok) return { status: "DEGRADED" };
      const body = (await response.json()) as {
        status?: unknown;
        passBuilderRevision?: unknown;
        signingKeyIds?: unknown;
        signingIdentities?: unknown;
      };
      const requiredSigningKeyIds = new Set([
        this.options.signingKeyId,
        ...Object.values(this.signingKeyIdsByMerchant),
      ]);
      const availableSigningKeyIds = Array.isArray(body.signingKeyIds)
        ? body.signingKeyIds.filter((keyId): keyId is string => typeof keyId === "string")
        : [];
      const keyAvailable = [...requiredSigningKeyIds].every((keyId) =>
        availableSigningKeyIds.includes(keyId),
      );
      const relevantExpirations = Array.isArray(body.signingIdentities)
        ? body.signingIdentities
            .flatMap((candidate) => {
              if (!candidate || typeof candidate !== "object") return [];
              const identity = candidate as { id?: unknown; expiresAt?: unknown };
              return typeof identity.id === "string" &&
                requiredSigningKeyIds.has(identity.id) &&
                typeof identity.expiresAt === "string"
                ? [identity.expiresAt]
                : [];
            })
            .sort((left, right) => Date.parse(left) - Date.parse(right))
        : [];
      const expiresAt = relevantExpirations[0];
      const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
      if (expiresAt && Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
        return { status: "EXPIRED", expiresAt };
      }
      if (
        expiresAt &&
        Number.isFinite(expiresAtMs) &&
        expiresAtMs <= Date.now() + 30 * 24 * 60 * 60 * 1_000
      ) {
        return { status: "EXPIRING", expiresAt };
      }
      return body.status === "ready" &&
        body.passBuilderRevision === adoptedApplePassBuilderRevision &&
        keyAvailable
        ? { status: "READY", ...(expiresAt ? { expiresAt } : {}) }
        : { status: "DEGRADED" };
    } catch {
      return { status: "DEGRADED" };
    }
  }

  private async request(input: WalletPassGenerationInput): Promise<PassBuilderServiceRequest> {
    const pass = mapAppleGenericPass(
      input.membership,
      input.configuration,
      input.authenticationToken,
    );
    const [brand, personalized] = await Promise.all([
      defaultBrandImages(),
      personalizedVariants(input.membership),
    ]);
    const thumbnail = merchantThumbnailVariants(input.membership);
    const field = (style: ApplePassFields, key: string) => {
      const result = [
        ...(style.headerFields ?? []),
        ...(style.primaryFields ?? []),
        ...(style.secondaryFields ?? []),
        ...(style.auxiliaryFields ?? []),
        ...(style.footerFields ?? []),
        ...(style.backFields ?? []),
      ].find((candidate) => candidate.key === key)?.value;
      return String(result ?? "");
    };
    return {
      operationId: `pass-${input.membership.walletPassInstanceId}`,
      merchantId: input.membership.organizationId,
      signingKeyId:
        this.signingKeyIdsByMerchant[input.membership.organizationId] ?? this.options.signingKeyId,
      templateId: this.options.templateId ?? "waflo-loyalty-v1",
      pass: {
        passTypeIdentifier: pass.passTypeIdentifier,
        teamIdentifier: pass.teamIdentifier,
        serialNumber: pass.serialNumber,
        organizationName: pass.organizationName,
        description: pass.description,
        logoText: pass.logoText,
        foregroundColor: hexFromRgb(pass.foregroundColor),
        backgroundColor: hexFromRgb(pass.backgroundColor),
        labelColor: hexFromRgb(pass.labelColor),
        webServiceURL: pass.webServiceURL,
        authenticationToken: pass.authenticationToken,
        voided: pass.voided,
        barcode: {
          format: "QR",
          message: pass.barcodes[0].message,
          messageEncoding: pass.barcodes[0].messageEncoding,
        },
        fieldValues: {
          progress: field(pass.generic, "progress"),
          progress_detail: field(pass.posterGeneric, "progress_detail"),
          program: field(pass.generic, "program"),
          member: field(pass.generic, "member"),
          status: field(pass.generic, "status"),
          reward: field(pass.generic, "reward"),
          security: field(pass.generic, "security"),
          operator: field(pass.generic, "operator"),
        },
      },
      images: {
        icon: brand.icon,
        logo: brand.logo,
        primaryLogo: brand.primaryLogo,
        artwork: personalized.artwork,
        strip: personalized.strip,
        ...(thumbnail ? { thumbnail } : {}),
      },
    };
  }

  private async call(path: string, body: PassBuilderServiceRequest): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.serviceUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.authToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (cause) {
      throw new WalletProviderError("PROVIDER_UNAVAILABLE", "Pass Builder is unavailable.", {
        retryable: true,
        cause,
      });
    }
    if (response.ok) return response;
    const digest = createHash("sha256")
      .update(await response.text())
      .digest("hex")
      .slice(0, 16);
    if (response.status === 400 || response.status === 413 || response.status === 422) {
      throw new WalletProviderError("OBJECT_INVALID", "Pass Builder rejected the pass.", {
        retryable: false,
        providerRequestId: digest,
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new WalletProviderError(
        "AUTHENTICATION_FAILED",
        "Pass Builder authentication failed.",
        {
          retryable: false,
          providerRequestId: digest,
        },
      );
    }
    throw new WalletProviderError("PROVIDER_UNAVAILABLE", "Pass Builder failed.", {
      retryable: true,
      providerRequestId: digest,
    });
  }
}

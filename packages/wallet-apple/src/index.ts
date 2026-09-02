import { createHash, createHmac } from "node:crypto";
import {
  cardLocalePresentation,
  cardLocaleRegistry,
  walletStructuralCopyForLocale,
} from "@waflo/contracts";
import { renderPublishedMembershipStampSvg } from "@waflo/stamp-engine";
import {
  composeAppleLegacyStripArtwork,
  walletArtworkInputFromStampRender,
} from "@waflo/wallet-artwork";
import {
  type WalletAddAction,
  type WalletInvalidateResult,
  type WalletIssueResult,
  type WalletMembershipInput,
  type WalletProgramInput,
  type WalletProgramTemplateResult,
  type WalletProvider,
  type WalletProviderHealth,
  type WalletProviderMode,
  resolveWalletLoyaltyPresentation,
  type WalletReconcileResult,
  type WalletUpdateReason,
  type WalletUpdateResult,
} from "@waflo/wallet-core";
import { zipSync } from "fflate";
import forge from "node-forge";
import sharp from "sharp";
import {
  mapAppleGenericPass,
  mapLegacyApplePresentation,
  type WalletPassGenerationInput,
  type WalletPassGenerator,
  type WalletPassGeneratorHealth,
} from "./pass-builder.js";

export {
  type AppleGenericPassDocument,
  ApplePassBuilderGenerator,
  type ApplePassBuilderGeneratorOptions,
  adoptedApplePassBuilderRevision,
  mapAppleGenericPass,
  mapLegacyApplePresentation,
  parseAppleSigningKeyMap,
  type WalletPassGenerationInput,
  type WalletPassGenerator,
  type WalletPassGeneratorHealth,
  type WalletPassValidationResult,
} from "./pass-builder.js";

export interface ApplePassConfiguration {
  readonly passTypeIdentifier: string;
  readonly teamIdentifier: string;
  readonly organizationName: string;
  readonly webServiceUrl: string;
}

export interface ApplePassField {
  readonly key: string;
  readonly label?: string;
  readonly value: string | number;
  readonly changeMessage?: string;
  readonly textAlignment?: "PKTextAlignmentNatural";
}

export interface AppleStoreCardPass {
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
  readonly locations?: ReadonlyArray<{
    readonly latitude: number;
    readonly longitude: number;
    readonly relevantText: string;
  }>;
  readonly maxDistance?: number;
  readonly barcodes: ReadonlyArray<{
    readonly format: "PKBarcodeFormatQR";
    readonly message: string;
    readonly messageEncoding: "iso-8859-1";
  }>;
  readonly storeCard: {
    readonly headerFields: readonly ApplePassField[];
    readonly primaryFields: readonly ApplePassField[];
    readonly secondaryFields: readonly ApplePassField[];
    readonly auxiliaryFields: readonly ApplePassField[];
    readonly backFields: readonly ApplePassField[];
  };
}

export function appleRgb(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Apple Wallet color must be six-digit hex.");
  const values = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  );
  return `rgb(${values.join(", ")})`;
}

export function mapAppleStoreCard(
  input: WalletMembershipInput,
  configuration: ApplePassConfiguration,
  authenticationToken: string,
): AppleStoreCardPass {
  const presentation = resolveWalletLoyaltyPresentation(input);
  const nearby = input.nearbyRelevance;
  if (nearby?.enabled && nearby.locations.length > 10) {
    throw new Error("Apple Wallet supports at most 10 nearby locations per pass.");
  }
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
    voided: presentation.inactive,
    ...(nearby?.enabled && nearby.locations.length
      ? {
          locations: nearby.locations.map((location) => ({
            latitude: location.latitude,
            longitude: location.longitude,
            relevantText: location.relevantText,
          })),
          maxDistance: nearby.desiredAppleMaxDistanceMeters,
        }
      : {}),
    barcodes: [
      {
        format: presentation.barcode.appleFormats[0],
        message: presentation.barcode.payload,
        messageEncoding: "iso-8859-1",
      },
    ],
    storeCard: mapLegacyApplePresentation(input) as AppleStoreCardPass["storeCard"],
  };
}

export function createAppleManifest(
  files: Readonly<Record<string, Uint8Array>>,
): Readonly<Record<string, string>> {
  const manifest: Record<string, string> = {};
  for (const name of Object.keys(files).toSorted()) {
    if (name === "manifest.json" || name === "signature" || name.includes("..")) continue;
    const content = files[name];
    if (!content) continue;
    manifest[name] = createHash("sha1").update(content).digest("hex");
  }
  return manifest;
}

export interface ApplePassSigner {
  readonly mode: "TEST_ADAPTER" | "REAL";
  signManifest(manifest: Uint8Array): Promise<Uint8Array>;
  health?(
    expectedPassTypeIdentifier: string,
    expectedTeamIdentifier: string,
  ): {
    status: "READY" | "EXPIRING" | "EXPIRED" | "IDENTIFIER_MISMATCH" | "TEAM_MISMATCH";
    expiresAt: string;
  };
}

export class TestApplePassSigner implements ApplePassSigner {
  readonly mode = "TEST_ADAPTER" as const;
  constructor(private readonly secret = "waflo-apple-test-adapter-signature") {}
  async signManifest(manifest: Uint8Array): Promise<Uint8Array> {
    return createHmac("sha256", this.secret).update(manifest).digest();
  }
}

export class Pkcs7ApplePassSigner implements ApplePassSigner {
  readonly mode = "REAL" as const;
  constructor(
    private readonly pkcs12Bytes: Uint8Array,
    private readonly password: string,
    private readonly wwdrCertificatePem: string,
  ) {}

  health(expectedPassTypeIdentifier: string, expectedTeamIdentifier: string) {
    const identity = this.identity();
    const now = Date.now();
    const expiresAt = identity.certificate.validity.notAfter.getTime();
    const commonName = String(identity.certificate.subject.getField("CN")?.value ?? "");
    const userId = String(identity.certificate.subject.getField("UID")?.value ?? "");
    const organizationalUnit = String(identity.certificate.subject.getField("OU")?.value ?? "");
    if (!commonName.includes(expectedPassTypeIdentifier) && userId !== expectedPassTypeIdentifier) {
      return {
        status: "IDENTIFIER_MISMATCH" as const,
        expiresAt: identity.certificate.validity.notAfter.toISOString(),
      };
    }
    if (organizationalUnit !== expectedTeamIdentifier) {
      return {
        status: "TEAM_MISMATCH" as const,
        expiresAt: identity.certificate.validity.notAfter.toISOString(),
      };
    }
    if (expiresAt <= now)
      return {
        status: "EXPIRED" as const,
        expiresAt: identity.certificate.validity.notAfter.toISOString(),
      };
    if (expiresAt <= now + 30 * 24 * 60 * 60 * 1_000) {
      return {
        status: "EXPIRING" as const,
        expiresAt: identity.certificate.validity.notAfter.toISOString(),
      };
    }
    return {
      status: "READY" as const,
      expiresAt: identity.certificate.validity.notAfter.toISOString(),
    };
  }

  async signManifest(manifest: Uint8Array): Promise<Uint8Array> {
    try {
      const identity = this.identity();
      const signed = forge.pkcs7.createSignedData();
      signed.content = forge.util.createBuffer(Buffer.from(manifest).toString("binary"));
      signed.addCertificate(identity.certificate);
      signed.addCertificate(forge.pki.certificateFromPem(this.wwdrCertificatePem));
      signed.addSigner({
        key: identity.key as unknown as string,
        certificate: identity.certificate,
        digestAlgorithm: forge.pki.oids.sha256 as string,
        authenticatedAttributes: [
          {
            type: forge.pki.oids.contentType as string,
            value: forge.pki.oids.data as string,
          },
          {
            type: forge.pki.oids.messageDigest as string,
          },
          {
            type: forge.pki.oids.signingTime as string,
            value: new Date() as unknown as string,
          },
        ],
      });
      signed.sign({ detached: true });
      return Buffer.from(forge.asn1.toDer(signed.toAsn1()).getBytes(), "binary");
    } catch (cause) {
      throw new Error("Apple pass PKCS#7 signing failed.", { cause });
    }
  }

  private identity() {
    const p12Asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(Buffer.from(this.pkcs12Bytes).toString("binary")),
    );
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, this.password);
    const shroudedKeyOid = forge.pki.oids.pkcs8ShroudedKeyBag as string;
    const keyOid = forge.pki.oids.keyBag as string;
    const certOid = forge.pki.oids.certBag as string;
    const keyBags = [
      ...(p12.getBags({ bagType: shroudedKeyOid })[shroudedKeyOid] ?? []),
      ...(p12.getBags({ bagType: keyOid })[keyOid] ?? []),
    ].filter((bag) => bag.key);
    const certBags = (p12.getBags({ bagType: certOid })[certOid] ?? []).filter((bag) => bag.cert);
    for (const keyBag of keyBags) {
      const key = keyBag.key as forge.pki.rsa.PrivateKey;
      const certBag = certBags.find((bag) => {
        const publicKey = bag.cert?.publicKey as forge.pki.rsa.PublicKey | undefined;
        return Boolean(
          publicKey && key.n.compareTo(publicKey.n) === 0 && key.e.compareTo(publicKey.e) === 0,
        );
      });
      if (!certBag?.cert) continue;
      const wwdr = forge.pki.certificateFromPem(this.wwdrCertificatePem);
      forge.pki.verifyCertificateChain(forge.pki.createCaStore([wwdr]), [certBag.cert]);
      return { key, certificate: certBag.cert };
    }
    throw new Error("Pass signing identity has no certificate matching its private key.");
  }
}

async function defaultPassImages(): Promise<Record<string, Uint8Array>> {
  const image = (width: number, height: number) => {
    const markSize = Math.min(height, width);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${markSize}" height="${height}" rx="${Math.max(4, height * 0.18)}" fill="#E4572E"/><path d="M${markSize * 0.2} ${height * 0.28}l${markSize * 0.16} ${height * 0.46} ${markSize * 0.14}-${height * 0.27} ${markSize * 0.14} ${height * 0.27} ${markSize * 0.16}-${height * 0.46}" fill="none" stroke="#fff" stroke-width="${Math.max(2, markSize * 0.09)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
  };
  const [icon, icon2x, icon3x, logo, logo2x, logo3x] = await Promise.all([
    image(38, 38),
    image(76, 76),
    image(114, 114),
    image(38, 38),
    image(76, 76),
    image(114, 114),
  ]);
  return {
    "icon.png": icon,
    "icon@2x.png": icon2x,
    "icon@3x.png": icon3x,
    "logo.png": logo,
    "logo@2x.png": logo2x,
    "logo@3x.png": logo3x,
  };
}

async function progressStripImages(
  input: WalletMembershipInput,
): Promise<Readonly<Record<string, Buffer>>> {
  const walletLocale = cardLocalePresentation(input.locale).locale;
  const stampRenderInput = { ...input.stampRenderInput, locale: walletLocale };
  const rendered = renderPublishedMembershipStampSvg({
    ...stampRenderInput,
    outputProfile: "APPLE_WALLET",
  });
  const composed = await composeAppleLegacyStripArtwork(
    walletArtworkInputFromStampRender(
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
    ),
  );
  return {
    "strip.png": composed.times1.bytes,
    "strip@2x.png": composed.times2.bytes,
    "strip@3x.png": composed.times3.bytes,
  };
}

/**
 * Legacy Store Cards have one compact logo slot beside logoText. Normalize
 * only pass-package derivatives, never the merchant source asset or Poster
 * artwork, so a wide wordmark cannot consume the identity row.
 */
async function normalizeLegacyLogoImages(
  images: Readonly<Record<string, Uint8Array>> | undefined,
): Promise<Readonly<Record<string, Uint8Array>>> {
  if (!images) return {};
  const output: Record<string, Uint8Array> = { ...images };
  await Promise.all(
    (
      [
        ["logo.png", 38],
        ["logo@2x.png", 76],
        ["logo@3x.png", 114],
      ] as const
    ).map(async ([name, size]) => {
      const source = images[name];
      if (!source) return;
      try {
        output[name] = await sharp(source)
          .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .resize(size, size, {
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 0 },
          })
          .png()
          .toBuffer();
      } catch {
        // Source-image validity is checked earlier in the branding flow. Keep
        // a supplied legacy/test asset when this presentation-only derivative
        // cannot be raster-normalized.
        output[name] = source;
      }
    }),
  );
  return output;
}

function appleStringsEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function localizedStrings(
  locale: string,
  replacements: readonly { key: string; value: string }[] = [],
): string {
  const presentation = cardLocalePresentation(locale);
  const copy = walletStructuralCopyForLocale(presentation.locale);
  const structural = [
    ["STAMPS", copy.stamps],
    ["MEMBER", copy.member],
    ["STATUS", copy.status],
    ["REWARD", copy.reward],
    ["PROGRAM", copy.program],
    ["SECURITY", copy.security],
    ["Active", copy.active],
    ["Reward ready", copy.rewardReady],
    ["Transferred", copy.transferred],
    ["Temporarily paused", copy.paused],
    ["No longer valid", copy.invalid],
  ] as const;
  return [...structural, ...replacements.map(({ key, value }) => [key, value] as const)]
    .filter(([key]) => key.length > 0)
    .map(([key, value]) => `"${appleStringsEscape(key)}" = "${appleStringsEscape(value)}";\n`)
    .join("");
}

function utf16AppleStrings(value: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, "utf16le")]);
}

function passFieldValue(pass: AppleStoreCardPass, key: string): string {
  const field = [
    ...pass.storeCard.headerFields,
    ...pass.storeCard.primaryFields,
    ...pass.storeCard.secondaryFields,
    ...pass.storeCard.auxiliaryFields,
    ...pass.storeCard.backFields,
  ].find((candidate) => candidate.key === key);
  return field?.value.toString() ?? "";
}

const appleLocalizableValueKeys: Readonly<Record<string, string>> = Object.freeze({
  progress: "__WAFLO_PROGRESS__",
  reward: "__WAFLO_REWARD__",
  program: "__WAFLO_PROGRAM__",
  member: "__WAFLO_MEMBER__",
  security: "__WAFLO_SECURITY_VALUE__",
  operator: "__WAFLO_OPERATOR_VALUE__",
});

/**
 * Apple resolves pass.strings by matching pass.json string values. Stable keys
 * keep that mapping independent of the language used to issue this pass while
 * retaining the approved field hierarchy and geometry.
 */
function withAppleLocalizationKeys(pass: AppleStoreCardPass): AppleStoreCardPass {
  const fields = (value: readonly ApplePassField[]) =>
    value.map((field) => ({
      ...field,
      value: appleLocalizableValueKeys[field.key] ?? field.value,
    }));
  return {
    ...pass,
    description: "__WAFLO_DESCRIPTION__",
    logoText: "__WAFLO_LOGO_TEXT__",
    storeCard: {
      headerFields: fields(pass.storeCard.headerFields),
      primaryFields: fields(pass.storeCard.primaryFields),
      secondaryFields: fields(pass.storeCard.secondaryFields),
      auxiliaryFields: fields(pass.storeCard.auxiliaryFields),
      backFields: fields(pass.storeCard.backFields),
    },
  };
}

export async function buildApplePassPackage(input: {
  pass: AppleStoreCardPass;
  signer: ApplePassSigner;
  images?: Readonly<Record<string, Uint8Array>>;
  defaultLocale?: string;
  localizations?: ReadonlyArray<{
    locale: string;
    programName: string;
    description: string;
    rewardSummary: string;
  }>;
}): Promise<Buffer> {
  const defaults = await defaultPassImages();
  const localizablePass = withAppleLocalizationKeys(input.pass);
  const configuredLocalizations = input.localizations?.length
    ? input.localizations
    : [
        {
          locale: "en",
          programName: passFieldValue(input.pass, "program"),
          description: input.pass.description,
          rewardSummary: passFieldValue(input.pass, "reward"),
        },
      ];
  const defaultLocale = cardLocalePresentation(
    input.defaultLocale ?? configuredLocalizations[0]?.locale ?? "en",
  ).locale;
  const defaultContent =
    configuredLocalizations.find(
      (item) => cardLocalePresentation(item.locale).locale === defaultLocale,
    ) ?? configuredLocalizations[0];
  if (!defaultContent) throw new Error("Apple pass needs localized default content.");
  // Apple receives a complete localization folder for every locale Waflo can
  // issue. A program's configured values win; unconfigured locales retain the
  // default merchant copy while their structural field labels remain correct.
  const localizations = cardLocaleRegistry.map((locale) => {
    const configured = configuredLocalizations.find(
      (item) => cardLocalePresentation(item.locale).locale === locale.id,
    );
    return configured ?? { ...defaultContent, locale: locale.id };
  });
  const localizedFiles = Object.fromEntries(
    localizations.map((content) => [
      `${cardLocalePresentation(content.locale).appleLocale}.lproj/pass.strings`,
      utf16AppleStrings(
        localizedStrings(content.locale, [
          {
            key: "__WAFLO_PROGRAM__",
            value: content.programName,
          },
          {
            key: "__WAFLO_DESCRIPTION__",
            value: content.description,
          },
          {
            key: "__WAFLO_REWARD__",
            value: content.rewardSummary,
          },
          { key: "__WAFLO_LOGO_TEXT__", value: input.pass.logoText },
          { key: "__WAFLO_PROGRESS__", value: passFieldValue(input.pass, "progress") },
          { key: "__WAFLO_MEMBER__", value: passFieldValue(input.pass, "member") },
          {
            key: "__WAFLO_SECURITY_VALUE__",
            value: passFieldValue(input.pass, "security"),
          },
          {
            key: "__WAFLO_OPERATOR_VALUE__",
            value: passFieldValue(input.pass, "operator"),
          },
        ]),
      ),
    ]),
  );
  const files: Record<string, Uint8Array> = {
    "pass.json": Buffer.from(JSON.stringify(localizablePass), "utf8"),
    ...defaults,
    ...localizedFiles,
    ...(input.images ?? {}),
  };
  const manifest = Buffer.from(JSON.stringify(createAppleManifest(files)), "utf8");
  files["manifest.json"] = manifest;
  files.signature = await input.signer.signManifest(manifest);
  return Buffer.from(zipSync(files, { level: 9 }));
}

export function appleAuthorizationToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^ApplePass ([A-Za-z0-9_-]{24,256})$/.exec(header.trim());
  return match?.[1] ?? null;
}

export interface AppleWalletProviderOptions {
  readonly mode: WalletProviderMode;
  readonly configuration?: ApplePassConfiguration;
  readonly signer?: ApplePassSigner;
  readonly generator?: WalletPassGenerator;
  readonly authenticationToken: (input: WalletMembershipInput) => string;
  readonly passDownloadUrl: string;
}

export class LegacyApplePassGenerator implements WalletPassGenerator {
  readonly kind = "legacy" as const;

  constructor(private readonly signer: ApplePassSigner) {}

  async generatePass(input: WalletPassGenerationInput): Promise<Buffer> {
    const pass = mapAppleStoreCard(
      input.membership,
      input.configuration,
      input.authenticationToken,
    );
    return buildApplePassPackage({
      pass,
      signer: this.signer,
      images: {
        ...(await progressStripImages(input.membership)),
        ...(await normalizeLegacyLogoImages(input.membership.applePassImages)),
      },
      ...(input.membership.defaultLocale ? { defaultLocale: input.membership.defaultLocale } : {}),
      ...(input.membership.localizedContent
        ? { localizations: input.membership.localizedContent }
        : {}),
    });
  }

  async validatePass(input: WalletPassGenerationInput) {
    const artifact = await this.generatePass(input);
    return { valid: artifact.length > 0, warnings: [] };
  }

  async healthCheck(configuration: ApplePassConfiguration): Promise<WalletPassGeneratorHealth> {
    if (this.signer.mode !== "REAL" || !this.signer.health) return { status: "READY" };
    return this.signer.health(configuration.passTypeIdentifier, configuration.teamIdentifier);
  }
}

export class AppleWalletProvider implements WalletProvider {
  readonly provider = "APPLE" as const;
  readonly mode: WalletProviderMode;
  private readonly generator: WalletPassGenerator | undefined;

  constructor(private readonly options: AppleWalletProviderOptions) {
    this.mode = options.mode;
    this.generator =
      options.generator ??
      (options.signer ? new LegacyApplePassGenerator(options.signer) : undefined);
  }

  async healthCheck(): Promise<WalletProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (this.mode === "DISABLED") {
      return {
        provider: this.provider,
        mode: this.mode,
        status: "NOT_CONFIGURED",
        checkedAt,
        safeMessage: "Apple Wallet is disabled.",
        demo: false,
      };
    }
    if (!this.options.configuration || !this.generator) {
      return {
        provider: this.provider,
        mode: this.mode,
        status: "NOT_CONFIGURED",
        checkedAt,
        safeMessage: "Apple Wallet signing configuration is incomplete.",
        demo: this.mode === "TEST_ADAPTER",
      };
    }
    try {
      const webServiceUrl = new URL(this.options.configuration.webServiceUrl);
      if (this.mode === "REAL" && webServiceUrl.protocol !== "https:") {
        throw new Error("Apple Wallet web service must use HTTPS.");
      }
    } catch {
      return {
        provider: this.provider,
        mode: this.mode,
        status: "DEGRADED",
        checkedAt,
        safeMessage: "Apple Wallet update web-service URL is invalid.",
        demo: this.mode === "TEST_ADAPTER",
        configured: false,
        providerReachable: false,
        externallyCertified: false,
      };
    }
    if (this.mode === "REAL") {
      try {
        const certificate = await this.generator.healthCheck(this.options.configuration);
        if (certificate.status === "DEGRADED") {
          return {
            provider: this.provider,
            mode: this.mode,
            status: "PROVIDER_UNAVAILABLE",
            checkedAt,
            safeMessage: "Apple pass generation is unavailable.",
            demo: false,
            configured: true,
            providerReachable: false,
            externallyCertified: false,
          };
        }
        if (certificate.status === "EXPIRED") {
          return {
            provider: this.provider,
            mode: this.mode,
            status: "CERTIFICATE_EXPIRED",
            checkedAt,
            safeMessage: "Apple Wallet signing certificate is expired.",
            demo: false,
            configured: true,
            providerReachable: false,
            externallyCertified: false,
            ...(certificate.expiresAt ? { certificateExpiresAt: certificate.expiresAt } : {}),
          };
        }
        if (certificate.status === "EXPIRING") {
          return {
            provider: this.provider,
            mode: this.mode,
            status: "CERTIFICATE_EXPIRING",
            checkedAt,
            safeMessage: "Apple Wallet signing certificate expires within 30 days.",
            demo: false,
            configured: true,
            providerReachable: false,
            externallyCertified: false,
            ...(certificate.expiresAt ? { certificateExpiresAt: certificate.expiresAt } : {}),
          };
        }
        if (
          certificate.status === "IDENTIFIER_MISMATCH" ||
          certificate.status === "TEAM_MISMATCH"
        ) {
          return {
            provider: this.provider,
            mode: this.mode,
            status: "PERMISSION_DENIED",
            checkedAt,
            safeMessage:
              certificate.status === "TEAM_MISMATCH"
                ? "Apple Wallet signing identity does not match the configured Team ID."
                : "Apple Wallet signing identity does not match the configured Pass Type ID.",
            demo: false,
            configured: true,
            providerReachable: false,
            externallyCertified: false,
            ...(certificate.expiresAt ? { certificateExpiresAt: certificate.expiresAt } : {}),
          };
        }
      } catch {
        return {
          provider: this.provider,
          mode: this.mode,
          status: "DEGRADED",
          checkedAt,
          safeMessage: "Apple Wallet signing identity could not be validated.",
          demo: false,
        };
      }
    }
    if (this.mode === "REAL") {
      return {
        provider: this.provider,
        mode: this.mode,
        status: "EXTERNALLY_UNCERTIFIED",
        checkedAt,
        safeMessage:
          "Apple Wallet signing is locally valid; external device certification is still pending.",
        demo: false,
        configured: true,
        providerReachable: false,
        externallyCertified: false,
      };
    }
    return {
      provider: this.provider,
      mode: this.mode,
      status: "HEALTHY",
      checkedAt,
      safeMessage:
        this.mode === "TEST_ADAPTER"
          ? "Apple Wallet Test Adapter is ready. Test packages are not installable production passes."
          : "Apple Wallet signing configuration is ready.",
      demo: this.mode === "TEST_ADAPTER",
      configured: true,
      providerReachable: false,
      externallyCertified: false,
    };
  }

  async ensureProgramTemplate(input: WalletProgramInput): Promise<WalletProgramTemplateResult> {
    this.requireConfigured();
    return {
      providerTemplateId: this.options.configuration?.passTypeIdentifier ?? "",
      state: "READY",
      fingerprint: input.configurationFingerprint,
    };
  }

  async issueMembershipPass(input: WalletMembershipInput): Promise<WalletIssueResult> {
    const configuration = this.requireConfigured();
    const authenticationToken = this.options.authenticationToken(input);
    const pass =
      this.generator?.kind === "apple-pass-builder"
        ? mapAppleGenericPass(input, configuration, authenticationToken)
        : mapAppleStoreCard(input, configuration, authenticationToken);
    const artifact = await this.generator?.generatePass({
      membership: input,
      configuration,
      authenticationToken,
    });
    if (!artifact) throw new Error("Apple Wallet pass generator is unavailable.");
    return {
      providerObjectId: input.providerIdentity,
      state: "ACTIVE",
      artifact,
      safeMetadata: {
        mode: this.mode,
        generator: this.generator?.kind ?? "unavailable",
        packageDigest: createHash("sha256").update(artifact).digest("hex"),
        voided: pass.voided,
      },
    };
  }

  async createAddToWalletAction(_input: WalletMembershipInput): Promise<WalletAddAction> {
    this.requireConfigured();
    return {
      mode: this.mode,
      url: this.options.passDownloadUrl,
      testAdapter: this.mode === "TEST_ADAPTER",
    };
  }

  async updateMembershipPass(
    input: WalletMembershipInput,
    _reason: WalletUpdateReason,
  ): Promise<WalletUpdateResult> {
    await this.issueMembershipPass(input);
    return { state: "UPDATED" };
  }

  async invalidateMembershipPass(
    input: WalletMembershipInput,
    _reason: WalletUpdateReason,
  ): Promise<WalletInvalidateResult> {
    await this.issueMembershipPass({ ...input, transferred: true });
    return { state: "INVALIDATED" };
  }

  async reconcileMembershipPass(input: WalletMembershipInput): Promise<WalletReconcileResult> {
    await this.issueMembershipPass(input);
    return { state: "ACTIVE", changed: false };
  }

  private requireConfigured(): ApplePassConfiguration {
    if (this.mode === "DISABLED" || !this.options.configuration || !this.generator) {
      throw new Error("Apple Wallet is not configured.");
    }
    return this.options.configuration;
  }
}

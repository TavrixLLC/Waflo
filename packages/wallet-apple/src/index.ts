import { createHash, createHmac } from "node:crypto";
import { renderPublishedMembershipStampSvg } from "@waflo/stamp-engine";
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
  type WalletReconcileResult,
  type WalletUpdateReason,
  type WalletUpdateResult,
} from "@waflo/wallet-core";
import { zipSync } from "fflate";
import forge from "node-forge";
import sharp from "sharp";

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
    readonly altText: string;
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
  const progress = `${input.currentStampCount}/${input.requiredStampCount}`;
  const inactive =
    input.transferred ||
    input.membershipStatus !== "ACTIVE" ||
    input.programStatus === "ARCHIVED" ||
    input.programStatus === "SUSPENDED";
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
    voided: inactive,
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
        format: "PKBarcodeFormatQR",
        message: input.credentialPayload,
        messageEncoding: "iso-8859-1",
        altText: inactive ? "No longer valid" : input.publicMembershipId.slice(-12),
      },
    ],
    storeCard: {
      headerFields: [{ key: "progress", label: "STAMPS", value: progress }],
      primaryFields: [{ key: "program", value: input.programName.slice(0, 80) }],
      secondaryFields: [{ key: "member", label: "MEMBER", value: input.displayName.slice(0, 80) }],
      auxiliaryFields: [
        {
          key: "status",
          label: "STATUS",
          value: input.transferred
            ? "Transferred"
            : input.programStatus === "PAUSED"
              ? "Temporarily paused"
              : input.rewardReady
                ? "Reward ready"
                : "Active",
          changeMessage: "%@",
        },
      ],
      backFields: [
        { key: "reward", label: "REWARD", value: input.rewardSummary.slice(0, 500) },
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
    },
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
  const image = (width: number, height: number, logo = false) => {
    const markSize = Math.min(height, logo ? width / 3 : width);
    const text = logo
      ? `<text x="${markSize + Math.max(5, width * 0.04)}" y="${height * 0.7}" font-family="Arial,sans-serif" font-size="${height * 0.48}" font-weight="700" fill="#241916">WAFLO</text>`
      : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${markSize}" height="${height}" rx="${Math.max(4, height * 0.18)}" fill="#E4572E"/><path d="M${markSize * 0.2} ${height * 0.28}l${markSize * 0.16} ${height * 0.46} ${markSize * 0.14}-${height * 0.27} ${markSize * 0.14} ${height * 0.27} ${markSize * 0.16}-${height * 0.46}" fill="none" stroke="#fff" stroke-width="${Math.max(2, markSize * 0.09)}" stroke-linecap="round" stroke-linejoin="round"/>${text}</svg>`;
    return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
  };
  const [icon, icon2x, icon3x, logo, logo2x] = await Promise.all([
    image(29, 29),
    image(58, 58),
    image(87, 87),
    image(160, 50, true),
    image(320, 100, true),
  ]);
  return {
    "icon.png": icon,
    "icon@2x.png": icon2x,
    "icon@3x.png": icon3x,
    "logo.png": logo,
    "logo@2x.png": logo2x,
  };
}

async function progressStrip(input: WalletMembershipInput): Promise<Buffer> {
  const rendered = renderPublishedMembershipStampSvg({
    ...input.stampRenderInput,
    outputProfile: "APPLE_WALLET",
  });
  return sharp(Buffer.from(rendered.svg, "utf8"))
    .resize(750, 246, {
      fit: "contain",
      background: input.stampRenderInput.visualTheme.backgroundColor,
    })
    .png()
    .toBuffer();
}

function appleStringsEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function localizedStrings(
  locale: string,
  replacements: readonly { key: string; value: string }[] = [],
): string {
  const structural =
    locale === "ar"
      ? '"STAMPS" = "الأختام";\n"MEMBER" = "العضو";\n"STATUS" = "الحالة";\n"Transferred" = "تم النقل";\n"No longer valid" = "لم تعد صالحة";\n'
      : '"STAMPS" = "STAMPS";\n"MEMBER" = "MEMBER";\n"STATUS" = "STATUS";\n"Transferred" = "Transferred";\n"No longer valid" = "No longer valid";\n';
  return `${structural}${replacements
    .map(({ key, value }) => `"${appleStringsEscape(key)}" = "${appleStringsEscape(value)}";\n`)
    .join("")}`;
}

function utf16AppleStrings(value: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, "utf16le")]);
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
  const localizations = input.localizations?.length
    ? input.localizations
    : [
        {
          locale: "en",
          programName: input.pass.storeCard.primaryFields[0]?.value.toString() ?? "",
          description: input.pass.description,
          rewardSummary: input.pass.storeCard.backFields[0]?.value.toString() ?? "",
        },
        {
          locale: "ar",
          programName: input.pass.storeCard.primaryFields[0]?.value.toString() ?? "",
          description: input.pass.description,
          rewardSummary: input.pass.storeCard.backFields[0]?.value.toString() ?? "",
        },
      ];
  const defaultLocale = input.defaultLocale ?? localizations[0]?.locale ?? "en";
  const defaultContent =
    localizations.find((item) => item.locale === defaultLocale) ?? localizations[0];
  const localizedFiles = Object.fromEntries(
    localizations.map((content) => [
      `${content.locale}.lproj/pass.strings`,
      utf16AppleStrings(
        localizedStrings(content.locale, [
          {
            key: defaultContent?.programName ?? "",
            value: content.programName,
          },
          {
            key: defaultContent?.description ?? "",
            value: content.description,
          },
          {
            key: defaultContent?.rewardSummary ?? "",
            value: content.rewardSummary,
          },
        ]),
      ),
    ]),
  );
  const files: Record<string, Uint8Array> = {
    "pass.json": Buffer.from(JSON.stringify(input.pass), "utf8"),
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
  readonly authenticationToken: (input: WalletMembershipInput) => string;
  readonly passDownloadUrl: string;
}

export class AppleWalletProvider implements WalletProvider {
  readonly provider = "APPLE" as const;
  readonly mode: WalletProviderMode;

  constructor(private readonly options: AppleWalletProviderOptions) {
    this.mode = options.mode;
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
    if (!this.options.configuration || !this.options.signer) {
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
    if (this.options.signer.mode === "REAL" && this.options.signer.health) {
      try {
        const certificate = this.options.signer.health(
          this.options.configuration.passTypeIdentifier,
          this.options.configuration.teamIdentifier,
        );
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
            certificateExpiresAt: certificate.expiresAt,
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
            certificateExpiresAt: certificate.expiresAt,
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
            certificateExpiresAt: certificate.expiresAt,
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
    const defaultLocale = input.defaultLocale ?? input.locale;
    const defaultContent =
      input.localizedContent?.find((content) => content.locale === defaultLocale) ??
      input.localizedContent?.[0];
    const passInput = defaultContent
      ? {
          ...input,
          locale: defaultLocale,
          programName: defaultContent.programName,
          description: defaultContent.description,
          rewardSummary: defaultContent.rewardSummary,
        }
      : input;
    const pass = mapAppleStoreCard(
      passInput,
      configuration,
      this.options.authenticationToken(input),
    );
    const artifact = await buildApplePassPackage({
      pass,
      signer: this.options.signer as ApplePassSigner,
      defaultLocale,
      ...(input.localizedContent ? { localizations: input.localizedContent } : {}),
      images: {
        "strip.png": await progressStrip(input),
        ...(input.applePassImages ?? {}),
      },
    });
    return {
      providerObjectId: input.providerIdentity,
      state: "ACTIVE",
      artifact,
      safeMetadata: {
        mode: this.mode,
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
    if (this.mode === "DISABLED" || !this.options.configuration || !this.options.signer) {
      throw new Error("Apple Wallet is not configured.");
    }
    return this.options.configuration;
  }
}

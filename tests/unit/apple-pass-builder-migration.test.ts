import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  parsePassBuilderRequest,
  parseSigningIdentities,
} from "../../apps/apple-pass-builder-service/src/contracts.js";
import {
  ApplePassBuilderGenerator,
  adoptedApplePassBuilderRevision,
  mapAppleGenericPass,
  mapAppleStoreCard,
  parseAppleSigningKeyMap,
} from "../../packages/wallet-apple/src/index.js";
import type { WalletMembershipInput } from "../../packages/wallet-core/src/index.js";

const baseMembership: WalletMembershipInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Cedar Coffee",
  programId: "00000000-0000-4000-8000-000000000002",
  programVersionId: "00000000-0000-4000-8000-000000000003",
  programName: "Cedar Circle",
  description: "A bilingual coffee loyalty card.",
  rewardSummary: "A complimentary drink after eight stamps.",
  backgroundColor: "#F7F4EE",
  foregroundColor: "#241916",
  configurationFingerprint: "a".repeat(64),
  locale: "en",
  walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
  providerIdentity: "waflo.00000000000040008000000000000004",
  publicMembershipId: "member_m8PNYl1aSr9bT0V4w89d3H2g",
  displayName: "Amina",
  credentialPayload: "wfl1.opaque.credential",
  currentStampCount: 3,
  requiredStampCount: 8,
  rewardReady: false,
  membershipStatus: "ACTIVE",
  programStatus: "PUBLISHED",
  transferred: false,
  stampRenderInput: {
    organizationId: "00000000-0000-4000-8000-000000000001",
    programId: "00000000-0000-4000-8000-000000000002",
    programVersionId: "00000000-0000-4000-8000-000000000003",
    membershipId: "00000000-0000-4000-8000-000000000005",
    rendererSchemaVersion: "waflo-stamp-render-v1",
    locale: "en",
    requiredStampCount: 8,
    currentStampCount: 3,
    rewardReady: false,
    layoutType: "GRID",
    layoutConfiguration: { columns: 4 },
    visualTheme: {
      filledColor: "#E4572E",
      emptyColor: "#F3A712",
      accentColor: "#E4572E",
      backgroundColor: "#F7F4EE",
      foregroundColor: "#241916",
      stampSize: 48,
      spacing: 8,
    },
    filledArtwork: {
      kind: "svg",
      trusted: true,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#E4572E" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>',
    },
    emptyArtwork: {
      kind: "svg",
      trusted: true,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#F7F4EE" stroke="#241916" stroke-width="7" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>',
    },
    assetDigests: { filled: "b".repeat(64), empty: "c".repeat(64) },
    outputProfile: "APPLE_WALLET",
  },
};

const configuration = {
  passTypeIdentifier: "pass.app.waflo",
  teamIdentifier: "WAFLOTEAM",
  organizationName: "Waflo",
  webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
};

function allFieldValues(fields: {
  headerFields?: readonly { key: string; value: string | number }[];
  primaryFields?: readonly { key: string; value: string | number }[];
  secondaryFields?: readonly { key: string; value: string | number }[];
  auxiliaryFields?: readonly { key: string; value: string | number }[];
  footerFields?: readonly { key: string; value: string | number }[];
  backFields?: readonly { key: string; value: string | number }[];
}) {
  return Object.fromEntries(
    [
      ...(fields.headerFields ?? []),
      ...(fields.primaryFields ?? []),
      ...(fields.secondaryFields ?? []),
      ...(fields.auxiliaryFields ?? []),
      ...(fields.footerFields ?? []),
      ...(fields.backFields ?? []),
    ].map((field) => [field.key, field.value]),
  );
}

describe("Apple Pass Builder migration", () => {
  it("keeps legacy reward content on the details side and never in a front field", () => {
    const rewardSummary = "A classic grooming service";
    const input = { ...baseMembership, rewardSummary };
    const legacy = mapAppleStoreCard(input, configuration, "a".repeat(43));
    const migrated = mapAppleGenericPass(input, configuration, "a".repeat(43));
    const frontValues = (fields: typeof legacy.storeCard) =>
      [
        ...fields.headerFields,
        ...fields.primaryFields,
        ...fields.secondaryFields,
        ...fields.auxiliaryFields,
      ].map((field) => field.value);

    expect(frontValues(legacy.storeCard)).not.toContain(rewardSummary);
    expect(legacy.storeCard.backFields).toContainEqual(
      expect.objectContaining({ key: "reward", value: rewardSummary }),
    );
    expect(migrated.generic.backFields).toContainEqual(
      expect.objectContaining({ key: "reward", value: rewardSummary }),
    );
    expect(migrated.posterGeneric.backFields).toContainEqual(
      expect.objectContaining({ key: "reward", value: rewardSummary }),
    );
  });

  it("preserves installed-pass identity, update authentication, QR payload, colors, and legacy Generic semantics", () => {
    const token = "a".repeat(43);
    const legacy = mapAppleStoreCard(baseMembership, configuration, token);
    const migrated = mapAppleGenericPass(baseMembership, configuration, token);
    expect(migrated).toMatchObject({
      passTypeIdentifier: legacy.passTypeIdentifier,
      serialNumber: legacy.serialNumber,
      teamIdentifier: legacy.teamIdentifier,
      webServiceURL: legacy.webServiceURL,
      authenticationToken: legacy.authenticationToken,
      barcodes: legacy.barcodes,
      foregroundColor: legacy.foregroundColor,
      backgroundColor: legacy.backgroundColor,
      labelColor: legacy.labelColor,
      voided: legacy.voided,
    });
    // Pass Builder is opt-in and intentionally uses Generic/Poster field placement;
    // preserve the installed-pass identity while keeping the legacy Store Card default intact.
    expect(allFieldValues(legacy.storeCard)).toMatchObject({
      program: baseMembership.programName,
      status: "Active",
    });
    expect(legacy.storeCard.backFields).toContainEqual(
      expect.objectContaining({ key: "reward", value: baseMembership.rewardSummary }),
    );
    expect(allFieldValues(migrated.generic)).toMatchObject({
      progress: "3/8",
      member: baseMembership.displayName,
      program: baseMembership.programName,
      reward: baseMembership.rewardSummary,
      status: "Active",
    });
  });

  it("emits Poster Generic and Generic fallback from the same personalization", () => {
    const pass = mapAppleGenericPass(baseMembership, configuration, "a".repeat(43));
    expect(pass.posterGeneric).toBeDefined();
    expect(pass.generic).toBeDefined();
    expect(allFieldValues(pass.posterGeneric)).toMatchObject({
      progress_detail: "3/8",
      program: "Cedar Circle",
      member: "Amina",
      status: "Active",
    });
    expect(pass.posterGeneric.headerFields).toBeUndefined();
    expect(pass.posterGeneric.primaryFields).toBeUndefined();
    expect(pass.posterGeneric.secondaryFields).toBeUndefined();
    expect(pass.posterGeneric.auxiliaryFields).toBeUndefined();
    expect(pass.posterGeneric.footerFields).toBeUndefined();
    expect(pass.barcodes[0]).not.toHaveProperty("altText");
  });

  it("covers representative current-platform golden personalizations without inventing tier fields", () => {
    const cases: Array<{
      name: string;
      input: WalletMembershipInput;
      config?: typeof configuration;
    }> = [
      { name: "basic", input: baseMembership },
      {
        name: "reward-ready",
        input: { ...baseMembership, currentStampCount: 8, rewardReady: true },
      },
      { name: "zero-stamps", input: { ...baseMembership, currentStampCount: 0 } },
      { name: "transferred", input: { ...baseMembership, transferred: true } },
      { name: "paused", input: { ...baseMembership, programStatus: "PAUSED" } },
      {
        name: "arabic",
        input: {
          ...baseMembership,
          locale: "ar",
          displayName: "سارة",
          programName: "بطاقة الوفاء",
          rewardSummary: "مشروب مجاني",
        },
      },
      { name: "english", input: { ...baseMembership, displayName: "Sara" } },
      { name: "qr", input: { ...baseMembership, credentialPayload: "wfl1.exact.qr.payload" } },
      {
        name: "merchant-branding",
        input: { ...baseMembership, organizationName: "Tigris Market", backgroundColor: "#112233" },
      },
      {
        name: "merchant-pass-type",
        input: baseMembership,
        config: { ...configuration, passTypeIdentifier: "pass.app.waflo.tigris" },
      },
    ];
    for (const golden of cases) {
      const pass = mapAppleGenericPass(
        golden.input,
        golden.config ?? configuration,
        "a".repeat(43),
      );
      expect(pass.serialNumber, golden.name).toBe(golden.input.providerIdentity);
      expect(pass.barcodes[0].message, golden.name).toBe(golden.input.credentialPayload);
      expect(pass.generic, golden.name).toBeDefined();
      expect(pass.posterGeneric, golden.name).toBeDefined();
      if (golden.name === "arabic") {
        expect(allFieldValues(pass.generic)).toMatchObject({
          member: "سارة",
          program: "بطاقة الوفاء",
          reward: "مشروب مجاني",
        });
      }
    }
    expect(
      readFileSync(
        "apps/apple-pass-builder-service/templates/waflo-loyalty-v1.pkpasstemplate/ar.lproj/pass.strings",
        "utf8",
      ),
    ).toContain('"MEMBER" = "العضو"');
  });

  it("sends bounded structured personalization and correctly sized PNG assets to the private adapter", async () => {
    let requestBody: unknown;
    const artifact = Buffer.alloc(1_024, 1);
    artifact.set(Buffer.from("PK"), 0);
    const generator = new ApplePassBuilderGenerator({
      serviceUrl: "http://pass-builder.internal:8080",
      authToken: "s".repeat(43),
      signingKeyId: "waflo-default",
      signingKeyIdsByMerchant: parseAppleSigningKeyMap({
        [baseMembership.organizationId]: "merchant-cedar",
      }),
      fetchImplementation: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(artifact, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.pkpass" },
        });
      },
    });
    await expect(
      generator.generatePass({
        membership: baseMembership,
        configuration,
        authenticationToken: "a".repeat(43),
      }),
    ).resolves.toEqual(artifact);
    const parsed = parsePassBuilderRequest(requestBody);
    expect(parsed.signingKeyId).toBe("merchant-cedar");
    expect(parsed.pass.serialNumber).toBe(baseMembership.providerIdentity);
    expect(parsed.pass.barcode.message).toBe(baseMembership.credentialPayload);
    expect(parsed.pass.barcode).not.toHaveProperty("altText");
    expect(() =>
      parsePassBuilderRequest({
        ...parsed,
        pass: { ...parsed.pass, barcode: { ...parsed.pass.barcode, altText: "Scan at checkout" } },
      }),
    ).toThrow("caption");
    expect(parsed.pass.fieldValues.member).toBe("Amina");
    expect(parsed.pass.fieldValues.progress_detail).toBe("3/8");
    expect(() =>
      parsePassBuilderRequest({
        ...parsed,
        pass: { ...parsed.pass, webServiceURL: "http://api.example.test/v1/apple-wallet" },
      }),
    ).toThrow("HTTPS");
    for (const [slot, variants] of Object.entries(parsed.images)) {
      for (const [scaleName, encoded] of Object.entries(variants)) {
        const metadata = await sharp(Buffer.from(encoded, "base64")).metadata();
        const scale = scaleName === "times1" ? 1 : scaleName === "times2" ? 2 : 3;
        const sizes = {
          icon: [38, 38],
          logo: [160, 50],
          primaryLogo: [126, 30],
          artwork: [358, 448],
          strip: [375, 144],
        } as const;
        expect(metadata.width, `${slot}.${scaleName}`).toBe(
          sizes[slot as keyof typeof sizes][0] * scale,
        );
        expect(metadata.height, `${slot}.${scaleName}`).toBe(
          sizes[slot as keyof typeof sizes][1] * scale,
        );
      }
    }
  });

  it("fails closed on adapter errors and reports pinned-service health", async () => {
    const healthy = new ApplePassBuilderGenerator({
      serviceUrl: "https://pass-builder.internal",
      authToken: "s".repeat(43),
      signingKeyId: "waflo-default",
      fetchImplementation: async () =>
        Response.json({
          status: "ready",
          passBuilderRevision: adoptedApplePassBuilderRevision,
          signingKeyIds: ["waflo-default"],
        }),
    });
    await expect(healthy.healthCheck(configuration)).resolves.toEqual({ status: "READY" });

    const rejected = new ApplePassBuilderGenerator({
      serviceUrl: "https://pass-builder.internal",
      authToken: "s".repeat(43),
      signingKeyId: "waflo-default",
      fetchImplementation: async () =>
        Response.json({ error: "PASS_REQUEST_INVALID" }, { status: 422 }),
    });
    const failure = await rejected
      .generatePass({
        membership: baseMembership,
        configuration,
        authenticationToken: "a".repeat(43),
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ category: "OBJECT_INVALID" });
  });

  it("validates signing identity isolation and rejects path-shaped identifiers", () => {
    const identities = parseSigningIdentities({
      identities: [
        {
          id: "merchant-a",
          merchantIds: ["00000000-0000-4000-8000-00000000000a"],
          passTypeIdentifier: "pass.app.waflo.a",
          teamIdentifier: "TEAM-A",
          certificatePath: "/run/secrets/a-p12",
          certificatePasswordFile: "/run/secrets/a-password",
          wwdrCertificatePath: "/run/secrets/wwdr",
        },
        {
          id: "merchant-b",
          merchantIds: ["00000000-0000-4000-8000-00000000000b"],
          passTypeIdentifier: "pass.app.waflo.b",
          teamIdentifier: "TEAM-B",
          certificatePath: "/run/secrets/b-p12",
          certificatePasswordFile: "/run/secrets/b-password",
          wwdrCertificatePath: "/run/secrets/wwdr",
        },
      ],
    });
    expect(identities.get("merchant-a")?.passTypeIdentifier).toBe("pass.app.waflo.a");
    expect(identities.get("merchant-b")?.teamIdentifier).toBe("TEAM-B");
    expect(() =>
      parseSigningIdentities({
        identities: [
          {
            id: "../merchant-a",
            merchantIds: ["*"],
            passTypeIdentifier: "pass.app.waflo.a",
            teamIdentifier: "TEAM-A",
            certificatePath: "/run/secrets/a",
            certificatePasswordFile: "/run/secrets/b",
            wwdrCertificatePath: "/run/secrets/c",
          },
        ],
      }),
    ).toThrow();
    expect(() => parseAppleSigningKeyMap({ "../merchant": "merchant-a" })).toThrow();
    expect(
      () =>
        new ApplePassBuilderGenerator({
          serviceUrl: "https://pass-builder.internal",
          authToken: "+".repeat(43),
          signingKeyId: "waflo-default",
        }),
    ).toThrow("auth token");
  });

  it("pins official source and uses safe subprocess and secret-file boundaries", () => {
    const dockerfile = readFileSync("apps/apple-pass-builder-service/Dockerfile", "utf8");
    const subprocess = readFileSync("apps/apple-pass-builder-service/src/subprocess.ts", "utf8");
    const service = readFileSync("apps/apple-pass-builder-service/src/builder.ts", "utf8");
    expect(dockerfile).toContain(adoptedApplePassBuilderRevision);
    expect(dockerfile).not.toMatch(/pass-builder\.git[^\n]*(main|master)/);
    expect(subprocess).toContain("execFile");
    expect(subprocess).not.toContain("shell:");
    expect(service).toContain("certificatePasswordFile");
    expect(service).toContain("mkdtemp");
    expect(service).toContain("rm(workDirectory");
  });
});

import { unzipSync } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildApplePassPackage,
  mapAppleStoreCard,
  mapAppleStoreCardPosterPass,
  mapLegacyApplePresentation,
  TestApplePassSigner,
} from "../../packages/wallet-apple/src/index.js";
import type { WalletMembershipInput } from "../../packages/wallet-core/src/index.js";
import { mapGoogleLoyaltyObject } from "../../packages/wallet-google/src/index.js";

const configuration = {
  passTypeIdentifier: "pass.app.waflo",
  teamIdentifier: "WAFLOTEAM",
  organizationName: "Waflo",
  webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
};

const membership = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Cedar Coffee",
  programId: "00000000-0000-4000-8000-000000000002",
  programVersionId: "00000000-0000-4000-8000-000000000003",
  programName: "Cedar Circle",
  description: "A bilingual coffee loyalty membership.",
  rewardSummary: "A complimentary drink after eight stamps.",
  backgroundColor: "#F7F4EE",
  foregroundColor: "#241916",
  configurationFingerprint: "legacy-apple-presentation",
  locale: "en",
  walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
  providerIdentity: "waflo.00000000000040008000000000000004",
  publicMembershipId: "member_m8PNYl1aSr9bT0V4w89d3H2g",
  displayName: "Amina",
  credentialPayload: "wfl1.opaque.credential",
  currentStampCount: 5,
  requiredStampCount: 8,
  rewardReady: false,
  membershipStatus: "ACTIVE",
  programStatus: "PUBLISHED",
  transferred: false,
  stampRenderInput: {
    assetDigests: { filled: "filled-digest", empty: "empty-digest" },
    currentStampCount: 5,
  },
} as WalletMembershipInput;

function frontFields(style: {
  headerFields?: readonly { key: string; value: string | number }[];
  primaryFields?: readonly { key: string; value: string | number }[];
  secondaryFields?: readonly { key: string; value: string | number }[];
  auxiliaryFields?: readonly { key: string; value: string | number }[];
}) {
  return [
    ...(style.headerFields ?? []),
    ...(style.primaryFields ?? []),
    ...(style.secondaryFields ?? []),
    ...(style.auxiliaryFields ?? []),
  ];
}

function decodePassStrings(bytes: Uint8Array | undefined): string {
  const content = Buffer.from(bytes ?? []);
  return content.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
    ? content.subarray(2).toString("utf16le")
    : content.toString("utf8");
}

describe("legacy Apple Wallet presentation", () => {
  it("keeps the native Store Card and Poster Generic package for Apple OS fallback selection", () => {
    const pass = mapAppleStoreCardPosterPass(membership, configuration, "a".repeat(43));
    expect(pass.storeCard).toBeDefined();
    expect(pass.posterGeneric).toBeDefined();
    expect(pass.posterGeneric.headerFields).toBeUndefined();
    expect(pass.posterGeneric.primaryFields).toBeUndefined();
    expect(pass.posterGeneric.secondaryFields).toBeUndefined();
    expect(pass.posterGeneric.auxiliaryFields).toBeUndefined();
  });

  it("uses the corrected hierarchy for the standalone legacy Store Card generator", () => {
    const pass = mapAppleStoreCard(membership, configuration, "a".repeat(43));
    expect(pass.storeCard.headerFields[0]).toMatchObject({ key: "progress", value: "5/8" });
    expect(pass.storeCard.primaryFields).toEqual([]);
    expect(pass.storeCard.secondaryFields[0]).toMatchObject({
      key: "reward",
      label: "REWARD",
      value: membership.rewardSummary,
    });
    expect(pass.storeCard.auxiliaryFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "member", value: membership.displayName }),
        expect.objectContaining({ key: "status", value: "Active" }),
      ]),
    );
  });

  it("puts reward in the native legacy secondary tier", () => {
    const presentation = mapLegacyApplePresentation(membership);
    expect(presentation.primaryFields).toEqual([]);
    expect(presentation.secondaryFields).toContainEqual(
      expect.objectContaining({ key: "reward", value: membership.rewardSummary }),
    );
    expect(frontFields(presentation).map((field) => field.value)).toContain(
      membership.rewardSummary,
    );
  });

  it("puts stamp progress immediately on the legacy front header tier", () => {
    const presentation = mapLegacyApplePresentation(membership);
    expect(presentation.headerFields).toContainEqual(
      expect.objectContaining({ key: "progress", label: "STAMPS", value: "5/8" }),
    );
  });

  it("keeps member and status in the legacy front-native auxiliary tier", () => {
    const presentation = mapLegacyApplePresentation(membership);
    expect(presentation.secondaryFields).toEqual([
      expect.objectContaining({ key: "reward", value: membership.rewardSummary }),
    ]);
    expect(presentation.auxiliaryFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "member", value: membership.displayName }),
        expect.objectContaining({ key: "status", value: "Active" }),
      ]),
    );
    expect(presentation.backFields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "member" }),
        expect.objectContaining({ key: "status" }),
      ]),
    );
    expect(presentation.backFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "program", value: membership.programName }),
      ]),
    );
  });

  it("serializes the expected current/required stamp count", () => {
    const pass = mapAppleStoreCardPosterPass(membership, configuration, "a".repeat(43));
    expect(pass.storeCard.headerFields?.[0]?.value).toBe("5/8");
  });

  it("does not leave reward exclusively in backFields", () => {
    const pass = mapAppleStoreCardPosterPass(membership, configuration, "a".repeat(43));
    expect(pass.storeCard.primaryFields).toEqual([]);
    expect(pass.storeCard.secondaryFields).toContainEqual(
      expect.objectContaining({ key: "reward" }),
    );
    expect(pass.storeCard.backFields).not.toContainEqual(
      expect.objectContaining({ key: "reward" }),
    );
  });

  it("does not leave progress exclusively in backFields", () => {
    const pass = mapAppleStoreCardPosterPass(membership, configuration, "a".repeat(43));
    expect(pass.storeCard.headerFields).toContainEqual(
      expect.objectContaining({ key: "progress" }),
    );
    expect(pass.storeCard.backFields).not.toContainEqual(
      expect.objectContaining({ key: "progress" }),
    );
  });

  it("keeps merchant identity in logoText without duplicating it as a field", () => {
    const pass = mapAppleStoreCardPosterPass(membership, configuration, "a".repeat(43));
    expect(pass.logoText).toBe("Cedar Coffee");
    expect(frontFields(pass.storeCard).map((field) => field.value)).not.toContain("Cedar Coffee");
    expect(new Set(frontFields(pass.storeCard).map((field) => field.key)).size).toBe(
      frontFields(pass.storeCard).length,
    );
  });

  it("preserves the QR message and format exactly", () => {
    const pass = mapAppleStoreCardPosterPass(membership, configuration, "a".repeat(43));
    expect(pass.barcodes).toEqual([
      {
        format: "PKBarcodeFormatQR",
        message: membership.credentialPayload,
        messageEncoding: "iso-8859-1",
      },
    ]);
  });

  it("preserves serial and authentication/update identity semantics", () => {
    const token = "a".repeat(43);
    const legacy = mapAppleStoreCard(membership, configuration, token);
    const storeCardPoster = mapAppleStoreCardPosterPass(membership, configuration, token);
    expect(storeCardPoster.serialNumber).toBe(legacy.serialNumber);
    expect(storeCardPoster.passTypeIdentifier).toBe(legacy.passTypeIdentifier);
    expect(storeCardPoster.teamIdentifier).toBe(legacy.teamIdentifier);
    expect(storeCardPoster.webServiceURL).toBe(legacy.webServiceURL);
    expect(storeCardPoster.authenticationToken).toBe(legacy.authenticationToken);
  });

  it("does not mutate persisted historical stamp input or its asset mapping", () => {
    const historical = {
      ...membership,
      stampRenderInput: {
        assetDigests: { filled: "filled-digest", empty: "empty-digest" },
        currentStampCount: membership.currentStampCount,
      },
    } as WalletMembershipInput;
    const before = JSON.stringify(historical);
    mapAppleStoreCardPosterPass(historical, configuration, "a".repeat(43));
    mapAppleStoreCard(historical, configuration, "a".repeat(43));
    expect(JSON.stringify(historical)).toBe(before);
  });

  it("keeps the Poster Generic detail contract unchanged", () => {
    const pass = mapAppleStoreCardPosterPass(membership, configuration, "a".repeat(43));
    expect(pass.posterGeneric.backFields).toEqual([
      { key: "program", label: "PROGRAM", value: membership.programName },
      { key: "member", label: "MEMBER", value: membership.displayName },
      { key: "status", label: "STATUS", value: "Active", changeMessage: "%@" },
      { key: "progress_detail", label: "STAMPS", value: "5/8" },
      { key: "reward", label: "REWARD", value: membership.rewardSummary },
      {
        key: "security",
        label: "SECURITY",
        value:
          "This QR is an opaque, revocable Waflo membership credential. Do not share screenshots.",
      },
      { key: "operator", label: "WAFLO", value: "Waflo is owned and operated by Tavrix LLC." },
    ]);
  });

  it("keeps Google Wallet payload semantics independent of legacy Apple fields", () => {
    const google = mapGoogleLoyaltyObject(membership, "issuer.object", "issuer.class");
    expect(google.loyaltyPoints).toBeUndefined();
    expect(google.barcode).toEqual({ type: "QR_CODE", value: membership.credentialPayload });
    expect(google.textModulesData).toContainEqual(
      expect.objectContaining({ id: "reward", body: membership.rewardSummary }),
    );
  });

  it("uses a compact mark-only logo for all standalone legacy resolutions", async () => {
    const pass = mapAppleStoreCard(membership, configuration, "a".repeat(43));
    const artifact = await buildApplePassPackage({ pass, signer: new TestApplePassSigner() });
    const files = unzipSync(artifact);
    for (const [name, size] of [
      ["logo.png", 38],
      ["logo@2x.png", 76],
      ["logo@3x.png", 114],
    ] as const) {
      const metadata = await sharp(files[name]).metadata();
      expect(metadata.width, name).toBe(size);
      expect(metadata.height, name).toBe(size);
    }
    expect(files).not.toHaveProperty("thumbnail.png");
    expect(files).not.toHaveProperty("thumbnail@2x.png");
    expect(files).not.toHaveProperty("thumbnail@3x.png");
  });

  it("localizes newly front-facing legacy labels", async () => {
    const pass = mapAppleStoreCard(membership, configuration, "a".repeat(43));
    const artifact = await buildApplePassPackage({ pass, signer: new TestApplePassSigner() });
    const files = unzipSync(artifact);
    const english = decodePassStrings(files["en.lproj/pass.strings"]);
    const arabic = decodePassStrings(files["ar.lproj/pass.strings"]);
    expect(english).toContain('"PROGRAM" = "PROGRAM"');
    expect(english).toContain('"REWARD" = "REWARD"');
    expect(arabic).toContain('"PROGRAM" = "\u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c"');
    expect(arabic).toContain('"REWARD" = "\u0627\u0644\u0645\u0643\u0627\u0641\u0623\u0629"');
  });

  it("keeps Pass Builder Store Card and standalone Store Card fields aligned", () => {
    const storeCardPoster = mapAppleStoreCardPosterPass(membership, configuration, "a".repeat(43));
    const legacy = mapAppleStoreCard(membership, configuration, "a".repeat(43));
    expect(storeCardPoster.storeCard).toEqual(legacy.storeCard);
  });
});

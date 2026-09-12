import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  cardLocalePresentation,
  walletStructuralCopyForLocale,
} from "../../packages/contracts/src/index.js";
import {
  buildApplePassPackage,
  mapAppleStoreCard,
  TestApplePassSigner,
} from "../../packages/wallet-apple/src/index.js";
import type {
  WalletMembershipInput,
  WalletProgramInput,
} from "../../packages/wallet-core/src/index.js";
import { mapGoogleLoyaltyClass } from "../../packages/wallet-google/src/index.js";
import { programTemplateCatalog } from "../../packages/contracts/src/program-template-catalog.js";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import { renderTemplateGalleryPreview } from "../../apps/api/src/programs/template-gallery-preview.js";

const appleConfiguration = {
  passTypeIdentifier: "pass.app.waflo",
  teamIdentifier: "WAFLOTEAM",
  organizationName: "Waflo",
  webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
};

function membership(locale: string): WalletMembershipInput {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    organizationName:
      locale === "ckb" ? "کافێ گەلەری" : locale === "ar" ? "حلويات اليوم" : "Gallery Coffee",
    programId: "00000000-0000-4000-8000-000000000002",
    programVersionId: "00000000-0000-4000-8000-000000000003",
    programName:
      locale === "ckb" ? "کارتێکی وەفاداری" : locale === "ar" ? "Waflo حلويات" : "Gallery Coffee",
    description: "Wallet membership",
    rewardSummary:
      locale === "ckb"
        ? "خەڵاتی بەخۆڕایی 6"
        : locale === "ar"
          ? "مكافأة مجانية 6"
          : "Complimentary reward",
    backgroundColor: "#F7F4EE",
    foregroundColor: "#241916",
    configurationFingerprint: "a".repeat(64),
    locale,
    walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
    providerIdentity: "waflo.00000000000040008000000000000004",
    publicMembershipId: "member_m8PNYl1aSr9bT0V4w89d3H2g",
    displayName: "Amina",
    credentialPayload: "wfl1.opaque.credential",
    currentStampCount: 6,
    requiredStampCount: 8,
    rewardReady: false,
    membershipStatus: "ACTIVE",
    programStatus: "PUBLISHED",
    transferred: false,
    stampRenderInput: { assetDigests: { filled: "filled-digest", empty: "empty-digest" } },
  } as WalletMembershipInput;
}

function decodePassStrings(value: Uint8Array | undefined): string {
  const bytes = Buffer.from(value ?? []);
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
  return bytes.subarray(2).toString("utf16le");
}

describe("Wallet RTL localization matrix", () => {
  it("uses the canonical locale presentation for Arabic-script locales", () => {
    expect(cardLocalePresentation("ar")).toMatchObject({
      locale: "ar",
      direction: "rtl",
      script: "Arab",
    });
    expect(cardLocalePresentation("ckb")).toMatchObject({
      locale: "ckb",
      direction: "rtl",
      script: "Arab",
    });
    expect(cardLocalePresentation("en")).toMatchObject({ locale: "en", direction: "ltr" });
    expect(walletStructuralCopyForLocale("ckb").stamps).toBe("مۆر");
  });

  it("writes UTF-16 Apple localization folders and stable pass.strings keys for en, ar, and ckb", async () => {
    const pass = mapAppleStoreCard(membership("en"), appleConfiguration, "a".repeat(43));
    const artifact = await buildApplePassPackage({
      pass,
      signer: new TestApplePassSigner(),
      defaultLocale: "en",
      localizations: [
        {
          locale: "en",
          programName: "Gallery Coffee",
          description: "Wallet membership",
          rewardSummary: "Complimentary reward",
        },
        {
          locale: "ar",
          programName: "Waflo حلويات",
          description: "عضوية المحفظة",
          rewardSummary: "مكافأة مجانية",
        },
        {
          locale: "ckb",
          programName: "کافێ گەلەری",
          description: "ئەندامێتی جزدان",
          rewardSummary: "خەڵاتی بەخۆڕایی",
        },
      ],
    });
    const files = unzipSync(artifact);
    const passJson = JSON.parse(Buffer.from(files["pass.json"] ?? []).toString("utf8"));
    expect(passJson.description).toBe("__WAFLO_DESCRIPTION__");
    expect(passJson.storeCard.secondaryFields[0].value).toBe("__WAFLO_REWARD__");
    expect(decodePassStrings(files["ar.lproj/pass.strings"])).toContain("المكافأة");
    const ckb = decodePassStrings(files["ckb.lproj/pass.strings"]);
    expect(ckb).toContain("کافێ گەلەری");
    expect(ckb).toContain("مۆر");
    expect(ckb).toContain("__WAFLO_PROGRAM__");
  });

  it("sends translated BCP-47 values to Google for every configured locale", () => {
    const mapped = mapGoogleLoyaltyClass(
      {
        organizationName: "Gallery Coffee",
        programName: "Gallery Coffee",
        description: "Wallet membership",
        rewardSummary: "Complimentary reward",
        backgroundColor: "#F7F4EE",
        locale: "en",
        defaultLocale: "en",
        localizedContent: [
          {
            locale: "en",
            programName: "Gallery Coffee",
            description: "Wallet membership",
            rewardSummary: "Complimentary reward",
          },
          {
            locale: "ar",
            programName: "Waflo حلويات",
            description: "عضوية",
            rewardSummary: "مكافأة مجانية",
          },
          {
            locale: "ckb",
            programName: "کافێ گەلەری",
            description: "ئەندامێتی",
            rewardSummary: "خەڵاتی بەخۆڕایی",
          },
        ],
      } as WalletProgramInput,
      "issuer.gallery",
    );
    expect(mapped.localizedProgramName.defaultValue).toEqual({
      language: "en",
      value: "Gallery Coffee",
    });
    expect(mapped.localizedProgramName.translatedValues).toEqual(
      expect.arrayContaining([
        { language: "ar", value: "Waflo حلويات" },
        { language: "ckb", value: "کافێ گەلەری" },
      ]),
    );
    expect(mapped.localizedIssuerName.translatedValues).toEqual(
      expect.arrayContaining([{ language: "ckb", value: "Gallery Coffee" }]),
    );
  });

  it("covers Arabic, Kurdish Sorani, and English across customer, Apple Legacy, and Google previews", async () => {
    const template = programTemplateCatalog[0];
    if (!template) throw new Error("Wallet template fixture is missing.");
    for (const locale of ["en", "ar", "ckb"]) {
      for (const profile of ["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const) {
        const preview = await renderTemplateGalleryPreview(template, profile, locale, "BLANK");
        expect(preview.svg, `${locale}:${profile}`).toContain(`lang="${locale}"`);
        expect(preview.svg, `${locale}:${profile}`).toContain(
          `direction="${cardLocalePresentation(locale).direction}"`,
        );
        if (profile !== "CUSTOMER_WEB") {
          expect(preview.svg, `${locale}:${profile}`).toContain('unicode-bidi="plaintext"');
          expect(preview.svg, `${locale}:${profile}`).not.toMatch(/[ÃÂØÙ]/u);
        }
      }
    }
  }, 30_000);

  it("uses the same logical Poster identity flow for English, Arabic, and Kurdish Sorani", () => {
    const artwork = {
      target: "APPLE_POSTER" as const,
      dataUri:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+uKi2AAAAAElFTkSuQmCC",
      width: 358,
      height: 448,
    };
    for (const locale of ["en", "ar", "ckb"]) {
      const preview = composeProgramPreview({
        profile: "APPLE_WALLET",
        appleWalletVariant: "POSTER",
        locale,
        organizationName: locale === "en" ? "Gallery Coffee" : "کافێ گەلەری",
        programName: "Waflo حلويات",
        shortDescription: "Membership",
        rewardSummary: "مكافأة مجانية / Complimentary reward",
        terms: "Terms",
        progress: 6,
        goal: 8,
        stampSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        backgroundColor: "#F7F4EE",
        foregroundColor: "#241916",
        accentColor: "#E4572E",
        secondaryColor: "#DACFC3",
        walletArtwork: artwork,
        customerWebVariant: "CARD",
        apple: {
          headerLabel: "STAMPS",
          headerValue: "6/8",
          secondaryLabel: "REWARD",
          barcodeLabel: "QR",
          showBackContent: true,
        },
        google: {
          title: "Gallery Coffee",
          subtitle: "Membership",
          detailsLabel: "STAMPS",
          barcodeLabel: "QR",
        },
      });
      expect(preview.svg).toContain(`lang="${locale}"`);
      expect(preview.svg).toContain(`direction="${cardLocalePresentation(locale).direction}"`);
      expect(preview.svg).toContain('unicode-bidi="plaintext"');
      // `start` is the logical identity edge for either direction. The
      // physical coordinate changes; the anchor must not be post-processed.
      expect(preview.svg).toContain('text-anchor="start"');
    }
  });

  it("keeps Wallet implementation source free from common mojibake sequences", () => {
    const sources = [
      "apps/api/src/programs/preview-composer.ts",
      "apps/api/src/programs/template-gallery-preview.ts",
      "apps/api/src/programs/wallet-preview-artwork.ts",
      "apps/wallet-worker/src/main.ts",
      "packages/wallet-artwork/src/index.ts",
      "packages/wallet-apple/src/index.ts",
      "packages/wallet-apple/src/pass-builder.ts",
      "packages/wallet-google/src/index.ts",
      "packages/wallet-core/src/index.ts",
      "packages/stamp-engine/src/index.ts",
      "packages/contracts/src/card-locales.ts",
      "apps/apple-pass-builder-service/src/builder.ts",
    ];
    for (const source of sources) {
      expect(readFileSync(source, "utf8"), source).not.toMatch(
        /(?:\u00c3.|\u00c2.|\u00d8.|\u00d9.|\u00e2[\u0080-\u00ff\u20ac\u2018-\u201f])/u,
      );
    }
  });
});

import { describe, expect, it } from "vitest";
import { artworkFor } from "../../apps/api/src/programs/library-artwork.js";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import {
  findProgramTemplate,
  latestProgramTemplates,
  resolveProgramTemplatePresentation,
} from "../../packages/contracts/src/index.js";
import { renderStampSvg } from "../../packages/stamp-engine/src/index.js";
import { mapAppleStoreCard } from "../../packages/wallet-apple/src/index.js";
import type { WalletMembershipInput } from "../../packages/wallet-core/src/index.js";
import {
  mapGoogleLoyaltyClass,
  mapGoogleLoyaltyObject,
} from "../../packages/wallet-google/src/index.js";

const goal = 8;
const organizationName = "Gallery Coffee";
const programName = "Classic Roast";
const rewardSummary = "Free house coffee";

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is required by this test.`);
  return value;
}

function preview(
  profile: "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET",
  progress: number,
  locale = "en",
  branding?: {
    logoDataUri?: string;
    merchantBrandLogoDataUri?: string;
  },
) {
  const template = required(findProgramTemplate("COFFEE"), "Classic Roast template");
  const filled = required(artworkFor(template.artwork.filled), "filled coffee artwork");
  const empty = required(artworkFor(template.artwork.empty), "empty coffee artwork");
  const rewardReady = progress >= goal;
  const stamp = renderStampSvg({
    goal,
    progress,
    layout: template.layout.type,
    layoutConfiguration: template.layout.configuration,
    outputProfile: profile,
    filledColor: template.colors.accent,
    emptyColor: profile === "CUSTOMER_WEB" ? template.colors.background : template.colors.secondary,
    accentColor: profile === "CUSTOMER_WEB" ? template.colors.foreground : template.colors.accent,
    backgroundColor: template.colors.background,
    foregroundColor: template.colors.foreground,
    stampSize: template.layout.stampSize,
    spacing: template.layout.stampSpacing,
    filledArtwork: { kind: "svg", content: filled.content, trusted: true },
    emptyArtwork: { kind: "svg", content: empty.content, trusted: true },
    label: `${progress}/${goal}`,
    rewardLabel:
      profile === "CUSTOMER_WEB" && rewardReady ? `Reward ready: ${rewardSummary}` : rewardSummary,
    locale,
    rewardReady,
    progressLabelVisible: profile === "CUSTOMER_WEB",
    rewardLabelVisible: true,
  });
  return composeProgramPreview({
    profile,
    locale,
    organizationName,
    programName,
    shortDescription: "A warm reward for regular coffee visits.",
    rewardSummary,
    terms: "One stamp per qualifying purchase.",
    progress,
    goal,
    stampSvg: stamp.svg,
    stampLayout: template.layout.type,
    backgroundColor: template.colors.background,
    foregroundColor: template.colors.foreground,
    accentColor: template.colors.accent,
    secondaryColor: template.colors.secondary,
    ...branding,
    identityDataUri: `data:image/svg+xml;base64,${Buffer.from(filled.content).toString("base64")}`,
    customerWebVariant: template.customerWeb.variant,
    ...(template.presentation ? { presentation: template.presentation } : {}),
    apple: template.apple,
    google: template.google,
  });
}

function embeddedStampSvg(svg: string): string {
  for (const match of svg.matchAll(/data:image\/svg\+xml;base64,([^"']+)/gu)) {
    const decoded = Buffer.from(match[1] ?? "", "base64").toString("utf8");
    if (decoded.includes("data-visual-state=")) return decoded;
  }
  throw new Error("Preview did not embed the shared stamp renderer output.");
}

function stateCount(svg: string, state: "FILLED" | "EMPTY"): number {
  return (svg.match(new RegExp(`data-visual-state="${state}"`, "gu")) ?? []).length;
}

function providerInput(progress: number): WalletMembershipInput {
  return {
    organizationId: "organization",
    organizationName,
    programId: "program",
    programVersionId: "version",
    programName,
    description: "A warm reward for regular coffee visits.",
    rewardSummary,
    backgroundColor: "#F5E5D2",
    foregroundColor: "#2A1710",
    configurationFingerprint: "fingerprint",
    locale: "en",
    walletPassInstanceId: "wallet-pass",
    providerIdentity: "provider-identity",
    publicMembershipId: "MEMBERSHIP-123456789012",
    displayName: "Demo customer",
    credentialPayload: "opaque-test-credential",
    currentStampCount: progress,
    requiredStampCount: goal,
    rewardReady: progress >= goal,
    membershipStatus: "ACTIVE",
    programStatus: "PUBLISHED",
    transferred: false,
    stampRenderInput: {} as WalletMembershipInput["stampRenderInput"],
  };
}

describe("P3 Builder preview fidelity", () => {
  it.each(latestProgramTemplates())(
    "keeps $code customer rendering on its published composition and color contract",
    (template) => {
      const filled = required(artworkFor(template.artwork.filled), `${template.code} filled art`);
      const empty = required(artworkFor(template.artwork.empty), `${template.code} empty art`);
      const stamp = renderStampSvg({
        goal: template.recommendedStampGoal,
        progress: 0,
        layout: template.layout.type,
        layoutConfiguration: template.layout.configuration,
        outputProfile: "CUSTOMER_WEB",
        filledColor: template.colors.accent,
        emptyColor: template.colors.background,
        accentColor: template.colors.foreground,
        backgroundColor: template.colors.background,
        foregroundColor: template.colors.foreground,
        stampSize: template.layout.stampSize,
        spacing: template.layout.stampSpacing,
        filledArtwork: { kind: "svg", content: filled.content, trusted: true },
        emptyArtwork: { kind: "svg", content: empty.content, trusted: true },
      });
      const presentation = resolveProgramTemplatePresentation(template.code, template.version);
      const composition = composeProgramPreview({
        profile: "CUSTOMER_WEB",
        locale: "en",
        organizationName,
        programName: template.copy.en.programName,
        shortDescription: template.copy.en.shortDescription,
        rewardSummary: template.copy.en.rewardSummary,
        terms: template.copy.en.termsAndConditions,
        progress: 0,
        goal: template.recommendedStampGoal,
        stampSvg: stamp.svg,
        stampLayout: template.layout.type,
        backgroundColor: template.colors.background,
        foregroundColor: template.colors.foreground,
        accentColor: template.colors.accent,
        secondaryColor: template.colors.secondary,
        identityDataUri: `data:image/svg+xml;base64,${Buffer.from(filled.content).toString("base64")}`,
        customerWebVariant: template.customerWeb.variant,
        presentation,
        apple: template.apple,
        google: template.google,
      });

      expect(composition.svg).toContain(`data-composition="${presentation.composition}"`);
      expect(composition.svg).toContain(`data-density="${presentation.density}"`);
      expect(composition.svg).toContain(`fill="${template.colors.background}"`);
      expect(composition.svg).toContain(`fill="${template.colors.foreground}"`);
      expect(composition.svg).toContain('data-preview-block="stamps"');
      expect(composition.svg).toContain('data-preview-block="reward"');
    },
  );

  it.each([
    ["ar", true],
    ["ckb", true],
    ["ku-Arab-IQ", true],
    ["ja", false],
  ] as const)(
    "keeps the %s script-aware font stack valid inside SVG attributes",
    (locale, hasQuotedFamily) => {
      const localized = preview("CUSTOMER_WEB", 0, locale);

      expect(localized.svg).not.toMatch(/font-family="[^"]*"Noto/u);
      expect(localized.svg.includes("&quot;")).toBe(hasQuotedFamily);
    },
  );

  it.each([0, 4, 8])(
    "renders exactly two stamp states at %i/8 on every Builder surface",
    (progress) => {
      for (const profile of ["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const) {
        const composition = preview(profile, progress);
        const stamp = embeddedStampSvg(composition.svg);
        expect(stateCount(stamp, "FILLED"), profile).toBe(progress);
        expect(stateCount(stamp, "EMPTY"), profile).toBe(goal - progress);
        expect(stamp).not.toMatch(/MILESTONE|GIFT|CHECK|REWARD_SLOT|NUMBERED/iu);
        expect(stamp).toContain(`data-reward-ready="${progress === goal}"`);
        expect(composition.svg).not.toMatch(
          />\s*(?:CUSTOMER_WEB|APPLE_WALLET|GOOGLE_WALLET|ProgramVersion|Draft revision)\s*</u,
        );
      }
    },
  );

  it.each([
    ["en", "ltr"],
    ["ar", "rtl"],
    ["ckb", "rtl"],
    ["ku-Arab-IQ", "rtl"],
  ])(
    "keeps the %s Google card free of numeric and customer identity fields",
    (locale, direction) => {
      const composition = preview("GOOGLE_WALLET", 0, locale);
      expect(composition.svg).not.toContain('data-stamp-counter="true"');
      expect(composition.svg).not.toContain('data-google-core-field="points"');
      expect(composition.svg).not.toContain("Demo customer");
      expect(composition.svg).not.toContain("عميل تجريبي");
      expect(composition.svg).toContain(`direction="${direction}"`);
      if (locale === "ckb" || locale === "ku-Arab-IQ") {
        expect(composition.svg).not.toContain("للمعاينة فقط");
      }
    },
  );

  it("uses only Google-supported background control and provider-managed chrome", () => {
    const composition = preview("GOOGLE_WALLET", 4);
    expect(composition.svg).toContain('data-card-surface-color="#FFF8EE"');
    expect(composition.svg).toContain('data-provider-managed-layout="true"');
    expect(composition.svg).toContain('data-provider-managed-text-color="true"');
    expect(composition.svg).toContain('data-google-hero-aspect="1032:812"');
    expect(composition.svg).toContain(
      'data-google-card-surface="true" x="24" y="40" width="412" height="716"',
    );
    expect(composition.svg).toContain(
      'data-google-hero-region="true" data-google-hero-artwork-composition="stamps-only"',
    );
    expect(composition.svg).toContain('x="44" y="366" width="372" height="293"');
    expect(composition.svg).toContain('data-google-reward-row="true"');
    expect(embeddedStampSvg(composition.svg)).not.toContain('data-integrated-reward="true"');
    expect(embeddedStampSvg(composition.svg)).not.toContain(rewardSummary);
    expect(composition.svg).toContain(rewardSummary);
    const qrRegion = composition.svg.indexOf('data-google-barcode-region="provider-managed"');
    const hero = composition.svg.indexOf('data-google-hero-region="true"');
    const supportingFields = composition.svg.indexOf('data-google-below-fold-fields="true"');
    expect(qrRegion).toBeGreaterThan(-1);
    expect(qrRegion).toBeLessThan(hero);
    expect(hero).toBeLessThan(supportingFields);
    const providerChrome = composition.svg.replace(
      /data:image\/svg\+xml;base64,[^"']+/gu,
      "embedded-stamp-artwork",
    );
    expect(providerChrome).not.toContain('fill="#2A1710"');
    expect(providerChrome).not.toContain('fill="#C74424"');
  });

  it("keeps Apple front fields minimal and identifies its provider-managed back fields", () => {
    const composition = preview("APPLE_WALLET", 4);
    expect(composition.svg).toContain('data-apple-front-surface="true"');
    expect(composition.svg).toContain('data-apple-back-fields="true"');
    expect(composition.svg).toContain('data-apple-strip-aspect="375:144"');
    expect(composition.svg).toContain('data-apple-field-role="primary"');
    expect(embeddedStampSvg(composition.svg)).not.toContain('data-integrated-reward="true"');
    expect(embeddedStampSvg(composition.svg)).not.toContain(rewardSummary);
    expect(composition.svg).toContain(rewardSummary);
    expect(composition.svg.indexOf('data-apple-front-surface="true"')).toBeLessThan(
      composition.svg.indexOf('data-apple-back-fields="true"'),
    );
  });

  it.each(["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const)(
    "uses the program logo ahead of the organization fallback in the %s preview",
    (profile) => {
      const programLogo = `data:image/svg+xml;base64,${Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><title>program-logo</title></svg>',
      ).toString("base64")}`;
      const organizationLogo = `data:image/svg+xml;base64,${Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><title>organization-logo</title></svg>',
      ).toString("base64")}`;
      const programComposition = preview(profile, 4, "en", {
        logoDataUri: programLogo,
        merchantBrandLogoDataUri: organizationLogo,
      });
      const fallbackComposition = preview(profile, 4, "en", {
        merchantBrandLogoDataUri: organizationLogo,
      });

      expect(programComposition.svg).toContain('data-issuer-brand="program"');
      expect(programComposition.svg).toContain(programLogo);
      expect(programComposition.svg).not.toContain(organizationLogo);
      expect(fallbackComposition.svg).toContain('data-issuer-brand="organization"');
      expect(fallbackComposition.svg).toContain(organizationLogo);
    },
  );

  it.each(["APPLE_WALLET", "GOOGLE_WALLET"] as const)(
    "keeps the Arabic %s preview RTL with provider barcode metadata",
    (profile) => {
      const composition = preview(profile, 8, "ar");
      expect(composition.svg).toContain('direction="rtl"');
      expect(composition.svg).toContain(
        `data-barcode-format="${profile === "APPLE_WALLET" ? "QR" : "QR_CODE"}"`,
      );
      expect(composition.svg).toContain("المكافأة جاهزة");
    },
  );

  it("retains the selected template composition and keeps readiness outside the grid", () => {
    const customer = preview("CUSTOMER_WEB", 8);
    const stamp = embeddedStampSvg(customer.svg);
    expect(customer.svg).toContain('data-composition="SPLIT_HERO"');
    expect(customer.svg).toContain('data-preview-block="motif"');
    expect(customer.svg).toContain('data-preview-block="reward"');
    expect(stamp).toContain("Reward ready: Free house coffee");
    expect(stateCount(stamp, "FILLED")).toBe(goal);
  });

  it.each([0, 4, 8])(
    "maps Apple preview content to the generated store-card payload at %i/8",
    (progress) => {
      const input = providerInput(progress);
      const pass = mapAppleStoreCard(
        input,
        {
          passTypeIdentifier: "pass.com.waflo.test",
          teamIdentifier: "TEAM",
          organizationName: "Waflo",
          webServiceUrl: "https://wallet.example.test/apple",
        },
        "authentication-token",
      );
      const composition = preview("APPLE_WALLET", progress);
      const program = required(pass.storeCard.secondaryFields[0], "Apple program field");
      const status = required(
        pass.storeCard.auxiliaryFields.find((field) => field.key === "status"),
        "Apple status front field",
      );
      const reward = required(
        pass.storeCard.primaryFields.find((field) => field.key === "reward"),
        "Apple reward front field",
      );

      expect(pass.storeCard.headerFields).toContainEqual(
        expect.objectContaining({ key: "progress", value: `${progress}/${goal}` }),
      );
      expect(pass.storeCard.primaryFields).toContainEqual(
        expect.objectContaining({ key: "reward", value: input.rewardSummary }),
      );
      expect(pass.storeCard.auxiliaryFields).toContainEqual(
        expect.objectContaining({ key: "member", value: input.displayName }),
      );
      expect(pass.storeCard.backFields.some((field) => field.key === "member")).toBe(false);
      expect(composition.svg).toContain(String(program.value));
      expect(composition.svg).toContain(String(status.label));
      expect(composition.svg).toContain(String(status.value));
      expect(composition.svg).toContain(String(reward.value));
      expect(composition.svg).not.toContain(input.displayName);
      expect(composition.svg).not.toContain(`${progress}/${goal}`);
      expect(composition.svg).toContain('data-barcode-format="QR"');
      expect(composition.svg).not.toContain("data-barcode-fallback");
      expect(composition.svg).toContain('data-apple-strip-safe-area="true"');
      expect(composition.svg).toContain('data-apple-field-role="primary"');
      expect(composition.svg).toContain('data-apple-field-role="secondary"');
      expect(composition.svg).not.toMatch(/wallet-role|wallet-motif|hero-field/u);
    },
  );

  it.each([0, 4, 8])(
    "maps Google preview content to generated loyalty class/object modules at %i/8",
    (progress) => {
      const input = providerInput(progress);
      const loyaltyClass = mapGoogleLoyaltyClass(input, "issuer.class");
      const loyaltyObject = mapGoogleLoyaltyObject(input, "issuer.object", "issuer.class");
      const imageFirstObject = mapGoogleLoyaltyObject(
        { ...input, walletArtworkUrl: "https://assets.example.test/google-hero.png" },
        "issuer.object",
        "issuer.class",
      );
      const composition = preview("GOOGLE_WALLET", progress);
      const status = required(loyaltyObject.textModulesData[1], "Google status module");

      expect(composition.svg).toContain(loyaltyClass.issuerName);
      expect(composition.svg).toContain(loyaltyClass.programName);
      expect(loyaltyObject).not.toHaveProperty("accountName");
      expect(loyaltyObject).not.toHaveProperty("accountId");
      expect(loyaltyObject).not.toHaveProperty("loyaltyPoints");
      expect(composition.svg).not.toContain(input.displayName);
      expect(composition.svg).not.toContain(`${progress}/${goal}`);
      expect(composition.svg).toContain(status.header);
      expect(composition.svg).toContain(status.body);
      expect(composition.svg).toContain('data-barcode-format="QR_CODE"');
      expect(loyaltyClass.textModulesData).not.toContainEqual(
        expect.objectContaining({ id: "reward" }),
      );
      expect(loyaltyClass).not.toHaveProperty("classTemplateInfo");
      expect(imageFirstObject).not.toHaveProperty("barcode");
      expect(imageFirstObject.textModulesData).not.toContainEqual(
        expect.objectContaining({ id: "reward" }),
      );
      expect(loyaltyObject).toMatchObject({
        barcode: { value: input.credentialPayload },
        textModulesData: expect.arrayContaining([
          expect.objectContaining({ id: "reward", body: rewardSummary }),
        ]),
      });
      expect(composition.svg).not.toMatch(/wallet-role|wallet-motif|hero-field/u);
    },
  );
});

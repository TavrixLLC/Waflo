import { describe, expect, it } from "vitest";
import { artworkFor } from "../../apps/api/src/programs/library-artwork.js";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import { findProgramTemplate } from "../../packages/contracts/src/index.js";
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

function preview(profile: "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET", progress: number) {
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
    rewardLabel: rewardReady ? `Reward ready: ${rewardSummary}` : rewardSummary,
    rewardReady,
    progressLabelVisible: profile === "CUSTOMER_WEB",
    rewardLabelVisible: profile === "CUSTOMER_WEB",
  });
  return composeProgramPreview({
    profile,
    locale: "EN",
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
      const header = required(pass.storeCard.headerFields[0], "Apple progress field");
      const primary = required(pass.storeCard.primaryFields[0], "Apple program field");
      const member = required(pass.storeCard.secondaryFields[0], "Apple member field");
      const status = required(pass.storeCard.auxiliaryFields[0], "Apple status field");
      const reward = required(pass.storeCard.backFields[0], "Apple reward back field");

      expect(composition.svg).toContain(String(header.label));
      expect(composition.svg).toContain(String(header.value));
      expect(composition.svg).toContain(String(primary.value));
      expect(composition.svg).toContain(String(member.label));
      expect(composition.svg).toContain(String(member.value));
      expect(composition.svg).toContain(String(status.label));
      expect(composition.svg).toContain(String(status.value));
      expect(composition.svg).toContain(String(reward.value));
      expect(composition.svg).not.toMatch(/wallet-role|wallet-motif|hero-field/u);
    },
  );

  it.each([0, 4, 8])(
    "maps Google preview content to generated loyalty class/object modules at %i/8",
    (progress) => {
      const input = providerInput(progress);
      const loyaltyClass = mapGoogleLoyaltyClass(input, "issuer.class");
      const loyaltyObject = mapGoogleLoyaltyObject(input, "issuer.object", "issuer.class");
      const composition = preview("GOOGLE_WALLET", progress);
      const reward = required(loyaltyClass.textModulesData[0], "Google reward module");
      const status = required(loyaltyObject.textModulesData[0], "Google status module");

      expect(composition.svg).toContain(loyaltyClass.issuerName);
      expect(composition.svg).toContain(loyaltyClass.programName);
      expect(composition.svg).toContain(loyaltyObject.accountName);
      expect(composition.svg).toContain(loyaltyObject.loyaltyPoints.label);
      expect(composition.svg).toContain(loyaltyObject.loyaltyPoints.balance.string);
      expect(composition.svg).toContain(reward.header);
      expect(composition.svg).toContain(reward.body);
      expect(composition.svg).toContain(status.header);
      expect(composition.svg).toContain(status.body);
      expect(composition.svg).not.toMatch(/wallet-role|wallet-motif|hero-field/u);
    },
  );
});

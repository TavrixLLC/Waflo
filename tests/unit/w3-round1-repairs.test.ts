import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  publishedMembershipStampVisualDigest,
  renderPublishedMembershipStampSvg,
  type PublishedMembershipStampRenderInput,
} from "../../packages/stamp-engine/src/index.js";
import { AppleWalletProvider, TestApplePassSigner } from "../../packages/wallet-apple/src/index.js";
import {
  mapGoogleLoyaltyClass,
  mapGoogleLoyaltyObject,
} from "../../packages/wallet-google/src/index.js";
import type { WalletMembershipInput } from "../../packages/wallet-core/src/index.js";

const pinnedRenderInput: PublishedMembershipStampRenderInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  programId: "00000000-0000-4000-8000-000000000002",
  programVersionId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  rendererSchemaVersion: "waflo-stamp-render-v1",
  locale: "ar",
  requiredStampCount: 8,
  currentStampCount: 3,
  rewardReady: false,
  layoutType: "PATH",
  layoutConfiguration: { columns: 4, serpentine: true },
  visualTheme: {
    filledColor: "#AE3115",
    emptyColor: "#F3A712",
    accentColor: "#AE3115",
    backgroundColor: "#F7F4EE",
    foregroundColor: "#241916",
    stampSize: 48,
    spacing: 8,
  },
  filledArtwork: {
    kind: "svg",
    trusted: true,
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path data-selected="filled" fill="#AE3115" d="M50 1 64 34 99 50 64 66 50 99 36 66 1 50 36 34Z"/></svg>',
  },
  emptyArtwork: {
    kind: "svg",
    trusted: true,
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path data-selected="empty" fill="#F7F4EE" stroke="#241916" stroke-width="8" d="M50 1 64 34 99 50 64 66 50 99 36 66 1 50 36 34Z"/></svg>',
  },
  assetDigests: { filled: "1".repeat(64), empty: "2".repeat(64) },
  outputProfile: "CUSTOMER_WEB",
};

const walletInput: WalletMembershipInput = {
  organizationId: pinnedRenderInput.organizationId,
  organizationName: "Cedar Coffee",
  programId: pinnedRenderInput.programId,
  programVersionId: pinnedRenderInput.programVersionId,
  programName: "Cedar Circle",
  description: "Selected artwork card.",
  rewardSummary: "Complimentary drink.",
  backgroundColor: "#F7F4EE",
  foregroundColor: "#241916",
  programLogoUrl: "https://assets.example.test/program-logo.png",
  publicAssetBaseUrl: "https://assets.example.test/progress.png",
  configurationFingerprint: "3".repeat(64),
  locale: "ar",
  walletPassInstanceId: "00000000-0000-4000-8000-000000000005",
  providerIdentity: "waflo.00000000000040008000000000000005",
  publicMembershipId: "member_public_opaque",
  displayName: "Amina",
  credentialPayload: "wfl1.opaque.credential",
  currentStampCount: 3,
  requiredStampCount: 8,
  rewardReady: false,
  membershipStatus: "ACTIVE",
  programStatus: "PUBLISHED",
  transferred: false,
  stampRenderInput: { ...pinnedRenderInput, outputProfile: "APPLE_WALLET" },
};

describe("W3 Repair Round 1 renderer and provider regressions", () => {
  it("preserves identical FILLED/EMPTY placement across every output profile", () => {
    const profiles = ["JOIN_PREVIEW", "CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const;
    const results = profiles.map((outputProfile) =>
      renderPublishedMembershipStampSvg({ ...pinnedRenderInput, outputProfile }),
    );
    const semantics = results.map((result) =>
      result.positions.map((position) => ({
        index: position.index,
        x: position.x,
        y: position.y,
        filled: position.filled,
      })),
    );
    expect(semantics.every((value) => JSON.stringify(value) === JSON.stringify(semantics[0]))).toBe(
      true,
    );
    for (const result of results) {
      expect(result.svg.match(/data-visual-state="FILLED"/g)).toHaveLength(3);
      expect(result.svg.match(/data-visual-state="EMPTY"/g)).toHaveLength(5);
      expect(result.svg).not.toMatch(/<text|check|star|gift|data-stamp-index="[^"]+">[0-9]/i);
    }
    expect(new Set(results.map((result) => result.configurationDigest)).size).toBe(4);
  });

  it("keeps generic dots, checks, and circle generators out of final W3 surfaces", () => {
    const customerCard = readFileSync(
      "apps/customer-web/app/card/[publicMembershipId]/customer-card.tsx",
      "utf8",
    );
    const customerCss = readFileSync("apps/customer-web/app/globals.css", "utf8");
    const apple = readFileSync("packages/wallet-apple/src/index.ts", "utf8");
    const worker = readFileSync("apps/wallet-worker/src/main.ts", "utf8");
    expect(customerCard).not.toMatch(/<Check\b|stamp-dot|stamp-grid/);
    expect(customerCss).not.toMatch(/\.stamp-dot|\.stamp-grid/);
    expect(apple).not.toContain("<circle");
    expect(worker).not.toContain("<circle");
  });

  it("uses an unbounded stable-cursor sync and a PII-free shared visual cache identity", () => {
    const worker = readFileSync("apps/wallet-worker/src/main.ts", "utf8");
    const programs = readFileSync("apps/api/src/programs/programs.service.ts", "utf8");
    expect(programs).not.toContain("take: 10_000");
    expect(worker).toContain('orderBy: [{ createdAt: "asc" }, { id: "asc" }]');
    expect(worker).toContain("cursorPassInstanceId");
    expect(
      publishedMembershipStampVisualDigest({
        ...pinnedRenderInput,
        membershipId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toBe(publishedMembershipStampVisualDigest(pinnedRenderInput));
  });

  it("packages nonblank Apple branding and selected-artwork progress without leaking secrets", async () => {
    const provider = new AppleWalletProvider({
      mode: "TEST_ADAPTER",
      configuration: {
        passTypeIdentifier: "pass.app.waflo.test-adapter",
        teamIdentifier: "WAFLOTEST",
        organizationName: "Waflo Test Adapter",
        webServiceUrl: "https://api.example.test/v1/apple-wallet",
      },
      signer: new TestApplePassSigner("repair-test-signature"),
      authenticationToken: () => "a".repeat(43),
      passDownloadUrl: "https://example.test/pass",
    });
    const issued = await provider.issueMembershipPass(walletInput);
    const files = unzipSync(issued.artifact as Uint8Array);
    const required = [
      "pass.json",
      "manifest.json",
      "signature",
      "icon.png",
      "icon@2x.png",
      "icon@3x.png",
      "logo.png",
      "logo@2x.png",
      "strip.png",
      "en.lproj/pass.strings",
      "ar.lproj/pass.strings",
    ];
    expect(Object.keys(files)).toEqual(expect.arrayContaining(required));
    const manifest = JSON.parse(
      Buffer.from(files["manifest.json"] ?? []).toString("utf8"),
    ) as Record<string, string>;
    expect(Object.keys(manifest).sort()).toEqual(
      Object.keys(files)
        .filter((name) => !["manifest.json", "signature"].includes(name))
        .sort(),
    );
    for (const name of ["icon.png", "logo.png", "strip.png"]) {
      const raw = await sharp(Buffer.from(files[name] ?? []))
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(raw.some((value, index) => index % 4 !== 3 && value > 0)).toBe(true);
      expect(raw.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    }
    const packageText = Object.entries(files)
      .filter(([name]) => name.endsWith(".json") || name.endsWith(".strings"))
      .map(([, value]) => Buffer.from(value).toString("utf8"))
      .join("\n");
    expect(packageText.match(/wfl1\.opaque\.credential/g)).toHaveLength(1);
    expect(packageText).not.toContain("customer@example.com");
    expect(Buffer.from(files.signature ?? [])).not.toHaveLength(0);
  });

  it("separates Apple local signing health from external device certification", async () => {
    const signer = {
      mode: "REAL" as const,
      signManifest: async () => Buffer.from("signature"),
      health: () => ({
        status: "READY" as const,
        expiresAt: "2027-07-29T00:00:00.000Z",
      }),
    };
    const provider = new AppleWalletProvider({
      mode: "REAL",
      configuration: {
        passTypeIdentifier: "pass.app.waflo",
        teamIdentifier: "WAFLOTEAM",
        organizationName: "Waflo",
        webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
      },
      signer,
      authenticationToken: () => "a".repeat(43),
      passDownloadUrl: "https://api.waflo.app/pass",
    });
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "EXTERNALLY_UNCERTIFIED",
      configured: true,
      providerReachable: false,
      externallyCertified: false,
    });

    for (const [certificateStatus, providerStatus] of [
      ["EXPIRED", "CERTIFICATE_EXPIRED"],
      ["EXPIRING", "CERTIFICATE_EXPIRING"],
      ["IDENTIFIER_MISMATCH", "PERMISSION_DENIED"],
      ["TEAM_MISMATCH", "PERMISSION_DENIED"],
    ] as const) {
      const mapped = new AppleWalletProvider({
        mode: "REAL",
        configuration: {
          passTypeIdentifier: "pass.app.waflo",
          teamIdentifier: "WAFLOTEAM",
          organizationName: "Waflo",
          webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
        },
        signer: {
          ...signer,
          health: () => ({
            status: certificateStatus,
            expiresAt: "2027-07-29T00:00:00.000Z",
          }),
        },
        authenticationToken: () => "a".repeat(43),
        passDownloadUrl: "https://api.waflo.app/pass",
      });
      await expect(mapped.healthCheck()).resolves.toMatchObject({
        status: providerStatus,
        configured: true,
        externallyCertified: false,
      });
    }
  });

  it("maps safe Class logo imagery and keeps member progress/barcode only on the Object", () => {
    const classValue = mapGoogleLoyaltyClass(walletInput, "issuer.class");
    const objectValue = mapGoogleLoyaltyObject(walletInput, "issuer.object", "issuer.class");
    expect(classValue).toMatchObject({
      programLogo: {
        sourceUri: { uri: walletInput.programLogoUrl },
      },
    });
    expect(JSON.stringify(classValue)).not.toContain(walletInput.credentialPayload);
    expect(objectValue).toMatchObject({
      imageModulesData: [{ mainImage: { sourceUri: { uri: walletInput.publicAssetBaseUrl } } }],
      barcode: { value: walletInput.credentialPayload },
    });
    expect(JSON.stringify(objectValue).match(/wfl1\.opaque\.credential/g)).toHaveLength(1);
  });
});

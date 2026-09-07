import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "../../apps/api/src/programs/object-storage.js";
import type { PreviewAsset } from "../../apps/api/src/programs/preview-assets.js";
import { resolveApplePassImagesWithFallback } from "../../apps/api/src/wallet/wallet.service.js";
import { renderStampSvg } from "../../packages/stamp-engine/src/index.js";
import {
  GOOGLE_WALLET_PROGRESS_ARTWORK_VERSION,
  resolveGoogleProgressArtworkComposition,
} from "../../packages/wallet-google/src/index.js";
import {
  GOOGLE_WALLET_HERO_HEIGHT,
  GOOGLE_WALLET_HERO_WIDTH,
  GOOGLE_WALLET_LOGO_SAFE_INSET,
  GOOGLE_WALLET_LOGO_SIZE,
  googleProgressAssetNeedsOwnershipRepair,
  googleProgressSharedAssetOwnership,
  prepareGoogleWalletProgramLogo,
  prepareGoogleWalletProgressHero,
} from "../../apps/wallet-worker/src/google-wallet-assets.js";
import { WALLET_PRESENTATION_SCHEMA_VERSION } from "../../packages/wallet-core/src/index.js";

const storage = {
  put: vi.fn(),
  putImmutable: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  ensureReady: vi.fn(),
} satisfies ObjectStorage;

function previewAsset(input: {
  id: string;
  inlineSvg?: string;
  variants?: PreviewAsset["variants"];
}): PreviewAsset {
  const digest = createHash("sha256")
    .update(input.inlineSvg ?? input.id)
    .digest("hex");
  return {
    id: input.id,
    sha256Digest: digest,
    safeMetadata: input.inlineSvg ? { inlineSvg: input.inlineSvg } : {},
    mimeType: "image/png",
    source: "UPLOAD",
    variants: input.variants ?? [],
  };
}

describe("Wallet rendering repair completion", () => {
  it("versions cached previews and reconciles existing provider presentation in place", () => {
    const previewCache = readFileSync("apps/api/src/programs/preview-cache.ts", "utf8");
    const enrollment = readFileSync("apps/api/src/enrollment/public-enrollment.service.ts", "utf8");
    const worker = readFileSync("apps/wallet-worker/src/main.ts", "utf8");
    expect(WALLET_PRESENTATION_SCHEMA_VERSION).toBe(5);
    expect(previewCache).toContain("PREVIEW_RENDERER_SCHEMA_VERSION = 10");
    expect(enrollment).toContain("ensure-template:v");
    expect(enrollment).toContain("WALLET_PRESENTATION_SCHEMA_VERSION");
    expect(worker).toContain("enqueuePresentationRepairs");
    expect(worker).toContain("ensureGoogleTemplateCurrent");
    expect(worker).toContain("PRESENTATION_SCHEMA_UPGRADE");
  });

  it("normalizes historical stamp topology to Grid in the Google hero composition", () => {
    const renderInput = {
      goal: 6,
      progress: 2,
      rewardReady: false,
      layout: "GRID" as const,
      layoutConfiguration: { columns: 4 },
      filledColor: "#E4572E",
      emptyColor: "#F3A712",
      accentColor: "#E4572E",
      backgroundColor: "#F7F4EE",
      foregroundColor: "#241916",
      stampSize: 48,
      spacing: 8,
      outputProfile: "GOOGLE_WALLET" as const,
    };
    const canonical = renderStampSvg(renderInput);
    const composition = resolveGoogleProgressArtworkComposition({
      goal: renderInput.goal,
      layout: renderInput.layout,
      layoutConfiguration: renderInput.layoutConfiguration,
      renderedWidth: canonical.width,
      renderedHeight: canonical.height,
    });
    const adapted = renderStampSvg({
      ...renderInput,
      layout: composition.layout,
      ...(composition.layoutConfiguration
        ? { layoutConfiguration: composition.layoutConfiguration }
        : {}),
    });

    expect(GOOGLE_WALLET_PROGRESS_ARTWORK_VERSION).toBe("google-progress-v5");
    expect(composition).toEqual({
      layout: "GRID",
      layoutConfiguration: undefined,
      adapted: false,
    });
    expect(adapted.width).toBe(canonical.width);
    expect(adapted.height).toBe(canonical.height);
    expect(adapted.svg.match(/data-visual-state="FILLED"/gu)).toHaveLength(2);
    expect(adapted.svg.match(/data-visual-state="EMPTY"/gu)).toHaveLength(4);
  });

  it("renders the single Google progress region at provider hero geometry", async () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240"><rect width="800" height="240" fill="#E4572E"/></svg>';
    const bytes = await prepareGoogleWalletProgressHero(source, "#F7F4EE");
    await expect(sharp(bytes).metadata()).resolves.toMatchObject({
      width: GOOGLE_WALLET_HERO_WIDTH,
      height: GOOGLE_WALLET_HERO_HEIGHT,
      format: "png",
    });
  });

  it("keeps merchant logo artwork inside Google's circular-mask safe area", async () => {
    const source = await sharp({
      create: { width: 400, height: 400, channels: 4, background: "#E4572E" },
    })
      .png()
      .toBuffer();
    const bytes = await prepareGoogleWalletProgramLogo(source);
    const metadata = await sharp(bytes).metadata();
    const trimmed = await sharp(bytes)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer({ resolveWithObject: true });
    expect(metadata).toMatchObject({
      width: GOOGLE_WALLET_LOGO_SIZE,
      height: GOOGLE_WALLET_LOGO_SIZE,
      format: "png",
    });
    expect(trimmed.info.width).toBe(GOOGLE_WALLET_LOGO_SIZE - GOOGLE_WALLET_LOGO_SAFE_INSET * 2);
    expect(trimmed.info.height).toBe(GOOGLE_WALLET_LOGO_SIZE - GOOGLE_WALLET_LOGO_SAFE_INSET * 2);
  });

  it("owns deduplicated Google progress art by program version so membership erasure cannot revoke it", () => {
    const legacyAsset = {
      organizationId: "organization-a",
      programVersionId: "program-version-a",
      membershipId: "membership-a",
      revokedAt: new Date("2026-08-23T00:00:00.000Z"),
    };
    expect(googleProgressAssetNeedsOwnershipRepair(legacyAsset, "program-version-a")).toBe(true);
    const repairedAsset = {
      ...legacyAsset,
      ...googleProgressSharedAssetOwnership("program-version-a"),
    };
    const erasedMembershipIds = new Set(["membership-a"]);
    const erasureWouldRevoke =
      repairedAsset.membershipId !== null && erasedMembershipIds.has(repairedAsset.membershipId);
    expect(repairedAsset).toMatchObject({
      organizationId: "organization-a",
      programVersionId: "program-version-a",
      membershipId: null,
      revokedAt: null,
    });
    expect(erasureWouldRevoke).toBe(false);
    expect(googleProgressAssetNeedsOwnershipRepair(repairedAsset, "program-version-a")).toBe(false);
    expect(googleProgressAssetNeedsOwnershipRepair(repairedAsset, "program-version-b")).toBe(true);
  });

  it("falls back to a usable organization logo when the Apple program logo is unusable", async () => {
    const unusableProgramLogo = previewAsset({
      id: "program-logo",
      inlineSvg: '<svg xmlns="http://www.w3.org/2000/svg"><broken',
    });
    const organizationLogo = previewAsset({
      id: "organization-logo",
      inlineSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#E4572E"/></svg>',
    });
    const result = await resolveApplePassImagesWithFallback(storage, [
      unusableProgramLogo,
      organizationLogo,
    ]);
    expect(Object.keys(result ?? {})).toEqual([
      "logo.png",
      "logo@2x.png",
      "logo@3x.png",
      "thumbnail.png",
      "thumbnail@2x.png",
      "thumbnail@3x.png",
    ]);
    await expect(sharp(Buffer.from(result?.["logo.png"] ?? [])).metadata()).resolves.toMatchObject({
      width: 160,
      height: 50,
      format: "png",
    });
    await expect(
      sharp(Buffer.from(result?.["logo@3x.png"] ?? [])).metadata(),
    ).resolves.toMatchObject({ width: 480, height: 150, format: "png" });
    await expect(
      sharp(Buffer.from(result?.["thumbnail@3x.png"] ?? [])).metadata(),
    ).resolves.toMatchObject({ width: 270, height: 270, format: "png" });
    expect(storage.get).not.toHaveBeenCalled();
  });
});

import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "../../apps/api/src/programs/object-storage.js";
import type { PreviewAsset } from "../../apps/api/src/programs/preview-assets.js";
import { resolveApplePassImagesWithFallback } from "../../apps/api/src/wallet/wallet.service.js";
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
    expect(Object.keys(result ?? {})).toEqual(["logo.png", "logo@2x.png"]);
    await expect(sharp(Buffer.from(result?.["logo.png"] ?? [])).metadata()).resolves.toMatchObject({
      width: 160,
      height: 50,
      format: "png",
    });
    expect(storage.get).not.toHaveBeenCalled();
  });
});

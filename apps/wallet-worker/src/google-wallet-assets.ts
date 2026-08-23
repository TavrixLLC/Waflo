import sharp from "sharp";

export const GOOGLE_WALLET_HERO_WIDTH = 1_032;
export const GOOGLE_WALLET_HERO_HEIGHT = 812;
const GOOGLE_WALLET_HERO_PADDING = 48;

export const GOOGLE_WALLET_LOGO_SIZE = 660;
export const GOOGLE_WALLET_LOGO_SAFE_INSET = 99;

const transparent = { r: 255, g: 255, b: 255, alpha: 0 } as const;

export async function prepareGoogleWalletProgressHero(
  sourceSvg: string,
  backgroundColor: string,
): Promise<Buffer> {
  const innerWidth = GOOGLE_WALLET_HERO_WIDTH - GOOGLE_WALLET_HERO_PADDING * 2;
  const innerHeight = GOOGLE_WALLET_HERO_HEIGHT - GOOGLE_WALLET_HERO_PADDING * 2;
  return sharp(Buffer.from(sourceSvg, "utf8"))
    .resize(innerWidth, innerHeight, {
      fit: "contain",
      background: backgroundColor,
      withoutEnlargement: false,
    })
    .extend({
      top: GOOGLE_WALLET_HERO_PADDING,
      bottom: GOOGLE_WALLET_HERO_PADDING,
      left: GOOGLE_WALLET_HERO_PADDING,
      right: GOOGLE_WALLET_HERO_PADDING,
      background: backgroundColor,
    })
    .png()
    .toBuffer();
}

export async function prepareGoogleWalletProgramLogo(source: Buffer): Promise<Buffer> {
  const safeContentSize = GOOGLE_WALLET_LOGO_SIZE - GOOGLE_WALLET_LOGO_SAFE_INSET * 2;
  return sharp(source)
    .resize(safeContentSize, safeContentSize, {
      fit: "contain",
      background: transparent,
      withoutEnlargement: false,
    })
    .extend({
      top: GOOGLE_WALLET_LOGO_SAFE_INSET,
      bottom: GOOGLE_WALLET_LOGO_SAFE_INSET,
      left: GOOGLE_WALLET_LOGO_SAFE_INSET,
      right: GOOGLE_WALLET_LOGO_SAFE_INSET,
      background: transparent,
    })
    .png()
    .toBuffer();
}

export const GOOGLE_PROGRESS_SHARED_ASSET_OWNERSHIP = Object.freeze({
  programVersionId: null,
  membershipId: null,
  revokedAt: null,
});

export function googleProgressAssetNeedsOwnershipRepair(asset: {
  readonly programVersionId: string | null;
  readonly membershipId: string | null;
  readonly revokedAt: Date | null;
}): boolean {
  return Boolean(asset.programVersionId || asset.membershipId || asset.revokedAt);
}

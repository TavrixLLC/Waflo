import sharp from "sharp";

export const GOOGLE_WALLET_HERO_WIDTH = 1_032;
export const GOOGLE_WALLET_HERO_HEIGHT = 812;
const GOOGLE_WALLET_HERO_PADDING = 48;

export const GOOGLE_WALLET_LOGO_SIZE = 660;
export const GOOGLE_WALLET_LOGO_SAFE_INSET = 99;

const opaqueWhite = { r: 255, g: 255, b: 255, alpha: 1 } as const;

type Rgb = Readonly<{ r: number; g: number; b: number }>;

function rgbFromHex(value: string): Rgb {
  const normalized = /^#([0-9a-f]{6})$/iu.exec(value.trim());
  if (!normalized) return { r: 228, g: 87, b: 46 };
  const numeric = Number.parseInt(normalized[1] ?? "e4572e", 16);
  return {
    r: (numeric >>> 16) & 0xff,
    g: (numeric >>> 8) & 0xff,
    b: numeric & 0xff,
  };
}

function isNearWhite(pixel: Rgb): boolean {
  return pixel.r > 242 && pixel.g > 242 && pixel.b > 242;
}

/**
 * Select a stable solid color from the cropped mark.  The most common exact
 * pixel is deliberately used rather than a visual average: a Waflo mark is
 * normally a flat brand tile with anti-aliased artwork over it, and the flat
 * tile color is what must continue through Google Wallet's circle mask.
 */
function dominantOpaqueColor(data: Buffer, fallback: Rgb): Rgb {
  const counts = new Map<string, { count: number; color: Rgb }>();
  for (let index = 0; index + 3 < data.length; index += 4) {
    const color = { r: data[index] ?? 0, g: data[index + 1] ?? 0, b: data[index + 2] ?? 0 };
    const alpha = data[index + 3] ?? 0;
    if (alpha < 245 || isNearWhite(color)) continue;
    const key = `${color.r}:${color.g}:${color.b}`;
    const previous = counts.get(key);
    counts.set(key, { color, count: (previous?.count ?? 0) + 1 });
  }
  let selected: { count: number; color: Rgb } | undefined;
  for (const candidate of counts.values()) {
    if (!selected || candidate.count > selected.count) selected = candidate;
  }
  return selected?.color ?? fallback;
}

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

/**
 * Compose a Google-specific logo derivative. Google masks `programLogo` into
 * a circle, so the source must remain a square, full-bleed PNG with artwork
 * held inside the 15% safe area. Do not pre-mask or mutate the merchant asset.
 */
export async function prepareGoogleWalletProgramLogo(
  source: Buffer,
  fallbackBackground = "#E4572E",
): Promise<Buffer> {
  const safeContentSize = GOOGLE_WALLET_LOGO_SIZE - GOOGLE_WALLET_LOGO_SAFE_INSET * 2;
  const fallback = rgbFromHex(fallbackBackground);
  // Merchant uploads often contain a white export canvas. Flattening and
  // trimming that canvas is derivative-only; the original object remains
  // untouched. If trimming cannot identify content, retain the source bytes
  // as the inner artwork and still guarantee the required opaque outer field.
  let cropped: Buffer;
  try {
    cropped = await sharp(source)
      .flatten({ background: opaqueWhite })
      .trim({ background: opaqueWhite, threshold: 10 })
      .png()
      .toBuffer();
  } catch {
    cropped = source;
  }
  const raw = await sharp(cropped).ensureAlpha().raw().toBuffer();
  const background = dominantOpaqueColor(raw, fallback);
  const inner = await sharp(cropped)
    .resize(safeContentSize, safeContentSize, {
      fit: "contain",
      background: { ...background, alpha: 1 },
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: GOOGLE_WALLET_LOGO_SIZE,
      height: GOOGLE_WALLET_LOGO_SIZE,
      channels: 4,
      background: { ...background, alpha: 1 },
    },
  })
    .composite([
      {
        input: inner,
        left: GOOGLE_WALLET_LOGO_SAFE_INSET,
        top: GOOGLE_WALLET_LOGO_SAFE_INSET,
      },
    ])
    .png()
    .toBuffer();
}

export function googleProgressSharedAssetOwnership(programVersionId: string) {
  return Object.freeze({
    programVersionId,
    membershipId: null,
    revokedAt: null,
  });
}

export function googleProgressAssetNeedsOwnershipRepair(
  asset: {
    readonly programVersionId: string | null;
    readonly membershipId: string | null;
    readonly revokedAt: Date | null;
  },
  expectedProgramVersionId: string,
): boolean {
  return (
    asset.programVersionId !== expectedProgramVersionId ||
    asset.membershipId !== null ||
    asset.revokedAt !== null
  );
}

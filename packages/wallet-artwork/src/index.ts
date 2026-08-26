import { createHash } from "node:crypto";
import { createQrPng, decodeQrImage } from "@waflo/qr-core";
import type { PublishedMembershipStampRenderResult, StampLayout } from "@waflo/stamp-engine";
import sharp from "sharp";

export type WalletArtworkTarget =
  | "APPLE_POSTER"
  | "APPLE_GENERIC_STRIP"
  | "APPLE_LEGACY_STRIP"
  | "GOOGLE_HERO";
export type WalletArtworkScale = 1 | 2 | 3;

export const walletArtworkDimensions = {
  APPLE_POSTER: { width: 358, height: 448, maxBytes: 4_000_000 },
  APPLE_GENERIC_STRIP: { width: 375, height: 144, maxBytes: 4_000_000 },
  APPLE_LEGACY_STRIP: { width: 375, height: 123, maxBytes: 4_000_000 },
  GOOGLE_HERO: { width: 1_032, height: 812, maxBytes: 5_000_000 },
} as const satisfies Readonly<
  Record<WalletArtworkTarget, { width: number; height: number; maxBytes: number }>
>;

export interface WalletArtworkPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface WalletArtworkLayout {
  readonly safeArea: WalletArtworkPlacement;
  readonly stampPanelRegion: WalletArtworkPlacement;
  readonly stampRegion: WalletArtworkPlacement;
  readonly identityRegion?: WalletArtworkPlacement;
  readonly counterBadgeRegion?: WalletArtworkPlacement;
  readonly rewardRegion?: WalletArtworkPlacement;
  readonly qrRegion?: WalletArtworkPlacement;
  readonly decorationRegion: WalletArtworkPlacement;
  readonly centerToleranceRatio: number;
}

/** Explicit 1x layout contracts keep safe areas and visual hierarchy reviewable. */
export const APPLE_POSTER_LAYOUT: WalletArtworkLayout = {
  safeArea: { left: 18, top: 22, width: 322, height: 404 },
  identityRegion: { left: 22, top: 38, width: 190, height: 72 },
  counterBadgeRegion: { left: 234, top: 30, width: 100, height: 96 },
  stampPanelRegion: { left: 10, top: 130, width: 338, height: 176 },
  stampRegion: { left: 32, top: 152, width: 294, height: 132 },
  rewardRegion: { left: 22, top: 322, width: 176, height: 78 },
  qrRegion: { left: 200, top: 286, width: 140, height: 140 },
  decorationRegion: { left: 0, top: 0, width: 358, height: 448 },
  centerToleranceRatio: 0.02,
};

export const APPLE_GENERIC_LAYOUT: WalletArtworkLayout = {
  safeArea: { left: 5, top: 5, width: 365, height: 134 },
  stampPanelRegion: { left: 5, top: 5, width: 365, height: 134 },
  stampRegion: { left: 22, top: 19, width: 331, height: 106 },
  decorationRegion: { left: 0, top: 0, width: 375, height: 144 },
  centerToleranceRatio: 0.02,
};

export const APPLE_LEGACY_LAYOUT: WalletArtworkLayout = {
  safeArea: { left: 5, top: 4, width: 365, height: 115 },
  stampPanelRegion: { left: 5, top: 4, width: 365, height: 115 },
  stampRegion: { left: 22, top: 16, width: 331, height: 91 },
  decorationRegion: { left: 0, top: 0, width: 375, height: 123 },
  centerToleranceRatio: 0.02,
};

export const GOOGLE_HERO_LAYOUT: WalletArtworkLayout = {
  safeArea: { left: 54, top: 48, width: 924, height: 716 },
  identityRegion: { left: 68, top: 76, width: 650, height: 108 },
  counterBadgeRegion: { left: 786, top: 70, width: 178, height: 132 },
  stampPanelRegion: { left: 32, top: 214, width: 968, height: 320 },
  stampRegion: { left: 92, top: 250, width: 848, height: 248 },
  rewardRegion: { left: 84, top: 574, width: 676, height: 146 },
  qrRegion: { left: 786, top: 558, width: 192, height: 192 },
  decorationRegion: { left: 0, top: 0, width: 1_032, height: 812 },
  centerToleranceRatio: 0.02,
};

export const walletArtworkLayouts = {
  APPLE_POSTER: APPLE_POSTER_LAYOUT,
  APPLE_GENERIC_STRIP: APPLE_GENERIC_LAYOUT,
  APPLE_LEGACY_STRIP: APPLE_LEGACY_LAYOUT,
  GOOGLE_HERO: GOOGLE_HERO_LAYOUT,
} as const satisfies Readonly<Record<WalletArtworkTarget, WalletArtworkLayout>>;

export const walletArtworkPanelCorners = {
  APPLE_POSTER: { topLeft: 38, topRight: 18, bottomLeft: 18, bottomRight: 38 },
  GOOGLE_HERO: { topLeft: 72, topRight: 30, bottomLeft: 30, bottomRight: 72 },
} as const;

export const walletArtworkArabicTypeface =
  "'Noto Sans Arabic','Noto Sans','DejaVu Sans','Segoe UI','Arial',sans-serif";

export interface WalletArtworkQrCenterLogo {
  /** Optional merchant/store mark. Unsafe or undecodable variants fall back to a plain QR. */
  readonly bytes: Uint8Array;
}

export interface WalletArtworkCompositionInput {
  /** The unchanged output of the one authoritative template/stamp renderer. */
  readonly stampArtwork: Pick<
    PublishedMembershipStampRenderResult,
    "svg" | "width" | "height" | "contentDigest" | "positions"
  >;
  readonly stampSize: number;
  readonly layoutType: StampLayout;
  readonly theme: {
    readonly backgroundColor: string;
    readonly foregroundColor: string;
    readonly accentColor: string;
    readonly secondaryColor: string;
  };
  readonly currentStampCount: number;
  readonly requiredStampCount: number;
  readonly rewardReady: boolean;
  readonly rewardLabel: string;
  readonly organizationName: string;
  readonly programName: string;
  readonly memberName: string;
  /** Opaque revocable Wallet credential. It is encoded only as a QR, never rendered as text. */
  readonly credentialPayload: string;
  readonly qrCenterLogo?: WalletArtworkQrCenterLogo;
  readonly locale: "en" | "ar";
}

export interface WalletArtworkVisibleBounds extends WalletArtworkPlacement {
  readonly right: number;
  readonly bottom: number;
}

export interface ComposedWalletArtwork {
  readonly bytes: Buffer;
  readonly target: WalletArtworkTarget;
  readonly scale: WalletArtworkScale;
  readonly width: number;
  readonly height: number;
  readonly contentDigest: string;
  readonly sourceStampDigest: string;
  readonly sourceVisibleBounds: WalletArtworkVisibleBounds;
  readonly sourceVisibleRasterAspectRatio: number;
  readonly stampPlacement: WalletArtworkPlacement;
  readonly stampPanelRegion: WalletArtworkPlacement;
  readonly stampRegion: WalletArtworkPlacement;
  readonly identityRegion?: WalletArtworkPlacement;
  readonly counterBadgeRegion?: WalletArtworkPlacement;
  readonly rewardRegion?: WalletArtworkPlacement;
  readonly qrRegion?: WalletArtworkPlacement;
  readonly qrCenterLogoApplied?: boolean;
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const colorPattern = /^#[0-9a-f]{6}$/i;

function scaledPlacement(
  placement: WalletArtworkPlacement | undefined,
  scale: WalletArtworkScale,
): WalletArtworkPlacement | undefined {
  return placement
    ? {
        left: placement.left * scale,
        top: placement.top * scale,
        width: placement.width * scale,
        height: placement.height * scale,
      }
    : undefined;
}

function assertCompositionInput(input: WalletArtworkCompositionInput): void {
  if (!Number.isInteger(input.currentStampCount) || input.currentStampCount < 0) {
    throw new Error("Wallet artwork current stamp count must be a non-negative integer.");
  }
  if (!Number.isInteger(input.requiredStampCount) || input.requiredStampCount < 1) {
    throw new Error("Wallet artwork required stamp count must be a positive integer.");
  }
  if (input.currentStampCount > input.requiredStampCount) {
    throw new Error("Wallet artwork current stamp count cannot exceed its required count.");
  }
  if (!Number.isFinite(input.stampSize) || input.stampSize < 1 || input.stampSize > 512) {
    throw new Error("Wallet artwork stamp size is invalid.");
  }
  if (input.rewardLabel.length > 500) {
    throw new Error("Wallet artwork reward label exceeds 500 characters.");
  }
  for (const [name, value, maximum] of [
    ["organization name", input.organizationName, 80],
    ["program name", input.programName, 80],
    ["member name", input.memberName, 120],
    ["credential payload", input.credentialPayload, 512],
  ] as const) {
    if (!value.trim() || value.length > maximum) {
      throw new Error(`Wallet artwork ${name} is invalid.`);
    }
  }
  for (const [name, value] of Object.entries(input.theme)) {
    if (!colorPattern.test(value)) throw new Error(`Wallet artwork ${name} is invalid.`);
  }
  if (
    input.qrCenterLogo &&
    (input.qrCenterLogo.bytes.byteLength < 32 || input.qrCenterLogo.bytes.byteLength > 512_000)
  ) {
    throw new Error("Wallet artwork QR center logo is invalid.");
  }
  if (
    !Number.isFinite(input.stampArtwork.width) ||
    !Number.isFinite(input.stampArtwork.height) ||
    input.stampArtwork.width < 1 ||
    input.stampArtwork.height < 1 ||
    input.stampArtwork.positions.length !== input.requiredStampCount
  ) {
    throw new Error("Wallet stamp artwork dimensions or positions are invalid.");
  }
  const source = Buffer.from(input.stampArtwork.svg, "utf8");
  if (
    source.length === 0 ||
    source.length > 8_000_000 ||
    !input.stampArtwork.svg.includes("<svg")
  ) {
    throw new Error("Wallet stamp artwork SVG is invalid.");
  }
  const digest = createHash("sha256").update(input.stampArtwork.svg).digest("hex");
  if (digest !== input.stampArtwork.contentDigest) {
    throw new Error("Wallet stamp artwork digest mismatch.");
  }
}

export function measureRenderedStampArtwork(
  stampArtwork: Pick<PublishedMembershipStampRenderResult, "width" | "height" | "positions">,
  stampSize: number,
): WalletArtworkVisibleBounds {
  if (stampArtwork.positions.length === 0) {
    throw new Error("Wallet stamp artwork contains no positioned stamps.");
  }
  const half = stampSize / 2;
  const left = Math.max(
    0,
    Math.min(...stampArtwork.positions.map((position) => position.x - half)),
  );
  const top = Math.max(0, Math.min(...stampArtwork.positions.map((position) => position.y - half)));
  const right = Math.min(
    stampArtwork.width,
    Math.max(...stampArtwork.positions.map((position) => position.x + half)),
  );
  const bottom = Math.min(
    stampArtwork.height,
    Math.max(...stampArtwork.positions.map((position) => position.y + half)),
  );
  if (right <= left || bottom <= top) {
    throw new Error("Wallet stamp artwork visible bounds are empty.");
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ??
      character,
  );
}

function wrapLabel(value: string, maxCharacters: number, maxLines = 2): string[] {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  let truncated = false;
  for (const rawWord of words) {
    const word =
      Array.from(rawWord).length > maxCharacters
        ? `${Array.from(rawWord)
            .slice(0, Math.max(1, maxCharacters - 1))
            .join("")}…`
        : rawWord;
    if (word !== rawWord) truncated = true;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) {
      current = candidate;
      continue;
    }
    if (lines.length < maxLines - 1) {
      lines.push(current);
      current = word;
      continue;
    }
    truncated = true;
    break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (truncated && lines.length > 0) {
    const last = lines.length - 1;
    const graphemes = Array.from((lines[last] ?? "").replace(/…$/, ""));
    lines[last] = `${graphemes
      .slice(0, Math.max(1, maxCharacters - 1))
      .join("")
      .trimEnd()}…`;
  }
  return lines;
}

function motif(
  layout: StampLayout,
  width: number,
  height: number,
  accent: string,
  secondary: string,
): string {
  if (layout === "RING") {
    return `<circle cx="${width * 0.84}" cy="${height * 0.2}" r="${width * 0.14}" fill="none" stroke="${accent}" stroke-width="${Math.max(10, width * 0.022)}" opacity="0.12"/><circle cx="${width * 0.13}" cy="${height * 0.84}" r="${width * 0.1}" fill="none" stroke="${secondary}" stroke-width="${Math.max(7, width * 0.016)}" opacity="0.14"/>`;
  }
  if (layout === "PATH") {
    return `<path d="M${width * 0.04} ${height * 0.2} C${width * 0.29} ${height * 0.08},${width * 0.6} ${height * 0.28},${width * 0.96} ${height * 0.12}" fill="none" stroke="${secondary}" stroke-width="${Math.max(18, width * 0.044)}" stroke-linecap="round" opacity="0.13"/><path d="M${width * 0.05} ${height * 0.84} C${width * 0.36} ${height * 0.7},${width * 0.68} ${height * 0.9},${width * 0.95} ${height * 0.76}" fill="none" stroke="${accent}" stroke-width="${Math.max(8, width * 0.016)}" stroke-linecap="round" opacity="0.1"/>`;
  }
  if (layout === "ROW") {
    return `<circle cx="${width * 0.84}" cy="${height * 0.16}" r="${width * 0.12}" fill="${secondary}" opacity="0.11"/><circle cx="${width * 0.89}" cy="${height * 0.19}" r="${width * 0.055}" fill="${accent}" opacity="0.11"/>`;
  }
  return `<path d="M${width * 0.7} ${height * 0.045}V${height * 0.17}M${width * 0.8} ${height * 0.045}V${height * 0.2}M${width * 0.9} ${height * 0.045}V${height * 0.16}M${width * 0.67} ${height * 0.08}H${width * 0.96}M${width * 0.69} ${height * 0.15}H${width * 0.96}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, width * 0.005)}" opacity="0.1"/><rect x="${width * 0.025}" y="${height * 0.77}" width="${width * 0.19}" height="${height * 0.18}" rx="${width * 0.03}" fill="${secondary}" opacity="0.1" transform="rotate(-7 ${width * 0.11} ${height * 0.86})"/>`;
}

function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Preserve approved colors when legible, with a deterministic safe fallback for pale themes. */
function readableTextColor(preferred: string, background: string): string {
  if (contrastRatio(preferred, background) >= 4.5) return preferred;
  const candidates = ["#241916", "#FFFFFF"];
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, background) > contrastRatio(best, background) ? candidate : best,
  );
}

function fittedFontSize(
  value: string,
  preferredSize: number,
  minimumSize: number,
  availableWidth: number,
  arabic: boolean,
): number {
  const characters = Math.max(1, Array.from(value).length);
  const estimatedWidth = characters * preferredSize * (arabic ? 0.61 : 0.56);
  return Math.max(
    minimumSize,
    Math.min(preferredSize, Number((preferredSize * (availableWidth / estimatedWidth)).toFixed(2))),
  );
}

function counterBadgeSvg(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
  typeface: string,
): string {
  const { accentColor, backgroundColor } = input.theme;
  const textColor = readableTextColor(backgroundColor, accentColor);
  const label = input.locale === "ar" ? "الأختام" : "STAMPS";
  const isArabic = input.locale === "ar";
  const cx = region.left + region.width / 2;
  const cy = region.top + region.height / 2;
  const radius = Math.min(region.width, region.height) / 2;
  const labelSize = region.width > 150 ? 18 : 10;
  const valueSize = region.width > 150 ? 36 : 22;
  return `<circle cx="${cx}" cy="${cy + 5}" r="${radius - 3}" fill="#000000" opacity="0.12"/><circle cx="${cx}" cy="${cy}" r="${radius - 3}" fill="${accentColor}" stroke="${backgroundColor}" stroke-width="${region.width > 150 ? 6 : 3}" stroke-opacity="0.72"/><text x="${cx}" y="${cy - (region.width > 150 ? 13 : 9)}" text-anchor="middle" font-family="${typeface}" font-size="${labelSize}" font-weight="800" letter-spacing="${isArabic ? 0 : 1.5}" fill="${textColor}" direction="${isArabic ? "rtl" : "ltr"}" unicode-bidi="plaintext" xml:lang="${isArabic ? "ar" : "en"}">${escapeXml(label)}</text><text x="${cx}" y="${cy + (region.width > 150 ? 30 : 21)}" text-anchor="middle" font-family="${typeface}" font-size="${valueSize}" font-weight="900" letter-spacing="-0.8" fill="${textColor}" direction="ltr" unicode-bidi="plaintext" xml:lang="en">${input.currentStampCount} / ${input.requiredStampCount}</text>`;
}

function identitySvg(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
  typeface: string,
): string {
  const isArabic = input.locale === "ar";
  const isGoogle = region.width > 400;
  const inset = isGoogle ? 18 : 8;
  const textX = isArabic ? region.left + region.width - inset : region.left + inset;
  // SVG `start` follows the active direction, so it is the visual right edge
  // for Arabic and the visual left edge for English.
  const textAnchor = "start";
  const direction = isArabic ? "rtl" : "ltr";
  const textColor = readableTextColor(input.theme.foregroundColor, input.theme.backgroundColor);
  const organization = wrapLabel(input.organizationName, isGoogle ? 44 : 24, 1)[0] ?? "";
  const program = wrapLabel(input.programName, isGoogle ? 36 : 22, 1)[0] ?? "";
  const memberPrefix = isArabic ? "العضو" : "MEMBER";
  const member = wrapLabel(`${memberPrefix}: ${input.memberName}`, isGoogle ? 48 : 28, 1)[0] ?? "";
  const availableWidth = region.width - inset * 2;
  const organizationSize = fittedFontSize(
    organization,
    isGoogle ? 15 : 8,
    isGoogle ? 11 : 6.5,
    availableWidth,
    isArabic,
  );
  const programSize = fittedFontSize(
    program,
    isGoogle ? 34 : 17,
    isGoogle ? 23 : 11,
    availableWidth,
    isArabic,
  );
  const memberSize = fittedFontSize(
    member,
    isGoogle ? 21 : 10.5,
    isGoogle ? 14 : 7.5,
    availableWidth,
    isArabic,
  );
  const organizationY = region.top + (isGoogle ? 18 : 11);
  const programY = region.top + (isGoogle ? 61 : 40);
  const memberY = region.top + (isGoogle ? 98 : 69);
  const markerX = isArabic ? region.left + region.width - 4 : region.left;
  const clipId = `identity-${region.left}-${region.top}`;
  return `<defs><clipPath id="${clipId}"><rect x="${region.left}" y="${region.top - 4}" width="${region.width}" height="${region.height + 8}"/></clipPath></defs><g clip-path="url(#${clipId})"><rect x="${markerX}" y="${region.top}" width="4" height="${region.height}" rx="2" fill="${input.theme.accentColor}" opacity="0.82"/><text x="${textX}" y="${organizationY}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${organizationSize}" font-weight="800" letter-spacing="${isArabic ? 0 : isGoogle ? 2 : 1.1}" fill="${textColor}" opacity="0.82" direction="${direction}" unicode-bidi="plaintext" xml:lang="${isArabic ? "ar" : "en"}">${escapeXml(organization)}</text><text x="${textX}" y="${programY}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${programSize}" font-weight="900" fill="${textColor}" direction="${direction}" unicode-bidi="plaintext" xml:lang="${isArabic ? "ar" : "en"}">${escapeXml(program)}</text><text x="${textX}" y="${memberY}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${memberSize}" font-weight="700" fill="${textColor}" opacity="0.9" direction="${direction}" unicode-bidi="plaintext" xml:lang="${isArabic ? "ar" : "en"}">${escapeXml(member)}</text></g>`;
}

function giftIconSvg(x: number, y: number, size: number, color: string): string {
  const scale = size / 48;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="19" width="34" height="23" rx="4"/><path d="M5 14h38v9H5zM24 14v28M24 14c-8 0-13-2-13-7 0-3 2-5 5-5 5 0 8 7 8 12Zm0 0c8 0 13-2 13-7 0-3-2-5-5-5-5 0-8 7-8 12Z"/></g>`;
}

function rewardPanelSvg(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
  typeface: string,
): string {
  const { accentColor, backgroundColor, foregroundColor, secondaryColor } = input.theme;
  const eyebrow =
    input.locale === "ar"
      ? input.rewardReady
        ? "المكافأة جاهزة"
        : "المكافأة"
      : input.rewardReady
        ? "REWARD READY"
        : "REWARD";
  const fallback = input.locale === "ar" ? "مكافأتك القادمة" : "Your next reward";
  const isGoogle = region.width > 500;
  const appleCharacters = Math.max(12, Math.floor((region.width - 72) / 6.2));
  const lines = wrapLabel(input.rewardLabel || fallback, isGoogle ? 36 : appleCharacters, 2);
  const isArabic = input.locale === "ar";
  const darkTheme = relativeLuminance(backgroundColor) < 0.34;
  const fill = input.rewardReady ? accentColor : "#FFFFFF";
  const textColor = readableTextColor(
    input.rewardReady ? backgroundColor : foregroundColor,
    input.rewardReady ? accentColor : backgroundColor,
  );
  const stroke = input.rewardReady ? backgroundColor : accentColor;
  const iconSize = isGoogle ? 62 : 28;
  const horizontalPadding = isGoogle ? 34 : 14;
  const iconX = isArabic
    ? region.left + region.width - horizontalPadding - iconSize
    : region.left + horizontalPadding;
  const iconY = region.top + (region.height - iconSize) / 2;
  const textGap = isGoogle ? 30 : 10;
  const textX = isArabic ? iconX - textGap : iconX + iconSize + textGap;
  // In SVG, `start` follows the active writing direction: it is the right edge
  // for RTL and the left edge for LTR. This keeps Arabic text left of the
  // mirrored right-side gift icon instead of allowing it to grow into the icon.
  const textAnchor = "start";
  const eyebrowY = region.top + (isGoogle ? 43 : 26);
  const bodyY = region.top + (isGoogle ? 82 : 49);
  const availableTextWidth = region.width - horizontalPadding * 2 - iconSize - textGap - 18;
  const bodySize = Math.min(
    ...lines.map((line) =>
      fittedFontSize(line, isGoogle ? 30 : 15, isGoogle ? 20 : 10.5, availableTextWidth, isArabic),
    ),
  );
  const lineGap = isGoogle ? 34 : 18;
  const clipId = `reward-${region.left}-${region.top}`;
  return `<rect x="${region.left}" y="${region.top + 6}" width="${region.width}" height="${region.height}" rx="${isGoogle ? 30 : 18}" fill="#000000" opacity="${darkTheme ? 0.18 : 0.08}"/><rect x="${region.left}" y="${region.top}" width="${region.width}" height="${region.height}" rx="${isGoogle ? 30 : 18}" fill="${fill}" fill-opacity="${input.rewardReady ? 0.96 : darkTheme ? 0.12 : 0.68}" stroke="${stroke}" stroke-width="${isGoogle ? 3 : 1.5}" stroke-opacity="${input.rewardReady ? 0.42 : 0.28}"/>${giftIconSvg(iconX, iconY, iconSize, textColor)}<defs><clipPath id="${clipId}"><rect x="${region.left + 10}" y="${region.top + 8}" width="${region.width - 20}" height="${region.height - 16}" rx="${isGoogle ? 22 : 12}"/></clipPath></defs><g clip-path="url(#${clipId})"><text x="${textX}" y="${eyebrowY}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${isGoogle ? 16 : 8.5}" font-weight="800" letter-spacing="${isArabic ? 0 : isGoogle ? 2.2 : 1.2}" fill="${textColor}" opacity="0.76" direction="${isArabic ? "rtl" : "ltr"}" unicode-bidi="plaintext" xml:lang="${isArabic ? "ar" : "en"}">${escapeXml(eyebrow)}</text>${lines
    .map(
      (line, index) =>
        `<text x="${textX}" y="${bodyY + index * lineGap}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${bodySize}" font-weight="800" fill="${textColor}" direction="${isArabic ? "rtl" : "ltr"}" unicode-bidi="plaintext" xml:lang="${isArabic ? "ar" : "en"}">${escapeXml(line)}</text>`,
    )
    .join(
      "",
    )}</g><circle cx="${isArabic ? region.left + (isGoogle ? 32 : 16) : region.left + region.width - (isGoogle ? 32 : 16)}" cy="${region.top + region.height / 2}" r="${isGoogle ? 8 : 4}" fill="${secondaryColor}" opacity="0.6"/>`;
}

function diagonalCornerPanelPath(
  region: WalletArtworkPlacement,
  specialRadius: number,
  standardRadius: number,
): string {
  const right = region.left + region.width;
  const bottom = region.top + region.height;
  return `M${region.left + specialRadius} ${region.top}H${right - standardRadius}Q${right} ${region.top} ${right} ${region.top + standardRadius}V${bottom - specialRadius}Q${right} ${bottom} ${right - specialRadius} ${bottom}H${region.left + standardRadius}Q${region.left} ${bottom} ${region.left} ${bottom - standardRadius}V${region.top + specialRadius}Q${region.left} ${region.top} ${region.left + specialRadius} ${region.top}Z`;
}

function imageFirstStampPanelSvg(
  region: WalletArtworkPlacement,
  accentColor: string,
  backgroundColor: string,
  foregroundColor: string,
  google: boolean,
): string {
  const corners = google
    ? walletArtworkPanelCorners.GOOGLE_HERO
    : walletArtworkPanelCorners.APPLE_POSTER;
  const path = diagonalCornerPanelPath(region, corners.topLeft, corners.topRight);
  const darkTheme = relativeLuminance(backgroundColor) < 0.34;
  return `<path d="${path}" fill="#000000" opacity="${darkTheme ? 0.16 : 0.07}" transform="translate(0 ${google ? 10 : 5})"/><path d="${path}" fill="${darkTheme ? "#FFFFFF" : foregroundColor}" opacity="${darkTheme ? 0.1 : 0.045}" stroke="${accentColor}" stroke-width="${google ? 3 : 1.5}" stroke-opacity="${darkTheme ? 0.26 : 0.18}"/><path d="M${region.left + corners.topLeft} ${region.top + 1}H${region.left + region.width - corners.topRight}" fill="none" stroke="#FFFFFF" stroke-width="${google ? 2 : 1}" stroke-linecap="round" opacity="${darkTheme ? 0.2 : 0.54}"/>`;
}

function qrFrameSvg(
  region: WalletArtworkPlacement,
  accentColor: string,
  backgroundColor: string,
  google: boolean,
): string {
  const radius = google ? 38 : 22;
  const darkTheme = relativeLuminance(backgroundColor) < 0.34;
  return `<rect x="${region.left}" y="${region.top + (google ? 9 : 5)}" width="${region.width}" height="${region.height}" rx="${radius}" fill="#000000" opacity="${darkTheme ? 0.2 : 0.1}"/><rect x="${region.left}" y="${region.top}" width="${region.width}" height="${region.height}" rx="${radius}" fill="#FFFEFC" stroke="${accentColor}" stroke-width="${google ? 4 : 2}" stroke-opacity="0.42"/><path d="M${region.left + radius} ${region.top + (google ? 3 : 2)}H${region.left + region.width - radius}" stroke="#FFFFFF" stroke-width="${google ? 3 : 1.5}" stroke-linecap="round" opacity="0.9"/>`;
}

function canvasSvg(
  input: WalletArtworkCompositionInput,
  target: WalletArtworkTarget,
  width: number,
  height: number,
  scale: WalletArtworkScale,
): string {
  const logical = walletArtworkDimensions[target];
  const layout = walletArtworkLayouts[target];
  const { backgroundColor, accentColor, secondaryColor } = input.theme;
  const artworkMotif = motif(
    input.layoutType,
    logical.width,
    logical.height,
    accentColor,
    secondaryColor,
  );

  let foreground = "";
  if (target === "APPLE_POSTER") {
    const regions = requiredImageFirstRegions(layout);
    foreground = `${imageFirstStampPanelSvg(layout.stampPanelRegion, accentColor, backgroundColor, input.theme.foregroundColor, false)}${qrFrameSvg(regions.qrRegion, accentColor, backgroundColor, false)}`;
  } else if (target === "APPLE_GENERIC_STRIP") {
    foreground = `<rect x="5" y="5" width="365" height="134" rx="25" fill="#000000" opacity="0.07" transform="translate(0 2)"/><rect x="5" y="5" width="365" height="134" rx="25" fill="#FFFFFF" opacity="0.5" stroke="${input.rewardReady ? secondaryColor : accentColor}" stroke-width="${input.rewardReady ? 4 : 1.5}" stroke-opacity="${input.rewardReady ? 0.72 : 0.18}"/>`;
  } else if (target === "APPLE_LEGACY_STRIP") {
    foreground = `<rect x="5" y="4" width="365" height="115" rx="23" fill="#000000" opacity="0.07" transform="translate(0 2)"/><rect x="5" y="4" width="365" height="115" rx="23" fill="#FFFFFF" opacity="0.5" stroke="${input.rewardReady ? secondaryColor : accentColor}" stroke-width="${input.rewardReady ? 4 : 1.5}" stroke-opacity="${input.rewardReady ? 0.72 : 0.18}"/>`;
  } else {
    const regions = requiredImageFirstRegions(layout);
    foreground = `${imageFirstStampPanelSvg(layout.stampPanelRegion, accentColor, backgroundColor, input.theme.foregroundColor, true)}${qrFrameSvg(regions.qrRegion, accentColor, backgroundColor, true)}`;
  }

  const ambientId = `ambient-${target.toLocaleLowerCase("en-US")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logical.width} ${logical.height}"><defs><radialGradient id="${ambientId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.18"/><stop offset="100%" stop-color="${secondaryColor}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="${backgroundColor}"/><ellipse cx="${logical.width * 0.79}" cy="${logical.height * 0.18}" rx="${logical.width * 0.23}" ry="${logical.height * 0.19}" fill="url(#${ambientId})"/><path d="M${logical.width * 0.06} ${logical.height * 0.075}C${logical.width * 0.3} ${logical.height * 0.025},${logical.width * 0.56} ${logical.height * 0.13},${logical.width * 0.9} ${logical.height * 0.065}" fill="none" stroke="${secondaryColor}" stroke-width="${Math.max(4, logical.width * 0.012)}" stroke-linecap="round" opacity="0.08"/>${artworkMotif}${foreground}<metadata data-composer="waflo-wallet-artwork-v5" data-target="${target}" data-scale="${scale}" data-source-stamp-digest="${input.stampArtwork.contentDigest}"/></svg>`;
}

function canvasOverlaySvg(
  input: WalletArtworkCompositionInput,
  target: WalletArtworkTarget,
  width: number,
  height: number,
): string | undefined {
  if (target !== "APPLE_POSTER" && target !== "GOOGLE_HERO") return undefined;
  const logical = walletArtworkDimensions[target];
  const regions = requiredImageFirstRegions(walletArtworkLayouts[target]);
  const typeface = walletArtworkArabicTypeface;
  const overlay = `${identitySvg(input, regions.identityRegion, typeface)}${counterBadgeSvg(input, regions.counterBadgeRegion, typeface)}${rewardPanelSvg(input, regions.rewardRegion, typeface)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logical.width} ${logical.height}">${overlay}</svg>`;
}

function requiredImageFirstRegions(layout: WalletArtworkLayout): {
  identityRegion: WalletArtworkPlacement;
  counterBadgeRegion: WalletArtworkPlacement;
  rewardRegion: WalletArtworkPlacement;
  qrRegion: WalletArtworkPlacement;
} {
  if (
    !layout.identityRegion ||
    !layout.counterBadgeRegion ||
    !layout.rewardRegion ||
    !layout.qrRegion
  ) {
    throw new Error(
      "Image-first Wallet artwork requires identity, counter, reward, and QR regions.",
    );
  }
  return {
    identityRegion: layout.identityRegion,
    counterBadgeRegion: layout.counterBadgeRegion,
    rewardRegion: layout.rewardRegion,
    qrRegion: layout.qrRegion,
  };
}

async function rasterizedVisibleStamp(input: WalletArtworkCompositionInput): Promise<{
  bytes: Buffer;
  visibleBounds: WalletArtworkVisibleBounds;
  aspectRatio: number;
}> {
  const visibleBounds = measureRenderedStampArtwork(input.stampArtwork, input.stampSize);
  const source = await sharp(Buffer.from(input.stampArtwork.svg, "utf8"), { density: 216 })
    .png()
    .toBuffer({ resolveWithObject: true });
  const xScale = source.info.width / input.stampArtwork.width;
  const yScale = source.info.height / input.stampArtwork.height;
  const left = Math.max(0, Math.floor(visibleBounds.left * xScale));
  const top = Math.max(0, Math.floor(visibleBounds.top * yScale));
  const right = Math.min(source.info.width, Math.ceil(visibleBounds.right * xScale));
  const bottom = Math.min(source.info.height, Math.ceil(visibleBounds.bottom * yScale));
  const extracted = await sharp(source.data)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
  const cropped = await sharp(extracted)
    // Trim in a second pipeline so Sharp cannot reorder it before extraction.
    // Wallet renderer backgrounds are transparent; only transparent outer
    // pixels are removed and the persisted stamp artwork remains unchanged.
    .trim({ threshold: 4 })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: cropped.data,
    visibleBounds,
    aspectRatio: cropped.info.width / cropped.info.height,
  };
}

async function premiumQrArtwork(
  input: WalletArtworkCompositionInput,
  target: "APPLE_POSTER" | "GOOGLE_HERO",
  frameRegion: WalletArtworkPlacement,
  scale: WalletArtworkScale,
): Promise<{
  bytes: Buffer;
  left: number;
  top: number;
  centerLogoApplied: boolean;
}> {
  const logicalInset = target === "GOOGLE_HERO" ? 14 : 7;
  const inset = logicalInset * scale;
  const width = frameRegion.width - inset * 2;
  const left = frameRegion.left + inset;
  const top = frameRegion.top + inset;
  const plain = await createQrPng(input.credentialPayload, {
    width,
    // The surrounding white plate completes the quiet zone, so a one-module
    // internal margin gives the data modules more physical size at Apple 1x.
    margin: 1,
    errorCorrectionLevel: "Q",
  });
  if (!input.qrCenterLogo) {
    return { bytes: plain, left, top, centerLogoApplied: false };
  }

  try {
    const logoBase = await createQrPng(input.credentialPayload, {
      width,
      margin: 1,
      errorCorrectionLevel: "H",
    });
    const logoSource = sharp(Buffer.from(input.qrCenterLogo.bytes), {
      failOn: "error",
      limitInputPixels: 1_000_000,
      sequentialRead: true,
    });
    const metadata = await logoSource.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      !new Set(["png", "jpeg", "webp"]).has(metadata.format ?? "") ||
      (metadata.pages !== undefined && metadata.pages > 1)
    ) {
      throw new Error("Unsupported QR center logo.");
    }
    const plateSize = Math.max(14, Math.floor(width * 0.17));
    const logoSize = Math.max(10, Math.floor(width * 0.115));
    const logo = await logoSource
      .resize({ width: logoSize, height: logoSize, fit: "contain", withoutEnlargement: false })
      .png()
      .toBuffer();
    const plate = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${plateSize}" height="${plateSize}" viewBox="0 0 ${plateSize} ${plateSize}"><rect width="${plateSize}" height="${plateSize}" rx="${plateSize * 0.3}" fill="#FFFEFC"/></svg>`,
      "utf8",
    );
    const plateLeft = Math.round((width - plateSize) / 2);
    const logoLeft = Math.round((width - logoSize) / 2);
    const styled = await sharp(logoBase)
      .composite([
        { input: plate, left: plateLeft, top: plateLeft },
        { input: logo, left: logoLeft, top: logoLeft },
      ])
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    // Optional center marks are accepted only when the production decoder can
    // still recover the exact opaque credential. Otherwise the plain QR wins.
    if ((await decodeQrImage(styled, "image/png")) !== input.credentialPayload) {
      throw new Error("QR center logo changed the decoded credential.");
    }
    return { bytes: styled, left, top, centerLogoApplied: true };
  } catch {
    return { bytes: plain, left, top, centerLogoApplied: false };
  }
}

export async function validateWalletArtworkPng(input: {
  readonly bytes: Uint8Array;
  readonly target: WalletArtworkTarget;
  readonly scale?: WalletArtworkScale;
}): Promise<{ width: number; height: number; size: number }> {
  const scale = input.scale ?? 1;
  const bytes = Buffer.from(input.bytes);
  const dimensions = walletArtworkDimensions[input.target];
  if (bytes.length === 0 || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`${input.target} artwork is not a valid PNG.`);
  }
  if (bytes.length > dimensions.maxBytes) {
    throw new Error(`${input.target} artwork exceeds its ${dimensions.maxBytes}-byte limit.`);
  }
  const metadata = await sharp(bytes).metadata();
  const expectedWidth = dimensions.width * scale;
  const expectedHeight = dimensions.height * scale;
  if (
    metadata.format !== "png" ||
    metadata.width !== expectedWidth ||
    metadata.height !== expectedHeight
  ) {
    throw new Error(
      `${input.target} artwork must be ${expectedWidth}x${expectedHeight} PNG; received ${metadata.width ?? 0}x${metadata.height ?? 0} ${metadata.format ?? "unknown"}.`,
    );
  }
  return { width: expectedWidth, height: expectedHeight, size: bytes.length };
}

export async function composeWalletArtwork(
  input: WalletArtworkCompositionInput,
  target: WalletArtworkTarget,
  scale: WalletArtworkScale = 1,
): Promise<ComposedWalletArtwork> {
  assertCompositionInput(input);
  if (target === "GOOGLE_HERO" && scale !== 1) {
    throw new Error("Google hero artwork has one fixed 1032x812 output size.");
  }
  const dimensions = walletArtworkDimensions[target];
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  const layout = walletArtworkLayouts[target];
  const stampRegion = {
    left: layout.stampRegion.left * scale,
    top: layout.stampRegion.top * scale,
    width: layout.stampRegion.width * scale,
    height: layout.stampRegion.height * scale,
  };
  const stampPanelRegion = {
    left: layout.stampPanelRegion.left * scale,
    top: layout.stampPanelRegion.top * scale,
    width: layout.stampPanelRegion.width * scale,
    height: layout.stampPanelRegion.height * scale,
  };
  const source = await rasterizedVisibleStamp(input);
  const resized = await sharp(source.bytes)
    .resize({
      width: stampRegion.width,
      height: stampRegion.height,
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const stampPlacement = {
    left: Math.round(stampRegion.left + (stampRegion.width - resized.info.width) / 2),
    top: Math.round(stampRegion.top + (stampRegion.height - resized.info.height) / 2),
    width: resized.info.width,
    height: resized.info.height,
  };
  const base = Buffer.from(canvasSvg(input, target, width, height, scale), "utf8");
  const qrRegion = scaledPlacement(layout.qrRegion, scale);
  const qr =
    qrRegion && (target === "APPLE_POSTER" || target === "GOOGLE_HERO")
      ? await premiumQrArtwork(input, target, qrRegion, scale)
      : undefined;
  const overlay = canvasOverlaySvg(input, target, width, height);
  const bytes = await sharp(base)
    .composite([
      { input: resized.data, left: stampPlacement.left, top: stampPlacement.top },
      ...(qr ? [{ input: qr.bytes, left: qr.left, top: qr.top }] : []),
      ...(overlay ? [{ input: Buffer.from(overlay, "utf8"), left: 0, top: 0 }] : []),
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await validateWalletArtworkPng({ bytes, target, scale });
  const counterBadgeRegion = scaledPlacement(layout.counterBadgeRegion, scale);
  const rewardRegion = scaledPlacement(layout.rewardRegion, scale);
  const identityRegion = scaledPlacement(layout.identityRegion, scale);
  return {
    bytes,
    target,
    scale,
    width,
    height,
    contentDigest: createHash("sha256").update(bytes).digest("hex"),
    sourceStampDigest: input.stampArtwork.contentDigest,
    sourceVisibleBounds: source.visibleBounds,
    sourceVisibleRasterAspectRatio: source.aspectRatio,
    stampPlacement,
    stampPanelRegion,
    stampRegion,
    ...(identityRegion ? { identityRegion } : {}),
    ...(counterBadgeRegion ? { counterBadgeRegion } : {}),
    ...(rewardRegion ? { rewardRegion } : {}),
    ...(qrRegion ? { qrRegion } : {}),
    ...(qr?.centerLogoApplied ? { qrCenterLogoApplied: true } : {}),
  };
}

export async function composeApplePosterArtwork(
  input: WalletArtworkCompositionInput,
): Promise<Readonly<Record<"times1" | "times2" | "times3", ComposedWalletArtwork>>> {
  const [times1, times2, times3] = await Promise.all([
    composeWalletArtwork(input, "APPLE_POSTER", 1),
    composeWalletArtwork(input, "APPLE_POSTER", 2),
    composeWalletArtwork(input, "APPLE_POSTER", 3),
  ] as const);
  return { times1, times2, times3 };
}

export async function composeAppleLegacyStripArtwork(
  input: WalletArtworkCompositionInput,
): Promise<Readonly<Record<"times1" | "times2" | "times3", ComposedWalletArtwork>>> {
  // Legacy Apple faces are native-data-heavy. Reward copy belongs to the
  // details/back fields and is deliberately unavailable to the strip renderer.
  const stripInput = { ...input, rewardLabel: "" };
  const [times1, times2, times3] = await Promise.all([
    composeWalletArtwork(stripInput, "APPLE_LEGACY_STRIP", 1),
    composeWalletArtwork(stripInput, "APPLE_LEGACY_STRIP", 2),
    composeWalletArtwork(stripInput, "APPLE_LEGACY_STRIP", 3),
  ] as const);
  return { times1, times2, times3 };
}

export async function composeAppleGenericStripArtwork(
  input: WalletArtworkCompositionInput,
): Promise<Readonly<Record<"times1" | "times2" | "times3", ComposedWalletArtwork>>> {
  // Generic is the iOS 26-and-earlier fallback for Poster Generic. Keep its
  // front strip artwork-only; reward copy remains in native back fields.
  const stripInput = { ...input, rewardLabel: "" };
  const [times1, times2, times3] = await Promise.all([
    composeWalletArtwork(stripInput, "APPLE_GENERIC_STRIP", 1),
    composeWalletArtwork(stripInput, "APPLE_GENERIC_STRIP", 2),
    composeWalletArtwork(stripInput, "APPLE_GENERIC_STRIP", 3),
  ] as const);
  return { times1, times2, times3 };
}

export function walletArtworkInputFromStampRender(
  input: {
    readonly organizationName: string;
    readonly programName: string;
    readonly memberName: string;
    readonly credentialPayload: string;
    readonly qrCenterLogo?: WalletArtworkQrCenterLogo;
    readonly rewardLabel: string;
    readonly stampRenderInput: {
      readonly layoutType: StampLayout;
      readonly locale: "en" | "ar";
      readonly currentStampCount: number;
      readonly requiredStampCount: number;
      readonly rewardReady: boolean;
      readonly visualTheme: {
        readonly backgroundColor?: string;
        readonly foregroundColor?: string;
        readonly accentColor: string;
        readonly emptyColor: string;
        readonly stampSize?: number;
      };
    };
  },
  stampArtwork: WalletArtworkCompositionInput["stampArtwork"],
): WalletArtworkCompositionInput {
  const renderInput = input.stampRenderInput;
  return {
    stampArtwork,
    stampSize: renderInput.visualTheme.stampSize ?? 48,
    layoutType: renderInput.layoutType,
    theme: {
      backgroundColor: renderInput.visualTheme.backgroundColor ?? "#F7F4EE",
      foregroundColor: renderInput.visualTheme.foregroundColor ?? "#241916",
      accentColor: renderInput.visualTheme.accentColor,
      secondaryColor: renderInput.visualTheme.emptyColor,
    },
    currentStampCount: renderInput.currentStampCount,
    requiredStampCount: renderInput.requiredStampCount,
    rewardReady: renderInput.rewardReady,
    rewardLabel: input.rewardLabel,
    organizationName: input.organizationName,
    programName: input.programName,
    memberName: input.memberName,
    credentialPayload: input.credentialPayload,
    ...(input.qrCenterLogo ? { qrCenterLogo: input.qrCenterLogo } : {}),
    locale: renderInput.locale,
  };
}

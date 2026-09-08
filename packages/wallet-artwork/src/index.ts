import { createHash } from "node:crypto";
import { cardLocalePresentation, walletStructuralCopyForLocale } from "@waflo/contracts";
import { createQrPng, decodeQrImage } from "@waflo/qr-core";
import {
  balancedWalletStampDistribution,
  type PublishedMembershipStampRenderResult,
  type StampLayout,
} from "@waflo/stamp-engine";
import sharp from "sharp";
import {
  applePosterTopAmbientSvg as renderPlanApplePosterTopAmbientSvg,
  applePosterGoogleMasterTransform as sharedApplePosterGoogleMasterTransform,
  createWalletArtworkApplePosterRenderPlan as createSharedApplePosterRenderPlan,
  createLegacyWalletStampGridPlan,
  createWalletArtworkRenderPlan,
  googleMasterContentBounds as sharedGoogleMasterContentBounds,
  measureWalletArtworkVisibleBounds,
  type WalletArtworkRenderPlanInput,
  walletArtworkLegacySurfaceSvg,
} from "./render-plan.js";
import {
  APPLE_GENERIC_LAYOUT,
  APPLE_LEGACY_LAYOUT,
  APPLE_POSTER_LAYOUT,
  GOOGLE_HERO_LAYOUT,
  walletArtworkArabicTypeface,
  walletArtworkDimensions,
  walletArtworkLayouts,
  walletArtworkPanelCorners,
  type WalletArtworkLayout,
  type WalletArtworkPlacement,
  type WalletArtworkScale,
  type WalletArtworkTarget,
} from "./model.js";

export {
  APPLE_GENERIC_LAYOUT,
  APPLE_LEGACY_LAYOUT,
  APPLE_POSTER_LAYOUT,
  GOOGLE_HERO_LAYOUT,
  walletArtworkArabicTypeface,
  walletArtworkDimensions,
  walletArtworkLayouts,
  walletArtworkPanelCorners,
};
export type {
  WalletArtworkLayout,
  WalletArtworkPlacement,
  WalletArtworkScale,
  WalletArtworkTarget,
};
export { createWalletArtworkRenderPlan, measureWalletArtworkVisibleBounds };
export type { WalletArtworkRenderPlan, WalletArtworkRenderPlanInput } from "./render-plan.js";

/* Legacy local declarations were moved to model.ts so client and server use one source of geometry.
type LegacyWalletArtworkTarget =
  | "APPLE_POSTER"
  | "APPLE_GENERIC_STRIP"
  | "APPLE_LEGACY_STRIP"
  | "GOOGLE_HERO";
type LegacyWalletArtworkScale = 1 | 2 | 3;

const legacyWalletArtworkDimensions = {
  APPLE_POSTER: { width: 358, height: 448, maxBytes: 4_000_000 },
  APPLE_GENERIC_STRIP: { width: 375, height: 144, maxBytes: 4_000_000 },
  APPLE_LEGACY_STRIP: { width: 375, height: 123, maxBytes: 4_000_000 },
  GOOGLE_HERO: { width: 1_032, height: 812, maxBytes: 5_000_000 },
} as const satisfies Readonly<
  Record<LegacyWalletArtworkTarget, { width: number; height: number; maxBytes: number }>
>;

interface LegacyWalletArtworkPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface LegacyWalletArtworkLayout {
  readonly safeArea: LegacyWalletArtworkPlacement;
  readonly stampPanelRegion: LegacyWalletArtworkPlacement;
  readonly stampRegion: LegacyWalletArtworkPlacement;
  readonly identityRegion?: LegacyWalletArtworkPlacement;
  readonly counterBadgeRegion?: LegacyWalletArtworkPlacement;
  readonly rewardRegion?: LegacyWalletArtworkPlacement;
  readonly qrRegion?: LegacyWalletArtworkPlacement;
  readonly decorationRegion: LegacyWalletArtworkPlacement;
  readonly centerToleranceRatio: number;
}

// Legacy 1x layout contracts are retained only as commented historical context.
const LEGACY_APPLE_POSTER_LAYOUT: LegacyWalletArtworkLayout = {
  safeArea: { left: 18, top: 22, width: 322, height: 404 },
  // Affine projection of GOOGLE_HERO's master component frame
  // (x:32–1000, y:70–750) into Apple’s calibrated safe frame
  // (x:14–344, y:30–310), with the identity height expanded only enough
  // to retain the approved two-line bilingual title and member line.
  identityRegion: { left: 26, top: 20, width: 222, height: 74 },
  counterBadgeRegion: { left: 271, top: 30, width: 61, height: 54 },
  // iOS 27 calibration: Apple-controlled material begins at approximately
  // Y=330.  All poster function ends by Y=309, retaining a 21 pt buffer.
  // Keep the primary panel full-width. Its right side deliberately reserves
  // clear space for the embedded QR; the authoritative stamp distribution is
  // unchanged and only compacted vertically for the calibrated safe area.
  stampPanelRegion: { left: 14, top: 104, width: 330, height: 118 },
  stampRegion: { left: 35, top: 118, width: 183, height: 90 },
  rewardRegion: { left: 32, top: 238, width: 186, height: 62 },
  qrRegion: { left: 228, top: 184, width: 116, height: 116 },
  decorationRegion: { left: 0, top: 0, width: 358, height: 448 },
  centerToleranceRatio: 0.02,
};

const LEGACY_APPLE_GENERIC_LAYOUT: LegacyWalletArtworkLayout = {
  safeArea: { left: 5, top: 5, width: 365, height: 134 },
  stampPanelRegion: { left: 5, top: 5, width: 365, height: 134 },
  stampRegion: { left: 22, top: 19, width: 331, height: 106 },
  decorationRegion: { left: 0, top: 0, width: 375, height: 144 },
  centerToleranceRatio: 0.02,
};

const LEGACY_APPLE_LEGACY_LAYOUT: LegacyWalletArtworkLayout = {
  safeArea: { left: 5, top: 4, width: 365, height: 115 },
  stampPanelRegion: { left: 5, top: 4, width: 365, height: 115 },
  stampRegion: { left: 22, top: 16, width: 331, height: 91 },
  decorationRegion: { left: 0, top: 0, width: 375, height: 123 },
  centerToleranceRatio: 0.02,
};

const LEGACY_GOOGLE_HERO_LAYOUT: LegacyWalletArtworkLayout = {
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

const legacyWalletArtworkLayouts = {
  APPLE_POSTER: LEGACY_APPLE_POSTER_LAYOUT,
  APPLE_GENERIC_STRIP: LEGACY_APPLE_GENERIC_LAYOUT,
  APPLE_LEGACY_STRIP: LEGACY_APPLE_LEGACY_LAYOUT,
  GOOGLE_HERO: LEGACY_GOOGLE_HERO_LAYOUT,
} as const satisfies Readonly<Record<LegacyWalletArtworkTarget, LegacyWalletArtworkLayout>>;

const legacyWalletArtworkPanelCorners = {
  APPLE_POSTER: { topLeft: 38, topRight: 18, bottomLeft: 18, bottomRight: 38 },
  GOOGLE_HERO: { topLeft: 72, topRight: 30, bottomLeft: 30, bottomRight: 72 },
} as const;

const legacyWalletArtworkArabicTypeface =
  "'Noto Sans Arabic','Noto Sans','DejaVu Sans','Segoe UI','Arial',sans-serif";
*/

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
  /** Apple Poster may request a high-contrast counter foreground without moving geometry. */
  readonly counterForegroundColor?: string;
  /** Apple-only presentation scale used before the single Google-group transform. */
  readonly headerScale?: number;
  /** Removes the localized member label while preserving the member value. */
  readonly suppressMemberPrefix?: boolean;
  /** Enables Apple-only refinement while retaining the Google visual language. */
  readonly applePosterRefinement?: boolean;
  /** Poster-only source-space adjustments applied before the approved group transform. */
  readonly appleStampPanelInset?: number;
  readonly headerOffsetY?: number;
  readonly lowerGroupOffsetY?: number;
  /** Canonical BCP-47 card locale. */
  readonly locale: string;
}

/**
 * Server-side entry point for the serializable composition authority. The
 * Sharp pipeline owns only decoding, resampling and compositing; it must not
 * recalculate artwork geometry, wrapping or locale presentation.
 */
export function createWalletArtworkCompositionPlan(
  input: WalletArtworkCompositionInput,
  target: Exclude<WalletArtworkTarget, "APPLE_POSTER">,
  scale: WalletArtworkScale = 1,
) {
  return createWalletArtworkRenderPlan(input satisfies WalletArtworkRenderPlanInput, target, scale);
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
  /** Present only for the legacy Apple strip, which always uses tidy row groups. */
  readonly stampGridRows?: readonly number[];
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
  return measureWalletArtworkVisibleBounds(stampArtwork, stampSize);
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ??
      character,
  );
}

function graphemeSegments(value: string, locale: string): string[] {
  return typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(value)].map(
        (part) => part.segment,
      )
    : Array.from(value);
}

function truncateGraphemes(value: string, maximum: number, locale: string): string {
  const graphemes = graphemeSegments(value, locale);
  return graphemes.length <= maximum
    ? value
    : `${graphemes.slice(0, Math.max(1, maximum - 1)).join("")}\u2026`;
}

function wrapLabel(value: string, maxCharacters: number, maxLines = 2, locale = "en"): string[] {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  let truncated = false;
  for (const rawWord of words) {
    const word = truncateGraphemes(rawWord, maxCharacters, locale);
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
    const graphemes = graphemeSegments((lines[last] ?? "").replace(/…$/, ""), locale);
    lines[last] = `${graphemes
      .slice(0, Math.max(1, maxCharacters - 1))
      .join("")
      .trimEnd()}…`;
  }
  return lines;
}

function motif(
  _layout: StampLayout,
  width: number,
  height: number,
  accent: string,
  secondary: string,
  includeLowerAccent = true,
): string {
  // Decoration follows the only supported topology. This prevents historical
  // PATH/RING configuration values from reintroducing non-grid visual language.
  return `<path d="M${width * 0.7} ${height * 0.045}V${height * 0.17}M${width * 0.8} ${height * 0.045}V${height * 0.2}M${width * 0.9} ${height * 0.045}V${height * 0.16}M${width * 0.67} ${height * 0.08}H${width * 0.96}M${width * 0.69} ${height * 0.15}H${width * 0.96}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, width * 0.005)}" opacity="0.1"/>${includeLowerAccent ? `<rect x="${width * 0.025}" y="${height * 0.77}" width="${width * 0.19}" height="${height * 0.18}" rx="${width * 0.03}" fill="${secondary}" opacity="0.1" transform="rotate(-7 ${width * 0.11} ${height * 0.86})"/>` : ""}`;
}

/** Approved Google Hero-only ambient geometry; it never changes Grid semantics. */
function googleHeroMotif(width: number, height: number, accent: string, secondary: string): string {
  return `<circle cx="${width * 0.84}" cy="${height * 0.2}" r="${width * 0.153}" fill="none" stroke="${accent}" stroke-width="${Math.max(3, width * 0.008)}" opacity="0.12"/><circle cx="${width * 0.123}" cy="${height * 0.845}" r="${width * 0.105}" fill="none" stroke="${secondary}" stroke-width="${Math.max(3, width * 0.008)}" opacity="0.16"/>`;
}

/** Full-bleed Apple Poster header atmosphere, placed on the final canvas. */
export function applePosterTopAmbientSvg(
  width: number,
  height: number,
  accent: string,
  secondary: string,
): string {
  return renderPlanApplePosterTopAmbientSvg(width, height, accent, secondary);
  /* Moved to render-plan.ts so browser and Sharp compose identical atmosphere.
  const badgeX = width * 0.84;
  const badgeY = height * 0.174;
  const badgeClearRadius = width * 0.125;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="apple-top-horizontal" gradientUnits="userSpaceOnUse" x1="${width * 0.06}" y1="0" x2="${width}" y2="0"><stop offset="0%" stop-color="${secondary}" stop-opacity="0"/><stop offset="51%" stop-color="${secondary}" stop-opacity="0.04"/><stop offset="100%" stop-color="${accent}" stop-opacity="0.125"/></linearGradient><radialGradient id="apple-top-glow" gradientUnits="userSpaceOnUse" cx="${badgeX}" cy="${badgeY}" r="${width * 0.43}"><stop offset="0%" stop-color="${secondary}" stop-opacity="0.145"/><stop offset="58%" stop-color="${secondary}" stop-opacity="0.06"/><stop offset="100%" stop-color="${secondary}" stop-opacity="0"/></radialGradient><linearGradient id="apple-top-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height * 0.34}"><stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/><stop offset="64%" stop-color="#FFFFFF" stop-opacity="0.72"/><stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient><radialGradient id="apple-top-badge-clear" gradientUnits="userSpaceOnUse" cx="${badgeX}" cy="${badgeY}" r="${badgeClearRadius}"><stop offset="0%" stop-color="#000000"/><stop offset="64%" stop-color="#000000"/><stop offset="100%" stop-color="#FFFFFF"/></radialGradient><linearGradient id="apple-top-line" gradientUnits="userSpaceOnUse" x1="${width * 0.04}" y1="0" x2="${width}" y2="0"><stop offset="0%" stop-color="${accent}" stop-opacity="0"/><stop offset="62%" stop-color="${accent}" stop-opacity="0.075"/><stop offset="100%" stop-color="${accent}" stop-opacity="0.025"/></linearGradient><mask id="apple-top-visible"><rect width="${width}" height="${height * 0.36}" fill="url(#apple-top-fade)"/><circle cx="${badgeX}" cy="${badgeY}" r="${badgeClearRadius}" fill="url(#apple-top-badge-clear)"/></mask></defs><g mask="url(#apple-top-visible)"><path d="M0 0H${width}V${height * 0.29}C${width * 0.77} ${height * 0.245},${width * 0.48} ${height * 0.235},${width * 0.12} ${height * 0.155}C${width * 0.055} ${height * 0.13},0 ${height * 0.12},0 ${height * 0.1}Z" fill="url(#apple-top-horizontal)"/><ellipse cx="${badgeX}" cy="${badgeY}" rx="${width * 0.44}" ry="${height * 0.28}" fill="url(#apple-top-glow)"/><path d="M${width * 0.05} ${height * 0.08}C${width * 0.31} ${height * 0.01},${width * 0.68} ${height * 0.1},${width * 1.02} ${height * 0.035}" fill="none" stroke="url(#apple-top-line)" stroke-width="${Math.max(1.2, width * 0.003)}" stroke-linecap="round"/></g></svg>`;
  */
}

function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

/** Matches the slightly warmer native compositing of legacy Store Card strips. */
function legacyAppleSurfaceColor(hex: string): string {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  );
  const [red = 0, green = 0, blue = 0] = channels;
  return `#${[red - 2, green + 1, blue + 2]
    .map((channel) => Math.min(255, Math.max(0, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Mirrors the slightly lifted surface created by Google Wallet's Hero image compositor. */
function googleHeroSurfaceColor(hex: string): string {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  );
  const [red = 0, green = 0, blue = 0] = channels;
  return `#${[red, green + 1, blue + 2]
    .map((channel) => Math.min(255, Math.max(0, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
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
  locale: string,
): number {
  const presentation = cardLocalePresentation(locale);
  // Sharp/libvips does not expose text metrics for SVG overlays. Estimate at
  // grapheme level instead of UTF-16/code-point length: combining marks take
  // no advance width and Arabic-script clusters are wider than Latin glyphs.
  const graphemes =
    typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter(presentation.locale, { granularity: "grapheme" }).segment(value),
        ].map((part) => part.segment)
      : Array.from(value);
  const units = graphemes.reduce((total, grapheme) => {
    if (/^\p{Mark}+$/u.test(grapheme)) return total;
    if (/\p{Script=Arabic}|\p{Script=Hebrew}/u.test(grapheme)) return total + 0.68;
    if (/\p{Number}|[/:.-]/u.test(grapheme)) return total + 0.56;
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(grapheme))
      return total + 0.98;
    return total + 0.56;
  }, 0);
  const estimatedWidth = Math.max(1, units) * preferredSize;
  return Math.max(
    minimumSize,
    Math.min(preferredSize, Number((preferredSize * (availableWidth / estimatedWidth)).toFixed(2))),
  );
}

function containsArabic(value: string): boolean {
  return /\p{Script=Arabic}/u.test(value);
}

function containsLatin(value: string): boolean {
  return /\p{Script=Latin}/u.test(value);
}

/**
 * Keeps a program name's language phrases intact.  A slash is a language
 * separator in merchant copy, not a permissible line-break opportunity.
 */
export function walletArtworkIdentityTitleLines(
  programName: string,
  locale: string,
): readonly string[] {
  const phrases = programName
    .split(/\s*[/|]\s*/u)
    .map((phrase) => phrase.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (phrases.length === 0) return [];

  const arabic = phrases.filter(containsArabic);
  const latin = phrases.filter((phrase) => !containsArabic(phrase) && containsLatin(phrase));
  const neutral = phrases.filter((phrase) => !containsArabic(phrase) && !containsLatin(phrase));
  const join = (items: readonly string[]) => items.join(" · ");
  const arabicLine = join(arabic);
  const latinLine = join([...latin, ...neutral]);

  if (arabicLine && latinLine) {
    return cardLocalePresentation(locale).isRtl ? [arabicLine, latinLine] : [latinLine, arabicLine];
  }
  // A single-language name remains one complete phrase even when it needs a
  // smaller measured font size to fit the identity region.
  return [join(phrases)];
}

function counterBadgeSvg(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
  typeface: string,
): string {
  const { accentColor, backgroundColor } = input.theme;
  const presentation = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(presentation.locale);
  const visualRegion = calibratedGoogleHeroCounterRegion(input, region);
  const textColor = input.counterForegroundColor ?? readableTextColor(backgroundColor, accentColor);
  const label = copy.stamps;
  const isRtl = presentation.isRtl;
  const cx = visualRegion.left + visualRegion.width / 2;
  const cy = visualRegion.top + visualRegion.height / 2;
  const radius = Math.min(visualRegion.width, visualRegion.height) / 2;
  const headerScale = input.headerScale ?? 1;
  const labelSize = (visualRegion.width > 150 ? 18 : 10) * headerScale;
  const valueSize = (visualRegion.width > 150 ? 36 : 22) * headerScale;
  return `<circle cx="${cx}" cy="${cy + 5}" r="${radius - 3}" fill="#000000" opacity="0.12"/><circle cx="${cx}" cy="${cy}" r="${radius - 3}" fill="${accentColor}" stroke="${backgroundColor}" stroke-width="${visualRegion.width > 150 ? 6 : 3}" stroke-opacity="0.72"/><text x="${cx}" y="${cy - (visualRegion.width > 150 ? 13 : 9)}" text-anchor="middle" font-family="${typeface}" font-size="${labelSize}" font-weight="800" letter-spacing="${isRtl ? 0 : 1.5}" fill="${textColor}" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(label)}</text><text x="${cx}" y="${cy + (visualRegion.width > 150 ? 30 : 21)}" text-anchor="middle" font-family="${typeface}" font-size="${valueSize}" font-weight="900" letter-spacing="-0.8" fill="${textColor}" direction="ltr" unicode-bidi="plaintext" xml:lang="en">${input.currentStampCount}/${input.requiredStampCount}</text>`;
}

function calibratedGoogleHeroCounterRegion(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
): WalletArtworkPlacement {
  return region.width > 150 && !input.applePosterRefinement
    ? { ...region, left: region.left + 2, top: region.top - 1 }
    : region;
}

function calibratedGoogleHeroStampPanelRegion(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
): WalletArtworkPlacement {
  // Reference registration places the Grid tiles exactly; only the enclosing
  // Google-owned panel begins four source pixels too low. Keep the tile grid
  // and its historical artwork untouched while extending the panel upward.
  return region.width > 500 && !input.applePosterRefinement
    ? { ...region, top: region.top - 4, height: region.height + 4 }
    : region;
}

function calibratedGoogleHeroRewardRegion(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
): WalletArtworkPlacement {
  return region.width > 500 && !input.applePosterRefinement
    ? { ...region, top: region.top + 2 }
    : region;
}

function calibratedGoogleHeroQrRegion(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
): WalletArtworkPlacement {
  // Screenshot registration places the full QR plate one source pixel down
  // and two source pixels right. The credential bytes and QR module geometry
  // are unchanged.
  return region.width > 150 && !input.applePosterRefinement
    ? { ...region, left: region.left + 2, top: region.top + 1 }
    : region;
}

function identitySvg(
  input: WalletArtworkCompositionInput,
  region: WalletArtworkPlacement,
  typeface: string,
): string {
  const presentation = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(presentation.locale);
  const isRtl = presentation.isRtl;
  const isGoogle = region.width > 400;
  const approvedGoogleHero = isGoogle && !input.applePosterRefinement;
  const inset = isGoogle ? (approvedGoogleHero ? 15 : 18) : 8;
  const textX = isRtl ? region.left + region.width - inset : region.left + inset;
  // SVG `start` follows the active direction, so it is the visual right edge
  // for Arabic and the visual left edge for English.
  const textAnchor = "start";
  const direction = presentation.direction;
  const headerScale = input.headerScale ?? 1;
  const textColor = readableTextColor(input.theme.foregroundColor, input.theme.backgroundColor);
  const organization =
    wrapLabel(input.organizationName, isGoogle ? 44 : 24, 1, presentation.locale)[0] ?? "";
  const titleLines = walletArtworkIdentityTitleLines(input.programName, input.locale);
  const memberPrefix = copy.member;
  const member =
    wrapLabel(
      input.suppressMemberPrefix ? input.memberName : `${memberPrefix}: ${input.memberName}`,
      isGoogle ? 48 : 28,
      1,
      presentation.locale,
    )[0] ?? "";
  const availableWidth = region.width - inset * 2;
  const organizationSize = fittedFontSize(
    organization,
    (isGoogle ? 15 : 8) * headerScale,
    (isGoogle ? 11 : 6.5) * headerScale,
    availableWidth,
    presentation.locale,
  );
  const titleSize = isGoogle
    ? Math.min(
        ...titleLines.map((line) =>
          fittedFontSize(
            line,
            (approvedGoogleHero ? 35 : 27) * headerScale,
            16 * headerScale,
            availableWidth,
            presentation.locale,
          ),
        ),
      )
    : Math.min(
        ...titleLines.map((line) =>
          fittedFontSize(
            line,
            15 * headerScale,
            9 * headerScale,
            availableWidth,
            presentation.locale,
          ),
        ),
      );
  const memberSize = fittedFontSize(
    member,
    (isGoogle ? (approvedGoogleHero ? 22 : 21) : 10.5) * headerScale,
    (isGoogle ? 14 : 7.5) * headerScale,
    availableWidth,
    presentation.locale,
  );
  const organizationY = region.top + (isGoogle ? (approvedGoogleHero ? 17 : 18) : 11);
  const titleY = region.top + (isGoogle ? (approvedGoogleHero ? 59 : 52) : 33);
  const titleLineGap = isGoogle ? 28 : 18;
  const memberY = region.top + (isGoogle ? (approvedGoogleHero ? 97 : 103) : 70);
  const markerX = isRtl
    ? region.left + region.width - 4
    : region.left - (approvedGoogleHero ? 4 : 0);
  const clipId = `identity-${region.left}-${region.top}`;
  const title = titleLines
    .map((line, index) => {
      const arabic = presentation.isRtl;
      const commonRtlTitle = isRtl;
      // Arabic RTL `start` and English LTR `end` meet at one common trailing
      // edge, keeping the bilingual name as a single identity block.
      const x = isGoogle
        ? textX
        : commonRtlTitle
          ? region.left + region.width - inset
          : arabic
            ? region.left + region.width - inset
            : region.left + inset;
      const anchor = commonRtlTitle && !arabic ? "end" : "start";
      return `<text x="${x}" y="${titleY + index * titleLineGap}" text-anchor="${anchor}" font-family="${typeface}" font-size="${titleSize}" font-weight="900" fill="${textColor}" direction="${direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(line)}</text>`;
    })
    .join("");
  const organizationMarkup = isGoogle
    ? `<text x="${textX}" y="${organizationY}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${organizationSize}" font-weight="800" letter-spacing="${isRtl ? 0 : 2}" fill="${textColor}" opacity="0.82" direction="${direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(organization)}</text>`
    : "";
  return `<defs><clipPath id="${clipId}"><rect x="${region.left}" y="${region.top - 4}" width="${region.width}" height="${region.height + 8}"/></clipPath></defs><g clip-path="url(#${clipId})"><rect x="${markerX}" y="${region.top}" width="4" height="${region.height}" rx="2" fill="${input.theme.accentColor}" opacity="0.82"/>${organizationMarkup}${title}<text x="${textX}" y="${memberY}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${memberSize}" font-weight="700" fill="${textColor}" opacity="0.9" direction="${direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(member)}</text></g>`;
}

export function posterSafeReserveDecorationSvg(
  width: number,
  accentColor: string,
  secondaryColor: string,
): string {
  // iOS 27 begins covering material around Y=330. Keep this ambient-only
  // continuation inside the visible 310–330 transition and fade it to zero
  // before the real cutoff rather than drawing decoration beneath it.
  const reserveTop = 310;
  const fadeBottom = 330;
  return `<defs><linearGradient id="poster-safe-continuation" gradientUnits="userSpaceOnUse" x1="0" y1="${reserveTop}" x2="0" y2="${fadeBottom}"><stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.09"/><stop offset="100%" stop-color="${secondaryColor}" stop-opacity="0"/></linearGradient><linearGradient id="poster-safe-curve" gradientUnits="userSpaceOnUse" x1="0" y1="${reserveTop}" x2="0" y2="${fadeBottom}"><stop offset="0%" stop-color="${accentColor}" stop-opacity="0.07"/><stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/></linearGradient><clipPath id="poster-safe-reserve"><rect x="0" y="${reserveTop}" width="${width}" height="${fadeBottom - reserveTop}"/></clipPath></defs><g clip-path="url(#poster-safe-reserve)"><ellipse cx="${width * 0.24}" cy="${reserveTop + 3}" rx="${width * 0.34}" ry="22" fill="url(#poster-safe-continuation)"/><ellipse cx="${width * 0.82}" cy="${reserveTop + 8}" rx="${width * 0.2}" ry="16" fill="url(#poster-safe-continuation)" opacity="0.72"/><path d="M${width * -0.06} ${reserveTop + 5}C${width * 0.24} ${reserveTop - 4},${width * 0.62} ${reserveTop + 20},${width * 1.06} ${reserveTop + 7}" fill="none" stroke="url(#poster-safe-curve)" stroke-width="1.2" stroke-linecap="round"/></g>`;
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
  const presentation = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(presentation.locale);
  // Google’s native Hero plate is fractionally wider than its semantic region.
  // Keep the Poster master untouched; its compact projection already accounts
  // for that presentation difference.
  const visualRegion = calibratedGoogleHeroRewardRegion(input, region);
  const eyebrow = input.rewardReady ? copy.rewardReady : copy.reward;
  const fallback = presentation.isRtl ? copy.nextReward : "Your next reward";
  const isGoogle = visualRegion.width > 500;
  const isRtl = presentation.isRtl;
  // A slash divides translated reward phrases; it must never create an
  // ellipsized partial English word on the compact calibrated Poster.
  const lines = walletArtworkIdentityTitleLines(input.rewardLabel || fallback, input.locale);
  const darkTheme = relativeLuminance(backgroundColor) < 0.34;
  const fill = input.rewardReady ? accentColor : "#FFFFFF";
  const textColor = readableTextColor(
    input.rewardReady ? backgroundColor : foregroundColor,
    input.rewardReady ? accentColor : backgroundColor,
  );
  const stroke = input.rewardReady ? backgroundColor : accentColor;
  const compactApple = !isGoogle && visualRegion.height <= 70;
  const iconSize = isGoogle ? 62 : compactApple ? 22 : 28;
  const horizontalPadding = isGoogle ? 34 : compactApple ? 10 : 14;
  const defaultIconX = isRtl
    ? region.left + region.width - horizontalPadding - iconSize
    : region.left + horizontalPadding;
  const iconX =
    visualRegion.left === region.left && visualRegion.width === region.width
      ? defaultIconX
      : isRtl
        ? visualRegion.left + visualRegion.width - horizontalPadding - iconSize
        : visualRegion.left + horizontalPadding;
  const iconY = visualRegion.top + (visualRegion.height - iconSize) / 2;
  const textGap = isGoogle ? 30 : compactApple ? 6 : 10;
  const textX = isRtl ? iconX - textGap : iconX + iconSize + textGap;
  // In SVG, `start` follows the active writing direction: it is the right edge
  // for RTL and the left edge for LTR. This keeps Arabic text left of the
  // mirrored right-side gift icon instead of allowing it to grow into the icon.
  const textAnchor = "start";
  const eyebrowY = visualRegion.top + (isGoogle ? 43 : compactApple ? 17 : 26);
  const bodyY = visualRegion.top + (isGoogle ? 82 : compactApple ? 36 : 49);
  const availableTextWidth =
    visualRegion.width - horizontalPadding * 2 - iconSize - textGap - (compactApple ? 8 : 18);
  const bodySize = Math.min(
    ...lines.map((line) =>
      fittedFontSize(
        line,
        isGoogle ? 30 : 15,
        isGoogle ? 20 : compactApple ? 7.5 : 10.5,
        availableTextWidth,
        presentation.locale,
      ),
    ),
  );
  const lineGap = isGoogle ? 34 : compactApple ? 14 : 18;
  const clipId = `reward-${visualRegion.left}-${visualRegion.top}`;
  const clipInset = compactApple ? 4 : 8;
  return `<rect x="${visualRegion.left}" y="${visualRegion.top + 6}" width="${visualRegion.width}" height="${visualRegion.height}" rx="${isGoogle ? 30 : 18}" fill="#000000" opacity="${darkTheme ? 0.18 : 0.08}"/><rect x="${visualRegion.left}" y="${visualRegion.top}" width="${visualRegion.width}" height="${visualRegion.height}" rx="${isGoogle ? 30 : 18}" fill="${fill}" fill-opacity="${input.rewardReady ? 0.96 : darkTheme ? 0.12 : 0.68}" stroke="${stroke}" stroke-width="${isGoogle ? 3 : 1.5}" stroke-opacity="${input.rewardReady ? 0.42 : 0.28}"/>${giftIconSvg(iconX, iconY, iconSize, textColor)}<defs><clipPath id="${clipId}"><rect x="${visualRegion.left + 10}" y="${visualRegion.top + clipInset}" width="${visualRegion.width - 20}" height="${visualRegion.height - clipInset * 2}" rx="${isGoogle ? 22 : 12}"/></clipPath></defs><g clip-path="url(#${clipId})"><text x="${textX}" y="${eyebrowY}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${isGoogle ? 16 : 8.5}" font-weight="800" letter-spacing="${isRtl ? 0 : isGoogle ? 2.2 : 1.2}" fill="${textColor}" opacity="0.76" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(eyebrow)}</text>${lines
    .map(
      (line, index) =>
        `<text x="${textX}" y="${bodyY + index * lineGap}" text-anchor="${textAnchor}" font-family="${typeface}" font-size="${bodySize}" font-weight="800" fill="${textColor}" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(line)}</text>`,
    )
    .join(
      "",
    )}</g><circle cx="${isRtl ? visualRegion.left + (isGoogle ? 32 : 16) : visualRegion.left + visualRegion.width - (isGoogle ? 32 : 16)}" cy="${visualRegion.top + visualRegion.height / 2}" r="${isGoogle ? 8 : 4}" fill="${secondaryColor}" opacity="0.6"/>`;
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

// These historical helpers are retained temporarily for source-level review
// while active artwork composition has moved to render-plan.ts. The server no
// longer invokes them; production output is created from the shared plan.
void [
  motif,
  googleHeroMotif,
  googleHeroSurfaceColor,
  legacyAppleSurfaceColor,
  counterBadgeSvg,
  calibratedGoogleHeroStampPanelRegion,
  identitySvg,
  rewardPanelSvg,
  imageFirstStampPanelSvg,
  qrFrameSvg,
  calibratedGoogleHeroQrRegion,
];

function canvasSvg(
  input: WalletArtworkCompositionInput,
  target: WalletArtworkTarget,
  width: number,
  height: number,
  scale: WalletArtworkScale,
): string {
  const plan = createWalletArtworkRenderPlan(
    input satisfies WalletArtworkRenderPlanInput,
    target as Exclude<WalletArtworkTarget, "APPLE_POSTER">,
    scale,
  );
  if (plan.width !== width || plan.height !== height) {
    throw new Error("Wallet artwork plan dimensions are invalid.");
  }
  return plan.baseSvg;
  /* Legacy server-only layout decisions moved to render-plan.ts.
  const logical = walletArtworkDimensions[target];
  const layout = walletArtworkLayouts[target];
  const { backgroundColor, accentColor, secondaryColor } = input.theme;
  const surfaceBackgroundColor =
    target === "GOOGLE_HERO" && !input.applePosterRefinement
      ? googleHeroSurfaceColor(backgroundColor)
      : backgroundColor;
  const masterPanel =
    target === "GOOGLE_HERO" && input.appleStampPanelInset
      ? {
          ...layout.stampPanelRegion,
          left: layout.stampPanelRegion.left + input.appleStampPanelInset,
          width: layout.stampPanelRegion.width - input.appleStampPanelInset * 2,
        }
      : calibratedGoogleHeroStampPanelRegion(input, layout.stampPanelRegion);
  const artworkMotif =
    target === "GOOGLE_HERO" && !input.applePosterRefinement
      ? googleHeroMotif(logical.width, logical.height, accentColor, secondaryColor)
      : motif(input.layoutType, logical.width, logical.height, accentColor, secondaryColor, true);

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
    const qrRegion = calibratedGoogleHeroQrRegion(
      input,
      input.lowerGroupOffsetY
        ? { ...regions.qrRegion, top: regions.qrRegion.top + input.lowerGroupOffsetY }
        : regions.qrRegion,
    );
    foreground = `${imageFirstStampPanelSvg(masterPanel, accentColor, backgroundColor, input.theme.foregroundColor, true)}${qrFrameSvg(qrRegion, accentColor, backgroundColor, true)}`;
  }

  const ambientId = `ambient-${target.toLocaleLowerCase("en-US")}`;
  // The Poster’s header field is composited after the scaled master so it can
  // reach the true canvas edge. Keep this source layer neutral to avoid an
  // internal boundary where the master begins.
  const posterMasterRefinement = target === "GOOGLE_HERO" && input.applePosterRefinement;
  const refinedCounterAmbient = "";
  const baseAmbientOpacity = posterMasterRefinement ? 0 : 1;
  const headerCurveOpacity = posterMasterRefinement ? 0 : 0.08;
  // Both surfaces use the shared motif/background language. Apple relies on
  // the same base background at its calibrated cutoff rather than an
  // Apple-only decorative layer.
  const safeReserve = "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logical.width} ${logical.height}"><defs><radialGradient id="${ambientId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.18"/><stop offset="100%" stop-color="${secondaryColor}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="${surfaceBackgroundColor}"/><ellipse cx="${logical.width * 0.79}" cy="${logical.height * 0.18}" rx="${logical.width * 0.23}" ry="${logical.height * 0.19}" fill="url(#${ambientId})" opacity="${baseAmbientOpacity}"/>${refinedCounterAmbient}<path d="M${logical.width * 0.06} ${logical.height * 0.075}C${logical.width * 0.3} ${logical.height * 0.025},${logical.width * 0.56} ${logical.height * 0.13},${logical.width * 0.9} ${logical.height * 0.065}" fill="none" stroke="${secondaryColor}" stroke-width="${Math.max(4, logical.width * 0.012)}" stroke-linecap="round" opacity="${headerCurveOpacity}"/>${artworkMotif}${safeReserve}${foreground}<metadata data-composer="waflo-wallet-artwork-v5" data-target="${target}" data-scale="${scale}" data-source-stamp-digest="${input.stampArtwork.contentDigest}"/></svg>`;
  */
}

function canvasOverlaySvg(
  input: WalletArtworkCompositionInput,
  target: WalletArtworkTarget,
  width: number,
  height: number,
): string | undefined {
  if (target !== "GOOGLE_HERO") return undefined;
  const plan = createWalletArtworkRenderPlan(input satisfies WalletArtworkRenderPlanInput, target);
  if (plan.width !== width || plan.height !== height) {
    throw new Error("Wallet artwork overlay dimensions are invalid.");
  }
  return plan.overlaySvg;
  /* Legacy server-only overlay decisions moved to render-plan.ts.
  if (target !== "APPLE_POSTER" && target !== "GOOGLE_HERO") return undefined;
  const logical = walletArtworkDimensions[target];
  const regions = requiredImageFirstRegions(walletArtworkLayouts[target]);
  const typeface = walletArtworkArabicTypeface;
  const headerScale = input.headerScale ?? 1;
  const scaleHeader = (region: WalletArtworkPlacement): WalletArtworkPlacement => ({
    left: region.left - (region.width * (headerScale - 1)) / 2,
    top: region.top - (region.height * (headerScale - 1)) / 2 + (input.headerOffsetY ?? 0),
    width: region.width * headerScale,
    height: region.height * headerScale,
  });
  // The RTL title block grows outward from its existing trailing edge so an
  // enlarged counter never encroaches on the bilingual identity.
  const scaleIdentityHeader = (region: WalletArtworkPlacement): WalletArtworkPlacement => ({
    left: region.left - region.width * (headerScale - 1),
    top: region.top - (region.height * (headerScale - 1)) / 2 + (input.headerOffsetY ?? 0),
    width: region.width * headerScale,
    height: region.height * headerScale,
  });
  const baseRewardRegion = input.lowerGroupOffsetY
    ? { ...regions.rewardRegion, top: regions.rewardRegion.top + input.lowerGroupOffsetY }
    : regions.rewardRegion;
  const overlay = `${identitySvg(input, scaleIdentityHeader(regions.identityRegion), typeface)}${counterBadgeSvg(input, scaleHeader(regions.counterBadgeRegion), typeface)}${rewardPanelSvg(input, baseRewardRegion, typeface)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logical.width} ${logical.height}">${overlay}</svg>`;
  */
}

// composeWalletArtwork now consumes the plan directly. Retain these wrappers
// only while the historical source section is removed in a follow-up cleanup.
void [canvasSvg, canvasOverlaySvg];

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

/**
 * Legacy Wallet strips are much smaller than the modern Poster and Google
 * surfaces. Their visual grammar is intentionally fixed to the approved
 * wallet row distribution, even when the original customer-facing program
 * happened to use a path or ring. This only changes placement; each tile is
 * cut from the already-rendered authoritative artwork, preserving the exact
 * historical filled and empty assets and their state/order.
 */
export function legacyAppleStampGridRows(total: number): readonly number[] {
  return balancedWalletStampDistribution(total).rows;
}

interface LegacyAppleStampTile {
  readonly index: number;
  readonly bytes: Buffer;
}

function assertLegacyAppleArtworkHasNoTextGlyphs(input: WalletArtworkCompositionInput): void {
  // Provider artwork is a visual-only surface. Accessibility metadata on the
  // source SVG is not painted by Sharp, but visible SVG text would be; reject
  // it here instead of allowing an accidental caption into the strip.
  if (/<(?:text|tspan|textPath)\b/i.test(input.stampArtwork.svg)) {
    throw new Error("Legacy Apple stamp artwork must not contain text glyphs.");
  }
}

async function rasterizedLegacyAppleStampTiles(
  input: WalletArtworkCompositionInput,
): Promise<readonly LegacyAppleStampTile[]> {
  assertLegacyAppleArtworkHasNoTextGlyphs(input);
  const source = await sharp(Buffer.from(input.stampArtwork.svg, "utf8"), { density: 216 })
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  const xScale = source.info.width / input.stampArtwork.width;
  const yScale = source.info.height / input.stampArtwork.height;
  const half = input.stampSize / 2;
  return Promise.all(
    [...input.stampArtwork.positions]
      .sort((left, right) => left.index - right.index)
      .map(async (position) => {
        // The renderer places every historical asset into this complete square
        // viewport. Extracting that viewport retains the full asset (including
        // its transparent breathing room) before a contain-only resize.
        const left = Math.max(0, Math.floor((position.x - half) * xScale));
        const top = Math.max(0, Math.floor((position.y - half) * yScale));
        const right = Math.min(source.info.width, Math.ceil((position.x + half) * xScale));
        const bottom = Math.min(source.info.height, Math.ceil((position.y + half) * yScale));
        if (right <= left || bottom <= top) {
          throw new Error("Legacy Apple stamp artwork tile is outside its source canvas.");
        }
        return {
          index: position.index,
          bytes: await sharp(source.data)
            .extract({ left, top, width: right - left, height: bottom - top })
            .png()
            .toBuffer(),
        };
      }),
  );
}

function legacyAppleSurfaceSvg(
  input: WalletArtworkCompositionInput,
  width: number,
  height: number,
  scale: WalletArtworkScale,
): string {
  return walletArtworkLegacySurfaceSvg(
    input satisfies WalletArtworkRenderPlanInput,
    width,
    height,
    scale,
  );
  /* Moved to render-plan.ts so browser and Sharp share the legacy field.
  const logical = walletArtworkDimensions.APPLE_LEGACY_STRIP;
  const { backgroundColor, accentColor, secondaryColor } = input.theme;
  const surfaceBackgroundColor = legacyAppleSurfaceColor(backgroundColor);
  const id = `legacy-surface-${scale}`;
  // This is deliberately a continuous field, not a framed image card: the
  // top/bottom fades let the strip settle into the native Wallet background.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logical.width} ${logical.height}"><defs><linearGradient id="${id}-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.16"/><stop offset="42%" stop-color="${secondaryColor}" stop-opacity="0.045"/><stop offset="100%" stop-color="${surfaceBackgroundColor}" stop-opacity="0"/></linearGradient><linearGradient id="${id}-bottom" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="${accentColor}" stop-opacity="0.11"/><stop offset="42%" stop-color="${accentColor}" stop-opacity="0.025"/><stop offset="100%" stop-color="${surfaceBackgroundColor}" stop-opacity="0"/></linearGradient><radialGradient id="${id}-glow" cx="86%" cy="20%" r="48%"><stop offset="0%" stop-color="${accentColor}" stop-opacity="0.13"/><stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="${surfaceBackgroundColor}"/><rect width="100%" height="100%" fill="url(#${id}-glow)"/><path d="M-8 12C81 0 160 12 243 5S351 2 385 12" fill="none" stroke="${secondaryColor}" stroke-width="1.2" stroke-linecap="round" opacity="0.14"/><path d="M-12 110C78 120 147 106 227 114S334 121 385 105" fill="none" stroke="${accentColor}" stroke-width="1" stroke-linecap="round" opacity="0.11"/><rect width="100%" height="42" fill="url(#${id}-top)"/><rect y="81" width="100%" height="42" fill="url(#${id}-bottom)"/><metadata data-composer="waflo-legacy-apple-strip-v1" data-text="none" data-layout="balanced-wallet-rows"/></svg>`;
  */
}

async function composeLegacyAppleStripArtwork(
  input: WalletArtworkCompositionInput,
  scale: WalletArtworkScale,
): Promise<ComposedWalletArtwork> {
  const target = "APPLE_LEGACY_STRIP" as const;
  const dimensions = walletArtworkDimensions[target];
  const layout = APPLE_LEGACY_LAYOUT;
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  const rows = legacyAppleStampGridRows(input.requiredStampCount);
  const tiles = await rasterizedLegacyAppleStampTiles(input);
  if (tiles.length !== input.requiredStampCount) {
    throw new Error("Legacy Apple stamp artwork tile count does not match progress semantics.");
  }

  const grid = {
    left: layout.stampRegion.left * scale,
    top: layout.stampRegion.top * scale,
    width: layout.stampRegion.width * scale,
    height: layout.stampRegion.height * scale,
  };
  const source = await rasterizedVisibleStamp(input);
  const legacyPlan = createLegacyWalletStampGridPlan(
    input satisfies WalletArtworkRenderPlanInput,
    scale,
    source.aspectRatio,
  );
  if (legacyPlan.rows.join(",") !== rows.join(",")) {
    throw new Error("Legacy Wallet stamp distribution drifted from the shared render plan.");
  }
  const planTiles = new Map(legacyPlan.tiles.map((tile) => [tile.index, tile]));
  const resizedTiles = await Promise.all(
    tiles.map(async (tile) => {
      const placement = planTiles.get(tile.index);
      if (!placement) throw new Error("Legacy Wallet stamp plan is incomplete.");
      return {
        index: tile.index,
        bytes: await sharp(tile.bytes)
          .resize({
            width: placement.width,
            height: placement.height,
            fit: "fill",
            withoutEnlargement: false,
            kernel: sharp.kernel.lanczos3,
          })
          .png()
          .toBuffer(),
      };
    }),
  );
  const rasterTiles = new Map(resizedTiles.map((tile) => [tile.index, tile]));
  const composites = legacyPlan.tiles.map((placement) => {
    const tile = rasterTiles.get(placement.index);
    if (!tile) throw new Error("Legacy Apple stamp artwork order is invalid.");
    return { input: tile.bytes, left: placement.left, top: placement.top };
  });
  const bytes = await sharp(Buffer.from(legacyAppleSurfaceSvg(input, width, height, scale), "utf8"))
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await validateWalletArtworkPng({ bytes, target, scale });
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
    stampPlacement: legacyPlan.stampPlacement,
    stampGridRows: legacyPlan.rows,
    stampPanelRegion: {
      left: layout.stampPanelRegion.left * scale,
      top: layout.stampPanelRegion.top * scale,
      width: layout.stampPanelRegion.width * scale,
      height: layout.stampPanelRegion.height * scale,
    },
    stampRegion: grid,
  };
  /* Legacy server layout calculations moved to render-plan.ts.
  const sourceGapRatio =
    (source.aspectRatio * rowCount - columns) / (columns - 1 - source.aspectRatio * (rowCount - 1));
  const estimatedTileSize =
    Number.isFinite(sourceGapRatio) && sourceGapRatio >= 0
      ? Math.min(
          grid.width / (columns + (columns - 1) * sourceGapRatio),
          grid.height / (rowCount + (rowCount - 1) * sourceGapRatio),
        )
      : Math.min(
          grid.width / (columns + (columns - 1) * 0.16),
          grid.height / (rowCount + (rowCount - 1) * 0.16),
        );
  // Preserve the authoritative group's proportions while keeping a single,
  // even gap value in both axes. This avoids squeezing wide historical marks
  // on small legacy strips without introducing a second stamp renderer.
  const gap = Math.max(
    scale,
    Math.round(
      estimatedTileSize *
        (Number.isFinite(sourceGapRatio) && sourceGapRatio >= 0 ? sourceGapRatio : 0.16),
    ),
  );
  const tileSize = Math.max(
    1,
    Math.floor(
      Math.min(
        (grid.width - (columns - 1) * gap) / columns,
        (grid.height - (rowCount - 1) * gap) / rowCount,
      ),
    ),
  );
  // Wallet's Legacy strip uses a deliberately wide device projection of the
  // same preserved square stamp tiles. The source asset remains byte-for-byte
  // intact; only this final presentation viewport is calibrated.
  const tileWidth = Math.max(1, Math.round(tileSize * 1.22));
  const tileHeight = Math.max(1, Math.round(tileSize * 1.06));
  const resizedTiles = await Promise.all(
    tiles.map(async (tile) => ({
      index: tile.index,
      bytes: await sharp(tile.bytes)
        .resize({
          width: tileWidth,
          height: tileHeight,
          fit: "fill",
          withoutEnlargement: false,
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer(),
    })),
  );
  // Apple's approved strip holds the row height while opening the horizontal
  // rhythm. Reusing the same tiles preserves every historic stamp pixel.
  const horizontalGap = gap + scale;
  const verticalGap = Math.max(scale, gap - 2 * scale);
  const gridHeight = rowCount * tileHeight + (rowCount - 1) * verticalGap;
  const top = Math.round(grid.top + (grid.height - gridHeight) / 2);
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  let cursor = 0;
  for (const [rowIndex, count] of rows.entries()) {
    const rowWidth = count * tileWidth + (count - 1) * horizontalGap;
    const left = Math.round(grid.left + (grid.width - rowWidth) / 2);
    for (let column = 0; column < count; column += 1) {
      const tile = resizedTiles[cursor];
      if (!tile || tile.index !== cursor) {
        throw new Error("Legacy Apple stamp artwork order is invalid.");
      }
      composites.push({
        input: tile.bytes,
        left: left + column * (tileWidth + horizontalGap),
        top: top + rowIndex * (tileHeight + verticalGap),
      });
      cursor += 1;
    }
  }
  const widestRow = Math.max(...rows);
  const rawWidth = widestRow * tileWidth + (widestRow - 1) * horizontalGap;
  const rawHeight = gridHeight;
  const reportedHeight = Math.min(
    rawHeight,
    grid.height,
    Math.round(rawWidth / source.aspectRatio),
  );
  const reportedWidth = Math.min(
    rawWidth,
    grid.width,
    Math.round(reportedHeight * source.aspectRatio),
  );
  // `stampPlacement` reports the visible artwork group rather than transparent
  // stamp viewports. Some historical marks are intentionally tall or narrow,
  // so the source's visible aspect ratio remains the correct contract here.
  const stampPlacement = {
    left: Math.round(grid.left + (grid.width - reportedWidth) / 2),
    top: Math.round(grid.top + (grid.height - reportedHeight) / 2),
    width: reportedWidth,
    height: reportedHeight,
  };
  const bytes = await sharp(Buffer.from(legacyAppleSurfaceSvg(input, width, height, scale), "utf8"))
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await validateWalletArtworkPng({ bytes, target, scale });
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
    stampGridRows: rows,
    stampPanelRegion: {
      left: layout.stampPanelRegion.left * scale,
      top: layout.stampPanelRegion.top * scale,
      width: layout.stampPanelRegion.width * scale,
      height: layout.stampPanelRegion.height * scale,
    },
    stampRegion: grid,
  };
  */
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
  const width =
    frameRegion.width -
    inset * 2 +
    (target === "GOOGLE_HERO" && !input.applePosterRefinement ? 5 : 0);
  // The approved Android capture has an asymmetric physical quiet zone inside
  // the symmetric visual plate. Keep the code's size and QR encoder exactly
  // unchanged; only place its already-generated raster in that measured slot.
  const googlePayloadOffset =
    target === "GOOGLE_HERO" && !input.applePosterRefinement ? -3 * scale : 0;
  const left = frameRegion.left + inset + googlePayloadOffset;
  const top = frameRegion.top + inset + googlePayloadOffset;
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
    // The Poster is a single uniformly scaled Google master. Its optional
    // center mark must be proportioned for the final scaled QR, rather than
    // merely decoding at the source master resolution.
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

/** Functional union of the approved Google composition, excluding only canvas dead space. */
export const googleMasterContentBounds: WalletArtworkPlacement = sharedGoogleMasterContentBounds;

/** One content-group-to-Poster transform; no Apple component has an independent bound. */
export const applePosterGoogleMasterTransform = sharedApplePosterGoogleMasterTransform;

function transformGoogleMasterPlacement(
  placement: WalletArtworkPlacement,
  outputScale: WalletArtworkScale,
): WalletArtworkPlacement {
  const factor = applePosterGoogleMasterTransform.scale * outputScale;
  return {
    left: Math.round(
      ((placement.left - googleMasterContentBounds.left) * applePosterGoogleMasterTransform.scale +
        applePosterGoogleMasterTransform.translateX) *
        outputScale,
    ),
    top: Math.round(
      ((placement.top - googleMasterContentBounds.top) * applePosterGoogleMasterTransform.scale +
        applePosterGoogleMasterTransform.translateY) *
        outputScale,
    ),
    width: Math.round(placement.width * factor),
    height: Math.round(placement.height * factor),
  };
}

async function composeApplePosterFromGoogleMaster(
  input: WalletArtworkCompositionInput,
  scale: WalletArtworkScale,
): Promise<ComposedWalletArtwork> {
  const sharedPosterPlan = createSharedApplePosterRenderPlan(
    input satisfies WalletArtworkRenderPlanInput,
    scale,
  );
  // Keep the source-space adjustment shared by the master render and its
  // returned visible bounds. The pixels already used this offset; reporting
  // the unadjusted QR region made downstream QR crops miss the code.
  const posterLowerGroupOffsetY = sharedPosterPlan.master.input.lowerGroupOffsetY ?? 0;
  const master = await composeWalletArtwork(sharedPosterPlan.master.input, "GOOGLE_HERO", 1);
  const width = sharedPosterPlan.width;
  const height = sharedPosterPlan.height;
  // The render plan deliberately keeps its transform as one exact uniform
  // scale. Sharp is the final bitmap boundary and requires integer pixels, so
  // round once here while deriving height from the same ratio instead of
  // feeding a second independently rounded canonical coordinate back into it.
  const masterWidth = Math.round(sharedPosterPlan.master.destination.width);
  const masterHeight = Math.round(
    (masterWidth * sharedPosterPlan.master.sourceBounds.height) /
      sharedPosterPlan.master.sourceBounds.width,
  );
  const masterImage = await sharp(master.bytes)
    .extract({
      left: sharedPosterPlan.master.sourceBounds.left,
      top: sharedPosterPlan.master.sourceBounds.top,
      width: sharedPosterPlan.master.sourceBounds.width,
      height: sharedPosterPlan.master.sourceBounds.height,
    })
    .resize({
      width: masterWidth,
      height: masterHeight,
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const bytes = await sharp({
    create: { width, height, channels: 4, background: input.theme.backgroundColor },
  })
    .composite([
      {
        input: Buffer.from(sharedPosterPlan.footerSvg, "utf8"),
        left: 0,
        top: 0,
      },
      {
        input: masterImage,
        left: sharedPosterPlan.master.destination.left,
        top: sharedPosterPlan.master.destination.top,
      },
      {
        input: Buffer.from(sharedPosterPlan.topAmbientSvg, "utf8"),
        left: 0,
        top: 0,
      },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await validateWalletArtworkPng({ bytes, target: "APPLE_POSTER", scale });
  const masterLayout = GOOGLE_HERO_LAYOUT;
  const masterRegions = requiredImageFirstRegions(masterLayout);
  const transformed = (placement: WalletArtworkPlacement) =>
    transformGoogleMasterPlacement(placement, scale);
  const transformedLowerGroup = (placement: WalletArtworkPlacement) =>
    transformed({ ...placement, top: placement.top + posterLowerGroupOffsetY });
  const qrFrameRegion = transformedLowerGroup(masterRegions.qrRegion);
  // Return the complete visible QR affordance, including the scaled plate
  // edge/shadow and a small quiet-zone surround used by independent decoders.
  const qrRegion = {
    left: qrFrameRegion.left - 4 * scale,
    top: qrFrameRegion.top - 4 * scale,
    width: qrFrameRegion.width + 8 * scale,
    height: qrFrameRegion.height + 8 * scale,
  };
  return {
    bytes,
    target: "APPLE_POSTER",
    scale,
    width,
    height,
    contentDigest: createHash("sha256").update(bytes).digest("hex"),
    sourceStampDigest: input.stampArtwork.contentDigest,
    sourceVisibleBounds: master.sourceVisibleBounds,
    sourceVisibleRasterAspectRatio: master.sourceVisibleRasterAspectRatio,
    stampPlacement: transformed(master.stampPlacement),
    stampPanelRegion: transformed(masterLayout.stampPanelRegion),
    stampRegion: transformed(masterLayout.stampRegion),
    identityRegion: transformed(masterRegions.identityRegion),
    counterBadgeRegion: transformed(masterRegions.counterBadgeRegion),
    rewardRegion: transformedLowerGroup(masterRegions.rewardRegion),
    qrRegion,
    ...(master.qrCenterLogoApplied ? { qrCenterLogoApplied: true } : {}),
  };
}

export async function composeWalletArtwork(
  input: WalletArtworkCompositionInput,
  target: WalletArtworkTarget,
  scale: WalletArtworkScale = 1,
): Promise<ComposedWalletArtwork> {
  assertCompositionInput(input);
  if (target === "APPLE_POSTER") {
    return composeApplePosterFromGoogleMaster(input, scale);
  }
  if (target === "APPLE_LEGACY_STRIP") {
    return composeLegacyAppleStripArtwork(input, scale);
  }
  if (target === "GOOGLE_HERO" && scale !== 1) {
    throw new Error("Google hero artwork has one fixed 1032x812 output size.");
  }
  const plan = createWalletArtworkCompositionPlan(input, target, scale);
  const width = plan.width;
  const height = plan.height;
  const layout = walletArtworkLayouts[target];
  const stampRegion = plan.stampRegion;
  const stampPanelRegion = {
    // This contract reports the semantic stamp field. The visually calibrated
    // Google panel extends upward around it, while the Grid itself remains
    // centered in this unchanged provider field.
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
  const base = Buffer.from(plan.baseSvg, "utf8");
  const qrRegion = plan.qr?.frame;
  const qr =
    qrRegion && target === "GOOGLE_HERO"
      ? await premiumQrArtwork(input, target, qrRegion, scale)
      : undefined;
  const overlay = plan.overlaySvg;
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
  const reportedCounterBadgeRegion = counterBadgeRegion
    ? calibratedGoogleHeroCounterRegion(input, counterBadgeRegion)
    : undefined;
  const reportedRewardRegion = rewardRegion
    ? calibratedGoogleHeroRewardRegion(input, rewardRegion)
    : undefined;
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
    ...(reportedCounterBadgeRegion ? { counterBadgeRegion: reportedCounterBadgeRegion } : {}),
    ...(reportedRewardRegion ? { rewardRegion: reportedRewardRegion } : {}),
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
      readonly locale: string;
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

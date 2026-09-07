import { cardLocalePresentation, walletStructuralCopyForLocale } from "@waflo/contracts";
import { createQrPreviewRasterMarkup } from "@waflo/qr-core/preview";
import {
  balancedWalletStampDistribution,
  type StampLayout,
  type StampPosition,
} from "@waflo/stamp-engine";
import {
  walletArtworkArabicTypeface,
  walletArtworkDimensions,
  walletArtworkLayouts,
  walletArtworkPanelCorners,
  type WalletArtworkPlacement,
  type WalletArtworkScale,
  type WalletArtworkTarget,
} from "./model.js";

/**
 * Browser-safe, canonical composition input. It deliberately contains only
 * rendered artwork and scalar layout state: Sharp, storage, credentials and
 * provider signing remain outside this boundary.
 */
export interface WalletArtworkRenderPlanInput {
  readonly stampArtwork: {
    readonly svg: string;
    readonly width: number;
    readonly height: number;
    readonly contentDigest: string;
    readonly positions: readonly StampPosition[];
  };
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
  readonly credentialPayload: string;
  readonly counterForegroundColor?: string;
  readonly headerScale?: number;
  readonly suppressMemberPrefix?: boolean;
  readonly applePosterRefinement?: boolean;
  readonly appleStampPanelInset?: number;
  readonly headerOffsetY?: number;
  readonly lowerGroupOffsetY?: number;
  readonly locale: string;
}

export interface WalletArtworkVisibleBounds extends WalletArtworkPlacement {
  readonly right: number;
  readonly bottom: number;
}

export interface WalletArtworkRenderPlan {
  readonly target: WalletArtworkTarget;
  readonly scale: WalletArtworkScale;
  readonly width: number;
  readonly height: number;
  readonly baseSvg: string;
  readonly overlaySvg?: string;
  readonly stampSourceBounds: WalletArtworkVisibleBounds;
  readonly stampPlacement: WalletArtworkPlacement;
  readonly stampRegion: WalletArtworkPlacement;
  readonly qr?: {
    readonly frame: WalletArtworkPlacement;
    readonly payload: WalletArtworkPlacement;
    readonly margin: number;
    readonly errorCorrectionLevel: "Q";
  };
}

export interface LegacyWalletStampGridPlan {
  readonly rows: readonly number[];
  readonly tiles: readonly {
    index: number;
    left: number;
    top: number;
    width: number;
    height: number;
    source: WalletArtworkPlacement;
  }[];
  readonly stampPlacement: WalletArtworkPlacement;
}

/** A browser-local raster request for the canonical, non-secret preview QR. */
export interface WalletArtworkQrRasterRequest {
  readonly value: "waflo-wallet-preview-only";
  readonly width: number;
  readonly margin: number;
  readonly errorCorrectionLevel: "Q";
}

export function measureWalletArtworkVisibleBounds(
  stampArtwork: Pick<
    WalletArtworkRenderPlanInput["stampArtwork"],
    "width" | "height" | "positions"
  >,
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
  if (right <= left || bottom <= top)
    throw new Error("Wallet stamp artwork visible bounds are empty.");
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
    : `${graphemes.slice(0, Math.max(1, maximum - 1)).join("")}…`;
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
  return `<path d="M${width * 0.7} ${height * 0.045}V${height * 0.17}M${width * 0.8} ${height * 0.045}V${height * 0.2}M${width * 0.9} ${height * 0.045}V${height * 0.16}M${width * 0.67} ${height * 0.08}H${width * 0.96}M${width * 0.69} ${height * 0.15}H${width * 0.96}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, width * 0.005)}" opacity="0.1"/>${includeLowerAccent ? `<rect x="${width * 0.025}" y="${height * 0.77}" width="${width * 0.19}" height="${height * 0.18}" rx="${width * 0.03}" fill="${secondary}" opacity="0.1" transform="rotate(-7 ${width * 0.11} ${height * 0.86})"/>` : ""}`;
}

function googleHeroMotif(width: number, height: number, accent: string, secondary: string): string {
  return `<circle cx="${width * 0.84}" cy="${height * 0.2}" r="${width * 0.153}" fill="none" stroke="${accent}" stroke-width="${Math.max(3, width * 0.008)}" opacity="0.12"/><circle cx="${width * 0.123}" cy="${height * 0.845}" r="${width * 0.105}" fill="none" stroke="${secondary}" stroke-width="${Math.max(3, width * 0.008)}" opacity="0.16"/>`;
}

export function applePosterTopAmbientSvg(
  width: number,
  height: number,
  accent: string,
  secondary: string,
): string {
  const badgeX = width * 0.84;
  const badgeY = height * 0.174;
  const badgeClearRadius = width * 0.125;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="apple-top-horizontal" gradientUnits="userSpaceOnUse" x1="${width * 0.06}" y1="0" x2="${width}" y2="0"><stop offset="0%" stop-color="${secondary}" stop-opacity="0"/><stop offset="51%" stop-color="${secondary}" stop-opacity="0.04"/><stop offset="100%" stop-color="${accent}" stop-opacity="0.125"/></linearGradient><radialGradient id="apple-top-glow" gradientUnits="userSpaceOnUse" cx="${badgeX}" cy="${badgeY}" r="${width * 0.43}"><stop offset="0%" stop-color="${secondary}" stop-opacity="0.145"/><stop offset="58%" stop-color="${secondary}" stop-opacity="0.06"/><stop offset="100%" stop-color="${secondary}" stop-opacity="0"/></radialGradient><linearGradient id="apple-top-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height * 0.34}"><stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/><stop offset="64%" stop-color="#FFFFFF" stop-opacity="0.72"/><stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient><radialGradient id="apple-top-badge-clear" gradientUnits="userSpaceOnUse" cx="${badgeX}" cy="${badgeY}" r="${badgeClearRadius}"><stop offset="0%" stop-color="#000000"/><stop offset="64%" stop-color="#000000"/><stop offset="100%" stop-color="#FFFFFF"/></radialGradient><linearGradient id="apple-top-line" gradientUnits="userSpaceOnUse" x1="${width * 0.04}" y1="0" x2="${width}" y2="0"><stop offset="0%" stop-color="${accent}" stop-opacity="0"/><stop offset="62%" stop-color="${accent}" stop-opacity="0.075"/><stop offset="100%" stop-color="${accent}" stop-opacity="0.025"/></linearGradient><mask id="apple-top-visible"><rect width="${width}" height="${height * 0.36}" fill="url(#apple-top-fade)"/><circle cx="${badgeX}" cy="${badgeY}" r="${badgeClearRadius}" fill="url(#apple-top-badge-clear)"/></mask></defs><g mask="url(#apple-top-visible)"><path d="M0 0H${width}V${height * 0.29}C${width * 0.77} ${height * 0.245},${width * 0.48} ${height * 0.235},${width * 0.12} ${height * 0.155}C${width * 0.055} ${height * 0.13},0 ${height * 0.12},0 ${height * 0.1}Z" fill="url(#apple-top-horizontal)"/><ellipse cx="${badgeX}" cy="${badgeY}" rx="${width * 0.44}" ry="${height * 0.28}" fill="url(#apple-top-glow)"/><path d="M${width * 0.05} ${height * 0.08}C${width * 0.31} ${height * 0.01},${width * 0.68} ${height * 0.1},${width * 1.02} ${height * 0.035}" fill="none" stroke="url(#apple-top-line)" stroke-width="${Math.max(1.2, width * 0.003)}" stroke-linecap="round"/></g></svg>`;
}

function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function googleHeroSurfaceColor(hex: string): string {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  );
  const [red = 0, green = 0, blue = 0] = channels;
  return `#${[red, green + 1, blue + 2].map((channel) => Math.min(255, Math.max(0, channel)).toString(16).padStart(2, "0")).join("")}`;
}

export function walletArtworkLegacySurfaceSvg(
  input: WalletArtworkRenderPlanInput,
  width: number,
  height: number,
  scale: WalletArtworkScale,
): string {
  const logical = walletArtworkDimensions.APPLE_LEGACY_STRIP;
  const { backgroundColor, accentColor, secondaryColor } = input.theme;
  const surfaceBackgroundColor = legacySurfaceColor(backgroundColor);
  const id = `legacy-surface-${scale}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logical.width} ${logical.height}"><defs><linearGradient id="${id}-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.16"/><stop offset="42%" stop-color="${secondaryColor}" stop-opacity="0.045"/><stop offset="100%" stop-color="${surfaceBackgroundColor}" stop-opacity="0"/></linearGradient><linearGradient id="${id}-bottom" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="${accentColor}" stop-opacity="0.11"/><stop offset="42%" stop-color="${accentColor}" stop-opacity="0.025"/><stop offset="100%" stop-color="${surfaceBackgroundColor}" stop-opacity="0"/></linearGradient><radialGradient id="${id}-glow" cx="86%" cy="20%" r="48%"><stop offset="0%" stop-color="${accentColor}" stop-opacity="0.13"/><stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="${surfaceBackgroundColor}"/><rect width="100%" height="100%" fill="url(#${id}-glow)"/><path d="M-8 12C81 0 160 12 243 5S351 2 385 12" fill="none" stroke="${secondaryColor}" stroke-width="1.2" stroke-linecap="round" opacity="0.14"/><path d="M-12 110C78 120 147 106 227 114S334 121 385 105" fill="none" stroke="${accentColor}" stroke-width="1" stroke-linecap="round" opacity="0.11"/><rect width="100%" height="42" fill="url(#${id}-top)"/><rect y="81" width="100%" height="42" fill="url(#${id}-bottom)"/><metadata data-composer="waflo-legacy-apple-strip-v1" data-text="none" data-layout="balanced-wallet-rows"/></svg>`;
}

function legacySurfaceColor(hex: string): string {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  );
  const [red = 0, green = 0, blue = 0] = channels;
  return `#${[red - 2, green + 1, blue + 2].map((channel) => Math.min(255, Math.max(0, channel)).toString(16).padStart(2, "0")).join("")}`;
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

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

export function walletArtworkPlanIdentityTitleLines(
  programName: string,
  locale: string,
): readonly string[] {
  const phrases = programName
    .split(/\s*[/|]\s*/u)
    .map((phrase) => phrase.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (phrases.length === 0) return [];
  const arabic = phrases.filter((phrase) => /\p{Script=Arabic}/u.test(phrase));
  const latin = phrases.filter(
    (phrase) => !/\p{Script=Arabic}/u.test(phrase) && /\p{Script=Latin}/u.test(phrase),
  );
  const neutral = phrases.filter(
    (phrase) => !/\p{Script=Arabic}/u.test(phrase) && !/\p{Script=Latin}/u.test(phrase),
  );
  const join = (items: readonly string[]) => items.join(" · ");
  const arabicLine = join(arabic);
  const latinLine = join([...latin, ...neutral]);
  if (arabicLine && latinLine)
    return cardLocalePresentation(locale).isRtl ? [arabicLine, latinLine] : [latinLine, arabicLine];
  return [join(phrases)];
}

function calibratedGoogleHeroCounterRegion(
  input: WalletArtworkRenderPlanInput,
  region: WalletArtworkPlacement,
): WalletArtworkPlacement {
  return region.width > 150 && !input.applePosterRefinement
    ? { ...region, left: region.left + 2, top: region.top - 1 }
    : region;
}

function calibratedGoogleHeroStampPanelRegion(
  input: WalletArtworkRenderPlanInput,
  region: WalletArtworkPlacement,
): WalletArtworkPlacement {
  return region.width > 500 && !input.applePosterRefinement
    ? { ...region, top: region.top - 4, height: region.height + 4 }
    : region;
}

function calibratedGoogleHeroRewardRegion(
  input: WalletArtworkRenderPlanInput,
  region: WalletArtworkPlacement,
): WalletArtworkPlacement {
  return region.width > 500 && !input.applePosterRefinement
    ? { ...region, top: region.top + 2 }
    : region;
}

function calibratedGoogleHeroQrRegion(
  input: WalletArtworkRenderPlanInput,
  region: WalletArtworkPlacement,
): WalletArtworkPlacement {
  return region.width > 150 && !input.applePosterRefinement
    ? { ...region, left: region.left + 2, top: region.top + 1 }
    : region;
}

function counterBadgeSvg(
  input: WalletArtworkRenderPlanInput,
  region: WalletArtworkPlacement,
): string {
  const { accentColor, backgroundColor } = input.theme;
  const presentation = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(presentation.locale);
  const visualRegion = calibratedGoogleHeroCounterRegion(input, region);
  const textColor = input.counterForegroundColor ?? readableTextColor(backgroundColor, accentColor);
  const cx = visualRegion.left + visualRegion.width / 2;
  const cy = visualRegion.top + visualRegion.height / 2;
  const radius = Math.min(visualRegion.width, visualRegion.height) / 2;
  const headerScale = input.headerScale ?? 1;
  const labelSize = (visualRegion.width > 150 ? 18 : 10) * headerScale;
  const valueSize = (visualRegion.width > 150 ? 36 : 22) * headerScale;
  return `<circle cx="${cx}" cy="${cy + 5}" r="${radius - 3}" fill="#000000" opacity="0.12"/><circle cx="${cx}" cy="${cy}" r="${radius - 3}" fill="${accentColor}" stroke="${backgroundColor}" stroke-width="${visualRegion.width > 150 ? 6 : 3}" stroke-opacity="0.72"/><text x="${cx}" y="${cy - (visualRegion.width > 150 ? 13 : 9)}" text-anchor="middle" font-family="${walletArtworkArabicTypeface}" font-size="${labelSize}" font-weight="800" letter-spacing="${presentation.isRtl ? 0 : 1.5}" fill="${textColor}" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(copy.stamps)}</text><text x="${cx}" y="${cy + (visualRegion.width > 150 ? 30 : 21)}" text-anchor="middle" font-family="${walletArtworkArabicTypeface}" font-size="${valueSize}" font-weight="900" letter-spacing="-0.8" fill="${textColor}" direction="ltr" unicode-bidi="plaintext" xml:lang="en">${input.currentStampCount}/${input.requiredStampCount}</text>`;
}

function identitySvg(input: WalletArtworkRenderPlanInput, region: WalletArtworkPlacement): string {
  const presentation = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(presentation.locale);
  const isRtl = presentation.isRtl;
  const isGoogle = region.width > 400;
  const approvedGoogleHero = isGoogle && !input.applePosterRefinement;
  const inset = isGoogle ? (approvedGoogleHero ? 15 : 18) : 8;
  const textX = isRtl ? region.left + region.width - inset : region.left + inset;
  const headerScale = input.headerScale ?? 1;
  const textColor = readableTextColor(input.theme.foregroundColor, input.theme.backgroundColor);
  const organization =
    wrapLabel(input.organizationName, isGoogle ? 44 : 24, 1, presentation.locale)[0] ?? "";
  const titleLines = walletArtworkPlanIdentityTitleLines(input.programName, input.locale);
  const member =
    wrapLabel(
      input.suppressMemberPrefix ? input.memberName : `${copy.member}: ${input.memberName}`,
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
  const titleSize = Math.min(
    ...titleLines.map((line) =>
      fittedFontSize(
        line,
        (isGoogle ? (approvedGoogleHero ? 35 : 27) : 15) * headerScale,
        (isGoogle ? 16 : 9) * headerScale,
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
      const x = isGoogle ? textX : isRtl ? region.left + region.width - inset : region.left + inset;
      const anchor = isRtl && !presentation.isRtl ? "end" : "start";
      return `<text x="${x}" y="${titleY + index * titleLineGap}" text-anchor="${anchor}" font-family="${walletArtworkArabicTypeface}" font-size="${titleSize}" font-weight="900" fill="${textColor}" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(line)}</text>`;
    })
    .join("");
  const organizationMarkup = isGoogle
    ? `<text x="${textX}" y="${organizationY}" text-anchor="start" font-family="${walletArtworkArabicTypeface}" font-size="${organizationSize}" font-weight="800" letter-spacing="${isRtl ? 0 : 2}" fill="${textColor}" opacity="0.82" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(organization)}</text>`
    : "";
  return `<defs><clipPath id="${clipId}"><rect x="${region.left}" y="${region.top - 4}" width="${region.width}" height="${region.height + 8}"/></clipPath></defs><g clip-path="url(#${clipId})"><rect x="${markerX}" y="${region.top}" width="4" height="${region.height}" rx="2" fill="${input.theme.accentColor}" opacity="0.82"/>${organizationMarkup}${title}<text x="${textX}" y="${memberY}" text-anchor="start" font-family="${walletArtworkArabicTypeface}" font-size="${memberSize}" font-weight="700" fill="${textColor}" opacity="0.9" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(member)}</text></g>`;
}

function giftIconSvg(x: number, y: number, size: number, color: string): string {
  const scale = size / 48;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="19" width="34" height="23" rx="4"/><path d="M5 14h38v9H5zM24 14v28M24 14c-8 0-13-2-13-7 0-3 2-5 5-5 5 0 8 7 8 12Zm0 0c8 0 13-2 13-7 0-3-2-5-5-5-5 0-8 7-8 12Z"/></g>`;
}

function rewardPanelSvg(
  input: WalletArtworkRenderPlanInput,
  region: WalletArtworkPlacement,
): string {
  const { accentColor, backgroundColor, foregroundColor, secondaryColor } = input.theme;
  const presentation = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(presentation.locale);
  const visualRegion = calibratedGoogleHeroRewardRegion(input, region);
  const eyebrow = input.rewardReady ? copy.rewardReady : copy.reward;
  const fallback = presentation.isRtl ? copy.nextReward : "Your next reward";
  const isGoogle = visualRegion.width > 500;
  const isRtl = presentation.isRtl;
  const lines = walletArtworkPlanIdentityTitleLines(input.rewardLabel || fallback, input.locale);
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
  const iconX = isRtl
    ? visualRegion.left + visualRegion.width - horizontalPadding - iconSize
    : visualRegion.left + horizontalPadding;
  const iconY = visualRegion.top + (visualRegion.height - iconSize) / 2;
  const textGap = isGoogle ? 30 : compactApple ? 6 : 10;
  const textX = isRtl ? iconX - textGap : iconX + iconSize + textGap;
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
  return `<rect x="${visualRegion.left}" y="${visualRegion.top + 6}" width="${visualRegion.width}" height="${visualRegion.height}" rx="${isGoogle ? 30 : 18}" fill="#000000" opacity="${darkTheme ? 0.18 : 0.08}"/><rect x="${visualRegion.left}" y="${visualRegion.top}" width="${visualRegion.width}" height="${visualRegion.height}" rx="${isGoogle ? 30 : 18}" fill="${fill}" fill-opacity="${input.rewardReady ? 0.96 : darkTheme ? 0.12 : 0.68}" stroke="${stroke}" stroke-width="${isGoogle ? 3 : 1.5}" stroke-opacity="${input.rewardReady ? 0.42 : 0.28}"/>${giftIconSvg(iconX, iconY, iconSize, textColor)}<defs><clipPath id="${clipId}"><rect x="${visualRegion.left + 10}" y="${visualRegion.top + clipInset}" width="${visualRegion.width - 20}" height="${visualRegion.height - clipInset * 2}" rx="${isGoogle ? 22 : 12}"/></clipPath></defs><g clip-path="url(#${clipId})"><text x="${textX}" y="${eyebrowY}" text-anchor="start" font-family="${walletArtworkArabicTypeface}" font-size="${isGoogle ? 16 : 8.5}" font-weight="800" letter-spacing="${isRtl ? 0 : isGoogle ? 2.2 : 1.2}" fill="${textColor}" opacity="0.76" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(eyebrow)}</text>${lines.map((line, index) => `<text x="${textX}" y="${bodyY + index * lineGap}" text-anchor="start" font-family="${walletArtworkArabicTypeface}" font-size="${bodySize}" font-weight="800" fill="${textColor}" direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}">${escapeXml(line)}</text>`).join("")}</g><circle cx="${isRtl ? visualRegion.left + (isGoogle ? 32 : 16) : visualRegion.left + visualRegion.width - (isGoogle ? 32 : 16)}" cy="${visualRegion.top + visualRegion.height / 2}" r="${isGoogle ? 8 : 4}" fill="${secondaryColor}" opacity="0.6"/>`;
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

function requiredRegions(target: WalletArtworkTarget): {
  identityRegion: WalletArtworkPlacement;
  counterBadgeRegion: WalletArtworkPlacement;
  rewardRegion: WalletArtworkPlacement;
  qrRegion: WalletArtworkPlacement;
} {
  const layout = walletArtworkLayouts[target];
  if (
    !layout.identityRegion ||
    !layout.counterBadgeRegion ||
    !layout.rewardRegion ||
    !layout.qrRegion
  )
    throw new Error("Wallet layout is incomplete.");
  return {
    identityRegion: layout.identityRegion,
    counterBadgeRegion: layout.counterBadgeRegion,
    rewardRegion: layout.rewardRegion,
    qrRegion: layout.qrRegion,
  };
}

function canvasSvg(
  input: WalletArtworkRenderPlanInput,
  target: WalletArtworkTarget,
  width: number,
  height: number,
  scale: WalletArtworkScale,
): string {
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
    const regions = requiredRegions(target);
    foreground = `${imageFirstStampPanelSvg(layout.stampPanelRegion, accentColor, backgroundColor, input.theme.foregroundColor, false)}${qrFrameSvg(regions.qrRegion, accentColor, backgroundColor, false)}`;
  } else if (target === "APPLE_GENERIC_STRIP") {
    foreground = `<rect x="5" y="5" width="365" height="134" rx="25" fill="#000000" opacity="0.07" transform="translate(0 2)"/><rect x="5" y="5" width="365" height="134" rx="25" fill="#FFFFFF" opacity="0.5" stroke="${input.rewardReady ? secondaryColor : accentColor}" stroke-width="${input.rewardReady ? 4 : 1.5}" stroke-opacity="${input.rewardReady ? 0.72 : 0.18}"/>`;
  } else if (target === "APPLE_LEGACY_STRIP") {
    foreground = `<rect x="5" y="4" width="365" height="115" rx="23" fill="#000000" opacity="0.07" transform="translate(0 2)"/><rect x="5" y="4" width="365" height="115" rx="23" fill="#FFFFFF" opacity="0.5" stroke="${input.rewardReady ? secondaryColor : accentColor}" stroke-width="${input.rewardReady ? 4 : 1.5}" stroke-opacity="${input.rewardReady ? 0.72 : 0.18}"/>`;
  } else {
    const regions = requiredRegions(target);
    const qrRegion = calibratedGoogleHeroQrRegion(
      input,
      input.lowerGroupOffsetY
        ? { ...regions.qrRegion, top: regions.qrRegion.top + input.lowerGroupOffsetY }
        : regions.qrRegion,
    );
    foreground = `${imageFirstStampPanelSvg(masterPanel, accentColor, backgroundColor, input.theme.foregroundColor, true)}${qrFrameSvg(qrRegion, accentColor, backgroundColor, true)}`;
  }
  const ambientId = `ambient-${target.toLocaleLowerCase("en-US")}`;
  const refined = target === "GOOGLE_HERO" && input.applePosterRefinement;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logical.width} ${logical.height}"><defs><radialGradient id="${ambientId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.18"/><stop offset="100%" stop-color="${secondaryColor}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="${surfaceBackgroundColor}"/><ellipse cx="${logical.width * 0.79}" cy="${logical.height * 0.18}" rx="${logical.width * 0.23}" ry="${logical.height * 0.19}" fill="url(#${ambientId})" opacity="${refined ? 0 : 1}"/><path d="M${logical.width * 0.06} ${logical.height * 0.075}C${logical.width * 0.3} ${logical.height * 0.025},${logical.width * 0.56} ${logical.height * 0.13},${logical.width * 0.9} ${logical.height * 0.065}" fill="none" stroke="${secondaryColor}" stroke-width="${Math.max(4, logical.width * 0.012)}" stroke-linecap="round" opacity="${refined ? 0 : 0.08}"/>${artworkMotif}${foreground}<metadata data-composer="waflo-wallet-artwork-v5" data-target="${target}" data-scale="${scale}" data-source-stamp-digest="${input.stampArtwork.contentDigest}"/></svg>`;
}

function canvasOverlaySvg(
  input: WalletArtworkRenderPlanInput,
  target: WalletArtworkTarget,
  width: number,
  height: number,
): string | undefined {
  if (target !== "APPLE_POSTER" && target !== "GOOGLE_HERO") return undefined;
  const logical = walletArtworkDimensions[target];
  const regions = requiredRegions(target);
  const headerScale = input.headerScale ?? 1;
  const scaleHeader = (region: WalletArtworkPlacement): WalletArtworkPlacement => ({
    left: region.left - (region.width * (headerScale - 1)) / 2,
    top: region.top - (region.height * (headerScale - 1)) / 2 + (input.headerOffsetY ?? 0),
    width: region.width * headerScale,
    height: region.height * headerScale,
  });
  const scaleIdentityHeader = (region: WalletArtworkPlacement): WalletArtworkPlacement => ({
    left: region.left - region.width * (headerScale - 1),
    top: region.top - (region.height * (headerScale - 1)) / 2 + (input.headerOffsetY ?? 0),
    width: region.width * headerScale,
    height: region.height * headerScale,
  });
  const reward = input.lowerGroupOffsetY
    ? { ...regions.rewardRegion, top: regions.rewardRegion.top + input.lowerGroupOffsetY }
    : regions.rewardRegion;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logical.width} ${logical.height}">${identitySvg(input, scaleIdentityHeader(regions.identityRegion))}${counterBadgeSvg(input, scaleHeader(regions.counterBadgeRegion))}${rewardPanelSvg(input, reward)}</svg>`;
}

function scaled(region: WalletArtworkPlacement, scale: WalletArtworkScale): WalletArtworkPlacement {
  return {
    left: region.left * scale,
    top: region.top * scale,
    width: region.width * scale,
    height: region.height * scale,
  };
}

export function createWalletArtworkRenderPlan(
  input: WalletArtworkRenderPlanInput,
  target: WalletArtworkTarget,
  scale: WalletArtworkScale = 1,
): WalletArtworkRenderPlan {
  if (target === "APPLE_POSTER")
    throw new Error("Apple Poster is derived from the shared Google master plan.");
  const dimensions = walletArtworkDimensions[target];
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  const layout = walletArtworkLayouts[target];
  const stampSourceBounds = measureWalletArtworkVisibleBounds(input.stampArtwork, input.stampSize);
  const stampRegion = scaled(layout.stampRegion, scale);
  const fit = Math.min(
    stampRegion.width / stampSourceBounds.width,
    stampRegion.height / stampSourceBounds.height,
  );
  const stampPlacement = {
    width: Math.round(stampSourceBounds.width * fit),
    height: Math.round(stampSourceBounds.height * fit),
    left: 0,
    top: 0,
  };
  const placement = {
    ...stampPlacement,
    left: Math.round(stampRegion.left + (stampRegion.width - stampPlacement.width) / 2),
    top: Math.round(stampRegion.top + (stampRegion.height - stampPlacement.height) / 2),
  };
  let qr: WalletArtworkRenderPlan["qr"];
  if (target === "GOOGLE_HERO") {
    const regions = requiredRegions(target);
    let frame = scaled(regions.qrRegion, scale);
    if (input.lowerGroupOffsetY)
      frame = { ...frame, top: frame.top + input.lowerGroupOffsetY * scale };
    frame = calibratedGoogleHeroQrRegion(input, frame);
    const inset = 14 * scale;
    const payloadSize = frame.width - inset * 2 + (!input.applePosterRefinement ? 5 : 0);
    const offset = !input.applePosterRefinement ? -3 * scale : 0;
    qr = {
      frame,
      payload: {
        left: frame.left + inset + offset,
        top: frame.top + inset + offset,
        width: payloadSize,
        height: payloadSize,
      },
      margin: 1,
      errorCorrectionLevel: "Q",
    };
  }
  const overlaySvg = canvasOverlaySvg(input, target, width, height);
  const baseSvg =
    target === "APPLE_LEGACY_STRIP"
      ? walletArtworkLegacySurfaceSvg(input, width, height, scale)
      : canvasSvg(input, target, width, height, scale);
  return {
    target,
    scale,
    width,
    height,
    baseSvg,
    ...(overlaySvg ? { overlaySvg } : {}),
    stampSourceBounds,
    stampPlacement: placement,
    stampRegion,
    ...(qr ? { qr } : {}),
  };
}

export function createLegacyWalletStampGridPlan(
  input: WalletArtworkRenderPlanInput,
  scale: WalletArtworkScale,
  sourceAspectRatio = measureWalletArtworkVisibleBounds(input.stampArtwork, input.stampSize).width /
    measureWalletArtworkVisibleBounds(input.stampArtwork, input.stampSize).height,
): LegacyWalletStampGridPlan {
  const rows = balancedWalletStampDistribution(input.requiredStampCount).rows;
  const columns = Math.max(...rows);
  const rowCount = rows.length;
  const layout = walletArtworkLayouts.APPLE_LEGACY_STRIP;
  const grid = {
    left: layout.stampRegion.left * scale,
    top: layout.stampRegion.top * scale,
    width: layout.stampRegion.width * scale,
    height: layout.stampRegion.height * scale,
  };
  const sourceGapRatio =
    (sourceAspectRatio * rowCount - columns) / (columns - 1 - sourceAspectRatio * (rowCount - 1));
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
  const width = Math.max(1, Math.round(tileSize * 1.22));
  const height = Math.max(1, Math.round(tileSize * 1.06));
  const horizontalGap = gap + scale;
  const verticalGap = Math.max(scale, gap - 2 * scale);
  const gridHeight = rowCount * height + (rowCount - 1) * verticalGap;
  const top = Math.round(grid.top + (grid.height - gridHeight) / 2);
  const sourceByIndex = new Map(
    input.stampArtwork.positions.map((position) => [position.index, position]),
  );
  let index = 0;
  const tiles: Array<LegacyWalletStampGridPlan["tiles"][number]> = [];
  for (const [rowIndex, count] of rows.entries()) {
    const rowWidth = count * width + (count - 1) * horizontalGap;
    const left = Math.round(grid.left + (grid.width - rowWidth) / 2);
    for (let column = 0; column < count; column += 1) {
      const source = sourceByIndex.get(index);
      if (!source) throw new Error("Legacy Wallet stamp position is unavailable.");
      const half = input.stampSize / 2;
      tiles.push({
        index,
        left: left + column * (width + horizontalGap),
        top: top + rowIndex * (height + verticalGap),
        width,
        height,
        source: {
          left: source.x - half,
          top: source.y - half,
          width: input.stampSize,
          height: input.stampSize,
        },
      });
      index += 1;
    }
  }
  const widestRow = Math.max(...rows);
  const rawWidth = widestRow * width + (widestRow - 1) * horizontalGap;
  const rawHeight = gridHeight;
  const reportedHeight = Math.min(rawHeight, grid.height, Math.round(rawWidth / sourceAspectRatio));
  const reportedWidth = Math.min(
    rawWidth,
    grid.width,
    Math.round(reportedHeight * sourceAspectRatio),
  );
  return {
    rows,
    tiles,
    stampPlacement: {
      left: Math.round(grid.left + (grid.width - reportedWidth) / 2),
      top: Math.round(grid.top + (grid.height - reportedHeight) / 2),
      width: reportedWidth,
      height: reportedHeight,
    },
  };
}

function dataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function innerSvg(svg: string): string {
  return svg.replace(/^<svg\b[^>]*>/u, "").replace(/<\/svg>$/u, "");
}

function stampMarkup(plan: WalletArtworkRenderPlan, input: WalletArtworkRenderPlanInput): string {
  const bounds = plan.stampSourceBounds;
  const placement = plan.stampPlacement;
  return `<svg x="${placement.left}" y="${placement.top}" width="${placement.width}" height="${placement.height}" viewBox="${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}" preserveAspectRatio="none" data-wallet-plan-layer="stamp"><image href="${dataUri(input.stampArtwork.svg)}" x="0" y="0" width="${input.stampArtwork.width}" height="${input.stampArtwork.height}" preserveAspectRatio="none"/></svg>`;
}

function legacyStampMarkup(
  plan: WalletArtworkRenderPlan,
  input: WalletArtworkRenderPlanInput,
): string {
  const grid = createLegacyWalletStampGridPlan(
    input,
    plan.scale,
    plan.stampSourceBounds.width / plan.stampSourceBounds.height,
  );
  return grid.tiles
    .map(
      (tile) =>
        `<svg x="${tile.left}" y="${tile.top}" width="${tile.width}" height="${tile.height}" viewBox="${tile.source.left} ${tile.source.top} ${tile.source.width} ${tile.source.height}" preserveAspectRatio="none" data-wallet-plan-layer="legacy-stamp"><image href="${dataUri(input.stampArtwork.svg)}" x="0" y="0" width="${input.stampArtwork.width}" height="${input.stampArtwork.height}" preserveAspectRatio="none"/></svg>`,
    )
    .join("");
}

function qrMarkup(plan: WalletArtworkRenderPlan, rasterDataUri?: string): string {
  if (!plan.qr) return "";
  if (rasterDataUri && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(rasterDataUri)) {
    return `<image data-wallet-plan-layer="qr" href="${rasterDataUri}" x="${plan.qr.payload.left}" y="${plan.qr.payload.top}" width="${plan.qr.payload.width}" height="${plan.qr.payload.height}" preserveAspectRatio="none"/>`;
  }
  const qr = createQrPreviewRasterMarkup("waflo-wallet-preview-only", {
    width: plan.qr.payload.width,
    margin: plan.qr.margin,
    errorCorrectionLevel: plan.qr.errorCorrectionLevel,
  });
  return `<svg data-wallet-plan-layer="qr" x="${plan.qr.payload.left}" y="${plan.qr.payload.top}" width="${plan.qr.payload.width}" height="${plan.qr.payload.height}" viewBox="0 0 ${qr.width} ${qr.width}" preserveAspectRatio="none" shape-rendering="crispEdges">${qr.markup}</svg>`;
}

/** Render the exact plan geometry as browser SVG. This does not make network requests. */
export function renderWalletArtworkPlanSvg(
  plan: WalletArtworkRenderPlan,
  input: WalletArtworkRenderPlanInput,
  rasterDataUri?: string,
): string {
  const stamp =
    plan.target === "APPLE_LEGACY_STRIP"
      ? legacyStampMarkup(plan, input)
      : stampMarkup(plan, input);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}" data-wallet-artwork-render-plan="v1" data-wallet-artwork-target="${plan.target}">${innerSvg(plan.baseSvg)}${stamp}${qrMarkup(plan, rasterDataUri)}${plan.overlaySvg ? innerSvg(plan.overlaySvg) : ""}</svg>`;
}

export function walletArtworkBrowserSvg(
  input: WalletArtworkRenderPlanInput,
  target: Exclude<WalletArtworkTarget, "APPLE_POSTER">,
  rasterDataUri?: string,
): string {
  return renderWalletArtworkPlanSvg(
    createWalletArtworkRenderPlan(input, target),
    input,
    rasterDataUri,
  );
}

export function walletArtworkQrRasterRequest(
  input: WalletArtworkRenderPlanInput,
  target: Exclude<WalletArtworkTarget, "APPLE_POSTER">,
): WalletArtworkQrRasterRequest | undefined {
  const qr = createWalletArtworkRenderPlan(input, target).qr;
  return qr
    ? {
        value: "waflo-wallet-preview-only",
        width: Math.floor(qr.payload.width),
        margin: qr.margin,
        errorCorrectionLevel: qr.errorCorrectionLevel,
      }
    : undefined;
}

/** Functional union of the approved Google composition, excluding canvas dead space. */
export const googleMasterContentBounds: WalletArtworkPlacement = {
  left: 32,
  top: 25,
  width: 968,
  // Includes the Google QR frame and shadow through Y=759.
  height: 734,
};

/** The one calibrated Google-master-to-Apple-Poster transform. */
export const applePosterGoogleMasterTransform = {
  scale: 353 / googleMasterContentBounds.width,
  translateX: 2,
  translateY: 33,
} as const;

export function applePosterFooterContinuationSvg(
  width: number,
  height: number,
  scale: WalletArtworkScale,
  accentColor: string,
  secondaryColor: string,
): string {
  const transitionTop = 290 * scale;
  const cutoff = 330 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="footer-fade" gradientUnits="userSpaceOnUse" x1="0" y1="${transitionTop}" x2="0" y2="${cutoff}"><stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.07"/><stop offset="100%" stop-color="${secondaryColor}" stop-opacity="0"/></linearGradient><linearGradient id="arc-fade" gradientUnits="userSpaceOnUse" x1="0" y1="${transitionTop}" x2="0" y2="${cutoff}"><stop offset="0%" stop-color="${accentColor}" stop-opacity="0.105"/><stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/></linearGradient><clipPath id="footer-visible"><rect x="0" y="${transitionTop}" width="${width}" height="${cutoff - transitionTop}"/></clipPath></defs><g clip-path="url(#footer-visible)"><rect x="0" y="${transitionTop}" width="${width}" height="${cutoff - transitionTop}" fill="url(#footer-fade)"/><circle cx="${-22 * scale}" cy="${385 * scale}" r="${112 * scale}" fill="none" stroke="url(#arc-fade)" stroke-width="${1.5 * scale}"/><path d="M${width * 0.9} ${292 * scale}C${width * 0.62} ${286 * scale},${width * 0.24} ${314 * scale},${width * -0.1} ${299 * scale}" fill="none" stroke="url(#arc-fade)" stroke-width="${1.05 * scale}" stroke-linecap="round"/></g></svg>`;
}

/** Apple Poster remains a single transformed, calibrated Google-master plan. */
export function applePosterGoogleMasterRenderInput(
  input: WalletArtworkRenderPlanInput,
): WalletArtworkRenderPlanInput {
  return {
    ...input,
    organizationName: "\u200B",
    counterForegroundColor: "#FFFFFF",
    headerScale: 1.3,
    appleStampPanelInset: 18,
    headerOffsetY: -15,
    lowerGroupOffsetY: -20,
    suppressMemberPrefix: true,
    applePosterRefinement: true,
  };
}

export interface WalletArtworkApplePosterRenderPlan {
  readonly target: "APPLE_POSTER";
  readonly scale: WalletArtworkScale;
  readonly width: number;
  readonly height: number;
  readonly master: {
    readonly input: WalletArtworkRenderPlanInput;
    readonly plan: WalletArtworkRenderPlan;
    readonly sourceBounds: WalletArtworkPlacement;
    readonly destination: WalletArtworkPlacement;
  };
  readonly footerSvg: string;
  readonly topAmbientSvg: string;
}

export function createWalletArtworkApplePosterRenderPlan(
  input: WalletArtworkRenderPlanInput,
  scale: WalletArtworkScale = 1,
): WalletArtworkApplePosterRenderPlan {
  const masterInput = applePosterGoogleMasterRenderInput(input);
  const width = walletArtworkDimensions.APPLE_POSTER.width * scale;
  const height = walletArtworkDimensions.APPLE_POSTER.height * scale;
  const destination = {
    left: applePosterGoogleMasterTransform.translateX * scale,
    top: applePosterGoogleMasterTransform.translateY * scale,
    width: Math.round(
      googleMasterContentBounds.width * applePosterGoogleMasterTransform.scale * scale,
    ),
    height: Math.round(
      googleMasterContentBounds.height * applePosterGoogleMasterTransform.scale * scale,
    ),
  };
  return {
    target: "APPLE_POSTER",
    scale,
    width,
    height,
    master: {
      input: masterInput,
      plan: createWalletArtworkRenderPlan(masterInput, "GOOGLE_HERO"),
      sourceBounds: googleMasterContentBounds,
      destination,
    },
    footerSvg: applePosterFooterContinuationSvg(
      width,
      height,
      scale,
      input.theme.accentColor,
      input.theme.secondaryColor,
    ),
    topAmbientSvg: applePosterTopAmbientSvg(
      width,
      height,
      input.theme.accentColor,
      input.theme.secondaryColor,
    ),
  };
}

export function renderWalletArtworkApplePosterPlanSvg(
  plan: WalletArtworkApplePosterRenderPlan,
  rasterDataUri?: string,
): string {
  const master = renderWalletArtworkPlanSvg(plan.master.plan, plan.master.input, rasterDataUri);
  const source = plan.master.sourceBounds;
  const destination = plan.master.destination;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}" data-wallet-artwork-render-plan="v1" data-wallet-artwork-target="APPLE_POSTER"><rect width="100%" height="100%" fill="${plan.master.input.theme.backgroundColor}"/>${innerSvg(plan.footerSvg)}<svg x="${destination.left}" y="${destination.top}" width="${destination.width}" height="${destination.height}" viewBox="${source.left} ${source.top} ${source.width} ${source.height}" preserveAspectRatio="none" data-wallet-plan-layer="apple-google-master">${innerSvg(master)}</svg>${innerSvg(plan.topAmbientSvg)}</svg>`;
}

export function walletArtworkApplePosterBrowserSvg(
  input: WalletArtworkRenderPlanInput,
  rasterDataUri?: string,
): string {
  return renderWalletArtworkApplePosterPlanSvg(
    createWalletArtworkApplePosterRenderPlan(input),
    rasterDataUri,
  );
}

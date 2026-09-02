import { createHash } from "node:crypto";
import {
  cardLocalePresentation,
  walletStructuralCopyForLocale,
  type ProgramTemplatePresentation,
} from "@waflo/contracts";
import { createQrPreviewMarkup } from "@waflo/qr-core";
import type { StampOutputProfile } from "@waflo/stamp-engine";
import type { DashboardWalletArtwork } from "./wallet-preview-artwork.js";

export interface ProgramPreviewCompositionInput {
  profile: StampOutputProfile;
  locale: string;
  organizationName: string;
  programName: string;
  shortDescription: string;
  rewardSummary: string;
  terms: string;
  progress: number;
  goal: number;
  stampSvg: string;
  /** The dashboard exposes only Grid; legacy values are normalized upstream. */
  stampLayout?: "GRID";
  appleWalletVariant?: "LEGACY" | "POSTER";
  backgroundColor: string;
  foregroundColor: string;
  accentColor: string;
  secondaryColor: string;
  /** Organization brand fallback used when a program-specific logo is absent. */
  merchantBrandLogoDataUri?: string;
  logoDataUri?: string;
  identityDataUri?: string;
  heroDataUri?: string;
  backgroundDataUri?: string;
  /** PNG output from the production Wallet compositor, supplied by the preview service. */
  walletArtwork?: DashboardWalletArtwork;
  customerWebVariant: "CARD" | "MINIMAL" | "HERO";
  presentation?: ProgramTemplatePresentation;
  apple: {
    headerLabel: string;
    headerValue: string;
    secondaryLabel: string;
    barcodeLabel: string;
    showBackContent: boolean;
  };
  google: {
    title: string;
    subtitle: string;
    detailsLabel: string;
    barcodeLabel: string;
  };
}

export interface ProgramPreviewComposition {
  svg: string;
  digest: string;
  width: number;
  height: number;
  warnings: Array<{
    code: string;
    severity: "warning";
    platform: "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET";
    message: string;
  }>;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ??
      character,
  );
}

/** SVG text needs local bidi isolation; SVG does not inherit DOM `<bdi>` semantics. */
function localizedTextAttributes(locale: string): string {
  const presentation = cardLocalePresentation(locale);
  return `direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}"`;
}

function progressTextAttributes(): string {
  // Preserve numerator/denominator order inside an RTL surrounding context.
  return 'direction="ltr" unicode-bidi="plaintext" xml:lang="en"';
}

function graphemeSegments(value: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
    ({ segment }) => segment,
  );
}

function previewWidth(value: string, locale: string): number {
  const { script } = cardLocalePresentation(locale);
  return graphemeSegments(value).reduce((width, grapheme) => {
    if (/^\p{Mark}+$/u.test(grapheme)) return width;
    if (script === "Arab" || script === "Hebr") return width + 0.7;
    if (/^[\u2e80-\uffff]$/u.test(grapheme)) return width + 1;
    return width + 0.56;
  }, 0);
}

function truncate(value: string, limit: number): string {
  const graphemes = graphemeSegments(value);
  return graphemes.length > limit
    ? `${graphemes.slice(0, Math.max(1, limit - 1)).join("")}\u2026`
    : value;
}

function previewTextLines(
  value: string,
  lineLimit: number,
  maximumLines = 2,
  locale = "en",
): string[] {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const rawWord of words) {
    const word = truncate(rawWord, lineLimit);
    const candidate = current ? `${current} ${word}` : word;
    if (previewWidth(candidate, locale) <= lineLimit * 0.56 || current.length === 0) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  if (lines.length <= maximumLines) return lines;
  return [
    ...lines.slice(0, maximumLines - 1),
    truncate(lines.slice(maximumLines - 1).join(" "), lineLimit),
  ];
}
function safeDataImage(value: string | undefined): string {
  return value && /^data:image\/(?:png|webp|jpeg|svg\+xml);base64,/i.test(value)
    ? escapeXml(value)
    : "";
}

function googleWalletSurfaceColor(hex: string): string {
  const match = /^#([0-9a-f]{6})$/iu.exec(hex);
  if (!match?.[1]) return hex;
  const color = match[1];
  const channels = [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const [red = 0, green = 0, blue = 0] = channels;
  return `#${[red, green + 1, blue + 2]
    .map((channel) => Math.min(255, Math.max(0, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function imageTag(
  value: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 12,
  fit: "slice" | "meet" | "none" = "slice",
  attributes = "",
): string {
  const href = safeDataImage(value);
  if (!href) return "";
  const clipId = `clip-${x}-${y}-${width}-${height}`;
  const preserveAspectRatio = fit === "none" ? "none" : `xMidYMid ${fit}`;
  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/></clipPath></defs><image ${attributes} href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${preserveAspectRatio}" clip-path="url(#${clipId})"/>`;
}

function wafloIssuerMark(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill = "#E4572E",
): string {
  const scale = Math.min(width, height) / 26;
  const insetX = x + (width - 26 * scale) / 2;
  const insetY = y + (height - 26 * scale) / 2;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/><path d="M${insetX + 5.5 * scale} ${insetY + 6 * scale}l4.5 ${13 * scale} 3.6 ${-6.5 * scale} 3.6 ${6.5 * scale} 4.5 ${-13 * scale}" fill="none" stroke="#fff" stroke-width="${2.3 * scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function issuerBrandMark(
  value: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fallbackColor = "#E4572E",
): string {
  return value
    ? imageTag(value, x, y, width, height, radius, "meet")
    : wafloIssuerMark(x, y, width, height, radius, fallbackColor);
}

/**
 * Google Wallet presents a supplied mark on a small white native logo plate.
 * Keep this treatment outside the production hero: the class logo remains the
 * semantic source, while the plate belongs to the Android card frame.
 */
function googleIssuerBrandMark(
  value: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  if (value) return issuerBrandMark(value, x, y, width, height, Math.min(width, height) / 2);
  // Android's native logo plate holds this issuer mark on its leading optical
  // edge rather than geometrically centering its compact rectangular asset.
  const innerWidth = width * 0.7;
  const innerHeight = height * 0.52;
  const innerX = x;
  const innerY = y + height * 0.22;
  return `<circle cx="${x + width / 2}" cy="${y + height / 2}" r="${Math.min(width, height) / 2}" fill="#FFFFFF"/>${wafloIssuerMark(innerX, innerY, innerWidth, innerHeight, Math.min(innerWidth, innerHeight) * 0.18, "#A03A21")}`;
}

function qrCode(x: number, y: number, size: number): string {
  const previewQr = createQrPreviewMarkup("waflo-wallet-preview-only", {
    errorCorrectionLevel: "Q",
  });
  const scale = size / previewQr.viewSize;
  return `<g aria-label="QR code preview" transform="translate(${x} ${y}) scale(${scale})" shape-rendering="crispEdges">${previewQr.markup}</g>`;
}

function stampImage(stampSvg: string, x: number, y: number, width: number, height: number): string {
  const href = `data:image/svg+xml;base64,${Buffer.from(stampSvg, "utf8").toString("base64")}`;
  const clipId = `stamp-clip-${x}-${y}-${width}-${height}`;
  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath></defs><image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})"/>`;
}

function productionArtworkImage(
  artwork: DashboardWalletArtwork | undefined,
  target: DashboardWalletArtwork["target"],
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fit: "meet" | "none" = "meet",
): string {
  return artwork?.target === target
    ? imageTag(
        artwork.dataUri,
        x,
        y,
        width,
        height,
        radius,
        fit,
        `data-production-wallet-artwork="${target}"`,
      )
    : "";
}

function composeLegacyCustomer(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 820;
  const height = input.customerWebVariant === "HERO" ? 600 : 560;
  const locale = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(locale.locale);
  const rtl = locale.isRtl;
  const direction = locale.direction;
  const textAttributes = localizedTextAttributes(locale.locale);
  const anchor = "start";
  const issuerSize = 40;
  const issuerX = rtl ? width - 74 - issuerSize : 74;
  const textX = rtl ? issuerX - 14 : issuerX + issuerSize + 14;
  const motifX = rtl ? 62 : width - 158;
  const issuerLogo = input.logoDataUri ?? input.merchantBrandLogoDataUri;
  const issuerBrand = input.logoDataUri
    ? "program"
    : input.merchantBrandLogoDataUri
      ? "organization"
      : "default";
  const brandArtwork = input.identityDataUri;
  const warnings: ProgramPreviewComposition["warnings"] = [];
  if (input.terms.length > 180)
    warnings.push({
      code: "CUSTOMER_TERMS_TRUNCATED",
      severity: "warning",
      platform: "CUSTOMER_WEB",
      message: "The terms preview is shortened in the customer card.",
    });
  const backgroundArtwork = imageTag(input.backgroundDataUri, 24, 20, width - 48, height - 40, 30);
  const backgroundOverlay = input.backgroundDataUri
    ? `<rect x="24" y="20" width="${width - 48}" height="${height - 40}" rx="30" fill="${input.backgroundColor}" opacity=".84"/>`
    : "";
  const title = (y: number, size: number) =>
    `<text ${textAttributes} x="${textX}" y="${y}" text-anchor="${anchor}" font-family="${escapeXml(locale.fontStack)}" font-size="${size}" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 48))}</text>`;
  const description = (y: number) =>
    `<text ${textAttributes} x="${textX}" y="${y}" text-anchor="${anchor}" font-family="${escapeXml(locale.fontStack)}" font-size="16" fill="${input.foregroundColor}" opacity=".72">${escapeXml(truncate(input.shortDescription, 76))}</text>`;
  const reward = (y: number, boxed = true) =>
    `${boxed ? `<rect x="58" y="${y - 27}" width="${width - 116}" height="68" rx="16" fill="${input.accentColor}" opacity=".12"/>` : `<path d="M58 ${y - 24}H762" stroke="${input.foregroundColor}" stroke-width="2" opacity=".14"/>`}<text ${textAttributes} x="${textX}" y="${y}" text-anchor="${anchor}" font-family="${escapeXml(locale.fontStack)}" font-size="13" font-weight="700" fill="${input.accentColor}">${copy.nextReward}</text><text ${textAttributes} x="${textX}" y="${y + 24}" text-anchor="${anchor}" font-family="${escapeXml(locale.fontStack)}" font-size="17" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.rewardSummary, 68))}</text>`;
  const terms = `<text ${textAttributes} x="${textX}" y="${height - 38}" text-anchor="${anchor}" font-family="${escapeXml(locale.fontStack)}" font-size="12" fill="${input.foregroundColor}" opacity=".58">${escapeXml(truncate(input.terms, 106))}</text>`;
  const motif = (x: number, y: number, size: number, opacity = 1) =>
    brandArtwork
      ? `<g opacity="${opacity}"><circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="${input.secondaryColor}" opacity=".22"/>${imageTag(brandArtwork, x + 10, y + 10, size - 20, size - 20, size / 4)}</g>`
      : "";
  const issuer = `<g data-issuer-brand="${issuerBrand}">${issuerBrandMark(issuerLogo, issuerX, 54, issuerSize, issuerSize, 11)}</g>`;

  let surface = "";
  if (input.customerWebVariant === "HERO") {
    const heroArtwork = imageTag(input.heroDataUri, 42, 42, width - 84, 160, 24);
    surface = `${heroArtwork}<rect x="42" y="42" width="${width - 84}" height="160" rx="24" fill="${input.accentColor}" opacity="${input.heroDataUri ? ".32" : ".14"}"/>${motif(motifX, 54, 132)}${title(103, 32)}${description(136)}${stampImage(input.stampSvg, 60, 218, width - 120, 178)}${reward(446)}${terms}`;
  } else if (input.customerWebVariant === "MINIMAL") {
    const railX = rtl ? width - 36 : 24;
    surface = `<rect x="${railX}" y="20" width="12" height="${height - 40}" rx="6" fill="${input.accentColor}"/>${motif(motifX, 42, 142, 0.22)}${title(94, 29)}${description(126)}${stampImage(input.stampSvg, 60, 160, width - 120, 184)}${reward(402, false)}${terms}`;
  } else {
    surface = `${motif(motifX, 46, 112)}${title(96, 30)}${description(128)}${stampImage(input.stampSvg, 60, 158, width - 120, 184)}${reward(400)}${terms}`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Customer Web preview" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${direction}" data-progress="${input.progress}" data-goal="${input.goal}" data-issuer-brand="${issuerBrand}"><rect width="100%" height="100%" fill="#ECEFF3"/><rect x="24" y="20" width="${width - 48}" height="${height - 40}" rx="30" fill="${input.backgroundColor}" stroke="#D9DDE3" stroke-width="2"/>${backgroundArtwork}${backgroundOverlay}${issuer}${surface}</svg>`;
  return { svg, width, height, warnings };
}

function composeCustomer(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  if (!input.presentation) return composeLegacyCustomer(input);

  const presentation = input.presentation;
  const width = 820;
  const height = 580;
  const locale = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(locale.locale);
  const rtl = locale.isRtl;
  const direction = locale.direction;
  const textAttributes = localizedTextAttributes(locale.locale);
  const font = locale.fontStack;
  const fontAttribute = escapeXml(font);
  const card = { x: 24, y: 20, width: 772, height: 540 };
  const cornerRadius =
    presentation.cornerTreatment === "ROUND"
      ? 38
      : presentation.cornerTreatment === "SOFT"
        ? 26
        : 16;
  const logicalRectX = (x: number, rectWidth: number) => (rtl ? width - x - rectWidth : x);
  const logicalTextX = (x: number) => (rtl ? width - x : x);
  const issuerLogo = input.logoDataUri ?? input.merchantBrandLogoDataUri;
  const issuerBrand = input.logoDataUri
    ? "program"
    : input.merchantBrandLogoDataUri
      ? "organization"
      : "default";
  const brandArtwork = input.identityDataUri;
  const warnings: ProgramPreviewComposition["warnings"] = [];
  if (input.terms.length > 180)
    warnings.push({
      code: "CUSTOMER_TERMS_TRUNCATED",
      severity: "warning",
      platform: "CUSTOMER_WEB",
      message: "The terms preview is shortened in the customer card.",
    });

  const baseTitleSize =
    presentation.titleTreatment === "DISPLAY"
      ? 38
      : presentation.titleTreatment === "EDITORIAL"
        ? 34
        : presentation.titleTreatment === "COMPACT"
          ? 27
          : 30;
  const titleSize = Math.max(
    23,
    baseTitleSize -
      (rtl ? 1 : 0) -
      (input.programName.length > 25 ? 4 : 0) -
      (input.programName.length > 34 ? 3 : 0),
  );
  const rewardLabel = copy.nextReward;

  const headerBlock = (
    x: number,
    y: number,
    options: { centered?: boolean; descriptionWidth?: number; compact?: boolean } = {},
  ) => {
    const centered = options.centered ?? false;
    const issuerSize = 40;
    const textX = centered ? width / 2 : logicalTextX(x + issuerSize + 14);
    const anchor = centered ? "middle" : "start";
    const localTitleSize = options.compact ? Math.max(22, titleSize - 4) : titleSize;
    const descriptionLimit =
      options.descriptionWidth && options.descriptionWidth < 360 ? (rtl ? 30 : 42) : rtl ? 52 : 68;
    const issuerX = centered ? width / 2 - issuerSize / 2 : logicalRectX(x, issuerSize);
    const issuerY = centered ? y - 66 : y - 35;
    return `<g data-preview-block="header" data-title-treatment="${presentation.titleTreatment}" data-issuer-brand="${issuerBrand}">${issuerBrandMark(issuerLogo, issuerX, issuerY, issuerSize, issuerSize, 11)}<text ${textAttributes} x="${textX}" y="${y}" text-anchor="${anchor}" font-family="${fontAttribute}" font-size="${localTitleSize}" font-weight="800" letter-spacing="${presentation.titleTreatment === "EDITORIAL" ? "-.5" : "0"}" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 46))}</text><text ${textAttributes} x="${textX}" y="${y + 32}" text-anchor="${anchor}" font-family="${fontAttribute}" font-size="${options.compact ? 13 : 15}" fill="${input.foregroundColor}" opacity=".7">${escapeXml(truncate(input.shortDescription, descriptionLimit))}</text></g>`;
  };

  const motif = () => {
    if (!brandArtwork) return "";
    const treatment = presentation.motifTreatment;
    if (treatment === "EDGE_CROP") {
      const size = 250;
      const x = logicalRectX(606, size);
      return `<g data-preview-block="motif" data-motif-treatment="${treatment}"><ellipse cx="${x + size / 2}" cy="142" rx="156" ry="150" fill="${input.secondaryColor}" opacity=".2"/><g opacity=".95">${imageTag(brandArtwork, x + 20, 28, size, size, 0)}</g></g>`;
    }
    if (treatment === "WATERMARK") {
      const size = 220;
      const x = logicalRectX(552, size);
      return `<g data-preview-block="motif" data-motif-treatment="${treatment}" opacity=".11">${imageTag(brandArtwork, x, 54, size, size, 0)}</g>`;
    }
    if (treatment === "HEADER_MARK") {
      const size = 92;
      const x = logicalRectX(666, size);
      return `<g data-preview-block="motif" data-motif-treatment="${treatment}"><rect x="${x - 8}" y="48" width="${size + 16}" height="${size + 16}" rx="22" fill="${input.secondaryColor}" opacity=".22"/>${imageTag(brandArtwork, x, 56, size, size, 18)}</g>`;
    }
    if (treatment === "CORNER_MARK") {
      const size = 108;
      const x = logicalRectX(644, size);
      return `<g data-preview-block="motif" data-motif-treatment="${treatment}"><path d="M${x - 22} 20H${x + size + 44}V174L${x + 8} 142Z" fill="${input.accentColor}" opacity=".14"/>${imageTag(brandArtwork, x, 42, size, size, 18)}</g>`;
    }
    if (treatment === "SIDE_MARK") {
      const size = 146;
      const x = logicalRectX(48, size);
      return `<g data-preview-block="motif" data-motif-treatment="${treatment}"><rect x="${x - 12}" y="76" width="${size + 24}" height="${size + 24}" rx="${cornerRadius}" fill="${input.secondaryColor}" opacity=".18"/>${imageTag(brandArtwork, x, 88, size, size, 22)}</g>`;
    }
    const size = 104;
    const x = logicalRectX(642, size);
    return `<g data-preview-block="motif" data-motif-treatment="${treatment}"><circle cx="${x + size / 2}" cy="128" r="64" fill="${input.secondaryColor}" opacity=".22"/>${imageTag(brandArtwork, x, 76, size, size, 30)}</g>`;
  };

  const stampBlock = (
    x: number,
    y: number,
    blockWidth: number,
    blockHeight: number,
    framed = false,
  ) => {
    const actualX = logicalRectX(x, blockWidth);
    return `<g data-preview-block="stamps" data-stamp-layout="${input.stampLayout ?? "GRID"}">${framed ? `<rect x="${actualX}" y="${y}" width="${blockWidth}" height="${blockHeight}" rx="24" fill="${input.secondaryColor}" opacity=".11" stroke="${input.foregroundColor}" stroke-opacity=".08"/>` : ""}${stampImage(input.stampSvg, actualX + (framed ? 16 : 0), y + (framed ? 10 : 0), blockWidth - (framed ? 32 : 0), blockHeight - (framed ? 20 : 0))}</g>`;
  };

  const rewardBlock = (x: number, y: number, blockWidth: number, blockHeight = 76) => {
    const actualX = logicalRectX(x, blockWidth);
    const textX = rtl ? actualX + blockWidth - 16 : actualX + 16;
    const summaryLimit = blockWidth < 230 ? (rtl ? 18 : 22) : blockWidth < 430 ? 46 : 68;
    const treatment = presentation.rewardTreatment;
    const shape =
      treatment === "FRAMED" || treatment === "SIDE_PANEL"
        ? `<rect x="${actualX}" y="${y}" width="${blockWidth}" height="${blockHeight}" rx="${treatment === "SIDE_PANEL" ? 18 : 20}" fill="${input.backgroundColor}" stroke="${input.accentColor}" stroke-width="2" stroke-opacity=".42"/>`
        : treatment === "FOOTER_BAND"
          ? `<rect x="${actualX}" y="${y}" width="${blockWidth}" height="${blockHeight}" rx="18" fill="${input.secondaryColor}" opacity=".18"/>`
          : treatment === "BADGE"
            ? `<rect x="${actualX}" y="${y}" width="${blockWidth}" height="${blockHeight}" rx="${blockHeight / 2}" fill="${input.accentColor}" opacity=".14"/>`
            : treatment === "RULE"
              ? `<path d="M${actualX} ${y}H${actualX + blockWidth}" stroke="${input.accentColor}" stroke-width="3"/>`
              : `<path d="M${rtl ? actualX + blockWidth - 34 : actualX} ${y + blockHeight / 2}H${rtl ? actualX + blockWidth : actualX + 34}" stroke="${input.accentColor}" stroke-width="5" stroke-linecap="round"/>`;
    const labelY = treatment === "RULE" ? y + 26 : y + 27;
    return `<g data-preview-block="reward" data-reward-treatment="${treatment}">${shape}<text ${textAttributes} x="${textX}" y="${labelY}" text-anchor="start" font-family="${fontAttribute}" font-size="11" font-weight="800" letter-spacing=".35" fill="${input.accentColor}">${rewardLabel}</text><text ${textAttributes} x="${textX}" y="${labelY + 25}" text-anchor="start" font-family="${fontAttribute}" font-size="${blockWidth < 230 ? 14 : 16}" font-weight="750" fill="${input.foregroundColor}">${escapeXml(truncate(input.rewardSummary, summaryLimit))}</text></g>`;
  };

  const footer = (x = 64) =>
    `<g data-preview-block="footer"><text ${textAttributes} x="${logicalTextX(x)}" y="538" text-anchor="start" font-family="${fontAttribute}" font-size="11" fill="${input.foregroundColor}" opacity=".54">${escapeXml(truncate(input.terms, 100))}</text></g>`;

  const backgroundArtwork = imageTag(
    input.backgroundDataUri,
    card.x,
    card.y,
    card.width,
    card.height,
    cornerRadius,
  );
  const backgroundOverlay = input.backgroundDataUri
    ? `<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="${cornerRadius}" fill="${input.backgroundColor}" opacity=".84"/>`
    : "";
  const heroWidth = presentation.composition === "SPLIT_HERO" ? 226 : card.width;
  const heroX = presentation.composition === "SPLIT_HERO" ? logicalRectX(570, heroWidth) : card.x;
  const heroHeight = presentation.composition === "SPLIT_HERO" ? card.height : 170;
  const heroArtwork = imageTag(
    input.heroDataUri,
    heroX,
    card.y,
    heroWidth,
    heroHeight,
    presentation.composition === "SPLIT_HERO" ? 0 : cornerRadius,
  );

  let surface = "";
  if (presentation.composition === "SPLIT_HERO") {
    const panelX = logicalRectX(570, 226);
    surface = `${heroArtwork}<rect data-preview-block="hero-field" x="${panelX}" y="20" width="226" height="540" fill="${input.accentColor}" opacity=".12"/>${motif()}${headerBlock(64, 92, { descriptionWidth: 470 })}${stampBlock(46, 180, 510, 220)}${rewardBlock(64, 426, 472, 78)}${footer(64)}`;
  } else if (presentation.composition === "HEADER_BAND") {
    surface = `${heroArtwork}<rect data-preview-block="hero-field" x="24" y="20" width="772" height="170" fill="${input.accentColor}" opacity="${input.heroDataUri ? ".28" : ".16"}"/>${motif()}${headerBlock(62, 88, { descriptionWidth: 520, compact: true })}${stampBlock(54, 202, 712, 205)}${rewardBlock(58, 425, 704, 72)}${footer(62)}`;
  } else if (presentation.composition === "STAMP_STAGE") {
    surface = `${headerBlock(62, 86, { descriptionWidth: 500, compact: true })}${motif()}${stampBlock(66, 154, 688, 250, true)}${rewardBlock(70, 426, 680, 76)}${footer(64)}`;
  } else if (presentation.composition === "EDITORIAL") {
    const dividerX = logicalRectX(558, 2);
    surface = `${motif()}${headerBlock(62, 100, { descriptionWidth: 500 })}<path data-preview-block="divider" d="M${dividerX} 186V464" stroke="${input.foregroundColor}" stroke-width="2" opacity=".12"/>${stampBlock(42, 190, 500, 245)}${rewardBlock(578, 232, 178, 150)}${footer(62)}`;
  } else if (presentation.composition === "LABEL_FRAME") {
    const headerX = presentation.motifTreatment === "SIDE_MARK" ? 226 : 68;
    surface = `<rect data-preview-block="frame" x="46" y="42" width="728" height="472" rx="${Math.max(12, cornerRadius - 6)}" fill="none" stroke="${input.foregroundColor}" stroke-width="2" opacity=".15"/>${motif()}${headerBlock(headerX, 94, { descriptionWidth: 460, compact: true })}${stampBlock(58, 180, 486, 236, true)}${rewardBlock(566, 210, 188, 166)}${footer(68)}`;
  } else if (presentation.composition === "SIDE_TOTEM") {
    const panelX = logicalRectX(24, 212);
    surface = `<rect data-preview-block="side-field" x="${panelX}" y="20" width="212" height="540" fill="${input.accentColor}" opacity=".12"/>${motif()}${headerBlock(258, 92, { descriptionWidth: 470, compact: true })}${stampBlock(238, 176, 538, 235)}${rewardBlock(48, 338, 164, 142)}${footer(258)}`;
  } else if (presentation.composition === "DIAGONAL_FIELD") {
    const transform = rtl ? ` transform="translate(${width} 0) scale(-1 1)"` : "";
    surface = `<g data-preview-block="diagonal-field"${transform}><path d="M510 20H796V290L658 236Z" fill="${input.accentColor}" opacity=".14"/><path d="M624 20H796V180Z" fill="${input.secondaryColor}" opacity=".24"/></g>${motif()}${headerBlock(62, 92, { descriptionWidth: 500 })}${stampBlock(66, 194, 620, 224)}${rewardBlock(64, 438, 690, 68)}${footer(64)}`;
  } else {
    surface = `${motif()}${headerBlock(410, 84, { centered: true, descriptionWidth: 600 })}${stampBlock(126, 178, 568, 230)}${rewardBlock(156, 432, 508, 72)}${footer(64)}`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Customer Web preview" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${direction}" data-progress="${input.progress}" data-goal="${input.goal}" data-composition="${presentation.composition}" data-visual-role="${presentation.visualRole}" data-density="${presentation.density}"><defs><clipPath id="customer-card-clip"><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="${cornerRadius}"/></clipPath></defs><rect width="100%" height="100%" fill="#ECEFF3"/><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="${cornerRadius}" fill="${input.backgroundColor}" stroke="#D9DDE3" stroke-width="2"/>${backgroundArtwork}${backgroundOverlay}<g clip-path="url(#customer-card-clip)">${surface}</g></svg>`;
  return { svg, width, height, warnings };
}

function composeAppleLegacyWithProductionArtwork(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 621;
  const locale = cardLocalePresentation(input.locale);
  const copy = walletStructuralCopyForLocale(locale.locale);
  const rtl = locale.isRtl;
  const textAttributes = localizedTextAttributes(locale.locale);
  const appleFont = "-apple-system,BlinkMacSystemFont,Arial,sans-serif";
  const textX = rtl ? 420 : 40;
  const identityX = rtl ? 374 : 86;
  // Apple places its native header opposite the identity group.  Keep its
  // label and the isolated LTR progress run on the clear physical side, with
  // their anchors chosen independently for their actual text directions.
  const countX = rtl ? 40 : 420;
  const progressX = countX;
  const progressAnchor = rtl ? "start" : "end";
  const markX = rtl ? 382 : 38;
  const rewardLines = previewTextLines(input.rewardSummary, rtl ? 32 : 42, 2, locale.locale);
  const strip = productionArtworkImage(
    input.walletArtwork,
    "APPLE_LEGACY_STRIP",
    24,
    87,
    412,
    158.41509433962264,
    0,
    // The 375 x 123 production strip fills Apple's native strip field.
    "none",
  );
  const nativeQr = { x: 151, y: 425, size: 159 };
  const issuerBrand = input.logoDataUri ? "program" : "organization";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Apple legacy Wallet preview" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${locale.direction}" data-wallet-provider="APPLE" data-barcode-format="QR" data-issuer-brand="${issuerBrand}" data-apple-preview-variant="LEGACY" data-progress="${input.progress}" data-goal="${input.goal}" data-preview-fidelity="legacy-production-strip" data-provider-managed-layout="true" data-provider-owned-geometry="true" data-apple-strip-aspect="375:123"><rect width="100%" height="100%" fill="#15171B"/><rect data-apple-front-surface="true" x="24" y="20" width="412" height="581" rx="16" fill="${input.backgroundColor}"/><g data-apple-identity="true">${issuerBrandMark(input.logoDataUri ?? input.merchantBrandLogoDataUri, markX, 31, 40, 40, 10, "#D2603C")}<text ${textAttributes} x="${identityX}" y="57" text-anchor="start" font-family="${appleFont}" font-size="17" font-weight="750" fill="${input.foregroundColor}">${escapeXml(truncate(input.organizationName, 48))}</text></g><g data-apple-header-field="stamps"><text ${textAttributes} x="${countX}" y="41" text-anchor="end" font-family="${appleFont}" font-size="11" font-weight="750" letter-spacing=".72" fill="${input.foregroundColor}" opacity=".62">${copy.stamps}</text><text ${progressTextAttributes()} x="${progressX}" y="63" text-anchor="${progressAnchor}" font-family="${appleFont}" font-size="19" font-weight="760" fill="${input.foregroundColor}">${input.progress}/${input.goal}</text></g><g data-apple-progress-strip="true" data-apple-progress-artwork="production-compositor">${strip}</g><g data-apple-secondary-field="reward"><text ${textAttributes} x="${textX}" y="263" text-anchor="start" font-family="${appleFont}" font-size="10" font-weight="750" letter-spacing=".72" fill="${input.foregroundColor}" opacity=".62">${copy.reward}</text>${rewardLines.map((line, index) => `<text ${textAttributes} x="${textX}" y="${289 + index * 22}" text-anchor="start" font-family="${appleFont}" font-size="${index === 0 ? 18 : 16}" font-weight="720" fill="${input.foregroundColor}">${escapeXml(line)}</text>`).join("")}</g><g data-apple-barcode-region="provider-managed" data-apple-barcode-source="qr-core"><rect x="${nativeQr.x}" y="${nativeQr.y}" width="${nativeQr.size}" height="${nativeQr.size}" rx="0" fill="#FFFFFF"/>${qrCode(nativeQr.x, nativeQr.y, nativeQr.size)}</g><metadata data-apple-native-fields="true" data-apple-field-groups="header:stamps;primary:empty;secondary:reward;back:member,status,program" data-reward-value="${escapeXml(input.rewardSummary)}">The strip is the exact production APPLE_LEGACY_STRIP PNG. Progress and reward use the same Apple field tiers as the issued pass; the native QR uses the shared QR renderer.</metadata></svg>`;
  return { svg, width, height, warnings: [] };
}
function composeApplePosterWithProductionArtwork(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 532;
  const locale = cardLocalePresentation(input.locale);
  const textAttributes = localizedTextAttributes(locale.locale);
  const cardX = 51;
  const cardY = 20;
  const cardWidth = 358;
  const posterHeight = 448;
  const posterY = 42;
  const cardHeight = 492;
  const nativeReserveHeight = cardY + cardHeight - (posterY + posterHeight);
  const poster = productionArtworkImage(
    input.walletArtwork,
    "APPLE_POSTER",
    cardX,
    posterY,
    cardWidth,
    posterHeight,
    14,
  );
  const logoX = locale.isRtl ? 367 : 64;
  const merchantX = locale.isRtl ? 358 : 102;
  // SVG start/end are logical, not physical. The mirrored coordinate is the
  // logical start edge for either direction.
  const merchantAnchor = "start";
  const issuerBrand = input.logoDataUri ? "program" : "organization";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Apple iOS 27 Wallet poster preview" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${locale.direction}" data-wallet-provider="APPLE" data-barcode-format="QR" data-issuer-brand="${issuerBrand}" data-apple-preview-variant="POSTER" data-progress="${input.progress}" data-goal="${input.goal}" data-preview-fidelity="poster-production-artwork" data-provider-owned-geometry="true" data-apple-poster-aspect="358:448"><defs><clipPath id="apple-poster-card-clip"><rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="14"/></clipPath><linearGradient id="apple-poster-native-top-material" gradientUnits="userSpaceOnUse" x1="0" y1="${cardY}" x2="0" y2="161"><stop offset="0" stop-color="#000000" stop-opacity=".425"/><stop offset="6%" stop-color="#000000" stop-opacity=".29"/><stop offset="30%" stop-color="#000000" stop-opacity=".23"/><stop offset="90%" stop-color="#000000" stop-opacity=".07"/><stop offset="100%" stop-color="#000000" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="#15171B"/><g clip-path="url(#apple-poster-card-clip)"><rect data-apple-poster-surface="true" x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" fill="${input.backgroundColor}"/><g data-poster-artwork="production-compositor">${poster}</g><rect data-apple-native-top-material="true" x="${cardX}" y="${cardY}" width="${cardWidth}" height="141" fill="url(#apple-poster-native-top-material)"/><rect data-apple-native-reserve="true" x="${cardX}" y="${posterY + posterHeight}" width="${cardWidth}" height="${nativeReserveHeight}" fill="${input.backgroundColor}"/></g><g data-apple-native-primary-logo="true">${issuerBrandMark(input.logoDataUri ?? input.merchantBrandLogoDataUri, logoX, 38, 29, 29, 7)}<text ${textAttributes} x="${merchantX}" y="58" text-anchor="${merchantAnchor}" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="${input.foregroundColor}">${escapeXml(truncate(input.organizationName, 24))}</text></g><metadata data-apple-poster-preview="true">The complete production APPLE_POSTER PNG is displayed at its native 358 by 448 aspect ratio. The empty lower reserve is Apple-owned continuation only; no dashboard placeholder content is drawn.</metadata></svg>`;
  return { svg, width, height, warnings: [] };
}
function composeGoogleWithProductionArtwork(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 564;
  const locale = cardLocalePresentation(input.locale);
  const rtl = locale.isRtl;
  const textAttributes = localizedTextAttributes(locale.locale);
  const logoX = rtl ? 380 : 48;
  const textX = rtl ? 364 : 96;
  // The coordinates below are logical-start coordinates. Do not exchange the
  // anchor for RTL: doing that makes a mixed Arabic/Latin run grow out of the
  // card instead of into its available text region.
  const anchor = "start";
  // Google Wallet displays the complete hero image below its native issuer and
  // program fields. The compositor owns every pixel inside this image.
  const hero = productionArtworkImage(
    input.walletArtwork,
    "GOOGLE_HERO",
    25.5,
    220,
    409,
    321.7286821705426,
    0,
  );
  const titleTextX = rtl ? 418 : 42;
  const nativeTitleLineGap = 46.5;
  const title = previewTextLines(truncate(input.programName, 60), rtl ? 18 : 16, 2, locale.locale)
    .map(
      (line, index) =>
        `<text ${textAttributes} x="${titleTextX}" y="${143 + index * nativeTitleLineGap}" text-anchor="${anchor}" font-family="Google Sans,Roboto,Arial,sans-serif" font-size="35" font-weight="700" fill="#202124">${escapeXml(line)}</text>`,
    )
    .join("");
  const issuerBrand = input.logoDataUri ? "program" : "organization";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Google Wallet preview" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${locale.direction}" data-wallet-provider="GOOGLE" data-barcode-format="QR_CODE" data-progress="${input.progress}" data-goal="${input.goal}" data-issuer-brand="${issuerBrand}" data-provider-managed-layout="true" data-google-hero-aspect="1032:812" data-preview-fidelity="google-wallet-full-production-hero" data-provider-owned-geometry="true"><rect width="100%" height="100%" fill="#F1F3F4"/><rect x="24" y="20" width="412" height="524" rx="32" fill="${input.backgroundColor}" stroke="#DADCE0"/><g data-google-native-identity="true">${googleIssuerBrandMark(input.logoDataUri ?? input.merchantBrandLogoDataUri, logoX, 45, 34, 34)}<text ${textAttributes} x="${textX}" y="67" text-anchor="${anchor}" font-family="Google Sans,Roboto,Arial,sans-serif" font-size="15" font-weight="600" fill="#202124">${escapeXml(truncate(input.organizationName, 60))}</text><path d="M48 98H412" stroke="#E4E7EB"/></g><g data-google-native-title="true">${title}</g><g data-google-hero-region="true" data-google-hero-artwork-composition="full-production-compositor">${hero}</g><metadata data-google-provider-payload="true">Native issuer and program fields use the Google class values. The full production GOOGLE_HERO PNG retains its 1032 by 812 aspect ratio without a dashboard crop.</metadata></svg>`;
  return { svg, width, height, warnings: [] };
}
export function composeProgramPreview(
  input: ProgramPreviewCompositionInput,
): ProgramPreviewComposition {
  const providerInput =
    input.profile !== "CUSTOMER_WEB" && input.logoDataUri
      ? { ...input, merchantBrandLogoDataUri: input.logoDataUri }
      : input;
  const requiredArtworkTarget =
    input.profile === "GOOGLE_WALLET"
      ? "GOOGLE_HERO"
      : input.profile === "APPLE_WALLET"
        ? input.appleWalletVariant === "POSTER"
          ? "APPLE_POSTER"
          : "APPLE_LEGACY_STRIP"
        : undefined;
  if (requiredArtworkTarget && input.walletArtwork?.target !== requiredArtworkTarget) {
    throw new Error(
      `Dashboard ${input.profile} preview requires the production ${requiredArtworkTarget} PNG.`,
    );
  }
  const calibratedProviderInput =
    providerInput.profile === "GOOGLE_WALLET"
      ? {
          ...providerInput,
          // Google applies the Hero's lifted material color to the entire
          // native card surface, not only to the generated image.
          backgroundColor: googleWalletSurfaceColor(providerInput.backgroundColor),
        }
      : providerInput;
  const result =
    input.profile === "APPLE_WALLET"
      ? input.appleWalletVariant === "POSTER"
        ? composeApplePosterWithProductionArtwork(calibratedProviderInput)
        : composeAppleLegacyWithProductionArtwork(calibratedProviderInput)
      : input.profile === "GOOGLE_WALLET"
        ? composeGoogleWithProductionArtwork(calibratedProviderInput)
        : composeCustomer(calibratedProviderInput);
  return {
    ...result,
    digest: createHash("sha256").update(result.svg).digest("hex"),
  };
}

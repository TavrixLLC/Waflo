import { createHash } from "node:crypto";
import { programPlatformCapabilities } from "@waflo/contracts";
import type { StampOutputProfile } from "@waflo/stamp-engine";

export interface ProgramPreviewCompositionInput {
  profile: StampOutputProfile;
  locale: "EN" | "AR";
  programName: string;
  shortDescription: string;
  rewardSummary: string;
  terms: string;
  progress: number;
  goal: number;
  stampSvg: string;
  backgroundColor: string;
  foregroundColor: string;
  accentColor: string;
  secondaryColor: string;
  logoDataUri?: string;
  heroDataUri?: string;
  backgroundDataUri?: string;
  customerWebVariant: "CARD" | "MINIMAL" | "HERO";
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

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value;
}

function safeDataImage(value: string | undefined): string {
  return value && /^data:image\/(?:png|webp|jpeg|svg\+xml);base64,/i.test(value)
    ? escapeXml(value)
    : "";
}

function imageTag(
  value: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 12,
): string {
  const href = safeDataImage(value);
  if (!href) return "";
  const clipId = `clip-${x}-${y}-${width}-${height}`;
  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/></clipPath></defs><image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`;
}

function barcode(x: number, y: number, width: number, height: number): string {
  const bars = Array.from({ length: 27 }, (_, index) => {
    const barWidth = index % 4 === 0 ? 4 : index % 3 === 0 ? 3 : 2;
    const offset = (index * width) / 28;
    return `<rect x="${x + offset}" y="${y}" width="${barWidth}" height="${height}" fill="#111827"/>`;
  }).join("");
  return `<g aria-label="Barcode placeholder">${bars}</g>`;
}

function stampImage(stampSvg: string, x: number, y: number, width: number, height: number): string {
  const href = `data:image/svg+xml;base64,${Buffer.from(stampSvg, "utf8").toString("base64")}`;
  return `<image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
}

function composeCustomer(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 820;
  const height = input.customerWebVariant === "HERO" ? 600 : 540;
  const direction = input.locale === "AR" ? "rtl" : "ltr";
  const anchor = input.locale === "AR" ? "end" : "start";
  const textX = input.locale === "AR" ? width - 74 : 74;
  const hero =
    input.customerWebVariant === "HERO"
      ? `${imageTag(input.heroDataUri, 42, 42, width - 84, 150, 22)}<rect x="42" y="42" width="${width - 84}" height="150" rx="22" fill="${input.secondaryColor}" opacity="${input.heroDataUri ? "0.24" : "1"}"/>`
      : "";
  const top = input.customerWebVariant === "HERO" ? 220 : 64;
  const logo = imageTag(
    input.logoDataUri,
    input.locale === "AR" ? width - 122 : 58,
    top,
    64,
    64,
    16,
  );
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Customer Web preview" direction="${direction}"><rect width="100%" height="100%" fill="#ECEFF3"/><rect x="24" y="20" width="${width - 48}" height="${height - 40}" rx="30" fill="${input.backgroundColor}" stroke="#D9DDE3" stroke-width="2"/>${backgroundArtwork}${backgroundOverlay}${hero}${logo}<text x="${textX}" y="${top + 94}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="30" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 54))}</text><text x="${textX}" y="${top + 126}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="16" fill="${input.foregroundColor}" opacity="0.72">${escapeXml(truncate(input.shortDescription, 82))}</text>${stampImage(input.stampSvg, 60, top + 145, width - 120, 176)}<rect x="58" y="${top + 332}" width="${width - 116}" height="68" rx="16" fill="${input.accentColor}" opacity="0.12"/><text x="${textX}" y="${top + 360}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="13" font-weight="700" fill="${input.accentColor}">${input.locale === "AR" ? "المكافأة التالية" : "NEXT REWARD"}</text><text x="${textX}" y="${top + 384}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="17" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.rewardSummary, 72))}</text><text x="${textX}" y="${height - 46}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="12" fill="${input.foregroundColor}" opacity="0.58">${escapeXml(truncate(input.terms, 110))}</text></svg>`;
  return { svg, width, height, warnings };
}

function composeApple(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 640;
  const warnings: ProgramPreviewComposition["warnings"] = [];
  if (input.programName.length > 32 || input.rewardSummary.length > 64)
    warnings.push({
      code: "APPLE_TEXT_LIMIT",
      severity: "warning",
      platform: "APPLE_WALLET",
      message: "Some fields may truncate in an actual Apple Wallet pass.",
    });
  if (input.backgroundDataUri)
    warnings.push({
      code: "APPLE_BACKGROUND_ARTWORK_UNSUPPORTED",
      severity: "warning",
      platform: "APPLE_WALLET",
      message: programPlatformCapabilities.APPLE_WALLET.backgroundArtwork.explanation,
    });
  if (input.heroDataUri)
    warnings.push({
      code: "APPLE_HERO_ARTWORK_UNSUPPORTED",
      severity: "warning",
      platform: "APPLE_WALLET",
      message: programPlatformCapabilities.APPLE_WALLET.heroArtwork.explanation,
    });
  const logo = imageTag(input.logoDataUri, 48, 60, 54, 54, 12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Apple Wallet preview only"><rect width="100%" height="100%" fill="#F1F3F6"/><rect x="24" y="22" width="412" height="596" rx="34" fill="${input.backgroundColor}" stroke="#C9CED6" stroke-width="2"/>${logo}<text x="116" y="78" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="${input.foregroundColor}" opacity="0.65">${escapeXml(truncate(input.apple.headerLabel.toUpperCase(), 24))}</text><text x="116" y="102" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.apple.headerValue, 30))}</text><rect x="302" y="54" width="102" height="28" rx="14" fill="#111827"/><text x="353" y="73" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#FFFFFF">PREVIEW ONLY</text><text x="48" y="156" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="29" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 30))}</text><text x="48" y="188" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="12" font-weight="700" fill="${input.foregroundColor}" opacity="0.58">${escapeXml(truncate(input.apple.secondaryLabel.toUpperCase(), 24))}</text><text x="48" y="215" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="17" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.rewardSummary, 42))}</text>${stampImage(input.stampSvg, 42, 236, 376, 170)}<rect x="48" y="430" width="364" height="118" rx="18" fill="#FFFFFF" opacity="0.76"/>${barcode(100, 452, 250, 54)}<text x="230" y="526" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#374151">${escapeXml(truncate(input.apple.barcodeLabel, 32))}</text><text x="48" y="582" font-family="Arial,sans-serif" font-size="11" fill="${input.foregroundColor}" opacity="0.62">${input.apple.showBackContent ? "Back content and terms configured · Preview only" : "Back content hidden · Preview only"}</text></svg>`;
  return { svg, width, height, warnings };
}

function composeGoogle(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 640;
  const warnings: ProgramPreviewComposition["warnings"] = [];
  if (input.google.title.length > 48 || input.google.subtitle.length > 64)
    warnings.push({
      code: "GOOGLE_TEXT_LIMIT",
      severity: "warning",
      platform: "GOOGLE_WALLET",
      message: "Some fields may truncate in an actual Google Wallet object.",
    });
  if (input.backgroundDataUri)
    warnings.push({
      code: "GOOGLE_BACKGROUND_ARTWORK_UNSUPPORTED",
      severity: "warning",
      platform: "GOOGLE_WALLET",
      message: programPlatformCapabilities.GOOGLE_WALLET.backgroundArtwork.explanation,
    });
  const hero = imageTag(input.heroDataUri, 24, 22, 412, 142, 28);
  const logo = imageTag(input.logoDataUri, 48, 128, 58, 58, 15);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Google Wallet preview only"><rect width="100%" height="100%" fill="#EEF3FA"/><rect x="24" y="22" width="412" height="596" rx="28" fill="#FFFFFF" stroke="#D2DAE5" stroke-width="2"/>${hero}<rect x="24" y="22" width="412" height="142" rx="28" fill="${input.accentColor}" opacity="${input.heroDataUri ? "0.28" : "1"}"/>${logo}<rect x="296" y="44" width="116" height="28" rx="14" fill="#FFFFFF" opacity="0.92"/><text x="354" y="63" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#1F2937">PREVIEW ONLY</text><text x="48" y="218" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="25" font-weight="700" fill="#1F2937">${escapeXml(truncate(input.google.title || input.programName, 38))}</text><text x="48" y="248" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="14" fill="#4B5563">${escapeXml(truncate(input.google.subtitle || input.shortDescription, 52))}</text>${stampImage(input.stampSvg, 42, 270, 376, 164)}<text x="48" y="466" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#6B7280">${escapeXml(truncate(input.google.detailsLabel.toUpperCase(), 30))}</text><text x="48" y="492" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="17" font-weight="700" fill="#1F2937">${escapeXml(truncate(input.rewardSummary, 44))}</text>${barcode(110, 522, 240, 48)}<text x="230" y="592" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#4B5563">${escapeXml(truncate(input.google.barcodeLabel, 32))}</text></svg>`;
  return { svg, width, height, warnings };
}

export function composeProgramPreview(
  input: ProgramPreviewCompositionInput,
): ProgramPreviewComposition {
  const result =
    input.profile === "APPLE_WALLET"
      ? composeApple(input)
      : input.profile === "GOOGLE_WALLET"
        ? composeGoogle(input)
        : composeCustomer(input);
  return {
    ...result,
    digest: createHash("sha256").update(result.svg).digest("hex"),
  };
}

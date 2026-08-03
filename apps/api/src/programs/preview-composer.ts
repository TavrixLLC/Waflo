import { createHash } from "node:crypto";
import { programPlatformCapabilities, type ProgramTemplatePresentation } from "@waflo/contracts";
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
  stampLayout?: "ROW" | "GRID" | "PATH" | "RING";
  backgroundColor: string;
  foregroundColor: string;
  accentColor: string;
  secondaryColor: string;
  logoDataUri?: string;
  identityDataUri?: string;
  heroDataUri?: string;
  backgroundDataUri?: string;
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

function composeLegacyCustomer(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 820;
  const height = input.customerWebVariant === "HERO" ? 600 : 560;
  const direction = input.locale === "AR" ? "rtl" : "ltr";
  const anchor = "start";
  const textX = input.locale === "AR" ? width - 74 : 74;
  const motifX = input.locale === "AR" ? 62 : width - 158;
  const brandArtwork = input.logoDataUri ?? input.identityDataUri;
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
    `<text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="${size}" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 48))}</text>`;
  const description = (y: number) =>
    `<text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="16" fill="${input.foregroundColor}" opacity=".72">${escapeXml(truncate(input.shortDescription, 76))}</text>`;
  const reward = (y: number, boxed = true) =>
    `${boxed ? `<rect x="58" y="${y - 27}" width="${width - 116}" height="68" rx="16" fill="${input.accentColor}" opacity=".12"/>` : `<path d="M58 ${y - 24}H762" stroke="${input.foregroundColor}" stroke-width="2" opacity=".14"/>`}<text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="13" font-weight="700" fill="${input.accentColor}">${input.locale === "AR" ? "المكافأة التالية" : "NEXT REWARD"}</text><text x="${textX}" y="${y + 24}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="17" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.rewardSummary, 68))}</text>`;
  const terms = `<text x="${textX}" y="${height - 38}" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="12" fill="${input.foregroundColor}" opacity=".58">${escapeXml(truncate(input.terms, 106))}</text>`;
  const motif = (x: number, y: number, size: number, opacity = 1) =>
    brandArtwork
      ? `<g opacity="${opacity}"><circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="${input.secondaryColor}" opacity=".22"/>${imageTag(brandArtwork, x + 10, y + 10, size - 20, size - 20, size / 4)}</g>`
      : "";

  let surface = "";
  if (input.customerWebVariant === "HERO") {
    const heroArtwork = imageTag(input.heroDataUri, 42, 42, width - 84, 160, 24);
    surface = `${heroArtwork}<rect x="42" y="42" width="${width - 84}" height="160" rx="24" fill="${input.accentColor}" opacity="${input.heroDataUri ? ".32" : ".14"}"/>${motif(motifX, 54, 132)}${title(103, 32)}${description(136)}${stampImage(input.stampSvg, 60, 218, width - 120, 178)}${reward(446)}${terms}`;
  } else if (input.customerWebVariant === "MINIMAL") {
    const railX = input.locale === "AR" ? width - 36 : 24;
    surface = `<rect x="${railX}" y="20" width="12" height="${height - 40}" rx="6" fill="${input.accentColor}"/>${motif(motifX, 42, 142, 0.22)}${title(94, 29)}${description(126)}${stampImage(input.stampSvg, 60, 160, width - 120, 184)}${reward(402, false)}${terms}`;
  } else {
    surface = `${motif(motifX, 46, 112)}${title(96, 30)}${description(128)}${stampImage(input.stampSvg, 60, 158, width - 120, 184)}${reward(400)}${terms}`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Customer Web preview" direction="${direction}"><rect width="100%" height="100%" fill="#ECEFF3"/><rect x="24" y="20" width="${width - 48}" height="${height - 40}" rx="30" fill="${input.backgroundColor}" stroke="#D9DDE3" stroke-width="2"/>${backgroundArtwork}${backgroundOverlay}${surface}</svg>`;
  return { svg, width, height, warnings };
}

function composeCustomer(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  if (!input.presentation) return composeLegacyCustomer(input);

  const presentation = input.presentation;
  const width = 820;
  const height = 580;
  const rtl = input.locale === "AR";
  const direction = rtl ? "rtl" : "ltr";
  const font = "Arial,Noto Sans Arabic,sans-serif";
  const card = { x: 24, y: 20, width: 772, height: 540 };
  const cornerRadius =
    presentation.cornerTreatment === "ROUND"
      ? 38
      : presentation.cornerTreatment === "SOFT"
        ? 26
        : 16;
  const logicalRectX = (x: number, rectWidth: number) => (rtl ? width - x - rectWidth : x);
  const logicalTextX = (x: number) => (rtl ? width - x : x);
  const brandArtwork = input.logoDataUri ?? input.identityDataUri;
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
  const rewardLabel = rtl ? "المكافأة التالية" : "NEXT REWARD";

  const headerBlock = (
    x: number,
    y: number,
    options: { centered?: boolean; descriptionWidth?: number; compact?: boolean } = {},
  ) => {
    const centered = options.centered ?? false;
    const textX = centered ? width / 2 : logicalTextX(x);
    const anchor = centered ? "middle" : "start";
    const localTitleSize = options.compact ? Math.max(22, titleSize - 4) : titleSize;
    const descriptionLimit =
      options.descriptionWidth && options.descriptionWidth < 360 ? (rtl ? 30 : 42) : rtl ? 52 : 68;
    return `<g data-preview-block="header" data-title-treatment="${presentation.titleTreatment}"><text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="${localTitleSize}" font-weight="800" letter-spacing="${presentation.titleTreatment === "EDITORIAL" ? "-.5" : "0"}" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 46))}</text><text x="${textX}" y="${y + 32}" text-anchor="${anchor}" font-family="${font}" font-size="${options.compact ? 13 : 15}" fill="${input.foregroundColor}" opacity=".7">${escapeXml(truncate(input.shortDescription, descriptionLimit))}</text></g>`;
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
    return `<g data-preview-block="reward" data-reward-treatment="${treatment}">${shape}<text x="${textX}" y="${labelY}" text-anchor="start" font-family="${font}" font-size="11" font-weight="800" letter-spacing=".35" fill="${input.accentColor}">${rewardLabel}</text><text x="${textX}" y="${labelY + 25}" text-anchor="start" font-family="${font}" font-size="${blockWidth < 230 ? 14 : 16}" font-weight="750" fill="${input.foregroundColor}">${escapeXml(truncate(input.rewardSummary, summaryLimit))}</text></g>`;
  };

  const footer = (x = 64) =>
    `<g data-preview-block="footer"><text x="${logicalTextX(x)}" y="538" text-anchor="start" font-family="${font}" font-size="11" fill="${input.foregroundColor}" opacity=".54">${escapeXml(truncate(input.terms, 100))}</text></g>`;

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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Customer Web preview" direction="${direction}" data-composition="${presentation.composition}" data-visual-role="${presentation.visualRole}" data-density="${presentation.density}"><defs><clipPath id="customer-card-clip"><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="${cornerRadius}"/></clipPath></defs><rect width="100%" height="100%" fill="#ECEFF3"/><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="${cornerRadius}" fill="${input.backgroundColor}" stroke="#D9DDE3" stroke-width="2"/>${backgroundArtwork}${backgroundOverlay}<g clip-path="url(#customer-card-clip)">${surface}</g></svg>`;
  return { svg, width, height, warnings };
}

function walletRoleDecoration(input: ProgramPreviewCompositionInput, rtl: boolean): string {
  const role = input.presentation?.visualRole;
  if (!role) return "";
  const railX = rtl ? 428 : 24;
  if (role === "SIGNATURE")
    return `<g data-preview-block="wallet-role" data-visual-role="${role}"><rect x="${railX}" y="44" width="8" height="118" rx="4" fill="${input.accentColor}"/><circle cx="${rtl ? 76 : 384}" cy="178" r="54" fill="${input.secondaryColor}" opacity=".12"/></g>`;
  if (role === "PREMIUM")
    return `<g data-preview-block="wallet-role" data-visual-role="${role}"><rect x="34" y="32" width="392" height="576" rx="27" fill="none" stroke="${input.accentColor}" stroke-width="2" stroke-opacity=".45"/></g>`;
  if (role === "FRIENDLY")
    return `<g data-preview-block="wallet-role" data-visual-role="${role}"><circle cx="${rtl ? 382 : 78}" cy="88" r="48" fill="${input.secondaryColor}" opacity=".2"/><circle cx="${rtl ? 64 : 396}" cy="212" r="28" fill="${input.accentColor}" opacity=".1"/></g>`;
  return `<g data-preview-block="wallet-role" data-visual-role="${role}"><path d="M42 132H418" stroke="${input.accentColor}" stroke-width="3" stroke-opacity=".55"/></g>`;
}

function walletContinuityMotif(
  input: ProgramPreviewCompositionInput,
  rtl: boolean,
  y: number,
): string {
  const treatment = input.presentation?.motifTreatment;
  const artwork = input.logoDataUri ?? input.identityDataUri;
  if (!treatment || !artwork) return "";
  const size =
    treatment === "EDGE_CROP" || treatment === "WATERMARK"
      ? 118
      : treatment === "CORNER_MARK"
        ? 92
        : 74;
  const opacity =
    treatment === "WATERMARK"
      ? 0.07
      : treatment === "EDGE_CROP"
        ? 0.12
        : treatment === "HEADER_MARK"
          ? 0.18
          : 0.13;
  const startSide = treatment === "SIDE_MARK";
  const x = startSide ? (rtl ? 460 - 44 - size : 44) : rtl ? 44 : 460 - 44 - size;
  return `<g data-preview-block="wallet-motif" data-motif-treatment="${treatment}" opacity="${opacity}">${imageTag(artwork, x, y, size, size, 16)}</g>`;
}

function composeApple(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 640;
  const rtl = input.locale === "AR";
  const direction = rtl ? "rtl" : "ltr";
  const anchor = "start";
  const contentX = rtl ? 412 : 48;
  const headerX = rtl ? 344 : 116;
  const logoX = rtl ? 358 : 48;
  const previewBadgeX = rtl ? 48 : 302;
  const previewBadgeCenter = previewBadgeX + 51;
  const previewOnly = rtl ? "للمعاينة فقط" : "PREVIEW ONLY";
  const backContent = rtl
    ? input.apple.showBackContent
      ? "تم إعداد التفاصيل والشروط · للمعاينة فقط"
      : "التفاصيل الخلفية مخفية · للمعاينة فقط"
    : input.apple.showBackContent
      ? "Back content and terms configured · Preview only"
      : "Back content hidden · Preview only";
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
  const roleDecoration = walletRoleDecoration(input, rtl);
  const continuityMotif = walletContinuityMotif(input, rtl, 126);
  const logo = imageTag(input.logoDataUri ?? input.identityDataUri, logoX, 60, 54, 54, 12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Apple Wallet preview only" direction="${direction}"><rect width="100%" height="100%" fill="#F1F3F6"/><rect x="24" y="22" width="412" height="596" rx="34" fill="${input.backgroundColor}" stroke="#C9CED6" stroke-width="2"/>${roleDecoration}${continuityMotif}${logo}<text x="${headerX}" y="78" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="11" font-weight="700" fill="${input.foregroundColor}" opacity="0.65">${escapeXml(truncate(input.apple.headerLabel.toUpperCase(), 24))}</text><text x="${headerX}" y="102" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="19" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.apple.headerValue, 30))}</text><rect x="${previewBadgeX}" y="54" width="102" height="28" rx="14" fill="#111827"/><text x="${previewBadgeCenter}" y="73" text-anchor="middle" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="${rtl ? 10 : 11}" font-weight="700" fill="#FFFFFF">${previewOnly}</text><text x="${contentX}" y="156" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="29" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 30))}</text><text x="${contentX}" y="188" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="12" font-weight="700" fill="${input.foregroundColor}" opacity="0.58">${escapeXml(truncate(input.apple.secondaryLabel.toUpperCase(), 24))}</text><text x="${contentX}" y="215" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="17" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.rewardSummary, 42))}</text>${stampImage(input.stampSvg, 42, 236, 376, 170)}<rect x="48" y="430" width="364" height="118" rx="18" fill="#FFFFFF" opacity="0.76"/>${barcode(100, 452, 250, 54)}<text x="230" y="526" text-anchor="middle" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="12" fill="#374151">${escapeXml(truncate(input.apple.barcodeLabel, 32))}</text><text x="${contentX}" y="582" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="11" fill="${input.foregroundColor}" opacity="0.62">${backContent}</text></svg>`;
  return { svg, width, height, warnings };
}

function composeGoogle(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 640;
  const rtl = input.locale === "AR";
  const direction = rtl ? "rtl" : "ltr";
  const anchor = "start";
  const contentX = rtl ? 412 : 48;
  const logoX = rtl ? 354 : 48;
  const previewBadgeX = rtl ? 48 : 296;
  const previewBadgeCenter = previewBadgeX + 58;
  const previewOnly = rtl ? "للمعاينة فقط" : "PREVIEW ONLY";
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
  const roleDecoration = walletRoleDecoration(input, rtl);
  const continuityMotif = walletContinuityMotif(input, rtl, 74);
  const hero = imageTag(input.heroDataUri, 24, 22, 412, 142, 28);
  const logo = imageTag(input.logoDataUri ?? input.identityDataUri, logoX, 128, 58, 58, 15);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Google Wallet preview only" direction="${direction}"><rect width="100%" height="100%" fill="#EEF3FA"/><rect x="24" y="22" width="412" height="596" rx="28" fill="#FFFFFF" stroke="#D2DAE5" stroke-width="2"/>${hero}<rect x="24" y="22" width="412" height="142" rx="28" fill="${input.accentColor}" opacity="${input.heroDataUri ? "0.28" : "1"}"/>${roleDecoration}${continuityMotif}${logo}<rect x="${previewBadgeX}" y="44" width="116" height="28" rx="14" fill="#FFFFFF" opacity="0.92"/><text x="${previewBadgeCenter}" y="63" text-anchor="middle" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="${rtl ? 10 : 11}" font-weight="700" fill="#1F2937">${previewOnly}</text><text x="${contentX}" y="218" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="25" font-weight="700" fill="#1F2937">${escapeXml(truncate(input.google.title || input.programName, 38))}</text><text x="${contentX}" y="248" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="14" fill="#4B5563">${escapeXml(truncate(input.google.subtitle || input.shortDescription, 52))}</text>${stampImage(input.stampSvg, 42, 270, 376, 164)}<text x="${contentX}" y="466" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="11" font-weight="700" fill="#6B7280">${escapeXml(truncate(input.google.detailsLabel.toUpperCase(), 30))}</text><text x="${contentX}" y="492" text-anchor="${anchor}" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="17" font-weight="700" fill="#1F2937">${escapeXml(truncate(input.rewardSummary, 44))}</text>${barcode(110, 522, 240, 48)}<text x="230" y="592" text-anchor="middle" font-family="Arial,Noto Sans Arabic,sans-serif" font-size="12" fill="#4B5563">${escapeXml(truncate(input.google.barcodeLabel, 32))}</text></svg>`;
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

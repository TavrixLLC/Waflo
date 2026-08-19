import { createHash } from "node:crypto";
import { programPlatformCapabilities, type ProgramTemplatePresentation } from "@waflo/contracts";
import type { StampOutputProfile } from "@waflo/stamp-engine";

export interface ProgramPreviewCompositionInput {
  profile: StampOutputProfile;
  locale: "EN" | "AR";
  organizationName: string;
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
  /**
   * The organization-owned issuer identity. This is deliberately separate from
   * a program's decorative visual asset: Wallet and customer card previews
   * must represent the same merchant logo that issued passes use.
   */
  merchantBrandLogoDataUri?: string;
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

function localizeSvgRoot(svg: string, locale: "EN" | "AR"): string {
  const language = locale === "AR" ? "ar" : "en";
  const localized = svg.replace("<svg ", `<svg lang="${language}" xml:lang="${language}" `);
  if (locale !== "AR") return localized;
  // Left-side Wallet fields use the physical left edge as their origin. Under
  // an RTL root, `start` points into the margin; `end` makes content flow back
  // into the card while right-side fields retain their logical `start` anchor.
  return localized.replace(
    /x="48" y="(188|210|440|464)" text-anchor="start"/g,
    'x="48" y="$1" text-anchor="end"',
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
  fit: "slice" | "meet" = "slice",
): string {
  const href = safeDataImage(value);
  if (!href) return "";
  const clipId = `clip-${x}-${y}-${width}-${height}`;
  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/></clipPath></defs><image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid ${fit}" clip-path="url(#${clipId})"/>`;
}

function wafloIssuerMark(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const scale = Math.min(width, height) / 26;
  const insetX = x + (width - 26 * scale) / 2;
  const insetY = y + (height - 26 * scale) / 2;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="#E4572E"/><path d="M${insetX + 5.5 * scale} ${insetY + 6 * scale}l4.5 ${13 * scale} 3.6 ${-6.5 * scale} 3.6 ${6.5 * scale} 4.5 ${-13 * scale}" fill="none" stroke="#fff" stroke-width="${2.3 * scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function issuerBrandMark(
  value: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  return value
    ? imageTag(value, x, y, width, height, radius, "meet")
    : wafloIssuerMark(x, y, width, height, radius);
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
  const issuerSize = 40;
  const issuerX = input.locale === "AR" ? width - 74 - issuerSize : 74;
  const textX = input.locale === "AR" ? issuerX - 14 : issuerX + issuerSize + 14;
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
    `<text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="${size}" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 48))}</text>`;
  const description = (y: number) =>
    `<text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="16" fill="${input.foregroundColor}" opacity=".72">${escapeXml(truncate(input.shortDescription, 76))}</text>`;
  const reward = (y: number, boxed = true) =>
    `${boxed ? `<rect x="58" y="${y - 27}" width="${width - 116}" height="68" rx="16" fill="${input.accentColor}" opacity=".12"/>` : `<path d="M58 ${y - 24}H762" stroke="${input.foregroundColor}" stroke-width="2" opacity=".14"/>`}<text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="13" font-weight="700" fill="${input.accentColor}">${input.locale === "AR" ? "المكافأة التالية" : "NEXT REWARD"}</text><text x="${textX}" y="${y + 24}" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="17" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.rewardSummary, 68))}</text>`;
  const terms = `<text x="${textX}" y="${height - 38}" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="12" fill="${input.foregroundColor}" opacity=".58">${escapeXml(truncate(input.terms, 106))}</text>`;
  const motif = (x: number, y: number, size: number, opacity = 1) =>
    brandArtwork
      ? `<g opacity="${opacity}"><circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="${input.secondaryColor}" opacity=".22"/>${imageTag(brandArtwork, x + 10, y + 10, size - 20, size - 20, size / 4)}</g>`
      : "";
  const issuer = `<g data-issuer-brand="organization">${issuerBrandMark(input.merchantBrandLogoDataUri, issuerX, 54, issuerSize, issuerSize, 11)}</g>`;

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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Customer Web preview" direction="${direction}" data-progress="${input.progress}" data-goal="${input.goal}" data-issuer-brand="organization"><rect width="100%" height="100%" fill="#ECEFF3"/><rect x="24" y="20" width="${width - 48}" height="${height - 40}" rx="30" fill="${input.backgroundColor}" stroke="#D9DDE3" stroke-width="2"/>${backgroundArtwork}${backgroundOverlay}${issuer}${surface}</svg>`;
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
  const font = "Cairo,Arial,sans-serif";
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
    const issuerSize = 40;
    const textX = centered ? width / 2 : logicalTextX(x + issuerSize + 14);
    const anchor = centered ? "middle" : "start";
    const localTitleSize = options.compact ? Math.max(22, titleSize - 4) : titleSize;
    const descriptionLimit =
      options.descriptionWidth && options.descriptionWidth < 360 ? (rtl ? 30 : 42) : rtl ? 52 : 68;
    const issuerX = centered ? width / 2 - issuerSize / 2 : logicalRectX(x, issuerSize);
    const issuerY = centered ? y - 66 : y - 35;
    return `<g data-preview-block="header" data-title-treatment="${presentation.titleTreatment}" data-issuer-brand="organization">${issuerBrandMark(input.merchantBrandLogoDataUri, issuerX, issuerY, issuerSize, issuerSize, 11)}<text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="${localTitleSize}" font-weight="800" letter-spacing="${presentation.titleTreatment === "EDITORIAL" ? "-.5" : "0"}" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 46))}</text><text x="${textX}" y="${y + 32}" text-anchor="${anchor}" font-family="${font}" font-size="${options.compact ? 13 : 15}" fill="${input.foregroundColor}" opacity=".7">${escapeXml(truncate(input.shortDescription, descriptionLimit))}</text></g>`;
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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Customer Web preview" direction="${direction}" data-progress="${input.progress}" data-goal="${input.goal}" data-composition="${presentation.composition}" data-visual-role="${presentation.visualRole}" data-density="${presentation.density}"><defs><clipPath id="customer-card-clip"><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="${cornerRadius}"/></clipPath></defs><rect width="100%" height="100%" fill="#ECEFF3"/><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="${cornerRadius}" fill="${input.backgroundColor}" stroke="#D9DDE3" stroke-width="2"/>${backgroundArtwork}${backgroundOverlay}<g clip-path="url(#customer-card-clip)">${surface}</g></svg>`;
  return { svg, width, height, warnings };
}

function composeApple(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 690;
  const rtl = input.locale === "AR";
  const direction = rtl ? "rtl" : "ltr";
  const anchor = "start";
  const contentX = rtl ? 412 : 48;
  const headerX = rtl ? 48 : 412;
  const headerAnchor = "end";
  const previewBadgeX = rtl ? 24 : 316;
  const previewBadgeCenter = previewBadgeX + 60;
  const previewOnly = rtl ? "للمعاينة فقط" : "PREVIEW ONLY";
  const stampsLabel = rtl ? "الأختام" : "STAMPS";
  const memberLabel = rtl ? "العضو" : "MEMBER";
  const memberValue = rtl ? "عميل تجريبي" : "Demo customer";
  const statusLabel = rtl ? "الحالة" : "STATUS";
  const statusValue =
    input.progress >= input.goal
      ? rtl
        ? "المكافأة جاهزة"
        : "Reward ready"
      : rtl
        ? "نشطة"
        : "Active";
  const backRewardLabel = rtl ? "خلف البطاقة · المكافأة" : "BACK OF PASS · REWARD";
  const barcodeLabel = rtl
    ? "رمز العضوية بعد حفظ العميل للبطاقة"
    : "Membership QR after the customer saves the card";
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
  if (input.logoDataUri && !input.merchantBrandLogoDataUri)
    warnings.push({
      code: "APPLE_CUSTOM_LOGO_NOT_MAPPED",
      severity: "warning",
      platform: "APPLE_WALLET",
      message: programPlatformCapabilities.APPLE_WALLET.logo.explanation,
    });
  const markX = rtl ? 386 : 48;
  const organizationX = rtl ? 376 : 84;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Apple Wallet preview only" direction="${direction}" data-wallet-provider="APPLE" data-progress="${input.progress}" data-goal="${input.goal}" data-back-reward="${escapeXml(input.rewardSummary)}" data-issuer-brand="organization"><rect width="100%" height="100%" fill="#F1F3F6"/><rect x="${previewBadgeX}" y="6" width="120" height="26" rx="13" fill="#111827"/><text x="${previewBadgeCenter}" y="24" text-anchor="middle" font-family="Cairo,Arial,sans-serif" font-size="${rtl ? 10 : 11}" font-weight="700" fill="#FFFFFF">${previewOnly}</text><rect x="24" y="40" width="412" height="580" rx="34" fill="${input.backgroundColor}" stroke="#C9CED6" stroke-width="2"/>${issuerBrandMark(input.merchantBrandLogoDataUri, markX, 66, 26, 26, 7)}<text x="${organizationX}" y="85" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="14" font-weight="700" fill="${input.foregroundColor}">${escapeXml(truncate(input.organizationName, 30))}</text><text x="${headerX}" y="72" text-anchor="${headerAnchor}" font-family="Cairo,Arial,sans-serif" font-size="10" font-weight="700" fill="${input.foregroundColor}" opacity=".66">${stampsLabel}</text><text x="${headerX}" y="96" text-anchor="${headerAnchor}" font-family="Cairo,Arial,sans-serif" font-size="19" font-weight="800" fill="${input.foregroundColor}">${input.progress}/${input.goal}</text><text x="${contentX}" y="154" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="29" font-weight="800" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 34))}</text><text x="${contentX}" y="188" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="10" font-weight="700" fill="${input.foregroundColor}" opacity=".62">${memberLabel}</text><text x="${contentX}" y="210" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="16" font-weight="700" fill="${input.foregroundColor}">${memberValue}</text><text x="${rtl ? 48 : 412}" y="188" text-anchor="${rtl ? "start" : "end"}" font-family="Cairo,Arial,sans-serif" font-size="10" font-weight="700" fill="${input.foregroundColor}" opacity=".62">${statusLabel}</text><text x="${rtl ? 48 : 412}" y="210" text-anchor="${rtl ? "start" : "end"}" font-family="Cairo,Arial,sans-serif" font-size="16" font-weight="700" fill="${input.foregroundColor}">${statusValue}</text>${stampImage(input.stampSvg, 42, 232, 376, 170)}<rect x="48" y="424" width="364" height="130" rx="18" fill="#FFFFFF" opacity=".82"/>${barcode(104, 446, 252, 58)}<text x="230" y="532" text-anchor="middle" font-family="Cairo,Arial,sans-serif" font-size="10" fill="#374151">${barcodeLabel}</text><text x="230" y="650" text-anchor="middle" font-family="Cairo,Arial,sans-serif" font-size="10" font-weight="800" fill="#6B7280">${backRewardLabel}</text><text x="230" y="673" text-anchor="middle" font-family="Cairo,Arial,sans-serif" font-size="14" font-weight="700" fill="#1F2937">${escapeXml(truncate(input.rewardSummary, 48))}</text></svg>`;
  return { svg, width, height, warnings };
}

function composeGoogle(
  input: ProgramPreviewCompositionInput,
): Omit<ProgramPreviewComposition, "digest"> {
  const width = 460;
  const height = 690;
  const rtl = input.locale === "AR";
  const direction = rtl ? "rtl" : "ltr";
  const anchor = "start";
  const contentX = rtl ? 412 : 48;
  const logoX = rtl ? 350 : 48;
  const previewBadgeX = rtl ? 24 : 316;
  const previewBadgeCenter = previewBadgeX + 60;
  const previewOnly = rtl ? "للمعاينة فقط" : "PREVIEW ONLY";
  const pointsLabel = rtl ? "الأختام" : "Stamps";
  const accountLabel = rtl ? "الحساب" : "Account";
  const accountValue = rtl ? "عميل تجريبي" : "Demo customer";
  const statusLabel = rtl ? "الحالة" : "Status";
  const statusValue =
    input.progress >= input.goal
      ? rtl
        ? "المكافأة جاهزة"
        : "Reward ready"
      : rtl
        ? "نشطة"
        : "Active";
  const rewardLabel = rtl ? "المكافأة" : "Reward";
  const barcodeLabel = rtl
    ? "رمز العضوية بعد حفظ العميل للبطاقة"
    : "Membership QR after the customer saves the card";
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
  if (input.heroDataUri)
    warnings.push({
      code: "GOOGLE_HERO_ARTWORK_UNSUPPORTED",
      severity: "warning",
      platform: "GOOGLE_WALLET",
      message: programPlatformCapabilities.GOOGLE_WALLET.heroArtwork.explanation,
    });
  const logo = issuerBrandMark(input.merchantBrandLogoDataUri, logoX, 72, 62, 62, 15);
  const issuerX = rtl ? 338 : 120;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Google Wallet preview only" direction="${direction}" data-wallet-provider="GOOGLE" data-progress="${input.progress}" data-goal="${input.goal}" data-class-reward="${escapeXml(input.rewardSummary)}" data-issuer-brand="organization"><rect width="100%" height="100%" fill="#EEF3FA"/><rect x="${previewBadgeX}" y="6" width="120" height="26" rx="13" fill="#1F2937"/><text x="${previewBadgeCenter}" y="24" text-anchor="middle" font-family="Cairo,Arial,sans-serif" font-size="${rtl ? 10 : 11}" font-weight="700" fill="#FFFFFF">${previewOnly}</text><rect x="24" y="40" width="412" height="626" rx="28" fill="#FFFFFF" stroke="#D2DAE5" stroke-width="2"/><rect x="24" y="40" width="412" height="136" rx="28" fill="${input.backgroundColor}"/>${logo}<text x="${issuerX}" y="92" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="12" font-weight="700" fill="${input.foregroundColor}" opacity=".75">${escapeXml(truncate(input.organizationName, 34))}</text><text x="${issuerX}" y="126" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="24" font-weight="800" fill="${input.foregroundColor}">${escapeXml(truncate(input.programName, 36))}</text><text x="${contentX}" y="210" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="10" font-weight="800" fill="#6B7280">${accountLabel}</text><text x="${contentX}" y="232" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="15" font-weight="700" fill="#1F2937">${accountValue}</text><text x="${rtl ? 48 : 412}" y="210" text-anchor="${rtl ? "start" : "end"}" font-family="Cairo,Arial,sans-serif" font-size="10" font-weight="800" fill="#6B7280">${pointsLabel}</text><text x="${rtl ? 48 : 412}" y="234" text-anchor="${rtl ? "start" : "end"}" font-family="Cairo,Arial,sans-serif" font-size="19" font-weight="800" fill="#1F2937">${input.progress}/${input.goal}</text>${stampImage(input.stampSvg, 42, 252, 376, 158)}<text x="${contentX}" y="440" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="10" font-weight="800" fill="#6B7280">${rewardLabel}</text><text x="${contentX}" y="464" text-anchor="${anchor}" font-family="Cairo,Arial,sans-serif" font-size="16" font-weight="700" fill="#1F2937">${escapeXml(truncate(input.rewardSummary, 46))}</text><text x="${rtl ? 48 : 412}" y="440" text-anchor="${rtl ? "start" : "end"}" font-family="Cairo,Arial,sans-serif" font-size="10" font-weight="800" fill="#6B7280">${statusLabel}</text><text x="${rtl ? 48 : 412}" y="464" text-anchor="${rtl ? "start" : "end"}" font-family="Cairo,Arial,sans-serif" font-size="15" font-weight="700" fill="#1F2937">${statusValue}</text><rect x="62" y="492" width="336" height="130" rx="18" fill="#F7F8FA"/>${barcode(112, 512, 236, 56)}<text x="230" y="600" text-anchor="middle" font-family="Cairo,Arial,sans-serif" font-size="10" fill="#4B5563">${barcodeLabel}</text></svg>`;
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
  const svg = localizeSvgRoot(result.svg, input.locale);
  return {
    ...result,
    svg,
    digest: createHash("sha256").update(svg).digest("hex"),
  };
}

import { cardLocalePresentation, walletStructuralCopyForLocale } from "@waflo/contracts";
import { createQrPreviewRasterMarkup } from "@waflo/qr-core/preview";
import { walletArtworkArabicTypeface } from "./model.js";
import {
  applePosterGoogleMasterRenderInput,
  createWalletArtworkApplePosterRenderPlan,
  createWalletArtworkRenderPlan,
  renderWalletArtworkApplePosterPlanSvg,
  renderWalletArtworkPlanSvg,
  type WalletArtworkApplePosterRenderPlan,
  type WalletArtworkQrRasterRequest,
  type WalletArtworkRenderPlan,
  type WalletArtworkRenderPlanInput,
  walletArtworkGoogleSurfaceColor,
  walletArtworkQrRasterRequest,
  walletArtworkReadableTextColor,
} from "./render-plan.js";

/**
 * The browser-safe Dashboard Wallet renderer. Its SVG is also the server
 * Dashboard preview contract; Sharp-based provider artefact generation stays
 * in the package root and consumes the same model.ts geometry.
 */
export type DashboardWalletPreviewProfile = "APPLE_LEGACY" | "APPLE_IOS27" | "GOOGLE_WALLET";

export interface DashboardWalletPreviewInput {
  readonly profile: DashboardWalletPreviewProfile;
  readonly locale: string;
  readonly organizationName: string;
  readonly programName: string;
  /** Representative member shown in the native Apple Legacy auxiliary tier. */
  readonly memberName?: string;
  /** Canonical membership state shown in the native Apple Legacy auxiliary tier. */
  readonly status?: string;
  readonly rewardSummary: string;
  readonly progress: number;
  readonly goal: number;
  readonly stampSvg: string;
  /** Exact Stamp Engine metadata required by the canonical composition plan. */
  readonly stampArtwork: Pick<
    WalletArtworkRenderPlanInput["stampArtwork"],
    "width" | "height" | "contentDigest" | "positions"
  > & { readonly stampSize: number };
  readonly backgroundColor: string;
  readonly foregroundColor: string;
  readonly accentColor: string;
  readonly secondaryColor: string;
  readonly logoDataUri?: string;
  readonly merchantBrandLogoDataUri?: string;
  /** Browser-local raster of the canonical non-secret preview QR. */
  readonly qrRasterDataUri?: string;
}

export interface DashboardWalletPreviewComposition {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly warnings: readonly [];
}

export function createDashboardWalletPreviewRenderPlanInput(
  input: DashboardWalletPreviewInput,
): WalletArtworkRenderPlanInput {
  return {
    stampArtwork: { svg: input.stampSvg, ...input.stampArtwork },
    stampSize: input.stampArtwork.stampSize,
    layoutType: "GRID" as const,
    theme: {
      backgroundColor: input.backgroundColor,
      foregroundColor: input.foregroundColor,
      accentColor: input.accentColor,
      secondaryColor: input.secondaryColor,
    },
    currentStampCount: input.progress,
    requiredStampCount: input.goal,
    rewardReady: input.progress >= input.goal,
    rewardLabel: input.rewardSummary,
    organizationName: input.organizationName,
    programName: input.programName,
    memberName: input.memberName ?? "Preview member",
    credentialPayload: "waflo-wallet-preview-only",
    locale: input.locale,
  };
}

export interface DashboardWalletPreviewArtworkPlan {
  readonly planInput: WalletArtworkRenderPlanInput;
  readonly plan: WalletArtworkRenderPlan;
  readonly posterPlan?: WalletArtworkApplePosterRenderPlan;
}

/**
 * The Dashboard asks the shared package for its complete artwork plan. This
 * deliberately returns the same serializable model the server rasterizer
 * receives; React never owns geometry or wrapping constants.
 */
export function createDashboardWalletPreviewArtworkPlan(
  input: DashboardWalletPreviewInput,
): DashboardWalletPreviewArtworkPlan {
  const sourceInput = createDashboardWalletPreviewRenderPlanInput(input);
  if (input.profile === "APPLE_IOS27") {
    const posterPlan = createWalletArtworkApplePosterRenderPlan(sourceInput);
    return {
      planInput: posterPlan.master.input,
      plan: posterPlan.master.plan,
      posterPlan,
    };
  }
  const planInput = sourceInput;
  const target = input.profile === "APPLE_LEGACY" ? "APPLE_STORE_CARD_STRIP" : "GOOGLE_HERO";
  return { planInput, plan: createWalletArtworkRenderPlan(planInput, target) };
}

/**
 * Exposes the one canonical QR raster request required by a Dashboard
 * provider surface. The component fulfils it locally; no API image request is
 * involved.
 */
export function dashboardWalletPreviewQrRasterRequest(
  input: DashboardWalletPreviewInput,
): WalletArtworkQrRasterRequest | undefined {
  const { planInput } = createDashboardWalletPreviewArtworkPlan(input);
  if (input.profile === "APPLE_LEGACY") return undefined;
  return input.profile === "APPLE_IOS27"
    ? walletArtworkQrRasterRequest(applePosterGoogleMasterRenderInput(planInput), "GOOGLE_HERO")
    : walletArtworkQrRasterRequest(planInput, "GOOGLE_HERO");
}

/**
 * Browser-safe shell shared by the Dashboard and the API preview endpoint.
 * The shell intentionally owns the provider-frame coordinates; the supplied
 * artwork can be either a server PNG or a browser-composed SVG data URI.
 */
export interface DashboardWalletPreviewShellInput {
  readonly profile: DashboardWalletPreviewProfile;
  readonly locale: string;
  readonly organizationName: string;
  readonly programName: string;
  readonly memberName?: string;
  readonly status?: string;
  readonly rewardSummary: string;
  readonly progress: number;
  readonly goal: number;
  readonly backgroundColor: string;
  readonly foregroundColor: string;
  /** Server previews retain their approved PNG; Dashboard previews pass raw plan SVG. */
  readonly artworkDataUri?: string;
  readonly artworkSvg?: string;
  readonly logoDataUri?: string;
  readonly merchantBrandLogoDataUri?: string;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ??
      character,
  );
}

function safeImage(value: string | undefined): string {
  return value && /^data:image\/(?:png|webp|jpeg|svg\+xml);base64,/iu.test(value)
    ? escapeXml(value)
    : "";
}

function imageTag(
  value: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 0,
  fit: "slice" | "meet" | "none" = "meet",
  attributes = "",
): string {
  const href = safeImage(value);
  if (!href) return "";
  const clipId = `preview-clip-${x}-${y}-${width}-${height}`;
  const preserveAspectRatio = fit === "none" ? "none" : `xMidYMid ${fit}`;
  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/></clipPath></defs><image ${attributes} href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${preserveAspectRatio}" clip-path="url(#${clipId})"/>`;
}

function shellArtworkImage(
  value: string,
  target: "APPLE_STORE_CARD_STRIP" | "APPLE_POSTER" | "GOOGLE_HERO",
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fit: "meet" | "none" = "meet",
): string {
  return imageTag(
    value,
    x,
    y,
    width,
    height,
    radius,
    fit,
    `data-production-wallet-artwork="${target}"`,
  );
}

function innerSvg(svg: string): string {
  return svg.replace(/^<svg\b[^>]*>/u, "").replace(/<\/svg>$/u, "");
}

function svgAttribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`, "u").exec(attributes)?.[1];
}

function requiredSvgNumber(attributes: string, name: string): number {
  const value = Number(svgAttribute(attributes, name));
  if (!Number.isFinite(value)) {
    throw new Error(`Dashboard Wallet render plan has an invalid nested SVG ${name}.`);
  }
  return value;
}

/**
 * Converts canonical nested SVG viewports into their equivalent coordinate
 * transforms. This is needed only for the Apple iOS poster transport: when a
 * nested SVG participates in a CSS-scaled outer SVG, Chromium can resolve its
 * viewport in CSS pixels and crop the artwork at the provider shell. The
 * transform is derived entirely from canonical SVG attributes; it owns no
 * Wallet artwork geometry.
 */
function flattenNestedSvgViewports(svg: string): string {
  let viewportIndex = 0;
  return innerSvg(svg).replace(/<svg\b([^>]*)>|<\/svg>/gu, (match, rawAttributes?: string) => {
    if (match === "</svg>") return "</g></g>";
    const attributes = rawAttributes ?? "";
    const x = Number(svgAttribute(attributes, "x") ?? "0");
    const y = Number(svgAttribute(attributes, "y") ?? "0");
    const width = requiredSvgNumber(attributes, "width");
    const height = requiredSvgNumber(attributes, "height");
    const viewBox = svgAttribute(attributes, "viewBox")?.trim().split(/\s+/u).map(Number);
    const [
      viewBoxX = Number.NaN,
      viewBoxY = Number.NaN,
      viewBoxWidth = Number.NaN,
      viewBoxHeight = Number.NaN,
    ] = viewBox ?? [];
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      width <= 0 ||
      height <= 0 ||
      !viewBox ||
      viewBox.length !== 4 ||
      viewBox.some((value) => !Number.isFinite(value)) ||
      viewBoxWidth <= 0 ||
      viewBoxHeight <= 0
    ) {
      throw new Error("Dashboard Wallet render plan has an invalid nested SVG viewport.");
    }
    const preserveAspectRatio = svgAttribute(attributes, "preserveAspectRatio") ?? "xMidYMid meet";
    const none = preserveAspectRatio === "none";
    const uniform = none ? 0 : Math.min(width / viewBoxWidth, height / viewBoxHeight);
    const scaleX = none ? width / viewBoxWidth : uniform;
    const scaleY = none ? height / viewBoxHeight : uniform;
    const offsetX = none ? 0 : (width - viewBoxWidth * uniform) / 2;
    const offsetY = none ? 0 : (height - viewBoxHeight * uniform) / 2;
    const existingTransform = svgAttribute(attributes, "transform");
    const retainedAttributes = attributes.replace(
      /\s(?:x|y|width|height|viewBox|preserveAspectRatio|transform)="[^"]*"/gu,
      "",
    );
    const viewportTransform = `translate(${x + offsetX} ${y + offsetY}) scale(${scaleX} ${scaleY}) translate(${-viewBoxX} ${-viewBoxY})`;
    const clipId = `wallet-inline-viewport-${viewportIndex++}`;
    return `<g${retainedAttributes} transform="${viewportTransform}${existingTransform ? ` ${existingTransform}` : ""}"><defs><clipPath id="${clipId}"><rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxWidth}" height="${viewBoxHeight}"/></clipPath></defs><g clip-path="url(#${clipId})" data-wallet-artwork-inline-viewport="true" data-wallet-artwork-source-view-box="${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}">`;
  });
}

/**
 * The provider frame is shared; only the final artwork transport differs.
 * Server previews carry the approved raster PNG. The Dashboard embeds the
 * browser-safe canonical plan directly, allowing its approved web fonts to
 * participate in the live SVG rather than being isolated in a data URI.
 */
function shellArtwork(
  input: DashboardWalletPreviewShellInput,
  target: "APPLE_STORE_CARD_STRIP" | "APPLE_POSTER" | "GOOGLE_HERO",
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fit: "meet" | "none" = "meet",
): string {
  if (input.artworkSvg) {
    const viewBox = /^<svg\b[^>]*\bviewBox="([^"]+)"/u.exec(input.artworkSvg)?.[1];
    if (!viewBox) throw new Error("Dashboard Wallet render plan is missing a viewBox.");
    const viewBoxValues = viewBox.trim().split(/\s+/u).map(Number);
    if (viewBoxValues.length !== 4)
      throw new Error("Dashboard Wallet render plan has an invalid viewBox.");
    const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = viewBoxValues as [
      number,
      number,
      number,
      number,
    ];
    if (
      !Number.isFinite(viewBoxX) ||
      !Number.isFinite(viewBoxY) ||
      !Number.isFinite(viewBoxWidth) ||
      !Number.isFinite(viewBoxHeight) ||
      viewBoxWidth <= 0 ||
      viewBoxHeight <= 0
    )
      throw new Error("Dashboard Wallet render plan has an invalid viewBox.");
    const locale = cardLocalePresentation(input.locale);
    const usesInlineGroupViewport = target === "APPLE_POSTER";
    const clip = radius
      ? `<defs><clipPath id="preview-plan-clip-${target}"><rect${usesInlineGroupViewport ? "" : ` x="${x}" y="${y}"`} width="${width}" height="${height}" rx="${radius}"/></clipPath></defs>`
      : "";
    const scale =
      fit === "none"
        ? { x: width / viewBoxWidth, y: height / viewBoxHeight, offsetX: 0, offsetY: 0 }
        : (() => {
            const uniform = Math.min(width / viewBoxWidth, height / viewBoxHeight);
            return {
              x: uniform,
              y: uniform,
              offsetX: (width - viewBoxWidth * uniform) / 2,
              offsetY: (height - viewBoxHeight * uniform) / 2,
            };
          })();
    const transform = `translate(${scale.offsetX - viewBoxX * scale.x} ${scale.offsetY - viewBoxY * scale.y}) scale(${scale.x} ${scale.y})`;
    // An inner SVG viewBox is independently viewport-sized by browsers. When
    // the outer preview root is CSS-scaled, that nested viewport can resolve
    // in CSS pixels and be clipped by the provider shell. Keep the canonical
    // plan unchanged and map its coordinates explicitly inside this one
    // provider viewport instead.
    const artwork =
      target === "APPLE_POSTER"
        ? flattenNestedSvgViewports(input.artworkSvg)
        : innerSvg(input.artworkSvg);
    if (usesInlineGroupViewport) {
      const providerTransform = `translate(${x + scale.offsetX - viewBoxX * scale.x} ${y + scale.offsetY - viewBoxY * scale.y}) scale(${scale.x} ${scale.y})`;
      return `${clip}<g data-production-wallet-artwork="${target}" data-wallet-artwork-render-plan="v1" data-wallet-artwork-transport="inline-plan" x="${x}" y="${y}" width="${width}" height="${height}" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${locale.direction}" transform="${providerTransform}"><g${radius ? ` clip-path="url(#preview-plan-clip-${target})"` : ""} data-wallet-artwork-coordinate-map="canonical-viewbox">${artwork}</g></g>`;
    }
    return `${clip}<svg data-production-wallet-artwork="${target}" data-wallet-artwork-render-plan="v1" data-wallet-artwork-transport="inline-plan" x="${x}" y="${y}" width="${width}" height="${height}" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${locale.direction}" overflow="hidden"${radius ? ` clip-path="url(#preview-plan-clip-${target})"` : ""}><g transform="${transform}" data-wallet-artwork-coordinate-map="canonical-viewbox">${artwork}</g></svg>`;
  }
  if (!input.artworkDataUri) throw new Error("Wallet preview artwork is unavailable.");
  return shellArtworkImage(input.artworkDataUri, target, x, y, width, height, radius, fit);
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
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/><path d="M${insetX + 5.5 * scale} ${insetY + 6 * scale}l${4.5 * scale} ${13 * scale} ${3.6 * scale} ${-6.5 * scale} ${3.6 * scale} ${6.5 * scale} ${4.5 * scale} ${-13 * scale}" fill="none" stroke="#fff" stroke-width="${2.3 * scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function issuerMark(
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

function googleIssuerMark(
  value: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const radius = Math.min(width, height) / 2;
  const inset = Math.max(2, radius * 0.22);
  const clipId = `google-issuer-clip-${x}-${y}-${width}-${height}`;
  const href = safeImage(value);
  const content = href
    ? `<image href="${href}" x="${x + inset}" y="${y + inset}" width="${width - inset * 2}" height="${height - inset * 2}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})"/>`
    : wafloIssuerMark(
        x + inset,
        y + inset,
        width - inset * 2,
        height - inset * 2,
        Math.max(2, radius * 0.18),
        "#E4572E",
      );
  return `<defs><clipPath id="${clipId}"><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${radius - inset}"/></clipPath></defs><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${radius}" fill="#FFFFFF"/>${content}`;
}

function textAttributes(locale: string): string {
  const presentation = cardLocalePresentation(locale);
  return `direction="${presentation.direction}" unicode-bidi="plaintext" xml:lang="${presentation.locale}"`;
}

/**
 * Provider chrome normally uses the platform typeface. Arabic-script content
 * needs the same shaping-capable family as the canonical artwork plan,
 * including when the SVG is rendered outside the Dashboard DOM by the API.
 */
function nativeWalletPreviewTypeface(
  locale: ReturnType<typeof cardLocalePresentation>,
  platformTypeface: string,
): string {
  return locale.script === "Arab" ? walletArtworkArabicTypeface : platformTypeface;
}

function graphemes(value: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
    ({ segment }) => segment,
  );
}

function truncate(value: string, limit: number): string {
  const segments = graphemes(value);
  return segments.length > limit ? `${segments.slice(0, Math.max(1, limit - 1)).join("")}…` : value;
}

function previewWidth(value: string, locale: string): number {
  const { script } = cardLocalePresentation(locale);
  return graphemes(value).reduce((width, grapheme) => {
    if (/^\p{Mark}+$/u.test(grapheme)) return width;
    if (script === "Arab" || script === "Hebr") return width + 0.7;
    if (/^[\u2e80-\uffff]$/u.test(grapheme)) return width + 1;
    return width + 0.56;
  }, 0);
}

/** Deterministic line breaks shared by the API Dashboard preview and browser. */
export function dashboardWalletPreviewTextLines(
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
  return lines.length <= maximumLines
    ? lines
    : [
        ...lines.slice(0, maximumLines - 1),
        truncate(lines.slice(maximumLines - 1).join(" "), lineLimit),
      ];
}

function shellQr(x: number, y: number, size: number): string {
  const preview = createQrPreviewRasterMarkup("waflo-wallet-preview-only", {
    width: size,
    margin: 1,
    errorCorrectionLevel: "Q",
  });
  return `<svg aria-label="QR code preview" x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${preview.width} ${preview.width}" preserveAspectRatio="none" shape-rendering="crispEdges">${preview.markup}</svg>`;
}

/** The one provider-frame implementation used by browser and API previews. */
export function renderDashboardWalletPreviewShell(
  input: DashboardWalletPreviewShellInput,
): DashboardWalletPreviewComposition {
  const locale = cardLocalePresentation(input.locale);
  const rtl = locale.isRtl;
  const text = textAttributes(locale.locale);
  const logo = input.logoDataUri ?? input.merchantBrandLogoDataUri;
  const issuerBrand = input.logoDataUri ? "program" : "organization";

  if (input.profile === "APPLE_LEGACY") {
    const width = 460;
    const height = 621;
    const copy = walletStructuralCopyForLocale(locale.locale);
    const textX = rtl ? 420 : 40;
    const identityX = rtl ? 374 : 86;
    const countX = rtl ? 40 : 420;
    const progressAnchor = rtl ? "start" : "end";
    const markX = rtl ? 382 : 38;
    const rewardLines = dashboardWalletPreviewTextLines(
      input.rewardSummary,
      rtl ? 32 : 42,
      2,
      locale.locale,
    );
    const strip = shellArtwork(
      input,
      "APPLE_STORE_CARD_STRIP",
      24,
      87,
      412,
      158.41509433962264,
      0,
      "none",
    );
    const nativeQr = { x: 145, y: 405, size: 170 };
    const appleFont = nativeWalletPreviewTypeface(
      locale,
      "-apple-system,BlinkMacSystemFont,Arial,sans-serif",
    );
    const memberName = truncate(input.memberName ?? "Preview member", 28);
    const status = truncate(input.status ?? copy.active, 24);
    const auxiliaryMemberX = textX;
    const auxiliaryStatusX = rtl ? 220 : 240;
    const legacyFields = [
      `<g data-apple-secondary-field="reward"><text ${text} x="${textX}" y="263" text-anchor="start" font-family="${appleFont}" font-size="10" font-weight="750" letter-spacing=".72" fill="${input.foregroundColor}" opacity=".62">${copy.reward}</text>${rewardLines.map((line, index) => `<text ${text} x="${textX}" y="${289 + index * 22}" text-anchor="start" font-family="${appleFont}" font-size="${index === 0 ? 18 : 16}" font-weight="720" fill="${input.foregroundColor}">${escapeXml(line)}</text>`).join("")}</g>`,
      `<g data-apple-auxiliary-fields="true"><g data-apple-auxiliary-field="member"><text ${text} x="${auxiliaryMemberX}" y="344" text-anchor="start" font-family="${appleFont}" font-size="10" font-weight="750" letter-spacing=".72" fill="${input.foregroundColor}" opacity=".62">${copy.member}</text><text ${text} x="${auxiliaryMemberX}" y="367" text-anchor="start" font-family="${appleFont}" font-size="15" font-weight="700" fill="${input.foregroundColor}">${escapeXml(memberName)}</text></g><g data-apple-auxiliary-field="status"><text ${text} x="${auxiliaryStatusX}" y="344" text-anchor="start" font-family="${appleFont}" font-size="10" font-weight="750" letter-spacing=".72" fill="${input.foregroundColor}" opacity=".62">${copy.status}</text><text ${text} x="${auxiliaryStatusX}" y="367" text-anchor="start" font-family="${appleFont}" font-size="15" font-weight="700" fill="${input.foregroundColor}">${escapeXml(status)}</text></g></g>`,
    ].join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Apple Store Card preview" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${locale.direction}" data-wallet-provider="APPLE" data-barcode-format="QR" data-issuer-brand="${issuerBrand}" data-apple-preview-variant="STORE_CARD" data-progress="${input.progress}" data-goal="${input.goal}" data-preview-fidelity="store-card-native-fields" data-provider-managed-layout="true" data-provider-owned-geometry="true" data-apple-strip-aspect="375:144"><rect width="100%" height="100%" fill="#15171B"/><rect data-apple-front-surface="true" x="24" y="20" width="412" height="581" rx="16" fill="${input.backgroundColor}"/><g data-apple-identity="true">${issuerMark(logo, markX, 31, 40, 40, 10, "#D2603C")}<text ${text} x="${identityX}" y="57" text-anchor="start" font-family="${appleFont}" font-size="17" font-weight="750" fill="${input.foregroundColor}">${escapeXml(truncate(input.organizationName, 48))}</text></g><g data-apple-header-field="stamps"><text ${text} x="${countX}" y="41" text-anchor="end" font-family="${appleFont}" font-size="11" font-weight="750" letter-spacing=".72" fill="${input.foregroundColor}" opacity=".62">${copy.stamps}</text><text direction="ltr" unicode-bidi="plaintext" xml:lang="en" x="${countX}" y="63" text-anchor="${progressAnchor}" font-family="${appleFont}" font-size="19" font-weight="760" fill="${input.foregroundColor}">${input.progress}/${input.goal}</text></g><g data-apple-progress-strip="true" data-apple-progress-artwork="production-compositor">${strip}</g>${legacyFields}<g data-apple-barcode-region="provider-managed" data-apple-barcode-source="qr-core"><rect x="${nativeQr.x}" y="${nativeQr.y}" width="${nativeQr.size}" height="${nativeQr.size}" rx="0" fill="#FFFFFF"/>${shellQr(nativeQr.x, nativeQr.y, nativeQr.size)}</g><metadata data-apple-native-fields="true" data-apple-field-groups="header:stamps;primary:empty;secondary:reward;auxiliary:member,status;back:program,security,operator" data-reward-value="${escapeXml(input.rewardSummary)}">The card is one native iOS 26-and-earlier Store Card face: its strip uses the selected theme artwork; reward, member, and status use native Store Card field tiers; program remains on the provider-owned back face and the native QR uses the shared QR renderer.</metadata></svg>`;
    return { svg, width, height, warnings: [] };
  }

  if (input.profile === "APPLE_IOS27") {
    const width = 460;
    const height = 532;
    const cardX = 51;
    const cardY = 20;
    const cardWidth = 358;
    const posterHeight = 448;
    const posterY = 42;
    const cardHeight = 492;
    const nativeReserveHeight = cardY + cardHeight - (posterY + posterHeight);
    const poster = shellArtwork(input, "APPLE_POSTER", cardX, posterY, cardWidth, posterHeight, 14);
    const logoX = rtl ? 367 : 64;
    const merchantX = rtl ? 358 : 102;
    const appleFont = nativeWalletPreviewTypeface(
      locale,
      "-apple-system,BlinkMacSystemFont,Arial,sans-serif",
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Apple iOS 27 Wallet poster preview" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${locale.direction}" data-wallet-provider="APPLE" data-barcode-format="QR" data-issuer-brand="${issuerBrand}" data-apple-preview-variant="POSTER" data-progress="${input.progress}" data-goal="${input.goal}" data-preview-fidelity="poster-production-artwork" data-provider-owned-geometry="true" data-apple-poster-aspect="358:448"><defs><clipPath id="apple-poster-card-clip"><rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="14"/></clipPath><linearGradient id="apple-poster-native-top-material" gradientUnits="userSpaceOnUse" x1="0" y1="${cardY}" x2="0" y2="161"><stop offset="0" stop-color="#000000" stop-opacity=".425"/><stop offset="6%" stop-color="#000000" stop-opacity=".29"/><stop offset="30%" stop-color="#000000" stop-opacity=".23"/><stop offset="90%" stop-color="#000000" stop-opacity=".07"/><stop offset="100%" stop-color="#000000" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="#15171B"/><g clip-path="url(#apple-poster-card-clip)"><rect data-apple-poster-surface="true" x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" fill="${input.backgroundColor}"/><g data-poster-artwork="production-compositor">${poster}</g><rect data-apple-native-top-material="true" x="${cardX}" y="${cardY}" width="${cardWidth}" height="141" fill="url(#apple-poster-native-top-material)"/><rect data-apple-native-reserve="true" x="${cardX}" y="${posterY + posterHeight}" width="${cardWidth}" height="${nativeReserveHeight}" fill="${input.backgroundColor}"/></g><g data-apple-native-primary-logo="true">${issuerMark(logo, logoX, 38, 29, 29, 7)}<text ${text} x="${merchantX}" y="58" text-anchor="start" font-family="${appleFont}" font-size="14" font-weight="800" fill="${input.foregroundColor}">${escapeXml(truncate(input.organizationName, 24))}</text></g><metadata data-apple-poster-preview="true">The complete shared APPLE_POSTER composition is displayed at its native 358 by 448 aspect ratio.</metadata></svg>`;
    return { svg, width, height, warnings: [] };
  }

  const width = 460;
  const height = 564;
  // Native Google fields sit on the same lifted Hero surface as the canonical
  // artwork plan. Derive their foreground from that effective surface instead
  // of keeping the old always-dark Google default.
  const googleSurfaceColor = walletArtworkGoogleSurfaceColor(input.backgroundColor);
  const googleForegroundColor = walletArtworkReadableTextColor(
    input.foregroundColor,
    googleSurfaceColor,
  );
  const logoX = rtl ? 380 : 48;
  const textX = rtl ? 364 : 96;
  const titleTextX = rtl ? 418 : 42;
  const title = dashboardWalletPreviewTextLines(
    truncate(input.programName, 60),
    rtl ? 18 : 16,
    2,
    locale.locale,
  )
    .map(
      (line, index) =>
        `<text ${text} x="${titleTextX}" y="${143 + index * 46.5}" text-anchor="start" font-family="${nativeWalletPreviewTypeface(locale, "Google Sans,Roboto,Arial,sans-serif")}" font-size="35" font-weight="700" fill="${googleForegroundColor}">${escapeXml(line)}</text>`,
    )
    .join("");
  const hero = shellArtwork(input, "GOOGLE_HERO", 25.5, 220, 409, 321.7286821705426, 0);
  const googleFont = nativeWalletPreviewTypeface(locale, "Google Sans,Roboto,Arial,sans-serif");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Google Wallet preview" lang="${locale.locale}" xml:lang="${locale.locale}" direction="${locale.direction}" data-wallet-provider="GOOGLE" data-barcode-format="QR_CODE" data-progress="${input.progress}" data-goal="${input.goal}" data-issuer-brand="${issuerBrand}" data-provider-managed-layout="true" data-google-hero-aspect="1032:812" data-preview-fidelity="google-wallet-full-production-hero" data-provider-owned-geometry="true"><rect width="100%" height="100%" fill="#F1F3F4"/><rect x="24" y="20" width="412" height="524" rx="32" fill="${googleSurfaceColor}" stroke="#DADCE0"/><g data-google-native-identity="true">${googleIssuerMark(logo, logoX, 45, 34, 34)}<text ${text} x="${textX}" y="67" text-anchor="start" font-family="${googleFont}" font-size="15" font-weight="600" fill="${googleForegroundColor}">${escapeXml(truncate(input.organizationName, 60))}</text><path d="M48 98H412" stroke="${googleForegroundColor}" stroke-opacity=".18"/></g><g data-google-native-title="true">${title}</g><g data-google-hero-region="true" data-google-hero-artwork-composition="full-production-compositor">${hero}</g><metadata data-google-provider-payload="true">Native issuer and program fields use the Google class values. The full production GOOGLE_HERO PNG retains its 1032 by 812 aspect ratio without a dashboard crop.</metadata></svg>`;
  return { svg, width, height, warnings: [] };
}

export function renderDashboardWalletPreviewSvg(
  input: DashboardWalletPreviewInput,
): DashboardWalletPreviewComposition {
  const artworkPlan = createDashboardWalletPreviewArtworkPlan(input);
  if (input.profile === "APPLE_IOS27" && !artworkPlan.posterPlan) {
    throw new Error("Apple Poster render plan is unavailable.");
  }
  const artworkSvg =
    input.profile === "APPLE_LEGACY"
      ? renderWalletArtworkPlanSvg(artworkPlan.plan, artworkPlan.planInput)
      : input.profile === "APPLE_IOS27"
        ? renderWalletArtworkApplePosterPlanSvg(
            artworkPlan.posterPlan as WalletArtworkApplePosterRenderPlan,
            input.qrRasterDataUri,
          )
        : renderWalletArtworkPlanSvg(
            artworkPlan.plan,
            artworkPlan.planInput,
            input.qrRasterDataUri,
          );
  return renderDashboardWalletPreviewShell({
    profile: input.profile,
    locale: input.locale,
    organizationName: input.organizationName,
    programName: input.programName,
    ...(input.memberName ? { memberName: input.memberName } : {}),
    ...(input.status ? { status: input.status } : {}),
    rewardSummary: input.rewardSummary,
    progress: input.progress,
    goal: input.goal,
    backgroundColor: input.backgroundColor,
    foregroundColor: input.foregroundColor,
    artworkSvg,
    ...(input.logoDataUri ? { logoDataUri: input.logoDataUri } : {}),
    ...(input.merchantBrandLogoDataUri
      ? { merchantBrandLogoDataUri: input.merchantBrandLogoDataUri }
      : {}),
  });
}

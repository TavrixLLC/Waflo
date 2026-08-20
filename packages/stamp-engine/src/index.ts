import { createHash } from "node:crypto";

export type StampLayout = "ROW" | "GRID" | "PATH" | "RING";
export type StampOutputProfile = "JOIN_PREVIEW" | "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET";

export type StampArtwork =
  | { kind: "svg"; content: string; trusted: true }
  | {
      kind: "data-uri";
      value: string;
      mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
      trusted: true;
    };

export interface StampLayoutConfiguration {
  columns?: number;
  maxPerRow?: number;
  serpentine?: boolean;
  startAngle?: number;
}

export interface StampMilestone {
  position: number;
  artwork: StampArtwork;
  label?: string;
}

export interface StampRenderInput {
  goal: number;
  progress: number;
  layout: StampLayout;
  filledColor: string;
  emptyColor: string;
  accentColor: string;
  backgroundColor?: string;
  foregroundColor?: string;
  label?: string;
  rewardLabel?: string;
  progressLabelVisible?: boolean;
  rewardLabelVisible?: boolean;
  rewardReady?: boolean;
  /** @deprecated Main-grid number overlays are forbidden and this value is ignored. */
  showIndexLabels?: boolean;
  stampSize?: number;
  spacing?: number;
  layoutConfiguration?: StampLayoutConfiguration;
  filledArtwork?: StampArtwork;
  emptyArtwork?: StampArtwork;
  /** @deprecated Milestones belong outside the primary grid and this value is ignored. */
  milestones?: StampMilestone[];
  outputProfile?: StampOutputProfile;
}

export interface StampPosition {
  index: number;
  x: number;
  y: number;
  filled: boolean;
}

/**
 * The immutable, published membership projection consumed by every customer and
 * wallet renderer. Both pieces of artwork are mandatory so production call
 * sites can never silently fall back to generic circles, checks, or placeholders.
 */
export interface PublishedMembershipStampRenderInput {
  readonly organizationId: string;
  readonly programId: string;
  readonly programVersionId: string;
  readonly membershipId: string;
  readonly rendererSchemaVersion: "waflo-stamp-render-v1";
  /** Canonical card-content BCP-47 locale. */
  readonly locale: string;
  readonly requiredStampCount: number;
  readonly currentStampCount: number;
  readonly rewardReady: boolean;
  readonly layoutType: StampLayout;
  readonly layoutConfiguration?: StampLayoutConfiguration;
  readonly visualTheme: {
    readonly filledColor: string;
    readonly emptyColor: string;
    readonly accentColor: string;
    readonly backgroundColor?: string;
    readonly foregroundColor?: string;
    readonly stampSize?: number;
    readonly spacing?: number;
  };
  readonly filledArtwork: StampArtwork;
  readonly emptyArtwork: StampArtwork;
  readonly assetDigests: {
    readonly filled: string;
    readonly empty: string;
  };
  readonly outputProfile: StampOutputProfile;
}

export interface PublishedMembershipStampRenderResult {
  readonly svg: string;
  readonly contentDigest: string;
  readonly configurationDigest: string;
  readonly width: number;
  readonly height: number;
  readonly positions: readonly StampPosition[];
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
  );
}

function validColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function artworkHref(artwork: StampArtwork | undefined): string | null {
  if (!artwork) return null;
  if (artwork.kind === "data-uri") {
    if (!artwork.value.startsWith(`data:${artwork.mimeType};base64,`))
      throw new Error("Artwork data URI does not match its declared MIME type.");
    return artwork.value;
  }
  if (/<script|<foreignObject|on[a-z]+\s*=|javascript:/i.test(artwork.content))
    throw new Error("Unsafe artwork content.");
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return `data:image/svg+xml;base64,${Buffer.from(artwork.content, "utf8").toString("base64")}`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(artwork.content)}`;
}

function fallbackArtwork(filled: boolean, filledColor: string, emptyColor: string): StampArtwork {
  const fill = filled ? validColor(filledColor, "#E4572E") : validColor(emptyColor, "#F7F4EE");
  const stroke = filled ? "#7A2A16" : "#AFA79B";
  const inner = filled
    ? `<circle cx="50" cy="50" r="44" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="50" cy="50" r="34" fill="none" stroke="${stroke}" stroke-width="2" opacity="0.6"/><path d="M50 24l6.5 15.5 16.5 1.5-12.5 11 3.5 16.5L50 60l-14 8.5 3.5-16.5-12.5-11 16.5-1.5z" fill="${stroke}"/>`
    : `<circle cx="50" cy="50" r="44" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-dasharray="6 4"/><circle cx="50" cy="50" r="34" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.5"/><circle cx="50" cy="50" r="4" fill="${stroke}" opacity="0.35"/>`;
  return {
    kind: "svg",
    trusted: true,
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`,
  };
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value as number));
}

export function layoutStampPositions(
  goal: number,
  layout: StampLayout,
  size = 48,
  spacing = 8,
  configuration: StampLayoutConfiguration = {},
): StampPosition[] {
  if (!Number.isInteger(goal) || goal < 2 || goal > 30)
    throw new Error("Stamp goal must be between 2 and 30.");
  if (!Number.isFinite(size) || size < 24 || size > 96) throw new Error("Invalid stamp size.");
  if (!Number.isFinite(spacing) || spacing < 0 || spacing > 32)
    throw new Error("Invalid stamp spacing.");

  const positions: StampPosition[] = [];
  const gap = size + spacing;
  const gridColumns = clampInteger(
    configuration.columns,
    2,
    6,
    Math.min(5, Math.max(2, Math.ceil(Math.sqrt(goal)))),
  );
  const rowLength = clampInteger(configuration.maxPerRow, 2, 10, Math.min(10, goal));
  const pathColumns = clampInteger(configuration.columns, 3, 6, Math.min(5, goal));
  const startAngle = ((configuration.startAngle ?? -90) * Math.PI) / 180;

  for (let index = 0; index < goal; index += 1) {
    let x = 0;
    let y = 0;
    if (layout === "ROW") {
      x = (index % rowLength) * gap;
      y = Math.floor(index / rowLength) * gap;
    } else if (layout === "GRID") {
      x = (index % gridColumns) * gap;
      y = Math.floor(index / gridColumns) * gap;
    } else if (layout === "PATH") {
      const row = Math.floor(index / pathColumns);
      const column = index % pathColumns;
      const serpentineColumn =
        configuration.serpentine === false || row % 2 === 0 ? column : pathColumns - 1 - column;
      x = serpentineColumn * gap;
      y = row * gap + Math.sin((column / Math.max(1, pathColumns - 1)) * Math.PI) * spacing;
    } else {
      const radius = Math.max(size * 1.6, (goal * gap) / (Math.PI * 2));
      const angle = (Math.PI * 2 * index) / goal + startAngle;
      x = radius + Math.cos(angle) * radius;
      y = radius + Math.sin(angle) * radius;
    }
    positions.push({ index, x, y, filled: false });
  }
  const minX = Math.min(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  return positions.map((position) => ({
    ...position,
    x: position.x - minX + size / 2,
    y: position.y - minY + size / 2,
  }));
}

export function renderStampSvg(input: StampRenderInput): {
  svg: string;
  digest: string;
  width: number;
  height: number;
  positions: StampPosition[];
} {
  const size = input.stampSize ?? 48;
  const spacing = input.spacing ?? 8;
  const progress = Math.max(0, Math.min(input.goal, Math.floor(input.progress)));
  const positions = layoutStampPositions(
    input.goal,
    input.layout,
    size,
    spacing,
    input.layoutConfiguration,
  ).map((position) => ({ ...position, filled: position.index < progress }));
  const labelLines = [
    input.progressLabelVisible && input.label ? input.label : null,
    input.rewardLabelVisible && input.rewardLabel ? input.rewardLabel : null,
  ].filter((value): value is string => Boolean(value));
  const labelHeight = labelLines.length ? labelLines.length * 24 + 16 : 0;
  const maxX = Math.max(...positions.map((position) => position.x + size / 2));
  const maxY = Math.max(...positions.map((position) => position.y + size / 2));
  const width = Math.ceil(maxX);
  const height = Math.ceil(maxY + labelHeight);
  const filledHref = artworkHref(
    input.filledArtwork ?? fallbackArtwork(true, input.filledColor, input.emptyColor),
  );
  const emptyHref = artworkHref(
    input.emptyArtwork ?? fallbackArtwork(false, input.filledColor, input.emptyColor),
  );
  const artwork = positions
    .map((position) => {
      const href = position.filled ? filledHref : emptyHref;
      const visualState = position.filled ? "FILLED" : "EMPTY";
      return `<g data-stamp-index="${position.index}" data-filled="${position.filled}" data-visual-state="${visualState}"><image href="${escapeXml(href ?? "")}" x="${position.x - size / 2}" y="${position.y - size / 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/></g>`;
    })
    .join("");
  const background = validColor(input.backgroundColor ?? "#FFFFFF", "#FFFFFF");
  const foreground = validColor(input.foregroundColor ?? input.accentColor, "#222222");
  const labels = labelLines
    .map(
      (label, index) =>
        `<text x="16" y="${Math.ceil(maxY + 24 + index * 24)}" font-family="Cairo,Arial,sans-serif" font-size="${index === 0 ? 16 : 14}" fill="${foreground}">${escapeXml(label)}</text>`,
    )
    .join("");
  const profile = input.outputProfile ?? "CUSTOMER_WEB";
  const ariaLabel = escapeXml(
    [...labelLines, `${progress} of ${input.goal} stamps`].filter(Boolean).join(". "),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}" data-output-profile="${profile}" data-reward-ready="${input.rewardReady === true}"><rect width="100%" height="100%" rx="18" fill="${background}"/>${artwork}${labels}</svg>`;
  return {
    svg,
    digest: createHash("sha256").update(svg).digest("hex"),
    width,
    height,
    positions,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
}

/**
 * Identifies only values that can change rendered pixels/markup. It deliberately
 * excludes private record identifiers so equivalent memberships can share one
 * immutable public Wallet image without leaking or keying by customer data.
 */
export function publishedMembershipStampVisualDigest(
  input: PublishedMembershipStampRenderInput,
): string {
  assertDigest(input.assetDigests.filled, "Filled artwork digest");
  assertDigest(input.assetDigests.empty, "Empty artwork digest");
  return createHash("sha256")
    .update(
      stableJson({
        rendererSchemaVersion: input.rendererSchemaVersion,
        requiredStampCount: input.requiredStampCount,
        currentStampCount: input.currentStampCount,
        rewardReady: input.rewardReady,
        layoutType: input.layoutType,
        layoutConfiguration: input.layoutConfiguration ?? {},
        visualTheme: input.visualTheme,
        assetDigests: input.assetDigests,
        outputProfile: input.outputProfile,
      }),
    )
    .digest("hex");
}

export function renderPublishedMembershipStampSvg(
  input: PublishedMembershipStampRenderInput,
): PublishedMembershipStampRenderResult {
  if (input.rendererSchemaVersion !== "waflo-stamp-render-v1") {
    throw new Error("Unsupported stamp renderer schema.");
  }
  assertDigest(input.assetDigests.filled, "Filled artwork digest");
  assertDigest(input.assetDigests.empty, "Empty artwork digest");

  const rendered = renderStampSvg({
    goal: input.requiredStampCount,
    progress: input.currentStampCount,
    layout: input.layoutType,
    ...(input.layoutConfiguration ? { layoutConfiguration: input.layoutConfiguration } : {}),
    filledColor: input.visualTheme.filledColor,
    emptyColor: input.visualTheme.emptyColor,
    accentColor: input.visualTheme.accentColor,
    ...(input.visualTheme.backgroundColor
      ? { backgroundColor: input.visualTheme.backgroundColor }
      : {}),
    ...(input.visualTheme.foregroundColor
      ? { foregroundColor: input.visualTheme.foregroundColor }
      : {}),
    ...(input.visualTheme.stampSize !== undefined
      ? { stampSize: input.visualTheme.stampSize }
      : {}),
    ...(input.visualTheme.spacing !== undefined ? { spacing: input.visualTheme.spacing } : {}),
    rewardReady: input.rewardReady,
    filledArtwork: input.filledArtwork,
    emptyArtwork: input.emptyArtwork,
    outputProfile: input.outputProfile,
    progressLabelVisible: false,
    rewardLabelVisible: false,
  });
  const configurationDigest = createHash("sha256")
    .update(
      stableJson({
        rendererSchemaVersion: input.rendererSchemaVersion,
        organizationId: input.organizationId,
        programId: input.programId,
        programVersionId: input.programVersionId,
        membershipId: input.membershipId,
        locale: input.locale,
        requiredStampCount: input.requiredStampCount,
        currentStampCount: input.currentStampCount,
        rewardReady: input.rewardReady,
        layoutType: input.layoutType,
        layoutConfiguration: input.layoutConfiguration ?? {},
        visualTheme: input.visualTheme,
        assetDigests: input.assetDigests,
        outputProfile: input.outputProfile,
      }),
    )
    .digest("hex");

  return {
    svg: rendered.svg,
    contentDigest: rendered.digest,
    configurationDigest,
    width: rendered.width,
    height: rendered.height,
    positions: rendered.positions,
  };
}

import { createHash } from "node:crypto";

export type StampLayout = "ROW" | "GRID" | "PATH" | "RING";
export type StampOutputProfile = "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET";

export type StampArtwork =
  | { kind: "svg"; content: string; trusted: true }
  | {
      kind: "data-uri";
      value: string;
      mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
      trusted: true;
    };

export interface StampRenderInput {
  goal: number;
  progress: number;
  layout: StampLayout;
  filledColor: string;
  emptyColor: string;
  accentColor: string;
  label?: string;
  rewardLabel?: string;
  stampSize?: number;
  spacing?: number;
  filledArtwork?: StampArtwork;
  emptyArtwork?: StampArtwork;
  milestoneArtwork?: StampArtwork;
  outputProfile?: StampOutputProfile;
}

export interface StampPosition {
  index: number;
  x: number;
  y: number;
  filled: boolean;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
  );
}

function artworkHref(artwork: StampArtwork | undefined): string | null {
  if (!artwork) return null;
  if (artwork.kind === "data-uri") return artwork.value;
  if (/<script|<foreignObject|on[a-z]+\\s*=|javascript:/i.test(artwork.content))
    throw new Error("Unsafe artwork content.");
  return `data:image/svg+xml;base64,${Buffer.from(artwork.content, "utf8").toString("base64")}`;
}

function fallbackArtwork(filled: boolean): StampArtwork {
  const fill = filled ? "#E4572E" : "#F7F4EE";
  const stroke = filled ? "#B63A18" : "#C9BFB1";
  return {
    kind: "svg",
    trusted: true,
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 4c7 8 14 7 21 5 1 8 7 13 15 15-3 8-1 15 5 21-6 6-8 13-5 21-8 2-14 7-15 15-7-2-14-3-21 5-7-8-14-7-21-5-1-8-7-13-15-15 3-8 1-15-5-21 6-6 8-13 5-21 8-2 14-7 15-15 7 2 14 3 21-5Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="35" cy="40" r="5" fill="${stroke}"/><circle cx="65" cy="40" r="5" fill="${stroke}"/><path d="M34 62c10 8 22 8 32 0" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/></svg>`,
  };
}

export function layoutStampPositions(
  goal: number,
  layout: StampLayout,
  size = 48,
  spacing = 8,
): StampPosition[] {
  const positions: StampPosition[] = [];
  const gap = size + spacing;
  for (let index = 0; index < goal; index += 1) {
    let x = 0;
    let y = 0;
    if (layout === "ROW") {
      x = index * gap;
      y = 0;
    }
    if (layout === "GRID") {
      const columns = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(goal))));
      x = (index % columns) * gap;
      y = Math.floor(index / columns) * gap;
    }
    if (layout === "PATH") {
      const columns = Math.min(5, Math.max(3, Math.ceil(Math.sqrt(goal))));
      const row = Math.floor(index / columns);
      const col = index % columns;
      x = (row % 2 ? columns - 1 - col : col) * gap;
      y = row * gap;
    }
    if (layout === "RING") {
      const radius = Math.max(size * 1.8, (goal * (size + spacing)) / 6);
      const angle = (Math.PI * 2 * index) / goal - Math.PI / 2;
      x = radius + Math.cos(angle) * radius;
      y = radius + Math.sin(angle) * radius;
    }
    positions.push({ index, x, y, filled: index < 0 });
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
  if (!Number.isInteger(input.goal) || input.goal < 2 || input.goal > 30)
    throw new Error("Stamp goal must be between 2 and 30.");
  const size = input.stampSize ?? 48;
  const spacing = input.spacing ?? 8;
  const positions = layoutStampPositions(input.goal, input.layout, size, spacing).map(
    (position) => ({ ...position, filled: position.index < Math.min(input.progress, input.goal) }),
  );
  const maxX = Math.max(...positions.map((position) => position.x + size / 2)) + size;
  const maxY = Math.max(...positions.map((position) => position.y + size / 2)) + size;
  const labels = `${input.label ?? ""}${input.rewardLabel ?? ""}`;
  const filledHref = artworkHref(input.filledArtwork ?? fallbackArtwork(true));
  const emptyHref = artworkHref(input.emptyArtwork ?? fallbackArtwork(false));
  const milestoneHref = artworkHref(input.milestoneArtwork);
  const circles = positions
    .map((position) => {
      const href = position.filled ? filledHref : emptyHref;
      const milestone =
        position.index === input.goal - 1 && milestoneHref
          ? `<image href="${escapeXml(milestoneHref)}" x="${position.x - size / 2}" y="${position.y - size / 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`
          : "";
      return `<g data-stamp-index="${position.index}" data-filled="${position.filled}"><image href="${escapeXml(href ?? "")}" x="${position.x - size / 2}" y="${position.y - size / 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>${milestone}<text x="${position.x}" y="${position.y + size * 0.42}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${Math.max(10, size / 4)}" fill="${position.filled ? "#ffffff" : escapeXml(input.accentColor)}">${position.filled ? "✓" : position.index + 1}</text></g>`;
    })
    .join("");
  const profile = input.outputProfile ?? "CUSTOMER_WEB";
  const profileBackground =
    profile === "APPLE_WALLET" ? "#F3F4F6" : profile === "GOOGLE_WALLET" ? "#EEF5FF" : "#FFFFFF";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(maxX)}" height="${Math.ceil(maxY + 44)}" viewBox="0 0 ${Math.ceil(maxX)} ${Math.ceil(maxY + 44)}" role="img" aria-label="${escapeXml(labels || `${input.progress} of ${input.goal} stamps`)}" data-output-profile="${profile}"><rect width="100%" height="100%" rx="18" fill="${profileBackground}"/>${circles}<text x="16" y="${Math.ceil(maxY + 26)}" font-family="Arial,sans-serif" font-size="16" fill="#222222">${escapeXml(input.label ?? `${input.progress}/${input.goal}`)}</text></svg>`;
  return {
    svg,
    digest: createHash("sha256").update(svg).digest("hex"),
    width: Math.ceil(maxX),
    height: Math.ceil(maxY + 44),
    positions,
  };
}

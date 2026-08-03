import { createHash } from "node:crypto";

export const PREVIEW_RENDERER_SCHEMA_VERSION = 4;

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

export function createProgramPreviewCacheKey(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalize(input)))
    .digest("hex");
}

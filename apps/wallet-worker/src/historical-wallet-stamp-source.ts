import { createHash } from "node:crypto";
import type { StampArtwork } from "@waflo/stamp-engine";
import { lookupProductionV1RecoveredStamp } from "./production-v1-wallet-assets.js";

export interface PersistedWalletStampAsset {
  readonly id: string;
  readonly category: string;
  readonly source: string;
  readonly sha256Digest: string;
  readonly safeMetadata: unknown;
  readonly variants: readonly {
    readonly variantCode: string;
    readonly objectKey: string;
    readonly mimeType: string;
    readonly digest: string;
  }[];
}

export interface HistoricalWalletStampIdentity {
  readonly assetId: string;
  readonly category: string;
  readonly source: string;
  readonly resolution: "INLINE_SVG" | "STORED_VARIANT";
  readonly selectedVariantCode: "STAMP_256" | "ORIGINAL_SAFE" | null;
  readonly selectedObjectKey: string | null;
  readonly renderDigest: string;
  readonly contentDigest: string;
  readonly recoverySourceReference: string | null;
}

export interface LoadedHistoricalWalletStampSource {
  readonly artwork: StampArtwork;
  readonly identity: HistoricalWalletStampIdentity;
}

export type HistoricalWalletStampSourceErrorCode =
  | "RENDER_ASSET_DIGEST_MISMATCH"
  | "RENDER_ASSET_MISSING";

export class HistoricalWalletStampSourceError extends Error {
  constructor(
    readonly safeErrorCode: HistoricalWalletStampSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HistoricalWalletStampSourceError";
  }
}

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inlineSvg(asset: PersistedWalletStampAsset): string | null {
  const metadata = asset.safeMetadata;
  return metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "inlineSvg" in metadata &&
    typeof metadata.inlineSvg === "string"
    ? metadata.inlineSvg
    : null;
}

function selectedVariant(asset: PersistedWalletStampAsset) {
  return (
    asset.variants.find((item) => item.variantCode === "STAMP_256") ??
    asset.variants.find((item) => item.variantCode === "ORIGINAL_SAFE") ??
    null
  );
}

/**
 * Reproduces the exact source-selection order used by the pre-composer Wallet
 * worker. No template code, category fallback, or generated icon is consulted.
 */
export async function loadHistoricalWalletStampSource(
  asset: PersistedWalletStampAsset,
  getObject: (objectKey: string) => Promise<Buffer>,
): Promise<LoadedHistoricalWalletStampSource> {
  const persistedSvg = inlineSvg(asset);
  const recovered = lookupProductionV1RecoveredStamp(asset);
  const svg = persistedSvg ?? recovered?.inlineSvg ?? null;
  const variant = selectedVariant(asset);
  const renderDigest = variant?.digest ?? asset.sha256Digest;
  if (svg) {
    return {
      artwork: { kind: "svg", content: svg, trusted: true },
      identity: {
        assetId: asset.id,
        category: asset.category,
        source: asset.source,
        resolution: "INLINE_SVG",
        selectedVariantCode:
          variant?.variantCode === "STAMP_256" || variant?.variantCode === "ORIGINAL_SAFE"
            ? variant.variantCode
            : null,
        selectedObjectKey: variant?.objectKey ?? null,
        renderDigest,
        contentDigest: sha256(svg),
        recoverySourceReference: recovered?.sourceReference ?? null,
      },
    };
  }
  if (
    !variant ||
    (variant.variantCode !== "STAMP_256" && variant.variantCode !== "ORIGINAL_SAFE") ||
    !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(variant.mimeType)
  ) {
    throw new HistoricalWalletStampSourceError(
      "RENDER_ASSET_MISSING",
      `Published Wallet stamp asset ${asset.id} has no exact historical processed variant.`,
    );
  }
  const bytes = await getObject(variant.objectKey);
  const digest = sha256(bytes);
  if (digest !== variant.digest) {
    throw new HistoricalWalletStampSourceError(
      "RENDER_ASSET_DIGEST_MISMATCH",
      `Published Wallet stamp asset ${asset.id} failed digest verification.`,
    );
  }
  const mimeType = variant.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  return {
    artwork: {
      kind: "data-uri",
      value: `data:${mimeType};base64,${bytes.toString("base64")}`,
      mimeType,
      trusted: true,
    },
    identity: {
      assetId: asset.id,
      category: asset.category,
      source: asset.source,
      resolution: "STORED_VARIANT",
      selectedVariantCode: variant.variantCode,
      selectedObjectKey: variant.objectKey,
      renderDigest,
      contentDigest: digest,
      recoverySourceReference: null,
    },
  };
}

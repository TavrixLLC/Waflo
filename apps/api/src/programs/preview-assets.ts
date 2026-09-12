import { createHash } from "node:crypto";
import { HttpStatus } from "@nestjs/common";
import { AppError } from "../common/app-error.js";
import type { ObjectStorage } from "./object-storage.js";

export type PreviewAsset = {
  id: string;
  sha256Digest: string;
  safeMetadata: unknown;
  mimeType: string;
  source: string;
  variants: Array<{
    variantCode: string;
    objectKey: string;
    mimeType: string;
    digest: string;
  }>;
};

export type PreviewAssetContent = {
  dataUri: string;
  artwork:
    | { kind: "svg"; content: string; trusted: true }
    | {
        kind: "data-uri";
        value: string;
        mimeType: "image/png" | "image/jpeg" | "image/webp";
        trusted: true;
      };
};

export type PreviewAssetVariant = "STAMP_256" | "ORIGINAL_SAFE" | "THUMBNAIL_96";

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function previewAssetCacheIdentity(
  asset: PreviewAsset | null | undefined,
  preferredVariant: PreviewAssetVariant,
) {
  if (!asset) return null;
  const variant =
    asset.variants.find((item) => item.variantCode === preferredVariant) ??
    asset.variants.find((item) => item.variantCode === "ORIGINAL_SAFE");
  return {
    assetId: asset.id,
    assetDigest: asset.sha256Digest,
    variantCode: variant?.variantCode ?? null,
    variantDigest: variant?.digest ?? null,
  };
}

export async function resolvePreviewAssetContent(
  storage: ObjectStorage,
  asset: PreviewAsset | null | undefined,
  preferredVariant: PreviewAssetVariant,
  role: string,
  required = false,
): Promise<PreviewAssetContent | undefined> {
  const metadata = asset?.safeMetadata;
  if (!asset) {
    if (required)
      throw new AppError(
        "PROGRAM_ASSET_CONTENT_UNAVAILABLE",
        `The selected ${role} asset is unavailable.`,
        HttpStatus.SERVICE_UNAVAILABLE,
        { role },
      );
    return undefined;
  }
  if (
    metadata &&
    typeof metadata === "object" &&
    "inlineSvg" in metadata &&
    typeof metadata.inlineSvg === "string"
  )
    return {
      dataUri: `data:image/svg+xml;base64,${Buffer.from(metadata.inlineSvg, "utf8").toString("base64")}`,
      artwork: {
        kind: "svg",
        content: metadata.inlineSvg,
        trusted: true,
      },
    };
  const variant =
    asset.variants.find((item) => item.variantCode === preferredVariant) ??
    asset.variants.find((item) => item.variantCode === "ORIGINAL_SAFE");
  if (!variant?.mimeType.startsWith("image/"))
    throw new AppError(
      "PROGRAM_ASSET_CONTENT_UNAVAILABLE",
      `The selected ${role} asset has no usable processed variant.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      { role, assetId: asset.id },
    );
  try {
    const bytes = await storage.get(variant.objectKey);
    if (sha256Bytes(bytes) !== variant.digest) throw new Error("digest mismatch");
    const dataUri = `data:${variant.mimeType};base64,${bytes.toString("base64")}`;
    return {
      dataUri,
      artwork: {
        kind: "data-uri",
        value: dataUri,
        mimeType: variant.mimeType as "image/png" | "image/jpeg" | "image/webp",
        trusted: true,
      },
    };
  } catch {
    throw new AppError(
      "PROGRAM_ASSET_CONTENT_UNAVAILABLE",
      `The selected ${role} asset content is missing or corrupted.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      { role, assetId: asset.id },
    );
  }
}

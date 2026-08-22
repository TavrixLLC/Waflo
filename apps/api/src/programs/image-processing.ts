import { createHash } from "node:crypto";
import sharp, { type Sharp, type SharpOptions } from "sharp";

const MAX_INPUT_PIXELS = 16_000_000;
const MAX_DIMENSION = 4096;

export type SupportedImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface ProcessedImageVariant {
  code: "ORIGINAL_SAFE" | "STAMP_256" | "THUMBNAIL_96";
  bytes: Buffer;
  mimeType: "image/png" | "image/webp";
  width: number;
  height: number;
  digest: string;
}

export interface ProcessedMerchantImage {
  original: ProcessedImageVariant;
  variants: ProcessedImageVariant[];
  source: {
    width: number;
    height: number;
    format: string;
    orientation: number | null;
    hadAlpha: boolean;
  };
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function extensionMime(hasAlpha: boolean): "image/png" | "image/webp" {
  return hasAlpha ? "image/png" : "image/webp";
}

async function encodeSafe(
  pipeline: Sharp,
  hasAlpha: boolean,
): Promise<{ bytes: Buffer; width: number; height: number; mimeType: "image/png" | "image/webp" }> {
  const result = hasAlpha
    ? await pipeline
        .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
        .toBuffer({ resolveWithObject: true })
    : await pipeline.webp({ quality: 88, effort: 5, smartSubsample: true }).toBuffer({
        resolveWithObject: true,
      });
  return {
    bytes: result.data,
    width: result.info.width,
    height: result.info.height,
    mimeType: extensionMime(hasAlpha),
  };
}

export async function processMerchantImage(
  bytes: Buffer,
  declaredMimeType: SupportedImageMime,
  crop: ImageCrop,
): Promise<ProcessedMerchantImage> {
  if (!bytes.length) throw new Error("The uploaded image is empty.");
  if (crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) {
    throw new Error("The crop rectangle must remain inside the source image.");
  }

  const decoderOptions: SharpOptions = {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
    pages: 1,
  };
  const probe = sharp(bytes, decoderOptions);
  const metadata = await probe.metadata();
  const detectedMime =
    metadata.format === "png"
      ? "image/png"
      : metadata.format === "jpeg"
        ? "image/jpeg"
        : metadata.format === "webp"
          ? "image/webp"
          : null;
  if (!detectedMime || detectedMime !== declaredMimeType) {
    throw new Error("The decoded image format does not match the declared MIME type.");
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_DIMENSION ||
    metadata.height > MAX_DIMENSION ||
    metadata.width * metadata.height > MAX_INPUT_PIXELS
  ) {
    throw new Error("The decoded image exceeds the safe resolution limit.");
  }

  const hadAlpha = Boolean(metadata.hasAlpha);
  const normalized = await encodeSafe(sharp(bytes, decoderOptions).rotate(), hadAlpha);
  const left = Math.min(normalized.width - 1, Math.round(crop.x * normalized.width));
  const top = Math.min(normalized.height - 1, Math.round(crop.y * normalized.height));
  const width = Math.max(
    1,
    Math.min(normalized.width - left, Math.round(crop.width * normalized.width)),
  );
  const height = Math.max(
    1,
    Math.min(normalized.height - top, Math.round(crop.height * normalized.height)),
  );
  const cropped = await encodeSafe(
    sharp(normalized.bytes, decoderOptions).extract({ left, top, width, height }),
    hadAlpha,
  );
  const original: ProcessedImageVariant = {
    code: "ORIGINAL_SAFE",
    ...cropped,
    digest: digest(cropped.bytes),
  };

  const makeVariant = async (
    code: "STAMP_256" | "THUMBNAIL_96",
    size: number,
  ): Promise<ProcessedImageVariant> => {
    const output = await encodeSafe(
      sharp(cropped.bytes, decoderOptions).resize(size, size, {
        fit: "contain",
        withoutEnlargement: false,
        background: hadAlpha
          ? { r: 0, g: 0, b: 0, alpha: 0 }
          : { r: 255, g: 255, b: 255, alpha: 1 },
      }),
      hadAlpha,
    );
    return { code, ...output, digest: digest(output.bytes) };
  };

  const variants = [
    original,
    await makeVariant("STAMP_256", 256),
    await makeVariant("THUMBNAIL_96", 96),
  ];
  return {
    original,
    variants,
    source: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      orientation: metadata.orientation ?? null,
      hadAlpha,
    },
  };
}

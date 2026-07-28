import { HttpStatus, Injectable } from "@nestjs/common";
import type { MerchantAssetUploadInput } from "@waflo/contracts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

const MAX_BYTES = 2 * 1024 * 1024;
const storageRoot = join(process.cwd(), "tmp", "waflo-assets");

function safeFilename(filename: string) {
  const normalized = basename(filename)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 120);
  return normalized || "upload";
}

function hasValidSignature(mimeType: MerchantAssetUploadInput["mimeType"], bytes: Buffer) {
  if (mimeType === "image/png")
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  return (
    bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
  );
}

function dimensions(mimeType: MerchantAssetUploadInput["mimeType"], bytes: Buffer) {
  if (mimeType === "image/png" && bytes.length >= 24)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mimeType === "image/webp" && bytes.length >= 30 && bytes.toString("ascii", 12, 16) === "VP8X")
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1] ?? -1;
      const length = bytes.readUInt16BE(offset + 2);
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      )
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      offset += 2 + length;
    }
  }
  return null;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, organizationId: string) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    return this.prisma.client.merchantAsset.findMany({
      where: { organizationId, archivedAt: null, processingStatus: "READY" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        category: true,
        originalFilename: true,
        mimeType: true,
        fileSize: true,
        width: true,
        height: true,
        sha256Digest: true,
        createdAt: true,
      },
    });
  }

  async upload(
    userId: string,
    organizationId: string,
    input: MerchantAssetUploadInput,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.contentBase64, "base64");
    } catch {
      throw new AppError(
        "ASSET_INVALID_BASE64",
        "The image payload is invalid.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (bytes.length === 0 || bytes.length > MAX_BYTES)
      throw new AppError(
        "ASSET_TOO_LARGE",
        "Images must be smaller than 2 MB.",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    if (!hasValidSignature(input.mimeType, bytes))
      throw new AppError(
        "ASSET_MALFORMED",
        "The uploaded bytes do not match the declared image format.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const size = dimensions(input.mimeType, bytes);
    if (
      !size ||
      size.width < 1 ||
      size.height < 1 ||
      size.width > 4096 ||
      size.height > 4096 ||
      size.width * size.height > 16_000_000
    )
      throw new AppError(
        "ASSET_DIMENSIONS_INVALID",
        "Images must have safe dimensions below 4096px and 16 megapixels.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const sha256Digest = createHash("sha256").update(bytes).digest("hex");
    const existing = await this.prisma.client.merchantAsset.findUnique({
      where: { organizationId_sha256Digest: { organizationId, sha256Digest } },
    });
    if (existing) return existing;
    const id = randomUUID();
    const filename = safeFilename(input.filename);
    const objectKey = `private/${organizationId}/${id}/${filename}`;
    await mkdir(join(storageRoot, organizationId, id), { recursive: true });
    await writeFile(join(storageRoot, organizationId, id, filename), bytes, { flag: "wx" });
    const asset = await this.prisma.client.merchantAsset.create({
      data: {
        id,
        organizationId,
        category: input.category,
        source: "MERCHANT_UPLOAD",
        originalObjectKey: objectKey,
        originalFilename: filename,
        mimeType: input.mimeType,
        fileSize: bytes.length,
        width: size.width,
        height: size.height,
        sha256Digest,
        processingStatus: "READY",
        createdByUserId: userId,
        safeMetadata: {
          storage: "local",
          sanitizedFilename: filename,
          metadataStripped: false,
          pixelCount: size.width * size.height,
        },
      },
    });
    const variantCodes = ["ORIGINAL_SAFE", "STAMP_256", "THUMBNAIL_96"] as const;
    for (const variantCode of variantCodes) {
      const variantFilename = `${variantCode.toLowerCase()}-${filename}`;
      await writeFile(join(storageRoot, organizationId, id, variantFilename), bytes, {
        flag: "wx",
      });
      await this.prisma.client.merchantAssetVariant.create({
        data: {
          assetId: asset.id,
          variantCode,
          objectKey: `private/${organizationId}/${id}/${variantFilename}`,
          mimeType: input.mimeType,
          width: size.width,
          height: size.height,
          fileSize: bytes.length,
          digest: sha256Digest,
        },
      });
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.asset_uploaded",
        targetType: "merchant_asset",
        targetId: asset.id,
        metadata: { category: asset.category, mimeType: asset.mimeType, fileSize: asset.fileSize },
      },
      request,
    );
    return asset;
  }

  async archive(userId: string, organizationId: string, assetId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    const asset = await this.prisma.client.merchantAsset.findFirst({
      where: { id: assetId, organizationId, source: "MERCHANT_UPLOAD", archivedAt: null },
    });
    if (!asset) throw new AppError("ASSET_NOT_FOUND", "Asset not found.", HttpStatus.NOT_FOUND);
    const updated = await this.prisma.client.merchantAsset.update({
      where: { id: assetId },
      data: { archivedAt: new Date(), processingStatus: "ARCHIVED" },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.asset_archived",
        targetType: "merchant_asset",
        targetId: assetId,
      },
      request,
    );
    return updated;
  }
}

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { MerchantAssetUploadMetadataInput } from "@waflo/contracts";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withOrganizationInvariantLock } from "../common/organization-transaction.js";
import { decodeTimestampCursor, encodeCursor } from "../common/cursor-pagination.js";
import type { WafloRequest } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";
import { processMerchantImage, type SupportedImageMime } from "./image-processing.js";
import { OBJECT_STORAGE, type ObjectStorage } from "./object-storage.js";

const MAX_BYTES = 2 * 1024 * 1024;
const variantCodes = ["ORIGINAL_SAFE", "STAMP_256", "THUMBNAIL_96"] as const;
export type AssetVariantCode = (typeof variantCodes)[number];

function safeFilename(filename: string) {
  const normalized = basename(filename)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 120);
  return normalized || "upload";
}

function processedExtension(mimeType: string): "png" | "webp" {
  return mimeType === "image/png" ? "png" : "webp";
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async list(userId: string, organizationId: string, cursor?: string, limit = 30) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const decoded = decodeTimestampCursor(cursor);
    const assets = await this.prisma.client.merchantAsset.findMany({
      where: {
        organizationId,
        archivedAt: null,
        processingStatus: "READY",
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: new Date(decoded.timestamp) } },
                { createdAt: new Date(decoded.timestamp), id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { variants: { orderBy: { variantCode: "asc" } } },
    });
    const items = assets.slice(0, limit).map((asset) => ({
      ...asset,
      contentUrl: `/v1/organizations/${organizationId}/assets/${asset.id}/content?variant=THUMBNAIL_96`,
    }));
    const last = assets.length > limit ? items.at(-1) : undefined;
    return {
      items,
      nextCursor: last
        ? encodeCursor({ id: last.id, timestamp: last.createdAt.toISOString() })
        : null,
    };
  }

  async upload(
    userId: string,
    organizationId: string,
    metadata: MerchantAssetUploadMetadataInput,
    file: { filename: string; mimeType: string; bytes: Buffer },
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.mimeType) ||
      file.bytes.length === 0 ||
      file.bytes.length > MAX_BYTES
    ) {
      throw new AppError(
        "ASSET_UPLOAD_INVALID",
        "Upload one PNG, JPEG, or WebP image smaller than 2 MB.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let processed: Awaited<ReturnType<typeof processMerchantImage>>;
    try {
      processed = await processMerchantImage(
        file.bytes,
        file.mimeType as SupportedImageMime,
        metadata.crop,
      );
    } catch (error) {
      throw new AppError(
        "ASSET_PROCESSING_FAILED",
        error instanceof Error ? error.message : "The image could not be decoded safely.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const result = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const existing = await transaction.merchantAsset.findUnique({
          where: {
            organizationId_sha256Digest_category: {
              organizationId,
              sha256Digest: processed.original.digest,
              category: metadata.category,
            },
          },
          include: { variants: true },
        });
        await this.objectStorage.ensureReady();
        const sanitizedFilename = safeFilename(file.filename);
        if (existing) {
          let valid = existing.archivedAt === null && existing.processingStatus === "READY";
          if (valid)
            for (const variant of processed.variants) {
              const stored = existing.variants.find(
                (candidate) => candidate.variantCode === variant.code,
              );
              if (!stored || stored.digest !== variant.digest) {
                valid = false;
                break;
              }
              try {
                const bytes = await this.objectStorage.get(stored.objectKey);
                if (!bytes.equals(variant.bytes)) {
                  valid = false;
                  break;
                }
              } catch {
                valid = false;
                break;
              }
            }
          if (valid) return { asset: existing, uploadDisposition: "REPLAYED" as const };

          const disposition =
            existing.archivedAt || existing.processingStatus === "ARCHIVED"
              ? ("RESTORED" as const)
              : ("REPAIRED" as const);
          const storedKeys = new Map<string, string>();
          for (const variant of processed.variants) {
            const current = existing.variants.find(
              (candidate) => candidate.variantCode === variant.code,
            );
            const objectKey =
              current?.objectKey ??
              `organizations/${organizationId}/assets/${existing.id}/${variant.code.toLowerCase()}.${processedExtension(variant.mimeType)}`;
            await this.objectStorage.put(objectKey, variant.bytes, variant.mimeType);
            storedKeys.set(variant.code, objectKey);
            await transaction.merchantAssetVariant.upsert({
              where: {
                assetId_variantCode: {
                  assetId: existing.id,
                  variantCode: variant.code,
                },
              },
              create: {
                assetId: existing.id,
                variantCode: variant.code,
                objectKey,
                mimeType: variant.mimeType,
                width: variant.width,
                height: variant.height,
                fileSize: variant.bytes.length,
                digest: variant.digest,
              },
              update: {
                objectKey,
                mimeType: variant.mimeType,
                width: variant.width,
                height: variant.height,
                fileSize: variant.bytes.length,
                digest: variant.digest,
              },
            });
          }
          const restored = await transaction.merchantAsset.update({
            where: { id: existing.id },
            data: {
              originalObjectKey: storedKeys.get("ORIGINAL_SAFE") as string,
              originalFilename: sanitizedFilename,
              mimeType: processed.original.mimeType,
              fileSize: processed.original.bytes.length,
              width: processed.original.width,
              height: processed.original.height,
              processingStatus: "READY",
              archivedAt: null,
              safeMetadata: {
                storage: "private-object-storage",
                sanitizedFilename,
                metadataStripped: true,
                rawUploadStored: false,
                crop: metadata.crop,
                source: processed.source,
                semanticIdentityRestored: disposition === "RESTORED",
                objectSetRepaired: true,
              },
            },
            include: { variants: true },
          });
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              actorUserId: userId,
              action:
                disposition === "RESTORED" ? "program.asset_restored" : "program.asset_repaired",
              targetType: "merchant_asset",
              targetId: restored.id,
              metadata: {
                category: restored.category,
                semanticIdentity: `${organizationId}:${restored.sha256Digest}:${restored.category}`,
              },
            },
            request,
          );
          return { asset: restored, uploadDisposition: disposition };
        }

        const id = randomUUID();
        const prefix = `organizations/${organizationId}/assets/${id}`;
        const storedKeys: string[] = [];
        try {
          for (const variant of processed.variants) {
            const objectKey = `${prefix}/${variant.code.toLowerCase()}.${processedExtension(variant.mimeType)}`;
            await this.objectStorage.put(objectKey, variant.bytes, variant.mimeType);
            storedKeys.push(objectKey);
          }
          const originalKey = storedKeys[0];
          if (!originalKey) throw new Error("Processed image produced no safe variant.");
          const created = await transaction.merchantAsset.create({
            data: {
              id,
              organizationId,
              category: metadata.category,
              source: "MERCHANT_UPLOAD",
              originalObjectKey: originalKey,
              originalFilename: sanitizedFilename,
              mimeType: processed.original.mimeType,
              fileSize: processed.original.bytes.length,
              width: processed.original.width,
              height: processed.original.height,
              sha256Digest: processed.original.digest,
              processingStatus: "READY",
              createdByUserId: userId,
              safeMetadata: {
                storage: "private-object-storage",
                sanitizedFilename,
                metadataStripped: true,
                rawUploadStored: false,
                crop: metadata.crop,
                source: processed.source,
              },
              variants: {
                create: processed.variants.map((variant, index) => ({
                  variantCode: variant.code,
                  objectKey: storedKeys[index] as string,
                  mimeType: variant.mimeType,
                  width: variant.width,
                  height: variant.height,
                  fileSize: variant.bytes.length,
                  digest: variant.digest,
                })),
              },
            },
            include: { variants: true },
          });
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              actorUserId: userId,
              action: "program.asset_uploaded",
              targetType: "merchant_asset",
              targetId: created.id,
              metadata: {
                category: created.category,
                mimeType: created.mimeType,
                fileSize: created.fileSize,
                metadataStripped: true,
              },
            },
            request,
          );
          return { asset: created, uploadDisposition: "CREATED" as const };
        } catch (error) {
          await Promise.allSettled(storedKeys.map((key) => this.objectStorage.delete(key)));
          throw error;
        }
      },
    );
    return {
      ...result.asset,
      uploadDisposition: result.uploadDisposition,
      contentUrl: `/v1/organizations/${organizationId}/assets/${result.asset.id}/content?variant=THUMBNAIL_96`,
    };
  }

  async read(
    userId: string,
    organizationId: string,
    assetId: string,
    variantCode: AssetVariantCode,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const asset = await this.prisma.client.merchantAsset.findFirst({
      where: {
        id: assetId,
        organizationId,
        archivedAt: null,
        processingStatus: "READY",
      },
      include: { variants: true },
    });
    if (!asset) throw new AppError("ASSET_NOT_FOUND", "Asset not found.", HttpStatus.NOT_FOUND);
    if (asset.source === "WAFLO_LIBRARY") {
      const metadata = asset.safeMetadata as { inlineSvg?: unknown } | null;
      if (typeof metadata?.inlineSvg !== "string")
        throw new AppError("ASSET_NOT_FOUND", "Asset content not found.", HttpStatus.NOT_FOUND);
      return { bytes: Buffer.from(metadata.inlineSvg), mimeType: "image/svg+xml" };
    }
    const variant =
      asset.variants.find((item) => item.variantCode === variantCode) ??
      asset.variants.find((item) => item.variantCode === "ORIGINAL_SAFE");
    if (!variant)
      throw new AppError(
        "ASSET_VARIANT_NOT_FOUND",
        "Asset variant not found.",
        HttpStatus.NOT_FOUND,
      );
    return {
      bytes: await this.objectStorage.get(variant.objectKey),
      mimeType: variant.mimeType,
    };
  }

  async archive(userId: string, organizationId: string, assetId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    return withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const asset = await transaction.merchantAsset.findFirst({
          where: { id: assetId, organizationId, source: "MERCHANT_UPLOAD", archivedAt: null },
        });
        if (!asset) throw new AppError("ASSET_NOT_FOUND", "Asset not found.", HttpStatus.NOT_FOUND);
        const updated = await transaction.merchantAsset.update({
          where: { id: assetId },
          data: { archivedAt: new Date(), processingStatus: "ARCHIVED" },
        });
        await this.audit.recordInTransaction(
          transaction,
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
      },
    );
  }
}

import { Controller, Delete, Get, HttpStatus, Param, Post, Query, Req, Res } from "@nestjs/common";
import { merchantAssetUploadMetadataSchema } from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import { CurrentUser } from "../common/decorators.js";
import { pageLimit } from "../common/cursor-pagination.js";
import { AppError } from "../common/app-error.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { AssetsService, type AssetVariantCode } from "./assets.service.js";

const variants = new Set<AssetVariantCode>(["ORIGINAL_SAFE", "STAMP_256", "THUMBNAIL_96"]);

@Controller("v1/organizations/:organizationId/assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.assets.list(user.id, parseUuid(organizationId), cursor, pageLimit(limit));
  }

  @Post()
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Req() request: WafloRequest,
  ) {
    let metadataValue: unknown;
    let uploaded: { filename: string; mimeType: string; bytes: Buffer } | null = null;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (uploaded)
          throw new AppError(
            "ASSET_FILE_COUNT_INVALID",
            "Upload exactly one image.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        uploaded = {
          filename: part.filename,
          mimeType: part.mimetype,
          bytes: await part.toBuffer(),
        };
      } else if (part.fieldname === "metadata") {
        try {
          metadataValue = JSON.parse(String(part.value));
        } catch {
          throw new AppError(
            "ASSET_METADATA_INVALID",
            "Asset metadata must be valid JSON.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }
    }
    if (!uploaded || metadataValue === undefined)
      throw new AppError(
        "ASSET_UPLOAD_INCOMPLETE",
        "The multipart upload requires metadata and one image file.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    return this.assets.upload(
      user.id,
      parseUuid(organizationId),
      parseInput(merchantAssetUploadMetadataSchema, metadataValue),
      uploaded,
      request,
    );
  }

  @Get(":assetId/content")
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("assetId") assetId: string,
    @Query("variant") requestedVariant = "ORIGINAL_SAFE",
    @Res() reply: FastifyReply,
  ) {
    const variant = requestedVariant.toUpperCase() as AssetVariantCode;
    if (!variants.has(variant))
      throw new AppError("ASSET_VARIANT_INVALID", "Unknown asset variant.", HttpStatus.BAD_REQUEST);
    const content = await this.assets.read(
      user.id,
      parseUuid(organizationId),
      parseUuid(assetId),
      variant,
    );
    reply.header("cache-control", "private, no-store");
    reply.type(content.mimeType).send(content.bytes);
  }

  @Delete(":assetId")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("assetId") assetId: string,
    @Req() request: WafloRequest,
  ) {
    return this.assets.archive(user.id, parseUuid(organizationId), parseUuid(assetId), request);
  }
}

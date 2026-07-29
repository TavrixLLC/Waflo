import { Controller, Get, HttpStatus, Inject, Param, Res } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";
import { AppError } from "../common/app-error.js";
import { Public, RateLimit } from "../common/decorators.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../programs/object-storage.js";
import { PrismaService } from "../database/prisma.service.js";

@Controller("v1/public/wallet-assets")
@Public()
export class PublicWalletAssetsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Get(":publicToken")
  @RateLimit(180)
  async content(@Param("publicToken") publicToken: string, @Res() reply: FastifyReply) {
    if (!/^[A-Za-z0-9_-]{24,100}$/.test(publicToken)) {
      throw new AppError("WALLET_ASSET_NOT_FOUND", "Asset not found.", HttpStatus.NOT_FOUND);
    }
    const asset = await this.prisma.client.publicWalletAsset.findFirst({
      where: { publicToken, revokedAt: null },
    });
    if (!asset) {
      throw new AppError("WALLET_ASSET_NOT_FOUND", "Asset not found.", HttpStatus.NOT_FOUND);
    }
    const bytes = await this.storage.get(asset.objectKey);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.contentDigest) {
      throw new AppError(
        "WALLET_ASSET_INTEGRITY_FAILURE",
        "Asset is temporarily unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("etag", `"sha256-${asset.contentDigest}"`)
      .header("x-content-type-options", "nosniff")
      .type(asset.mimeType)
      .send(bytes);
  }
}

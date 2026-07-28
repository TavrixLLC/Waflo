import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { merchantAssetUploadSchema } from "@waflo/contracts";
import { CurrentUser } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { AssetsService } from "./assets.service.js";

@Controller("v1/organizations/:organizationId/assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.assets.list(user.id, parseUuid(organizationId));
  }

  @Post()
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.assets.upload(
      user.id,
      parseUuid(organizationId),
      parseInput(merchantAssetUploadSchema, body),
      request,
    );
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

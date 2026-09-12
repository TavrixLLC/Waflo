import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import {
  AdminRoute,
  CurrentAdmin,
  CurrentAdminSession,
  RequireAdminPermissions,
} from "../common/decorators.js";
import type { AuthenticatedAdmin, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import {
  adminPricingDraftSchema,
  adminPricingMarketCreateSchema,
  adminPricingMarketUpdateSchema,
  adminPricingReauthenticationSchema,
} from "./admin-pricing.js";
import { AdminPricingService } from "./admin-pricing.service.js";

@Controller("v1/admin/pricing")
@AdminRoute()
export class AdminPricingController {
  constructor(private readonly pricing: AdminPricingService) {}

  @Get("overview")
  @RequireAdminPermissions("admin.pricing.read")
  overview() {
    return this.pricing.overview();
  }

  @Get("markets")
  @RequireAdminPermissions("admin.pricing.read")
  markets() {
    return this.pricing.markets();
  }

  @Get("markets/:marketId")
  @RequireAdminPermissions("admin.pricing.read")
  market(@Param("marketId") marketId: string) {
    return this.pricing.market(parseUuid(marketId));
  }

  @Post("markets")
  @RequireAdminPermissions("admin.pricing.write")
  createMarket(
    @Body() body: unknown,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() request: WafloRequest,
  ) {
    return this.pricing.createMarket(
      parseInput(adminPricingMarketCreateSchema, body),
      admin,
      request,
    );
  }

  @Patch("markets/:marketId")
  @RequireAdminPermissions("admin.pricing.write")
  updateMarket(
    @Param("marketId") marketId: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @CurrentAdminSession() sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.pricing.updateMarket(
      parseUuid(marketId),
      parseInput(adminPricingMarketUpdateSchema, body),
      admin,
      sessionId,
      request,
    );
  }

  @Post("versions")
  @RequireAdminPermissions("admin.pricing.write")
  createDraft(
    @Body() body: unknown,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(adminPricingDraftSchema, body);
    return this.pricing.createDraft(
      {
        ...input,
        cadence: input.cadence.toUpperCase() as "MONTHLY" | "QUARTERLY" | "YEARLY",
      },
      admin,
      request,
    );
  }

  @Get("versions/:versionId")
  @RequireAdminPermissions("admin.pricing.read")
  version(@Param("versionId") versionId: string) {
    return this.pricing.version(parseUuid(versionId));
  }

  @Post("versions/:versionId/validate")
  @RequireAdminPermissions("admin.pricing.write")
  validate(
    @Param("versionId") versionId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() request: WafloRequest,
  ) {
    return this.pricing.validateVersion(parseUuid(versionId), admin, request);
  }

  @Post("versions/:versionId/publish")
  @RequireAdminPermissions("admin.pricing.write")
  publish(
    @Param("versionId") versionId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @CurrentAdminSession() sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.pricing.publishVersion(parseUuid(versionId), admin, sessionId, request);
  }

  @Post("versions/:versionId/retire")
  @RequireAdminPermissions("admin.pricing.write")
  retire(
    @Param("versionId") versionId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @CurrentAdminSession() sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.pricing.retireVersion(parseUuid(versionId), admin, sessionId, request);
  }

  @Post("reauth")
  @RequireAdminPermissions("admin.pricing.write")
  reauthenticate(
    @Body() body: unknown,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @CurrentAdminSession() sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.pricing.reauthenticate(
      admin.id,
      sessionId,
      parseInput(adminPricingReauthenticationSchema, body).currentPassword,
      request,
    );
  }
}

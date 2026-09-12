import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import {
  AdminRoute,
  CurrentAdmin,
  CurrentAdminSession,
  RequireAdminPermissions,
} from "../common/decorators.js";
import type { AuthenticatedAdmin, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import {
  adminRepricingPreviewSchema,
  adminRepricingReplaceSchema,
  adminRepricingScheduleSchema,
  adminRepricingSubscriberQuerySchema,
} from "./admin-repricing.js";
import { AdminRepricingService } from "./admin-repricing.service.js";

@Controller("v1/admin/repricing")
@AdminRoute()
export class AdminRepricingController {
  constructor(private readonly repricing: AdminRepricingService) {}

  @Get("overview")
  @RequireAdminPermissions("admin.repricing.read")
  overview() {
    return this.repricing.overview();
  }

  @Post("preview")
  @RequireAdminPermissions("admin.repricing.write")
  preview(
    @Body() body: unknown,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(adminRepricingPreviewSchema, body);
    return this.repricing.preview(
      { ...input, cadence: input.cadence.toUpperCase() as "MONTHLY" | "QUARTERLY" | "YEARLY" },
      admin,
      request,
    );
  }

  @Post("schedule")
  @RequireAdminPermissions("admin.repricing.write")
  schedule(
    @Body() body: unknown,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @CurrentAdminSession() sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.repricing.schedule(
      parseInput(adminRepricingScheduleSchema, body).campaignId,
      admin,
      sessionId,
      request,
    );
  }

  @Get("campaigns")
  @RequireAdminPermissions("admin.repricing.read")
  campaigns() {
    return this.repricing.campaigns();
  }

  @Get("campaigns/:campaignId")
  @RequireAdminPermissions("admin.repricing.read")
  campaign(@Param("campaignId") campaignId: string) {
    return this.repricing.campaign(parseUuid(campaignId));
  }

  @Post("campaigns/:campaignId/cancel")
  @RequireAdminPermissions("admin.repricing.write")
  cancel(
    @Param("campaignId") campaignId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @CurrentAdminSession() sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.repricing.cancel(parseUuid(campaignId), admin, sessionId, request);
  }

  @Post("campaigns/:campaignId/replace")
  @RequireAdminPermissions("admin.repricing.write")
  replace(
    @Param("campaignId") campaignId: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @CurrentAdminSession() sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.repricing.replace(
      parseUuid(campaignId),
      parseInput(adminRepricingReplaceSchema, body).replacementPreviewId,
      admin,
      sessionId,
      request,
    );
  }

  @Get("campaigns/:campaignId/subscribers")
  @RequireAdminPermissions("admin.repricing.read")
  subscribers(@Param("campaignId") campaignId: string, @Query() query: unknown) {
    return this.repricing.subscribers(
      parseUuid(campaignId),
      parseInput(adminRepricingSubscriberQuerySchema, query),
    );
  }
}

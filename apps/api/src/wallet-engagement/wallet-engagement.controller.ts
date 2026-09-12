import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { walletCampaignCreateSchema, walletNearbyUpdateSchema } from "@waflo/contracts";
import { CurrentUser, RateLimit } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { WalletEngagementService } from "./wallet-engagement.service.js";

@Controller("v1/organizations/:organizationId/programs/:programId/wallet-engagement")
export class MerchantWalletEngagementController {
  constructor(private readonly engagement: WalletEngagementService) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
  ) {
    return this.engagement.getMerchantView(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
    );
  }

  @Patch("nearby")
  updateNearby(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.engagement.updateNearby(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      parseInput(walletNearbyUpdateSchema, body),
      request,
    );
  }

  @Get("audience-estimate")
  audienceEstimate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Query("branchId") branchId?: string,
  ) {
    return this.engagement.audienceEstimate(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      branchId ? parseUuid(branchId) : undefined,
    );
  }

  @Post("campaigns")
  @RateLimit(10, 3600)
  createCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.engagement.createCampaign(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      parseInput(walletCampaignCreateSchema, body),
      request,
    );
  }

  @Get("campaigns")
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Query("limit") limit?: string,
  ) {
    return this.engagement.history(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      Math.min(50, Math.max(1, Number(limit) || 20)),
    );
  }

  @Post("campaigns/:campaignId/cancel")
  cancelCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Param("campaignId") campaignId: string,
    @Req() request: WafloRequest,
  ) {
    return this.engagement.cancelCampaign(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      parseUuid(campaignId),
      request,
    );
  }
}

/** Mobile-ready application API. It shares the same service, permission gate,
 * eligibility cache, and durable campaign pipeline as Merchant Dashboard. */
@Controller("v1/organizations/:organizationId/wallet-notifications")
export class MerchantWalletNotificationController {
  constructor(private readonly engagement: WalletEngagementService) {}

  @Get("programs")
  programs(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
  ) {
    return this.engagement.notificationPrograms(user.id, parseUuid(organizationId));
  }

  @Get("branches")
  branches(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("programId") programId?: string,
  ) {
    return this.engagement.notificationBranches(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId ?? ""),
    );
  }

  @Post("eligibility")
  eligibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: { programId?: unknown; branchId?: unknown },
  ) {
    return this.engagement.audienceEstimate(
      user.id,
      parseUuid(organizationId),
      parseUuid(typeof body?.programId === "string" ? body.programId : ""),
      typeof body?.branchId === "string" ? parseUuid(body.branchId) : undefined,
    );
  }

  @Post("validate")
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: { programId?: unknown; branchId?: unknown },
  ) {
    return this.engagement.audienceEstimate(
      user.id,
      parseUuid(organizationId),
      parseUuid(typeof body?.programId === "string" ? body.programId : ""),
      typeof body?.branchId === "string" ? parseUuid(body.branchId) : undefined,
    );
  }

  @Post("campaigns")
  @RateLimit(10, 3600)
  campaigns(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const { programId, ...campaign } = payload;
    return this.engagement.createCampaign(
      user.id,
      parseUuid(organizationId),
      parseUuid(typeof programId === "string" ? programId : ""),
      parseInput(walletCampaignCreateSchema, campaign),
      request,
    );
  }

  @Get("campaigns")
  campaignsHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("programId") programId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.engagement.history(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId ?? ""),
      Math.min(50, Math.max(1, Number(limit) || 20)),
    );
  }

  @Get("campaigns/:campaignId")
  campaignDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("campaignId") campaignId: string,
  ) {
    return this.engagement.campaignDetail(
      user.id,
      parseUuid(organizationId),
      parseUuid(campaignId),
    );
  }
}

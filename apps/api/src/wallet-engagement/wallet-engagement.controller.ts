import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  walletCampaignCreateSchema,
  walletNearbyUpdateSchema,
  walletPromotionConsentSchema,
} from "@waflo/contracts";
import { CurrentUser, CustomerCsrf, Public, RateLimit } from "../common/decorators.js";
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
  ) {
    return this.engagement.audienceEstimate(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
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

@Controller("v1/customer/wallet-engagement")
@Public()
export class CustomerWalletEngagementController {
  constructor(private readonly engagement: WalletEngagementService) {}

  @Get("consent")
  @RateLimit(60)
  consent(@Req() request: WafloRequest, @Query("tenant") tenant?: string) {
    return this.engagement.customerConsent(request, tenant);
  }

  @Post("consent")
  @CustomerCsrf()
  @RateLimit(10, 3600)
  setConsent(
    @Req() request: WafloRequest,
    @Body() body: unknown,
    @Query("tenant") tenant?: string,
  ) {
    return this.engagement.setCustomerConsent(
      request,
      parseInput(walletPromotionConsentSchema, body),
      tenant,
    );
  }
}

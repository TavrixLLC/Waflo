import { Body, Controller, Get, Headers, Param, Patch, Post, Req } from "@nestjs/common";
import { selectedPlanSchema } from "@waflo/contracts";
import { CurrentUser, Public, RateLimit, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput } from "../common/validation.js";
import { BillingService } from "./billing.service.js";

@Controller("v1/organizations/:organizationId/billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.billing.get(user.id, organizationId);
  }

  @Patch("selected-plan")
  select(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(selectedPlanSchema, body);
    return this.billing.selectPlan(user.id, organizationId, input.plan, request);
  }

  @Post("checkout")
  @RateLimit(5, 300)
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.billing.checkout(user.id, organizationId, request);
  }

  @Post("portal")
  @RateLimit(5, 300)
  portal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.billing.portal(user.id, organizationId, request);
  }
}

@Controller("v1/webhooks")
export class WebhooksController {
  constructor(private readonly billing: BillingService) {}

  @Post("stripe")
  @Public()
  @SkipCsrf()
  @RateLimit(120, 60)
  stripe(@Req() request: WafloRequest, @Headers("stripe-signature") signature?: string) {
    if (!request.rawBody) {
      throw new Error("Raw request body is unavailable for Stripe signature verification.");
    }
    return this.billing.processWebhook(request.rawBody, signature, request);
  }
}

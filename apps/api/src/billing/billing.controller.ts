import { Body, Controller, Get, Headers, Param, Patch, Post, Req } from "@nestjs/common";
import {
  billingCheckoutSchema,
  billingIdentitySchema,
  refundRequestSchema,
  refundReviewSchema,
  selectedPlanSchema,
} from "@waflo/contracts";
import { CurrentUser, Public, RateLimit, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import {
  parseCheckoutIdempotencyKey,
  parseInput,
  parseRefundIdempotencyKey,
  parseUuid,
} from "../common/validation.js";
import { BillingService } from "./billing.service.js";

@Controller("v1/organizations/:organizationId/billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.billing.get(user.id, parseUuid(organizationId));
  }

  @Patch("selected-plan")
  select(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(selectedPlanSchema, body);
    return this.billing.selectPlan(
      user.id,
      parseUuid(organizationId),
      input.plan,
      input.cadence ?? "monthly",
      request,
    );
  }

  @Patch("identity")
  identity(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.billing.updateBillingIdentity(
      user.id,
      parseUuid(organizationId),
      parseInput(billingIdentitySchema, body),
      request,
    );
  }

  @Post("checkout")
  @RateLimit(5, 300)
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(billingCheckoutSchema, body);
    return this.billing.checkout(
      user.id,
      parseUuid(organizationId),
      input.cadence,
      request,
      parseCheckoutIdempotencyKey(idempotencyKey),
    );
  }

  @Post("portal")
  @RateLimit(5, 300)
  portal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.billing.portal(user.id, parseUuid(organizationId), request);
  }

  @Post("reconcile")
  @RateLimit(5, 300)
  reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.billing.reconcileOrganization(user.id, parseUuid(organizationId), request);
  }

  @Post("invoices/:invoiceId/refunds")
  @RateLimit(3, 300)
  requestRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("invoiceId") invoiceId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.billing.requestRefund(
      user.id,
      parseUuid(organizationId),
      parseUuid(invoiceId),
      parseInput(refundRequestSchema, body),
      parseRefundIdempotencyKey(idempotencyKey),
      request,
    );
  }

  @Patch("refunds/:refundRequestId")
  @RateLimit(5, 300)
  reviewRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("refundRequestId") refundRequestId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.billing.reviewRefund(
      user.id,
      parseUuid(organizationId),
      parseUuid(refundRequestId),
      parseInput(refundReviewSchema, body),
      request,
    );
  }

  @Post("refunds/:refundRequestId/execute")
  @RateLimit(3, 300)
  executeRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("refundRequestId") refundRequestId: string,
    @Req() request: WafloRequest,
  ) {
    return this.billing.executeRefund(
      user.id,
      parseUuid(organizationId),
      parseUuid(refundRequestId),
      request,
    );
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

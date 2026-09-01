import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  billingIdentitySchema,
  billingSetupIntentCompleteSchema,
  billingSubscriptionCancellationSchema,
  billingSubscriptionChangeSchema,
  billingTrialCompleteSchema,
  billingTrialSetupSchema,
  refundRequestSchema,
  refundReviewSchema,
  selectedPlanSchema,
  subscriptionChangeConfirmSchema,
  subscriptionChangePreviewSchema,
} from "@waflo/contracts";
import { AppError } from "../common/app-error.js";
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

  @Get("catalog")
  catalog(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.billing.catalogForOnboarding(user.id, parseUuid(organizationId));
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

  // Persisted-preview flow for an existing subscription. The request carries
  // intent only; commercial authority remains the catalog and durable preview.
  @Post("subscription-change/preview")
  @RateLimit(10, 300)
  createSubscriptionChangePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(subscriptionChangePreviewSchema, body);
    return this.billing.createSubscriptionChangePreview(
      user.id,
      parseUuid(organizationId),
      input.targetPlan,
      input.targetCadence,
      request,
    );
  }

  @Post("subscription-change/:previewId/confirm")
  @RateLimit(10, 300)
  confirmSubscriptionChange(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("previewId") previewId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    parseInput(subscriptionChangeConfirmSchema, body);
    return this.billing.confirmSubscriptionChange(
      user.id,
      parseUuid(organizationId),
      parseUuid(previewId),
      request,
    );
  }

  @Post("subscription/change/preview")
  @RateLimit(10, 300)
  previewSubscriptionChange(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(billingSubscriptionChangeSchema, body);
    return this.billing.createSubscriptionChangePreview(
      user.id,
      parseUuid(organizationId),
      input.plan,
      input.cadence,
      request,
    );
  }

  @Post("subscription/change")
  @RateLimit(5, 300)
  changeSubscription(
    @CurrentUser() _user: AuthenticatedUser,
    @Param("organizationId") _organizationId: string,
    @Headers("x-idempotency-key") _idempotencyKey: string | undefined,
    @Body() _body: unknown,
    @Req() _request: WafloRequest,
  ) {
    throw new AppError(
      "SUBSCRIPTION_CHANGE_PREVIEW_REQUIRED",
      "Confirm a persisted subscription-change preview instead.",
      HttpStatus.CONFLICT,
    );
  }

  @Post("subscription/cancel")
  @RateLimit(5, 300)
  cancelSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.billing.cancelSubscription(
      user.id,
      parseUuid(organizationId),
      parseInput(billingSubscriptionCancellationSchema, body),
      parseCheckoutIdempotencyKey(idempotencyKey),
      request,
    );
  }

  @Post("subscription/resume")
  @RateLimit(5, 300)
  resumeSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() request: WafloRequest,
  ) {
    return this.billing.resumeSubscription(
      user.id,
      parseUuid(organizationId),
      parseCheckoutIdempotencyKey(idempotencyKey),
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

  @Post("trial/setup")
  @RateLimit(5, 300)
  prepareTrial(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(billingTrialSetupSchema, body);
    return this.billing.prepareTrialSetup(
      user.id,
      parseUuid(organizationId),
      input,
      request,
      parseCheckoutIdempotencyKey(idempotencyKey),
    );
  }

  @Post("trial/complete")
  @RateLimit(5, 300)
  completeTrial(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.billing.completeTrialSetup(
      user.id,
      parseUuid(organizationId),
      parseInput(billingTrialCompleteSchema, body),
      request,
      parseCheckoutIdempotencyKey(idempotencyKey),
    );
  }

  @Post("trial/preview")
  @RateLimit(10, 300)
  previewTrial(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.billing.previewTrialSetup(
      user.id,
      parseUuid(organizationId),
      parseInput(billingTrialCompleteSchema, body),
      parseCheckoutIdempotencyKey(idempotencyKey),
    );
  }

  @Post("payment-method/setup")
  @RateLimit(5, 300)
  preparePaymentMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() request: WafloRequest,
  ) {
    return this.billing.preparePaymentMethodReplacement(
      user.id,
      parseUuid(organizationId),
      request,
      parseCheckoutIdempotencyKey(idempotencyKey),
    );
  }

  @Post("payment-method/complete")
  @RateLimit(5, 300)
  completePaymentMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.billing.completePaymentMethodReplacement(
      user.id,
      parseUuid(organizationId),
      parseInput(billingSetupIntentCompleteSchema, body),
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

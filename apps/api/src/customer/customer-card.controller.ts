import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { customerSessionRotateSchema } from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import { CustomerCsrf, Public, RateLimit } from "../common/decorators.js";
import type { WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { EnvironmentService } from "../config/environment.service.js";
import { CustomerCardService } from "./customer-card.service.js";

@Controller("v1/customer")
@Public()
export class CustomerCardController {
  constructor(
    private readonly cards: CustomerCardService,
    private readonly environment: EnvironmentService,
  ) {}

  @Get("session")
  @RateLimit(60)
  session(@Req() request: WafloRequest, @Query("tenant") tenant?: string) {
    return this.cards.session(request, undefined, tenant);
  }

  @Get("card")
  @RateLimit(90)
  card(
    @Req() request: WafloRequest,
    @Query("tenant") tenant?: string,
    @Query("locale") locale?: string,
  ) {
    return this.cards.card(request, undefined, tenant, locale);
  }

  @Get("card/:publicMembershipId")
  @RateLimit(90)
  cardByPublicId(
    @Req() request: WafloRequest,
    @Param("publicMembershipId") publicMembershipId: string,
    @Query("tenant") tenant?: string,
    @Query("locale") locale?: string,
  ) {
    return this.cards.card(request, publicMembershipId, tenant, locale);
  }

  @Get("wallet-status")
  @RateLimit(60)
  walletStatus(@Req() request: WafloRequest, @Query("tenant") tenant?: string) {
    return this.cards.walletStatus(request, tenant);
  }

  @Get("csrf")
  @RateLimit(60)
  async csrf(
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query("tenant") tenant?: string,
  ) {
    await this.cards.requireSession(request, tenant);
    const rawSessionToken = request.cookies[this.environment.values.CUSTOMER_COOKIE_NAME];
    if (!rawSessionToken) throw new Error("Customer session disappeared during CSRF bootstrap.");
    const token = this.cards.customerCsrfToken(rawSessionToken);
    reply.setCookie(this.environment.customerCsrfCookieName, token, {
      httpOnly: true,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: "strict",
      path: "/",
      maxAge: 15 * 60,
    });
    return { token, expiresInSeconds: 15 * 60 };
  }

  @Post("session/rotate")
  @CustomerCsrf()
  @RateLimit(10)
  async rotate(
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
    @Query("tenant") tenant?: string,
  ) {
    parseInput(customerSessionRotateSchema, body);
    const result = await this.cards.rotate(request, tenant);
    reply.setCookie(this.environment.values.CUSTOMER_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: this.environment.values.COOKIE_SAME_SITE === "NONE" ? "none" : "lax",
      path: "/",
      maxAge: this.environment.values.CUSTOMER_SESSION_TTL_DAYS * 24 * 60 * 60,
    });
    return { expiresAt: result.expiresAt };
  }

  @Post("session/logout")
  @CustomerCsrf()
  @RateLimit(10)
  async logout(
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query("tenant") tenant?: string,
  ) {
    const result = await this.cards.logout(request, tenant);
    reply.clearCookie(this.environment.values.CUSTOMER_COOKIE_NAME, { path: "/" });
    reply.clearCookie(this.environment.customerCsrfCookieName, { path: "/" });
    return result;
  }

  @Post("privacy-requests")
  @CustomerCsrf()
  @RateLimit(5, 3600)
  createPrivacyRequest(
    @Req() request: WafloRequest,
    @Body() body: unknown,
    @Query("tenant") tenant?: string,
  ) {
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const requestType = input.requestType === "ERASURE" ? "ERASURE" : "EXPORT";
    return this.cards.createPrivacyRequest(
      request,
      {
        commandId: parseUuid(typeof input.commandId === "string" ? input.commandId : ""),
        requestType,
        confirmation: typeof input.confirmation === "string" ? input.confirmation : "",
      },
      tenant,
    );
  }

  @Get("privacy-requests/:requestId")
  @RateLimit(30)
  privacyRequestStatus(
    @Req() request: WafloRequest,
    @Param("requestId") requestId: string,
    @Query("tenant") tenant?: string,
  ) {
    return this.cards.privacyRequestStatus(request, parseUuid(requestId), tenant);
  }
}

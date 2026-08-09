import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentUser, CurrentSession, Public, RateLimit, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { ExternalAuthService } from "./external-auth.service.js";

type Provider = "google" | "apple";

function parseProvider(value: string): Provider {
  if (value === "google" || value === "apple") return value;
  throw new Error("Unsupported external authentication provider.");
}

function parseLocale(value: unknown): "en" | "ar" {
  return value === "ar" ? "ar" : "en";
}

@Controller("v1/auth/external")
export class ExternalAuthController {
  constructor(
    private readonly externalAuth: ExternalAuthService,
    private readonly environment: EnvironmentService,
  ) {}

  @Get("providers")
  @Public()
  capabilities() {
    return this.externalAuth.publicCapabilities();
  }

  @Get(":provider/start")
  @Public()
  @RateLimit(20, 300)
  async start(
    @Param("provider") providerValue: string,
    @Query() query: Record<string, unknown>,
    @Res() reply: FastifyReply,
  ) {
    const registration = query.registration === "true";
    const started = await this.externalAuth.start(parseProvider(providerValue), {
      locale: parseLocale(query.locale),
      allowRegistration: registration,
      legalAccepted:
        registration && query.termsAccepted === "true" && query.privacyAccepted === "true",
    });
    return reply.redirect(started.authorizationUrl);
  }

  @Post(":provider/link")
  async link(
    @Param("provider") providerValue: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Body() body: unknown,
  ) {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return this.externalAuth.startLink(
      parseProvider(providerValue),
      user.id,
      sessionId,
      typeof value.currentPassword === "string" ? value.currentPassword : "",
      parseLocale(value.locale),
    );
  }

  @Get("identities")
  identities(@CurrentUser() user: AuthenticatedUser) {
    return this.externalAuth.identities(user.id);
  }

  @Delete(":provider")
  unlink(
    @Param("provider") providerValue: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return this.externalAuth.unlink(
      parseProvider(providerValue),
      user.id,
      sessionId,
      typeof value.currentPassword === "string" ? value.currentPassword : undefined,
      request,
    );
  }

  @Get("google/callback")
  @Public()
  @RateLimit(30, 300)
  googleCallback(
    @Query() query: Record<string, unknown>,
    @Req() request: WafloRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.completeCallback(
      "google",
      typeof query.state === "string" ? query.state : "",
      typeof query.code === "string" ? query.code : "",
      undefined,
      request,
      reply,
    );
  }

  @Post("apple/callback")
  @Public()
  @SkipCsrf()
  @RateLimit(30, 300)
  appleCallback(@Body() body: unknown, @Req() request: WafloRequest, @Res() reply: FastifyReply) {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return this.completeCallback(
      "apple",
      typeof value.state === "string" ? value.state : "",
      typeof value.code === "string" ? value.code : "",
      typeof value.user === "string" ? value.user : undefined,
      request,
      reply,
    );
  }

  private async completeCallback(
    provider: Provider,
    state: string,
    code: string,
    appleUser: string | undefined,
    request: WafloRequest,
    reply: FastifyReply,
  ) {
    const fallbackLocale = state
      ? await this.externalAuth.localeForState(provider, state).catch(() => "en" as const)
      : "en";
    if (!state || !code) return this.safeRedirect(reply, fallbackLocale, "failed");
    try {
      const completed = await this.externalAuth.complete(
        { provider, state, code, ...(appleUser ? { appleUser } : {}) },
        request,
      );
      this.setSessionCookie(reply, completed.session.rawToken, completed.session.expiresAt);
      return this.safeRedirect(reply, completed.locale, "authenticated");
    } catch {
      return this.safeRedirect(reply, fallbackLocale, "failed");
    }
  }

  private safeRedirect(reply: FastifyReply, locale: "en" | "ar", result: string) {
    const target = new URL(
      `/${locale}/oauth/callback`,
      this.environment.values.MERCHANT_DASHBOARD_URL,
    );
    target.searchParams.set("result", result);
    return reply.redirect(target.toString());
  }

  private setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
    reply.setCookie(this.environment.values.COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: this.environment.values.COOKIE_SAME_SITE === "NONE" ? "none" : "lax",
      expires: expiresAt,
    });
  }
}

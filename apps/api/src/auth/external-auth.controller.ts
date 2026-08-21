import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { googleSignupIntentSchema } from "@waflo/contracts";
import { AppError } from "../common/app-error.js";
import { parseInput } from "../common/validation.js";
import { CurrentSession, CurrentUser, Public, RateLimit, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { ExternalAuthService } from "./external-auth.service.js";

type Provider = "google" | "apple";

function parseProvider(value: string): Provider {
  if (value === "google" || value === "apple") return value;
  throw new Error("Unsupported external authentication provider.");
}

function parseEnabledProvider(value: string): "google" {
  if (value === "google") return value;
  throw new AppError(
    "APPLE_SIGNIN_REMOVED",
    "Apple Sign-In is no longer available. Use Google or your email and password.",
    HttpStatus.GONE,
  );
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
    const provider = parseEnabledProvider(providerValue);
    const started = await this.externalAuth.start(provider, {
      locale: parseLocale(query.locale),
      allowRegistration: false,
      legalAccepted: false,
    });
    this.setBrowserBindingCookie(reply, provider, started.browserBinding);
    return reply.redirect(started.authorizationUrl, HttpStatus.FOUND);
  }

  @Post("google/signup")
  @Public()
  @RateLimit(10, 300)
  async startGoogleSignup(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parseInput(googleSignupIntentSchema, body);
    const started = await this.externalAuth.start("google", {
      locale: input.locale,
      allowRegistration: true,
      legalAccepted: input.termsAccepted && input.privacyAccepted,
    });
    this.setBrowserBindingCookie(reply, "google", started.browserBinding);
    return { authorizationUrl: started.authorizationUrl };
  }

  @Post(":provider/link")
  async link(
    @Param("provider") providerValue: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const provider = parseEnabledProvider(providerValue);
    const started = await this.externalAuth.startLink(
      provider,
      user.id,
      sessionId,
      typeof value.currentPassword === "string" ? value.currentPassword : "",
      parseLocale(value.locale),
    );
    this.setBrowserBindingCookie(reply, provider, started.browserBinding);
    return { authorizationUrl: started.authorizationUrl };
  }

  @Post(":provider/reauthenticate")
  @RateLimit(10, 300)
  async reauthenticate(
    @Param("provider") providerValue: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const provider = parseEnabledProvider(providerValue);
    const started = await this.externalAuth.startReauthentication(
      provider,
      user.id,
      sessionId,
      parseLocale(value.locale),
    );
    this.setBrowserBindingCookie(reply, provider, started.browserBinding);
    return { authorizationUrl: started.authorizationUrl };
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
  appleCallback() {
    throw new AppError(
      "APPLE_SIGNIN_REMOVED",
      "Apple Sign-In is no longer available. Use Google or your email and password.",
      HttpStatus.GONE,
    );
  }

  @Post("apple/notifications")
  @Public()
  @SkipCsrf()
  @RateLimit(300, 300)
  @HttpCode(HttpStatus.OK)
  appleNotifications(@Body() body: unknown, @Req() request: WafloRequest) {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return this.externalAuth.handleAppleNotification(
      typeof value.payload === "string" ? value.payload : "",
      request,
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
    if (!state) return this.safeRedirect(reply, fallbackLocale, "failed");
    const cookieName = this.externalAuth.browserBindingCookieName(provider, state);
    const browserBinding = request.cookies[cookieName] ?? "";
    let result = "failed";
    let redirectLocale = fallbackLocale;
    try {
      const completed = await this.externalAuth.complete(
        { provider, state, code, browserBinding, ...(appleUser ? { appleUser } : {}) },
        request,
      );
      this.setSessionCookie(reply, completed.session.rawToken, completed.session.expiresAt);
      result = "authenticated";
      redirectLocale = completed.locale;
    } catch (error) {
      result =
        error instanceof AppError && error.code === "EXTERNAL_AUTH_ACCOUNT_NOT_FOUND"
          ? "no_account"
          : "failed";
    } finally {
      this.clearBrowserBindingCookie(reply, provider, cookieName);
    }
    return this.safeRedirect(reply, redirectLocale, result);
  }

  private setBrowserBindingCookie(
    reply: FastifyReply,
    provider: Provider,
    binding: { cookieName: string; value: string; expiresAt: Date },
  ) {
    const deployed = this.environment.values.DEPLOYMENT_ENVIRONMENT !== "development";
    reply.setCookie(binding.cookieName, binding.value, {
      path: `/v1/auth/external/${provider}/callback`,
      httpOnly: true,
      secure: deployed,
      sameSite: deployed ? "none" : "lax",
      expires: binding.expiresAt,
    });
  }

  private clearBrowserBindingCookie(reply: FastifyReply, provider: Provider, cookieName: string) {
    const deployed = this.environment.values.DEPLOYMENT_ENVIRONMENT !== "development";
    reply.clearCookie(cookieName, {
      path: `/v1/auth/external/${provider}/callback`,
      httpOnly: true,
      secure: deployed,
      sameSite: deployed ? "none" : "lax",
    });
  }

  private safeRedirect(reply: FastifyReply, locale: "en" | "ar", result: string) {
    const target = new URL(
      `/${locale}/oauth/callback`,
      this.environment.values.MERCHANT_DASHBOARD_URL,
    );
    target.searchParams.set("result", result);
    return reply.redirect(target.toString(), HttpStatus.FOUND);
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

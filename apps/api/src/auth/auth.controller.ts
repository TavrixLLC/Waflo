import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
  updateUserSchema,
} from "@waflo/contracts";
import { createOpaqueToken } from "@waflo/auth";
import type { FastifyReply } from "fastify";
import { CurrentSession, CurrentUser, Public, RateLimit } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { EnvironmentService } from "../config/environment.service.js";
import { AuthService } from "./auth.service.js";

@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly environment: EnvironmentService,
  ) {}

  @Get("csrf")
  @Public()
  csrf(@Res({ passthrough: true }) reply: FastifyReply) {
    const token = createOpaqueToken();
    reply.setCookie("waflo_csrf", token, {
      path: "/",
      httpOnly: false,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: "strict",
      maxAge: 60 * 60 * 8,
    });
    return { csrfToken: token };
  }

  @Post("register")
  @Public()
  @RateLimit(5, 300)
  async register(@Body() body: unknown, @Req() request: WafloRequest) {
    return await this.auth.register(parseInput(registerSchema, body), request);
  }

  @Post("verify-email")
  @Public()
  @RateLimit(10, 300)
  verify(@Body() body: unknown, @Req() request: WafloRequest) {
    const input = parseInput(tokenSchema, body);
    return this.auth.verifyEmail(input.token, request);
  }

  @Post("resend-verification")
  @Public()
  @RateLimit(3, 300)
  resend(@Body() body: unknown, @Req() request: WafloRequest) {
    const input = parseInput(forgotPasswordSchema, body);
    return this.auth.resendVerification(input.email, request);
  }

  @Post("login")
  @Public()
  @RateLimit(8, 300)
  async login(
    @Body() body: unknown,
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseInput(loginSchema, body);
    const session = await this.auth.login(input.email, input.password, request);
    this.setSessionCookie(reply, session.rawToken, session.expiresAt);
    return { status: "authenticated", sessionId: session.sessionId };
  }

  @Post("logout")
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.auth.logout(user.id, sessionId, request);
    this.clearSessionCookie(reply);
    return { status: "logged_out" };
  }

  @Post("forgot-password")
  @Public()
  @RateLimit(5, 300)
  forgot(@Body() body: unknown, @Req() request: WafloRequest) {
    const input = parseInput(forgotPasswordSchema, body);
    return this.auth.forgotPassword(input.email, request);
  }

  @Post("reset-password")
  @Public()
  @RateLimit(5, 300)
  reset(@Body() body: unknown, @Req() request: WafloRequest) {
    const input = parseInput(resetPasswordSchema, body);
    return this.auth.resetPassword(input.token, input.password, request);
  }

  @Post("change-password")
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseInput(changePasswordSchema, body);
    const session = await this.auth.changePassword(
      user.id,
      sessionId,
      input.currentPassword,
      input.newPassword,
      request,
    );
    this.setSessionCookie(reply, session.rawToken, session.expiresAt);
    return { status: "password_changed", sessionId: session.sessionId };
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  @Patch("me")
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.auth.updateMe(user.id, parseInput(updateUserSchema, body));
  }

  @Get("sessions")
  sessions(@CurrentUser() user: AuthenticatedUser, @CurrentSession() sessionId: string) {
    return this.auth.sessions(user.id, sessionId);
  }

  @Delete("sessions/:sessionId")
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() currentSessionId: string,
    @Param("sessionId") sessionId: string,
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.revokeSession(
      user.id,
      parseUuid(sessionId),
      currentSessionId,
      request,
    );
    if (result.currentSessionRevoked) this.clearSessionCookie(reply);
    return result;
  }

  @Post("sessions/revoke-others")
  revokeOthers(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.auth.revokeOthers(user.id, sessionId, request);
  }

  @Post("sessions/revoke-all")
  async revokeAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.revokeAll(user.id, request);
    this.clearSessionCookie(reply);
    return result;
  }

  private setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    reply.setCookie(this.environment.values.COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: "lax",
      expires: expiresAt,
    });
  }

  private clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(this.environment.values.COOKIE_NAME, { path: "/" });
  }
}

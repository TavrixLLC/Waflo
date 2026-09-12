import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { createOpaqueToken } from "@waflo/auth";
import { loginSchema } from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import {
  AdminPublic,
  AdminRoute,
  CurrentAdmin,
  CurrentAdminSession,
  RateLimit,
  RequireAdminPermissions,
} from "../common/decorators.js";
import type { AuthenticatedAdmin, WafloRequest } from "../common/request-context.js";
import { parseInput } from "../common/validation.js";
import { EnvironmentService } from "../config/environment.service.js";
import { AdminAuthService } from "./admin-auth.service.js";

@Controller("v1/admin")
@AdminRoute()
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly environment: EnvironmentService,
  ) {}

  @Get("auth/csrf")
  @AdminPublic()
  csrf(@Res({ passthrough: true }) reply: FastifyReply) {
    const token = createOpaqueToken();
    reply.setCookie(this.environment.adminCsrfCookieName, token, {
      path: "/",
      httpOnly: false,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: "strict",
      maxAge: 60 * 60,
    });
    return { csrfToken: token };
  }

  @Post("auth/login")
  @AdminPublic()
  @RateLimit(10, 300)
  async login(
    @Body() body: unknown,
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseInput(loginSchema, body);
    const session = await this.auth.login(input.email, input.password, request);
    this.setSessionCookie(reply, session.rawToken, session.expiresAt);
    return { status: "authenticated", expiresAt: session.expiresAt };
  }

  @Post("auth/logout")
  async logout(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @CurrentAdminSession() sessionId: string,
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.auth.logout(admin.id, sessionId, request);
    this.clearSessionCookie(reply);
    return { status: "logged_out" };
  }

  @Get("me")
  @RequireAdminPermissions("admin.dashboard.read")
  me(@CurrentAdmin() admin: AuthenticatedAdmin, @CurrentAdminSession() sessionId: string) {
    return this.auth.me(admin.id, sessionId);
  }

  @Get("overview")
  @RequireAdminPermissions("admin.dashboard.read")
  overview(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return {
      status: "operational" as const,
      environment: this.environment.values.DEPLOYMENT_ENVIRONMENT,
      release: this.environment.values.RELEASE_SHA,
      admin: { publicId: admin.publicId, role: admin.role },
    };
  }

  private setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    reply.setCookie(this.environment.values.ADMIN_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: "strict",
      expires: expiresAt,
    });
  }

  private clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(this.environment.values.ADMIN_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: "strict",
    });
  }
}

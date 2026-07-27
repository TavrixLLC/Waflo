import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hashOpaqueToken, isSessionActive, safeTokenEquals } from "@waflo/auth";
import { AppError } from "../common/app-error.js";
import { IS_PUBLIC, RATE_LIMIT, SKIP_CSRF } from "../common/decorators.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { RateLimitService } from "./rate-limit.service.js";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly environment: EnvironmentService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<WafloRequest>();
    const token = request.cookies[this.environment.values.COOKIE_NAME];
    if (!token) {
      throw new AppError("AUTH_REQUIRED", "Please sign in to continue.", HttpStatus.UNAUTHORIZED);
    }
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: { user: true },
    });
    if (!session || !isSessionActive(session) || session.user.status !== "ACTIVE") {
      throw new AppError(
        "SESSION_EXPIRED",
        "Your session has expired. Please sign in again.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    request.currentUser = {
      id: session.user.id,
      displayName: session.user.displayName,
      email: session.user.email,
      preferredLocale: session.user.preferredLocale,
      emailVerifiedAt: session.user.emailVerifiedAt,
    };
    request.currentSessionId = session.id;
    request.currentSessionToken = token;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (session.lastActiveAt < fiveMinutesAgo) {
      void this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date() },
      });
    }
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly environment: EnvironmentService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WafloRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const origin = request.headers.origin;
    const csrfCookie = request.cookies.waflo_csrf;
    const csrfHeader = request.headers["x-csrf-token"];
    const validOrigin =
      typeof origin === "string" && this.environment.allowedOrigins.includes(origin);
    const validToken =
      typeof csrfCookie === "string" &&
      typeof csrfHeader === "string" &&
      safeTokenEquals(csrfCookie, csrfHeader);
    if (!validOrigin || !validToken) {
      await this.audit.security(
        {
          ...(request.currentUser ? { userId: request.currentUser.id } : {}),
          eventType: "csrf.rejected",
          severity: "MEDIUM",
          metadata: { originPresent: Boolean(origin), validOrigin },
        },
        request,
      );
      throw new AppError(
        "CSRF_REJECTED",
        "This request could not be verified. Refresh the page and try again.",
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WafloRequest>();
    const config = this.reflector.getAllAndOverride<{ limit: number; windowSeconds: number }>(
      RATE_LIMIT,
      [context.getHandler(), context.getClass()],
    ) ?? { limit: 120, windowSeconds: 60 };
    const ip = request.ip || "unknown";
    const route = request.routeOptions?.url ?? request.url.split("?")[0] ?? "unknown";
    const key = `waflo:rate:${ip}:${route}`;
    const allowed = await this.limiter.consume(key, config.limit, config.windowSeconds);
    if (!allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests. Please wait and try again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

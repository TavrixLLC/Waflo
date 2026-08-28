import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hashOpaqueToken, safeTokenEquals } from "@waflo/auth";
import type { AdminSession, AdminUser } from "@waflo/database";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { ADMIN_PERMISSIONS, IS_ADMIN_PUBLIC, IS_ADMIN_ROUTE } from "../common/decorators.js";
import { ERROR_REPORTER, type ErrorReporter } from "../common/error-reporter.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  type AdminPermission,
  permissionsForAdminRole,
  requireAdminPermission,
} from "./admin-rbac.js";

export function isAdminSessionActive(
  session: Pick<AdminSession, "expiresAt" | "revokedAt" | "lastActiveAt"> & {
    adminUser: Pick<AdminUser, "status">;
  },
  idleTtlMinutes: number,
  now = new Date(),
): boolean {
  return (
    session.revokedAt === null &&
    session.expiresAt.getTime() > now.getTime() &&
    session.lastActiveAt.getTime() > now.getTime() - idleTtlMinutes * 60 * 1000 &&
    session.adminUser.status === "ACTIVE"
  );
}

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly environment: EnvironmentService,
    private readonly prisma: PrismaService,
    @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const adminRoute = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!adminRoute) return true;
    const publicRoute = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publicRoute) return true;

    const request = context.switchToHttp().getRequest<WafloRequest>();
    const token = request.cookies[this.environment.values.ADMIN_COOKIE_NAME];
    if (!token) {
      throw new AppError(
        "ADMIN_AUTH_REQUIRED",
        "Administrator sign-in is required.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.prisma.client.adminSession.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: { adminUser: true },
    });
    if (
      !session ||
      !isAdminSessionActive(session, this.environment.values.ADMIN_SESSION_IDLE_TTL_MINUTES)
    ) {
      throw new AppError(
        "ADMIN_SESSION_EXPIRED",
        "Your administrator session has expired.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    request.currentAdmin = {
      id: session.adminUser.id,
      publicId: session.adminUser.publicId,
      displayName: session.adminUser.displayName,
      email: session.adminUser.email,
      preferredLocale: session.adminUser.preferredLocale,
      role: session.adminUser.role,
      permissions: permissionsForAdminRole(session.adminUser.role),
    };
    request.currentAdminSessionId = session.id;
    request.currentAdminSessionToken = token;
    if (session.lastActiveAt.getTime() < Date.now() - 5 * 60 * 1000) {
      void this.prisma.client.adminSession
        .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
        .catch((error: unknown) =>
          this.reporter.captureException(error, {
            requestId: request.requestId || request.id,
            component: "api",
            operation: "admin_session.activity_update",
          }),
        )
        .catch(() => undefined);
    }
    return true;
  }
}

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly AdminPermission[]>(
      ADMIN_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<WafloRequest>();
    if (!request.currentAdmin) {
      throw new AppError(
        "ADMIN_AUTH_REQUIRED",
        "Administrator sign-in is required.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    for (const permission of required) {
      requireAdminPermission(request.currentAdmin.role, permission);
    }
    return true;
  }
}

@Injectable()
export class AdminCsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly environment: EnvironmentService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const adminRoute = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!adminRoute) return true;
    const request = context.switchToHttp().getRequest<WafloRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const origin = request.headers.origin;
    const csrfCookie = request.cookies[this.environment.adminCsrfCookieName];
    const csrfHeader = request.headers["x-csrf-token"];
    const validOrigin = origin === this.environment.adminOrigin;
    const validToken =
      typeof csrfCookie === "string" &&
      typeof csrfHeader === "string" &&
      safeTokenEquals(csrfCookie, csrfHeader);
    if (!validOrigin || !validToken) {
      await this.audit.security(
        {
          eventType: "admin_csrf.rejected",
          severity: "HIGH",
          metadata: { originPresent: Boolean(origin), validOrigin },
        },
        request,
      );
      throw new AppError(
        "ADMIN_CSRF_REJECTED",
        "This administrator request could not be verified.",
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}

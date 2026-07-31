import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hashOpaqueToken, isSessionActive, safeTokenEquals } from "@waflo/auth";
import { evaluateRiskRules, riskDeduplicationKey } from "@waflo/operational-analytics";
import { AppError } from "../common/app-error.js";
import { CUSTOMER_CSRF, IS_PUBLIC, RATE_LIMIT, SKIP_CSRF } from "../common/decorators.js";
import { ERROR_REPORTER, type ErrorReporter } from "../common/error-reporter.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { RateLimitService } from "./rate-limit.service.js";
import { CustomerCardService } from "../customer/customer-card.service.js";
import { CustomerSecurityService } from "../customer/customer-security.service.js";
import {
  assertBodyDigest,
  assertDeviceOperational,
  assertDeviceRequestTimestamp,
  assertTestClientAllowed,
  hashOpaqueDeviceToken,
  verifyDeviceRequestSignature,
} from "@waflo/staff-device-security";
import { STAFF_DEVICE_SIGNED } from "../common/decorators.js";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly environment: EnvironmentService,
    private readonly prisma: PrismaService,
    @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter,
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
      void this.prisma.client.session
        .update({
          where: { id: session.id },
          data: { lastActiveAt: new Date() },
        })
        .catch((error: unknown) =>
          this.reporter.captureException(error, {
            requestId: request.requestId || request.id,
            component: "api",
            operation: "session.activity_update",
          }),
        )
        .catch(() => undefined);
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
    const customerCsrf = this.reflector.getAllAndOverride<boolean | "optional">(CUSTOMER_CSRF, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (customerCsrf) return true;
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
export class CustomerCsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly environment: EnvironmentService,
    private readonly cards: CustomerCardService,
    private readonly security: CustomerSecurityService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const protectedMutation = this.reflector.getAllAndOverride<boolean | "optional">(
      CUSTOMER_CSRF,
      [context.getHandler(), context.getClass()],
    );
    if (!protectedMutation) return true;
    const request = context.switchToHttp().getRequest<WafloRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const rawSessionToken = request.cookies[this.environment.values.CUSTOMER_COOKIE_NAME];
    if (protectedMutation === "optional" && !rawSessionToken) return true;
    const developmentOverride =
      request.query &&
      typeof request.query === "object" &&
      "tenant" in request.query &&
      typeof request.query.tenant === "string"
        ? request.query.tenant
        : undefined;
    const session = await this.cards.requireSession(request, developmentOverride);
    const csrfCookie = request.cookies[this.environment.customerCsrfCookieName];
    const csrfHeader = request.headers["x-csrf-token"];
    const origin = request.headers.origin;
    const expectedOrigins = this.expectedOrigins(
      session.session.membership.organization.merchantSlug,
    );
    const validOrigin = typeof origin === "string" && expectedOrigins.includes(origin);
    const expectedToken = rawSessionToken ? this.security.customerCsrfToken(rawSessionToken) : "";
    const validToken =
      typeof csrfCookie === "string" &&
      typeof csrfHeader === "string" &&
      safeTokenEquals(csrfCookie, csrfHeader) &&
      safeTokenEquals(expectedToken, csrfHeader);
    if (!validOrigin || !validToken) {
      await this.audit.security(
        {
          organizationId: session.session.organizationId,
          eventType: "customer_csrf.rejected",
          severity: "MEDIUM",
          metadata: { originPresent: Boolean(origin), validOrigin, validToken },
        },
        request,
      );
      throw new AppError(
        "CUSTOMER_CSRF_INVALID",
        "This customer request could not be verified. Refresh the page and try again.",
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }

  private expectedOrigins(merchantSlug: string): string[] {
    const base = new URL(this.environment.values.CUSTOMER_WEB_URL);
    const merchant = new URL(base);
    merchant.hostname = `${merchantSlug}.${base.hostname}`;
    if (this.environment.values.NODE_ENV === "production") {
      return [merchant.origin];
    }
    const developmentOrigins = [base.origin, merchant.origin];
    for (const hostname of [`${merchantSlug}.localhost`, `${merchantSlug}.lvh.me`]) {
      const local = new URL(base);
      local.hostname = hostname;
      developmentOrigins.push(local.origin);
    }
    return [...new Set(developmentOrigins)];
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
    const body = request.body;
    const email =
      body && typeof body === "object" && "email" in body && typeof body.email === "string"
        ? hashOpaqueToken(body.email.trim().toLocaleLowerCase("en-US"))
        : null;
    const organizationId =
      request.params &&
      typeof request.params === "object" &&
      "organizationId" in request.params &&
      typeof request.params.organizationId === "string"
        ? request.params.organizationId
        : null;
    const signals = [
      `ip:${ip}`,
      ...(email ? [`email:${email}`] : []),
      ...(organizationId ? [`organization:${organizationId}`] : []),
      ...(request.currentUser ? [`account:${request.currentUser.id}`] : []),
    ];
    const decisions = await Promise.all(
      signals.map((signal) =>
        this.limiter.consume(`waflo:rate:${signal}:${route}`, config.limit, config.windowSeconds),
      ),
    );
    if (decisions.includes(false)) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests. Please wait and try again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

function singleHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

@Injectable()
export class StaffDeviceSignatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly environment: EnvironmentService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimitService,
  ) {}

  private async persistDeviceRisk(
    session: {
      organizationId: string;
      organizationMemberId: string;
      staffDeviceId: string;
      locationId: string;
    },
    ruleCode: string,
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    score: number,
    safeEvidence: Record<string, string | number | boolean | null>,
  ) {
    const windowStart = new Date();
    windowStart.setUTCMinutes(0, 0, 0);
    const deduplicationKey = riskDeduplicationKey({
      ruleCode,
      organizationId: session.organizationId,
      subjectId: session.staffDeviceId,
      windowStart,
    });
    await this.prisma.client.operationalRiskSignal.upsert({
      where: {
        organizationId_deduplicationKey: {
          organizationId: session.organizationId,
          deduplicationKey,
        },
      },
      create: {
        organizationId: session.organizationId,
        staffMemberId: session.organizationMemberId,
        staffDeviceId: session.staffDeviceId,
        locationId: session.locationId,
        ruleCode,
        severity,
        score,
        ruleVersion: "w4r1-v1",
        deduplicationKey,
        deduplicationWindowStart: windowStart,
        safeEvidence,
      },
      update: {},
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(STAFF_DEVICE_SIGNED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<WafloRequest>();
    const authorization = singleHeader(request.headers.authorization);
    const token = authorization.startsWith("Device ") ? authorization.slice(7) : "";
    const devicePublicId = singleHeader(request.headers["x-waflo-device-id"]);
    const deviceSessionId = singleHeader(request.headers["x-waflo-device-session-id"]);
    const requestId =
      singleHeader(request.headers["x-waflo-request-id"]) ||
      singleHeader(request.headers["x-request-id"]);
    const timestamp = singleHeader(request.headers["x-waflo-timestamp"]);
    const nonce = singleHeader(request.headers["x-waflo-nonce"]);
    const bodyDigest = singleHeader(request.headers["x-waflo-body-sha256"]);
    const signature = singleHeader(request.headers["x-waflo-signature"]);
    if (
      !token ||
      !devicePublicId ||
      !deviceSessionId ||
      !requestId ||
      !timestamp ||
      !nonce ||
      !bodyDigest ||
      !signature
    ) {
      throw new AppError(
        "STAFF_DEVICE_SIGNATURE_INVALID",
        "Signed Staff device authentication is required.",
        HttpStatus.UNAUTHORIZED,
      );
    }

    const session = await this.prisma.client.staffDeviceSession.findFirst({
      where: {
        id: deviceSessionId,
        tokenHash: hashOpaqueDeviceToken(token, this.environment.values.DEVICE_SESSION_SECRET),
        staffDevice: { publicId: devicePublicId },
      },
      include: {
        staffDevice: true,
        organizationMember: true,
      },
    });
    if (!session) {
      throw new AppError(
        "STAFF_DEVICE_NOT_ACTIVE",
        "Staff device session is not active.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      assertDeviceOperational({
        deviceStatus: session.staffDevice.status,
        sessionRevokedAt: session.revokedAt,
        sessionExpiresAt: session.expiresAt,
        memberStatus: session.organizationMember.status,
        now: new Date(),
      });
      assertTestClientAllowed({
        platform: session.staffDevice.platform,
        nodeEnvironment: this.environment.values.NODE_ENV,
        testClientEnabled: this.environment.values.TEST_STAFF_CLIENT_ENABLED,
      });
      assertDeviceRequestTimestamp({
        timestamp,
        now: new Date(),
        maximumClockSkewSeconds: this.environment.values.DEVICE_REQUEST_MAX_CLOCK_SKEW_SECONDS,
      });
      assertBodyDigest(request.rawBody ?? Buffer.alloc(0), bodyDigest);
      verifyDeviceRequestSignature({
        publicKey: session.staffDevice.publicKey,
        envelope: {
          method: request.method,
          canonicalPath: request.url.split("?")[0] ?? request.url,
          requestId,
          timestamp,
          nonce,
          bodyDigest,
          deviceSessionId,
          organizationId: session.organizationId,
        },
        signature,
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "STAFF_DEVICE_SIGNATURE_INVALID";
      await this.audit.security(
        {
          organizationId: session.organizationId,
          eventType: `staff_device.${code.toLocaleLowerCase("en-US")}`,
          severity: code === "STAFF_DEVICE_CLOCK_SKEW" ? "MEDIUM" : "HIGH",
          metadata: { devicePublicId, requestId },
        },
        request,
      );
      const ruleCode =
        code === "STAFF_DEVICE_CLOCK_SKEW"
          ? "CLOCK_SKEW"
          : code === "STAFF_DEVICE_NOT_ACTIVE"
            ? "DEVICE_NOT_ACTIVE"
            : "SIGNATURE_FAILURE";
      await this.persistDeviceRisk(
        session,
        ruleCode,
        code === "STAFF_DEVICE_CLOCK_SKEW" ? "HIGH" : "CRITICAL",
        code === "STAFF_DEVICE_CLOCK_SKEW" ? 85 : 100,
        { failureCode: code },
      );
      throw new AppError(
        code,
        "Staff device request could not be verified.",
        HttpStatus.UNAUTHORIZED,
      );
    }

    const [deviceAllowed, staffAllowed] = await Promise.all([
      this.limiter.consume(
        `waflo:staff-operation:device:${session.staffDeviceId}`,
        this.environment.values.OPERATION_RATE_LIMIT_PER_DEVICE_MINUTE,
        60,
      ),
      this.limiter.consume(
        `waflo:staff-operation:member:${session.organizationMemberId}`,
        this.environment.values.OPERATION_RATE_LIMIT_PER_STAFF_HOUR,
        3_600,
      ),
    ]);
    if (!deviceAllowed || !staffAllowed) {
      const risk = evaluateRiskRules({
        deviceOperationsLastMinute: deviceAllowed
          ? 0
          : this.environment.values.OPERATION_RATE_LIMIT_PER_DEVICE_MINUTE,
        deviceOperationLimit: this.environment.values.OPERATION_RATE_LIMIT_PER_DEVICE_MINUTE,
        staffOperationsLastHour: staffAllowed
          ? 0
          : this.environment.values.OPERATION_RATE_LIMIT_PER_STAFF_HOUR,
        staffOperationLimit: this.environment.values.OPERATION_RATE_LIMIT_PER_STAFF_HOUR,
      });
      for (const signal of risk.signals) {
        await this.persistDeviceRisk(
          session,
          signal.ruleCode,
          signal.severity,
          signal.score,
          signal.safeEvidence as Record<string, string | number | boolean | null>,
        );
      }
      throw new AppError(
        "RATE_LIMITED",
        "This Staff operation rate limit has been reached.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      await this.prisma.client.deviceRequestNonce.create({
        data: {
          staffDeviceId: session.staffDeviceId,
          nonce,
          requestTimestamp: new Date(timestamp),
          bodyDigest,
          expiresAt: new Date(
            Date.now() + this.environment.values.DEVICE_NONCE_TTL_MINUTES * 60_000,
          ),
        },
      });
    } catch {
      await this.audit.security(
        {
          organizationId: session.organizationId,
          eventType: "staff_device.nonce_replayed",
          severity: "HIGH",
          metadata: { devicePublicId, requestId },
        },
        request,
      );
      await this.persistDeviceRisk(session, "NONCE_REPLAY", "CRITICAL", 100, {
        failureCode: "STAFF_DEVICE_NONCE_REPLAYED",
      });
      throw new AppError(
        "STAFF_DEVICE_NONCE_REPLAYED",
        "This Staff device request has already been used.",
        HttpStatus.CONFLICT,
      );
    }

    request.staffDeviceContext = {
      organizationId: session.organizationId,
      organizationMemberId: session.organizationMemberId,
      role: session.organizationMember.role,
      locationId: session.locationId,
      deviceId: session.staffDeviceId,
      devicePublicId: session.staffDevice.publicId,
      deviceSessionId: session.id,
      platform: session.staffDevice.platform,
      requestId,
    };
    void this.prisma.client.staffDeviceSession
      .update({
        where: { id: session.id },
        data: { lastActiveAt: new Date(), staffDevice: { update: { lastSeenAt: new Date() } } },
      })
      .catch(() => undefined);
    return true;
  }
}

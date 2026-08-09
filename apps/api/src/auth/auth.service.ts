import { HttpStatus, Injectable } from "@nestjs/common";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  sessionExpiresAt,
  verifyPassword,
} from "@waflo/auth";
import type { Locale, RegisterInput } from "@waflo/contracts";
import type { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  type NotificationMessage,
  NotificationService,
} from "../notifications/notification.service.js";

interface SessionResult {
  rawToken: string;
  sessionId: string;
  expiresAt: Date;
}

// A valid Argon2id hash for a fixed non-secret value. It makes unknown-account
// login attempts pay the same password-verification cost as known accounts.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=1,t=3$1Js4rUmnc8rXyGhwZFkaBw$/GV+BI9qUlTYSdBdh324GSbXQ/09bI3wotF112pYVIk";

function localeFromDb(locale: "EN" | "AR"): Locale {
  return locale === "AR" ? "ar" : "en";
}

function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Chrome/")
      ? "Chrome"
      : userAgent.includes("Firefox/")
        ? "Firefox"
        : userAgent.includes("Safari/")
          ? "Safari"
          : "Browser";
  const operatingSystem = userAgent.includes("Windows")
    ? "Windows"
    : userAgent.includes("Mac OS")
      ? "macOS"
      : userAgent.includes("Android")
        ? "Android"
        : userAgent.includes("iPhone")
          ? "iPhone"
          : "device";
  return `${browser} on ${operatingSystem}`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput, request: WafloRequest) {
    const normalizedEmail = normalizeEmail(input.email);
    // Do this before checking existence to avoid a cheap registration oracle.
    const passwordHash = await hashPassword(input.password);
    const existing = await this.prisma.client.user.findUnique({ where: { normalizedEmail } });
    if (existing) {
      // Deliberately match the successful public registration response so this
      // endpoint cannot be used as an account-existence oracle.
      if (!existing.emailVerifiedAt && existing.status === "ACTIVE") {
        await this.issueVerification(
          existing.id,
          existing.email,
          localeFromDb(existing.preferredLocale),
          request,
        );
      }
      return {
        status: "verification_required",
        email: input.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2"),
      };
    }
    const legalAcceptedAt = new Date();
    const user = await this.prisma.client.user.create({
      data: {
        displayName: input.displayName,
        email: input.email,
        normalizedEmail,
        passwordHash,
        preferredLocale: input.locale === "ar" ? "AR" : "EN",
        termsVersion: this.environment.values.LEGAL_TERMS_VERSION,
        privacyVersion: this.environment.values.LEGAL_PRIVACY_VERSION,
        legalAcceptedAt,
      },
    });
    await this.audit.record(
      {
        actorUserId: user.id,
        action: "account.registered",
        targetType: "user",
        targetId: user.id,
      },
      request,
    );
    await this.issueVerification(user.id, user.email, input.locale, request);
    return {
      status: "verification_required",
      email: user.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2"),
    };
  }

  private async issueVerification(
    userId: string,
    email: string,
    locale: Locale,
    request: WafloRequest,
  ): Promise<void> {
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.environment.values.EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000,
    );
    await withInvariantLock(
      this.prisma.client,
      `verification-token:${userId}`,
      async (transaction) => {
        const now = new Date();
        await transaction.emailVerificationToken.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: now },
        });
        await transaction.emailVerificationToken.create({
          data: { userId, tokenHash: hashOpaqueToken(rawToken), expiresAt },
        });
      },
    );
    const url = `${this.environment.values.MERCHANT_DASHBOARD_URL}/${locale}/verify-email#token=${encodeURIComponent(rawToken)}`;
    await this.sendNotificationAfterCommit(
      {
        to: email,
        locale,
        kind: "email_verification",
        actionUrl: url,
      },
      userId,
      request,
    );
    await this.audit.record(
      {
        actorUserId: userId,
        action: "email.verification_requested",
        targetType: "user",
        targetId: userId,
      },
      request,
    );
  }

  async verifyEmail(rawToken: string, request: WafloRequest) {
    const now = new Date();
    const result = await this.prisma.client.$transaction(async (transaction) => {
      const token = await transaction.emailVerificationToken.findUnique({
        where: { tokenHash: hashOpaqueToken(rawToken) },
        include: { user: true },
      });
      if (!token) return { claimed: false as const, token: null };
      const claim = await transaction.emailVerificationToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claim.count !== 1) return { claimed: false as const, token };
      await transaction.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: token.user.emailVerifiedAt ?? now },
      });
      return { claimed: true as const, token };
    });
    if (!result.claimed) {
      if (result.token) {
        await this.audit.security(
          {
            userId: result.token.userId,
            eventType: "email_verification.invalid_or_reused",
            severity: "MEDIUM",
          },
          request,
        );
      }
      throw new AppError(
        "VERIFICATION_LINK_INVALID",
        "This verification link is invalid or has expired.",
        HttpStatus.GONE,
      );
    }
    await this.audit.record(
      {
        actorUserId: result.token.userId,
        action: "email.verified",
        targetType: "user",
        targetId: result.token.userId,
      },
      request,
    );
    return { status: "verified" };
  }

  async resendVerification(emailInput: string, request: WafloRequest) {
    const normalizedEmail = normalizeEmail(emailInput);
    const user = await this.prisma.client.user.findUnique({ where: { normalizedEmail } });
    if (user && !user.emailVerifiedAt) {
      await this.issueVerification(
        user.id,
        user.email,
        localeFromDb(user.preferredLocale),
        request,
      );
    }
    return {
      status: "accepted",
      message: "If verification is available for that address, a new email has been sent.",
    };
  }

  async login(emailInput: string, password: string, request: WafloRequest): Promise<SessionResult> {
    const normalizedEmail = normalizeEmail(emailInput);
    const user = await this.prisma.client.user.findUnique({ where: { normalizedEmail } });
    const passwordValid = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    if (!user || !passwordValid) {
      if (user) {
        await this.audit.security(
          {
            userId: user.id,
            eventType: "login.failed",
            severity: "LOW",
          },
          request,
        );
      }
      throw new AppError(
        "INVALID_CREDENTIALS",
        "The email or password is incorrect.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!user.emailVerifiedAt || user.status !== "ACTIVE") {
      await this.audit.security(
        { userId: user.id, eventType: "login.denied", severity: "LOW" },
        request,
      );
      throw new AppError(
        "INVALID_CREDENTIALS",
        "The email or password is incorrect.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.createSession(user.id, request);
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record(
      {
        actorUserId: user.id,
        action: "login.succeeded",
        targetType: "session",
        targetId: session.sessionId,
      },
      request,
    );
    try {
      await this.notifications.send({
        to: user.email,
        locale: localeFromDb(user.preferredLocale),
        kind: "new_login",
      });
    } catch {
      await this.audit
        .record(
          {
            actorUserId: user.id,
            action: "notification.delivery_failed",
            targetType: "user",
            targetId: user.id,
            metadata: { kind: "new_login" },
          },
          request,
        )
        .catch(() => undefined);
    }
    return session;
  }

  async createSession(
    userId: string,
    request: Pick<FastifyRequest, "headers" | "ip">,
    rotatedFromId?: string,
  ): Promise<SessionResult> {
    const rawToken = createOpaqueToken();
    const expiresAt = sessionExpiresAt(new Date(), this.environment.values.SESSION_TTL_DAYS);
    const session = await withInvariantLock(
      this.prisma.client,
      `user-auth-lifecycle:${userId}`,
      async (transaction) => {
        const user = await transaction.user.findUnique({
          where: { id: userId },
          select: { status: true },
        });
        if (user?.status !== "ACTIVE") {
          throw new AppError(
            "AUTHENTICATION_FAILED",
            "Sign-in could not be completed.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        return transaction.session.create({
          data: {
            userId,
            tokenHash: hashOpaqueToken(rawToken),
            expiresAt,
            userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
            deviceLabel: deviceLabel(request.headers["user-agent"]),
            ipMetadata: null,
            rotatedFromId: rotatedFromId ?? null,
          },
        });
      },
    );
    return { rawToken, sessionId: session.id, expiresAt };
  }

  async logout(userId: string, sessionId: string, request: WafloRequest): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: "logout" },
    });
    await this.audit.record(
      {
        actorUserId: userId,
        action: "logout",
        targetType: "session",
        targetId: sessionId,
      },
      request,
    );
  }

  async forgotPassword(emailInput: string, request: WafloRequest) {
    const user = await this.prisma.client.user.findUnique({
      where: { normalizedEmail: normalizeEmail(emailInput) },
    });
    if (user) {
      const rawToken = createOpaqueToken();
      const expiresAt = new Date(
        Date.now() + this.environment.values.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
      );
      await withInvariantLock(
        this.prisma.client,
        `password-reset-token:${user.id}`,
        async (transaction) => {
          const now = new Date();
          await transaction.passwordResetToken.updateMany({
            where: { userId: user.id, consumedAt: null },
            data: { consumedAt: now },
          });
          await transaction.passwordResetToken.create({
            data: { userId: user.id, tokenHash: hashOpaqueToken(rawToken), expiresAt },
          });
        },
      );
      await this.sendNotificationAfterCommit(
        {
          to: user.email,
          locale: localeFromDb(user.preferredLocale),
          kind: "password_reset",
          actionUrl: `${this.environment.values.MERCHANT_DASHBOARD_URL}/${localeFromDb(user.preferredLocale)}/reset-password#token=${encodeURIComponent(rawToken)}`,
        },
        user.id,
        request,
      );
      await this.audit.record(
        {
          actorUserId: user.id,
          action: "password_reset.requested",
          targetType: "user",
          targetId: user.id,
        },
        request,
      );
    }
    return {
      status: "accepted",
      message: "If the account exists, password reset instructions have been sent.",
    };
  }

  async resetPassword(rawToken: string, password: string, request: WafloRequest) {
    const passwordHash = await hashPassword(password);
    const changedAt = new Date();
    const result = await this.prisma.client.$transaction(async (transaction) => {
      const token = await transaction.passwordResetToken.findUnique({
        where: { tokenHash: hashOpaqueToken(rawToken) },
        include: { user: true },
      });
      if (!token) return { claimed: false as const, token: null };
      const claim = await transaction.passwordResetToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: changedAt } },
        data: { consumedAt: changedAt },
      });
      if (claim.count !== 1) return { claimed: false as const, token };
      await transaction.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });
      await transaction.passwordResetToken.updateMany({
        where: { userId: token.userId, consumedAt: null },
        data: { consumedAt: changedAt },
      });
      await transaction.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: changedAt, revocationReason: "password_reset" },
      });
      return { claimed: true as const, token };
    });
    if (!result.claimed) {
      if (result.token) {
        await this.audit.security(
          {
            userId: result.token.userId,
            eventType: "password_reset.invalid_or_reused",
            severity: "HIGH",
          },
          request,
        );
      }
      throw new AppError(
        "RESET_LINK_INVALID",
        "This password reset link is invalid or has expired.",
        HttpStatus.GONE,
      );
    }
    await this.audit.record(
      {
        actorUserId: result.token.userId,
        action: "password_reset.completed",
        targetType: "user",
        targetId: result.token.userId,
      },
      request,
    );
    await this.audit.security(
      {
        userId: result.token.userId,
        eventType: "password_reset.completed",
        severity: "MEDIUM",
      },
      request,
    );
    await this.sendNotificationAfterCommit(
      {
        to: result.token.user.email,
        locale: localeFromDb(result.token.user.preferredLocale),
        kind: "password_changed",
      },
      result.token.userId,
      request,
    );
    return { status: "password_reset" };
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
    request: WafloRequest,
  ): Promise<SessionResult> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppError(
        "CURRENT_PASSWORD_INVALID",
        "The current password is incorrect.",
        HttpStatus.FORBIDDEN,
      );
    }
    const changedAt = new Date();
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.client.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: changedAt, revocationReason: "password_change" },
      }),
      this.prisma.client.passwordResetToken.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: changedAt },
      }),
    ]);
    const newSession = await this.createSession(userId, request, currentSessionId);
    await this.audit.record(
      {
        actorUserId: userId,
        action: "password.changed",
        targetType: "user",
        targetId: userId,
      },
      request,
    );
    await this.audit.security(
      { userId, eventType: "password.changed", severity: "MEDIUM" },
      request,
    );
    await this.sendNotificationAfterCommit(
      {
        to: user.email,
        locale: localeFromDb(user.preferredLocale),
        kind: "password_changed",
      },
      userId,
      request,
    );
    return newSession;
  }

  async me(userId: string) {
    return this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        emailVerifiedAt: true,
        preferredLocale: true,
        lastSelectedOrganizationId: true,
        memberships: {
          where: { status: "ACTIVE", organization: { status: { not: "ARCHIVED" } } },
          select: {
            id: true,
            role: true,
            organization: {
              select: {
                id: true,
                name: true,
                merchantSlug: true,
                defaultLocale: true,
                selectedPlan: true,
                onboardingState: true,
              },
            },
          },
        },
      },
    });
  }

  async updateMe(
    userId: string,
    input: {
      displayName?: string | undefined;
      preferredLocale?: "en" | "ar" | undefined;
    },
  ) {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.preferredLocale
          ? { preferredLocale: input.preferredLocale === "ar" ? "AR" : "EN" }
          : {}),
      },
      select: { id: true, displayName: true, email: true, preferredLocale: true },
    });
  }

  async sessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.client.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        deviceLabel: true,
        userAgent: true,
        createdAt: true,
        lastActiveAt: true,
        expiresAt: true,
      },
      orderBy: { lastActiveAt: "desc" },
    });
    return sessions.map(
      (session: {
        id: string;
        deviceLabel: string | null;
        userAgent: string | null;
        createdAt: Date;
        lastActiveAt: Date;
        expiresAt: Date;
      }) => ({ ...session, current: session.id === currentSessionId }),
    );
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    currentSessionId: string,
    request: WafloRequest,
  ): Promise<{ currentSessionRevoked: boolean }> {
    const session = await this.prisma.client.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new AppError(
        "SESSION_NOT_FOUND",
        "That session is no longer available.",
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.client.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revocationReason: "manual_revocation" },
    });
    await this.audit.record(
      {
        actorUserId: userId,
        action: "session.revoked",
        targetType: "session",
        targetId: session.id,
      },
      request,
    );
    await this.audit.security({ userId, eventType: "session.revoked", severity: "LOW" }, request);
    return { currentSessionRevoked: session.id === currentSessionId };
  }

  async revokeOthers(userId: string, currentSessionId: string, request: WafloRequest) {
    const result = await this.prisma.client.session.updateMany({
      where: { userId, id: { not: currentSessionId }, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: "revoke_other_sessions" },
    });
    await this.audit.record(
      {
        actorUserId: userId,
        action: "sessions.others_revoked",
        targetType: "user",
        targetId: userId,
        metadata: { count: result.count },
      },
      request,
    );
    return { revoked: result.count };
  }

  async revokeAll(userId: string, request: WafloRequest) {
    const result = await this.prisma.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: "revoke_all_sessions" },
    });
    await this.audit.record(
      {
        actorUserId: userId,
        action: "sessions.all_revoked",
        targetType: "user",
        targetId: userId,
        metadata: { count: result.count },
      },
      request,
    );
    await this.audit.security(
      { userId, eventType: "sessions.all_revoked", severity: "MEDIUM" },
      request,
    );
    return { revoked: result.count };
  }

  async requestAccountLifecycle(
    userId: string,
    requestType: "DEACTIVATION" | "DELETION",
    input: {
      commandId: string;
      sessionId: string;
      confirmation: string;
      currentPassword?: string | undefined;
    },
    request: WafloRequest,
  ) {
    const expected = requestType === "DELETION" ? "REQUEST DELETION" : "DEACTIVATE";
    if (input.confirmation !== expected) {
      throw new AppError(
        "SENSITIVE_ACTION_CONFIRMATION_FAILED",
        "Account confirmation did not match.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    const recentExternalSession = !user.passwordHash
      ? await this.prisma.client.session.findFirst({
          where: {
            id: input.sessionId,
            userId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
            createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) },
          },
          select: { id: true },
        })
      : null;
    if (
      user.passwordHash
        ? !input.currentPassword ||
          !(await verifyPassword(user.passwordHash, input.currentPassword))
        : !recentExternalSession
    ) {
      throw new AppError(
        "REAUTHENTICATION_REQUIRED",
        "Re-enter your password to continue.",
        HttpStatus.FORBIDDEN,
      );
    }
    const existing = await this.prisma.client.merchantAccountLifecycleRequest.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.commandId } },
    });
    if (existing) {
      if (existing.requestType !== requestType) {
        throw new AppError(
          "OPERATION_IDEMPOTENCY_CONFLICT",
          "Command conflict.",
          HttpStatus.CONFLICT,
        );
      }
      return {
        publicId: existing.id,
        status: existing.status,
        outcomeDisposition: existing.outcomeDisposition,
        retentionNoticeCode: existing.retentionNoticeCode,
        replayed: true,
      };
    }
    const now = new Date();
    const created = await withInvariantLock(
      this.prisma.client,
      `user-auth-lifecycle:${userId}`,
      async (transaction) => {
        const lifecycle = await transaction.merchantAccountLifecycleRequest.create({
          data: {
            userId,
            requestType,
            idempotencyKey: input.commandId,
            identityValidatedAt: now,
          },
        });
        await transaction.user.update({
          where: { id: userId },
          data: {
            status: "DEACTIVATED",
            deactivatedAt: now,
            ...(requestType === "DELETION" ? { deletionRequestedAt: now } : {}),
          },
        });
        await transaction.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now, revocationReason: "account_deactivated" },
        });
        await transaction.oAuthAuthorizationRequest.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: now },
        });
        await transaction.emailVerificationToken.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: now },
        });
        await transaction.passwordResetToken.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: now },
        });
        const finalized = await transaction.merchantAccountLifecycleRequest.update({
          where: { id: lifecycle.id },
          data: {
            status: "COMPLETED",
            completedAt: now,
            ...(requestType === "DELETION"
              ? {
                  outcomeDisposition: "RETAINED_BY_POLICY",
                  retentionNoticeCode: "ACCOUNT_DISABLED_PENDING_POLICY_PROCESSING",
                }
              : {}),
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            actorUserId: userId,
            action:
              requestType === "DELETION" ? "account.deletion_requested" : "account.deactivated",
            targetType: "user",
            targetId: userId,
            metadata: {
              sessionsRevoked: true,
              externalIdentitiesRetainedAsRevokedAccountTombstones: true,
            },
          },
          request,
        );
        return finalized;
      },
    );
    return {
      publicId: created.id,
      status: created.status,
      outcomeDisposition: created.outcomeDisposition,
      retentionNoticeCode: created.retentionNoticeCode,
      replayed: false,
    };
  }

  private async sendNotificationAfterCommit(
    message: NotificationMessage,
    userId: string,
    request: WafloRequest,
  ): Promise<void> {
    try {
      await this.notifications.send(message);
    } catch {
      await this.audit
        .record(
          {
            actorUserId: userId,
            action: "notification.delivery_failed",
            targetType: "user",
            targetId: userId,
            metadata: { kind: message.kind, businessMutationCommitted: true },
          },
          request,
        )
        .catch(() => undefined);
    }
  }
}

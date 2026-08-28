import { HttpStatus, Injectable } from "@nestjs/common";
import { createOpaqueToken, hashOpaqueToken, normalizeEmail, verifyPassword } from "@waflo/auth";
import type { AdminUser } from "@waflo/database";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { permissionsForAdminRole } from "./admin-rbac.js";

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=1,t=3$1Js4rUmnc8rXyGhwZFkaBw$/GV+BI9qUlTYSdBdh324GSbXQ/09bI3wotF112pYVIk";

export function safeAdminIdentity(
  admin: Pick<AdminUser, "publicId" | "displayName" | "preferredLocale" | "role" | "lastLoginAt">,
) {
  return {
    publicId: admin.publicId,
    displayName: admin.displayName,
    preferredLocale: admin.preferredLocale === "AR" ? ("ar" as const) : ("en" as const),
    role: admin.role,
    permissions: permissionsForAdminRole(admin.role),
    lastLoginAt: admin.lastLoginAt,
  };
}

export interface AdminSessionResult {
  rawToken: string;
  sessionId: string;
  expiresAt: Date;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, request: WafloRequest): Promise<AdminSessionResult> {
    const admin = await this.prisma.client.adminUser.findUnique({
      where: { normalizedEmail: normalizeEmail(email) },
    });
    const passwordValid = await verifyPassword(
      admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (!admin || !passwordValid || admin.status !== "ACTIVE") {
      throw new AppError(
        "ADMIN_INVALID_CREDENTIALS",
        "The email or password is incorrect.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.environment.values.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000,
    );
    const session = await this.prisma.client.$transaction(async (transaction) => {
      const current = await transaction.adminUser.findUnique({
        where: { id: admin.id },
        select: { status: true },
      });
      if (current?.status !== "ACTIVE") {
        throw new AppError(
          "ADMIN_INVALID_CREDENTIALS",
          "The email or password is incorrect.",
          HttpStatus.UNAUTHORIZED,
        );
      }
      const created = await transaction.adminSession.create({
        data: {
          adminUserId: admin.id,
          tokenHash: hashOpaqueToken(rawToken),
          expiresAt,
          userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
          ipMetadata: null,
        },
      });
      await transaction.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      });
      return created;
    });
    await this.audit.record(
      {
        actorAdminUserId: admin.id,
        action: "admin.login.succeeded",
        targetType: "admin_session",
        targetId: session.id,
      },
      request,
    );
    return { rawToken, sessionId: session.id, expiresAt };
  }

  async me(adminId: string, sessionId: string) {
    const admin = await this.prisma.client.adminUser.findFirst({
      where: { id: adminId, status: "ACTIVE" },
    });
    if (!admin) {
      throw new AppError(
        "ADMIN_SESSION_EXPIRED",
        "Your administrator session has expired.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.prisma.client.adminSession.findFirst({
      where: { id: sessionId, adminUserId: admin.id, revokedAt: null },
      select: { createdAt: true, expiresAt: true, lastActiveAt: true },
    });
    if (!session) {
      throw new AppError(
        "ADMIN_SESSION_EXPIRED",
        "Your administrator session has expired.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    return { ...safeAdminIdentity(admin), session };
  }

  async logout(adminId: string, sessionId: string, request: WafloRequest): Promise<void> {
    await this.prisma.client.adminSession.updateMany({
      where: { id: sessionId, adminUserId: adminId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: "logout" },
    });
    await this.audit.record(
      {
        actorAdminUserId: adminId,
        action: "admin.logout",
        targetType: "admin_session",
        targetId: sessionId,
      },
      request,
    );
  }
}

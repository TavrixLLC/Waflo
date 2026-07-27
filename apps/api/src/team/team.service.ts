import { HttpStatus, Injectable } from "@nestjs/common";
import { createOpaqueToken, hashOpaqueToken, normalizeEmail } from "@waflo/auth";
import { canInviteTeamMember } from "@waflo/billing";
import type { MemberRole } from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import { allowedInvitationRoles, assertRoleAssignment, canManageMember } from "@waflo/permissions";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

function toPlanCode(plan: "STARTER" | "GROWTH" | "SCALE"): "starter" | "growth" | "scale" {
  return plan.toLocaleLowerCase("en-US") as "starter" | "growth" | "scale";
}

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly environment: EnvironmentService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, organizationId: string) {
    const membership = await this.tenant.requireMembership(userId, organizationId, "team.view");
    const now = new Date();
    const [members, invitations, activeSeatCount, pendingSeatCount] = await Promise.all([
      this.prisma.client.organizationMember.findMany({
        where: { organizationId, status: { not: "REMOVED" } },
        select: {
          id: true,
          role: true,
          status: true,
          joinedAt: true,
          user: { select: { id: true, displayName: true, email: true, preferredLocale: true } },
        },
        orderBy: { joinedAt: "asc" },
      }),
      this.prisma.client.organizationInvitation.findMany({
        where: {
          organizationId,
          acceptedAt: null,
          canceledAt: null,
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          email: true,
          intendedRole: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.client.organizationMember.count({
        where: {
          organizationId,
          status: "ACTIVE",
          role: { in: ["MANAGER", "STAFF"] },
        },
      }),
      this.prisma.client.organizationInvitation.count({
        where: {
          organizationId,
          acceptedAt: null,
          canceledAt: null,
          expiresAt: { gt: now },
          intendedRole: { in: ["MANAGER", "STAFF"] },
        },
      }),
    ]);
    const plan = toPlanCode(membership.organization.selectedPlan);
    const usage = canInviteTeamMember(
      plan,
      activeSeatCount + pendingSeatCount,
      plan === "scale" ? this.environment.values.SCALE_TEAM_LIMIT : undefined,
    );
    return { members, invitations, usage };
  }

  private async currentSeatUsage(organizationId: string): Promise<number> {
    const now = new Date();
    const [active, pending] = await Promise.all([
      this.prisma.client.organizationMember.count({
        where: {
          organizationId,
          status: "ACTIVE",
          role: { in: ["MANAGER", "STAFF"] },
        },
      }),
      this.prisma.client.organizationInvitation.count({
        where: {
          organizationId,
          acceptedAt: null,
          canceledAt: null,
          expiresAt: { gt: now },
          intendedRole: { in: ["MANAGER", "STAFF"] },
        },
      }),
    ]);
    return active + pending;
  }

  async invite(
    userId: string,
    organizationId: string,
    emailInput: string,
    role: "MANAGER" | "STAFF",
    request: WafloRequest,
  ) {
    const membership = await this.tenant.requireMembership(userId, organizationId, "team.invite");
    if (!allowedInvitationRoles(membership.role as MemberRole).includes(role)) {
      throw new AppError(
        "INVITATION_ROLE_FORBIDDEN",
        "Your role cannot invite this team role.",
        HttpStatus.FORBIDDEN,
      );
    }
    const normalizedEmail = normalizeEmail(emailInput);
    const activeMember = await this.prisma.client.organizationMember.findFirst({
      where: {
        organizationId,
        user: { normalizedEmail },
        status: { not: "REMOVED" },
      },
    });
    if (activeMember) {
      throw new AppError(
        "ALREADY_A_MEMBER",
        "This person already belongs to the organization.",
        HttpStatus.CONFLICT,
      );
    }
    const duplicate = await this.prisma.client.organizationInvitation.findFirst({
      where: {
        organizationId,
        normalizedEmail,
        acceptedAt: null,
        canceledAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (duplicate) {
      throw new AppError(
        "ACTIVE_INVITATION_EXISTS",
        "An active invitation already exists for this email.",
        HttpStatus.CONFLICT,
      );
    }
    const plan = toPlanCode(membership.organization.selectedPlan);
    const usage = await this.currentSeatUsage(organizationId);
    const decision = canInviteTeamMember(
      plan,
      usage,
      plan === "scale" ? this.environment.values.SCALE_TEAM_LIMIT : undefined,
    );
    if (!decision.allowed) {
      throw new AppError(
        "TEAM_LIMIT_REACHED",
        "Your current plan has reached its team seat limit.",
        HttpStatus.CONFLICT,
        {
          limit: decision.limit,
          currentUsage: decision.currentUsage,
          recommendedPlan: decision.recommendedPlan,
        },
      );
    }
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.environment.values.INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const invitation = await this.prisma.client.organizationInvitation.create({
      data: {
        organizationId,
        email: emailInput,
        normalizedEmail,
        intendedRole: role,
        tokenHash: hashOpaqueToken(rawToken),
        invitedByUserId: userId,
        expiresAt,
      },
      include: { organization: true },
    });
    const locale = invitation.organization.defaultLocale === "AR" ? "ar" : "en";
    await this.notifications.send({
      to: invitation.email,
      locale,
      kind: "team_invitation",
      organizationName: invitation.organization.name,
      actionUrl: `${this.environment.values.MERCHANT_DASHBOARD_URL}/${locale}/invite/${encodeURIComponent(rawToken)}`,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "invitation.created",
        targetType: "invitation",
        targetId: invitation.id,
        metadata: { role },
      },
      request,
    );
    return {
      id: invitation.id,
      email: invitation.email,
      intendedRole: invitation.intendedRole,
      expiresAt: invitation.expiresAt,
    };
  }

  async resend(
    userId: string,
    organizationId: string,
    invitationId: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "team.invite");
    const invitation = await this.prisma.client.organizationInvitation.findFirst({
      where: { id: invitationId, organizationId, acceptedAt: null, canceledAt: null },
      include: { organization: true },
    });
    if (!invitation) {
      throw new AppError(
        "INVITATION_NOT_FOUND",
        "This invitation is no longer available.",
        HttpStatus.NOT_FOUND,
      );
    }
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.environment.values.INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.client.organizationInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: hashOpaqueToken(rawToken), expiresAt },
    });
    const locale = invitation.organization.defaultLocale === "AR" ? "ar" : "en";
    await this.notifications.send({
      to: invitation.email,
      locale,
      kind: "team_invitation",
      organizationName: invitation.organization.name,
      actionUrl: `${this.environment.values.MERCHANT_DASHBOARD_URL}/${locale}/invite/${encodeURIComponent(rawToken)}`,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "invitation.resent",
        targetType: "invitation",
        targetId: invitation.id,
      },
      request,
    );
    return { id: invitation.id, expiresAt };
  }

  async cancel(
    userId: string,
    organizationId: string,
    invitationId: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "team.invite");
    const result = await this.prisma.client.organizationInvitation.updateMany({
      where: { id: invitationId, organizationId, acceptedAt: null, canceledAt: null },
      data: { canceledAt: new Date() },
    });
    if (result.count === 0) {
      throw new AppError(
        "INVITATION_NOT_FOUND",
        "This invitation is no longer available.",
        HttpStatus.NOT_FOUND,
      );
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "invitation.canceled",
        targetType: "invitation",
        targetId: invitationId,
      },
      request,
    );
    return { status: "canceled" };
  }

  async inspect(rawToken: string) {
    const invitation = await this.prisma.client.organizationInvitation.findUnique({
      where: { tokenHash: hashOpaqueToken(rawToken) },
      include: { organization: { select: { name: true, defaultLocale: true } } },
    });
    if (!invitation || invitation.canceledAt) {
      throw new AppError(
        "INVITATION_UNAVAILABLE",
        "This invitation is unavailable.",
        HttpStatus.GONE,
      );
    }
    if (invitation.acceptedAt) {
      throw new AppError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation has already been accepted.",
        HttpStatus.GONE,
      );
    }
    if (invitation.expiresAt <= new Date()) {
      throw new AppError("INVITATION_EXPIRED", "This invitation has expired.", HttpStatus.GONE);
    }
    return {
      organizationName: invitation.organization.name,
      role: invitation.intendedRole,
      invitedEmail: invitation.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2"),
      locale: invitation.organization.defaultLocale,
      expiresAt: invitation.expiresAt,
    };
  }

  async accept(userId: string, rawToken: string, request: WafloRequest) {
    const invitation = await this.prisma.client.organizationInvitation.findUnique({
      where: { tokenHash: hashOpaqueToken(rawToken) },
      include: { organization: true, invitedBy: true },
    });
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (!invitation || invitation.canceledAt) {
      throw new AppError("INVITATION_CANCELED", "This invitation is unavailable.", HttpStatus.GONE);
    }
    if (invitation.acceptedAt) {
      throw new AppError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation has already been accepted.",
        HttpStatus.GONE,
      );
    }
    if (invitation.expiresAt <= new Date()) {
      throw new AppError("INVITATION_EXPIRED", "This invitation has expired.", HttpStatus.GONE);
    }
    if (!user.emailVerifiedAt) {
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verify your email before accepting this invitation.",
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.normalizedEmail !== invitation.normalizedEmail) {
      throw new AppError(
        "INVITATION_EMAIL_MISMATCH",
        "Sign in with the email address that received this invitation.",
        HttpStatus.FORBIDDEN,
      );
    }
    await this.prisma.client.$transaction(async (transaction: Prisma.TransactionClient) => {
      await transaction.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId },
        },
        update: {
          role: invitation.intendedRole,
          status: "ACTIVE",
          joinedAt: new Date(),
        },
        create: {
          organizationId: invitation.organizationId,
          userId,
          role: invitation.intendedRole,
        },
      });
      await transaction.organizationInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await transaction.user.update({
        where: { id: userId },
        data: { lastSelectedOrganizationId: invitation.organizationId },
      });
    });
    await this.audit.record(
      {
        organizationId: invitation.organizationId,
        actorUserId: userId,
        action: "invitation.accepted",
        targetType: "invitation",
        targetId: invitation.id,
      },
      request,
    );
    await this.notifications.send({
      to: invitation.invitedBy.email,
      locale: invitation.invitedBy.preferredLocale === "AR" ? "ar" : "en",
      kind: "invitation_accepted",
      organizationName: invitation.organization.name,
    });
    return { organizationId: invitation.organizationId, role: invitation.intendedRole };
  }

  async updateMember(
    userId: string,
    organizationId: string,
    memberId: string,
    input: {
      role?: MemberRole | undefined;
      status?: "ACTIVE" | "SUSPENDED" | undefined;
    },
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(userId, organizationId, "team.view");
    const target = await this.prisma.client.organizationMember.findFirst({
      where: { id: memberId, organizationId, status: { not: "REMOVED" } },
    });
    if (!target) {
      throw new AppError("MEMBER_NOT_FOUND", "Team member not found.", HttpStatus.NOT_FOUND);
    }
    if (!canManageMember(actor.role as MemberRole, target.role as MemberRole)) {
      throw new AppError(
        "MEMBER_MANAGEMENT_FORBIDDEN",
        "Your role cannot manage this team member.",
        HttpStatus.FORBIDDEN,
      );
    }
    if (input.role) {
      if (!assertRoleAssignment(actor.role as MemberRole, input.role)) {
        throw new AppError(
          "ROLE_ASSIGNMENT_FORBIDDEN",
          "This role assignment is not allowed.",
          HttpStatus.FORBIDDEN,
        );
      }
      if (target.role === "OWNER") {
        await this.ensureNotFinalOwner(organizationId, target.id);
      }
    }
    const updated = await this.prisma.client.organizationMember.update({
      where: { id: target.id },
      data: {
        ...(input.role ? { role: input.role } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: input.role ? "member.role_changed" : "member.status_changed",
        targetType: "organization_member",
        targetId: target.id,
        metadata: { role: input.role, status: input.status },
      },
      request,
    );
    return updated;
  }

  async removeMember(
    userId: string,
    organizationId: string,
    memberId: string,
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(userId, organizationId, "team.remove");
    const target = await this.prisma.client.organizationMember.findFirst({
      where: { id: memberId, organizationId, status: { not: "REMOVED" } },
    });
    if (!target) {
      throw new AppError("MEMBER_NOT_FOUND", "Team member not found.", HttpStatus.NOT_FOUND);
    }
    if (!canManageMember(actor.role as MemberRole, target.role as MemberRole)) {
      throw new AppError(
        "MEMBER_REMOVAL_FORBIDDEN",
        "Your role cannot remove this team member.",
        HttpStatus.FORBIDDEN,
      );
    }
    if (target.role === "OWNER") await this.ensureNotFinalOwner(organizationId, target.id);
    await this.prisma.client.organizationMember.update({
      where: { id: target.id },
      data: { status: "REMOVED" },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "member.removed",
        targetType: "organization_member",
        targetId: target.id,
      },
      request,
    );
    return { status: "removed" };
  }

  private async ensureNotFinalOwner(organizationId: string, memberId: string): Promise<void> {
    const activeOwners = await this.prisma.client.organizationMember.count({
      where: { organizationId, role: "OWNER", status: "ACTIVE", id: { not: memberId } },
    });
    if (activeOwners < 1) {
      throw new AppError(
        "LAST_OWNER_PROTECTED",
        "The final active Owner cannot be removed or demoted.",
        HttpStatus.CONFLICT,
      );
    }
  }
}

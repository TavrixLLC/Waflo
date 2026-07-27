import { HttpStatus, Injectable } from "@nestjs/common";
import { createOpaqueToken, hashOpaqueToken, normalizeEmail } from "@waflo/auth";
import { canInviteTeamMember } from "@waflo/billing";
import type { MemberRole } from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import { allowedInvitationRoles, assertRoleAssignment, canManageMember } from "@waflo/permissions";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withOrganizationInvariantLock } from "../common/organization-transaction.js";
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
          status: "PENDING",
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
          status: "PENDING",
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

  private async currentSeatUsage(
    transaction: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<number> {
    const now = new Date();
    const [active, pending] = await Promise.all([
      transaction.organizationMember.count({
        where: {
          organizationId,
          status: "ACTIVE",
          role: { in: ["MANAGER", "STAFF"] },
        },
      }),
      transaction.organizationInvitation.count({
        where: {
          organizationId,
          status: "PENDING",
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
    const initialMembership = await this.tenant.requireMembership(
      userId,
      organizationId,
      "team.invite",
    );
    if (!allowedInvitationRoles(initialMembership.role as MemberRole).includes(role)) {
      throw new AppError(
        "INVITATION_ROLE_FORBIDDEN",
        "Your role cannot invite this team role.",
        HttpStatus.FORBIDDEN,
      );
    }
    const normalizedEmail = normalizeEmail(emailInput);
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.environment.values.INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const invitation = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const now = new Date();
        const actor = await transaction.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
        });
        if (
          actor?.status !== "ACTIVE" ||
          !allowedInvitationRoles(actor.role as MemberRole).includes(role)
        ) {
          throw new AppError(
            "INVITATION_ROLE_FORBIDDEN",
            "Your role cannot invite this team role.",
            HttpStatus.FORBIDDEN,
          );
        }
        await transaction.organizationInvitation.updateMany({
          where: { organizationId, status: "PENDING", expiresAt: { lte: now } },
          data: { status: "EXPIRED" },
        });
        const existingMember = await transaction.organizationMember.findFirst({
          where: {
            organizationId,
            user: { normalizedEmail },
            status: { not: "REMOVED" },
          },
        });
        if (existingMember) {
          throw new AppError(
            "ALREADY_A_MEMBER",
            "This person already belongs to the organization.",
            HttpStatus.CONFLICT,
          );
        }
        const duplicate = await transaction.organizationInvitation.findFirst({
          where: { organizationId, normalizedEmail, status: "PENDING" },
        });
        if (duplicate) {
          throw new AppError(
            "ACTIVE_INVITATION_EXISTS",
            "An active invitation already exists for this email.",
            HttpStatus.CONFLICT,
          );
        }
        const organization = await transaction.organization.findUniqueOrThrow({
          where: { id: organizationId },
        });
        const plan = toPlanCode(organization.selectedPlan);
        const usage = await this.currentSeatUsage(transaction, organizationId);
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
        return transaction.organizationInvitation.create({
          data: {
            organizationId,
            email: emailInput,
            normalizedEmail,
            intendedRole: role,
            tokenHash: hashOpaqueToken(rawToken),
            invitedByUserId: userId,
            expiresAt,
            status: "PENDING",
          },
          include: { organization: true },
        });
      },
    );
    const locale = invitation.organization.defaultLocale === "AR" ? "ar" : "en";
    await this.notifications.send({
      to: invitation.email,
      locale,
      kind: "team_invitation",
      organizationName: invitation.organization.name,
      actionUrl: `${this.environment.values.MERCHANT_DASHBOARD_URL}/${locale}/invite?token=${encodeURIComponent(rawToken)}`,
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
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.environment.values.INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const invitation = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const now = new Date();
        await transaction.organizationInvitation.updateMany({
          where: { organizationId, status: "PENDING", expiresAt: { lte: now } },
          data: { status: "EXPIRED" },
        });
        const [actor, current] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
          }),
          transaction.organizationInvitation.findFirst({
            where: { id: invitationId, organizationId },
            include: { organization: true },
          }),
        ]);
        if (
          actor?.status !== "ACTIVE" ||
          !current ||
          current.status === "ACCEPTED" ||
          current.status === "CANCELED"
        ) {
          throw new AppError(
            "INVITATION_NOT_FOUND",
            "This invitation is no longer available.",
            HttpStatus.NOT_FOUND,
          );
        }
        if (
          !allowedInvitationRoles(actor.role as MemberRole).includes(
            current.intendedRole as MemberRole,
          )
        ) {
          throw new AppError(
            "INVITATION_MANAGEMENT_FORBIDDEN",
            "Your role cannot manage this invitation.",
            HttpStatus.FORBIDDEN,
          );
        }
        if (current.status === "EXPIRED") {
          const organization = current.organization;
          const plan = toPlanCode(organization.selectedPlan);
          const usage = await this.currentSeatUsage(transaction, organizationId);
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
        }
        return transaction.organizationInvitation.update({
          where: { id: current.id },
          data: {
            tokenHash: hashOpaqueToken(rawToken),
            expiresAt,
            status: "PENDING",
            acceptedAt: null,
            canceledAt: null,
          },
          include: { organization: true },
        });
      },
    );
    const locale = invitation.organization.defaultLocale === "AR" ? "ar" : "en";
    await this.notifications.send({
      to: invitation.email,
      locale,
      kind: "team_invitation",
      organizationName: invitation.organization.name,
      actionUrl: `${this.environment.values.MERCHANT_DASHBOARD_URL}/${locale}/invite?token=${encodeURIComponent(rawToken)}`,
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
    await withOrganizationInvariantLock(this.prisma.client, organizationId, async (transaction) => {
      const now = new Date();
      await transaction.organizationInvitation.updateMany({
        where: { organizationId, status: "PENDING", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      const [actor, invitation] = await Promise.all([
        transaction.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
        }),
        transaction.organizationInvitation.findFirst({
          where: { id: invitationId, organizationId, status: "PENDING" },
        }),
      ]);
      if (!invitation || actor?.status !== "ACTIVE") {
        throw new AppError(
          "INVITATION_NOT_FOUND",
          "This invitation is no longer available.",
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        !allowedInvitationRoles(actor.role as MemberRole).includes(
          invitation.intendedRole as MemberRole,
        )
      ) {
        throw new AppError(
          "INVITATION_MANAGEMENT_FORBIDDEN",
          "Your role cannot manage this invitation.",
          HttpStatus.FORBIDDEN,
        );
      }
      const result = await transaction.organizationInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { status: "CANCELED", canceledAt: now },
      });
      if (result.count !== 1) {
        throw new AppError(
          "INVITATION_NOT_FOUND",
          "This invitation is no longer available.",
          HttpStatus.NOT_FOUND,
        );
      }
    });
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
    if (!invitation || invitation.status === "CANCELED") {
      throw new AppError(
        "INVITATION_UNAVAILABLE",
        "This invitation is unavailable.",
        HttpStatus.GONE,
      );
    }
    if (invitation.status === "ACCEPTED") {
      throw new AppError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation has already been accepted.",
        HttpStatus.GONE,
      );
    }
    if (invitation.status === "EXPIRED" || invitation.expiresAt <= new Date()) {
      if (invitation.status === "PENDING") {
        await this.prisma.client.organizationInvitation.updateMany({
          where: { id: invitation.id, status: "PENDING", expiresAt: { lte: new Date() } },
          data: { status: "EXPIRED" },
        });
      }
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
    const invitationReference = await this.prisma.client.organizationInvitation.findUnique({
      where: { tokenHash: hashOpaqueToken(rawToken) },
      select: { organizationId: true },
    });
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (!invitationReference) {
      throw new AppError("INVITATION_CANCELED", "This invitation is unavailable.", HttpStatus.GONE);
    }
    if (!user.emailVerifiedAt) {
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verify your email before accepting this invitation.",
        HttpStatus.FORBIDDEN,
      );
    }
    const outcome = await withOrganizationInvariantLock(
      this.prisma.client,
      invitationReference.organizationId,
      async (transaction) => {
        const invitation = await transaction.organizationInvitation.findUnique({
          where: { tokenHash: hashOpaqueToken(rawToken) },
          include: { organization: true, invitedBy: true },
        });
        if (!invitation || invitation.status === "CANCELED") {
          return { kind: "canceled" as const };
        }
        if (invitation.status === "ACCEPTED") {
          return { kind: "accepted" as const };
        }
        const now = new Date();
        if (invitation.status === "EXPIRED" || invitation.expiresAt <= now) {
          await transaction.organizationInvitation.updateMany({
            where: { id: invitation.id, status: "PENDING", expiresAt: { lte: now } },
            data: { status: "EXPIRED" },
          });
          return { kind: "expired" as const };
        }
        if (user.normalizedEmail !== invitation.normalizedEmail) {
          return { kind: "email_mismatch" as const };
        }
        const claim = await transaction.organizationInvitation.updateMany({
          where: {
            id: invitation.id,
            status: "PENDING",
            acceptedAt: null,
            canceledAt: null,
            expiresAt: { gt: now },
          },
          data: { status: "ACCEPTED", acceptedAt: now },
        });
        if (claim.count !== 1) return { kind: "accepted" as const };
        await transaction.organizationMember.upsert({
          where: {
            organizationId_userId: { organizationId: invitation.organizationId, userId },
          },
          update: {
            role: invitation.intendedRole,
            status: "ACTIVE",
            joinedAt: now,
          },
          create: {
            organizationId: invitation.organizationId,
            userId,
            role: invitation.intendedRole,
          },
        });
        await transaction.user.update({
          where: { id: userId },
          data: { lastSelectedOrganizationId: invitation.organizationId },
        });
        return { kind: "success" as const, invitation };
      },
    );
    if (outcome.kind === "canceled") {
      throw new AppError("INVITATION_CANCELED", "This invitation is unavailable.", HttpStatus.GONE);
    }
    if (outcome.kind === "accepted") {
      throw new AppError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation has already been accepted.",
        HttpStatus.GONE,
      );
    }
    if (outcome.kind === "expired") {
      throw new AppError("INVITATION_EXPIRED", "This invitation has expired.", HttpStatus.GONE);
    }
    if (outcome.kind === "email_mismatch") {
      throw new AppError(
        "INVITATION_EMAIL_MISMATCH",
        "Sign in with the email address that received this invitation.",
        HttpStatus.FORBIDDEN,
      );
    }
    const invitation = outcome.invitation;
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
    await this.tenant.requireMembership(userId, organizationId, "team.view");
    const updated = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const [actor, target, organization] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
          }),
          transaction.organizationMember.findFirst({
            where: { id: memberId, organizationId, status: { not: "REMOVED" } },
          }),
          transaction.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        ]);
        if (!target) {
          throw new AppError("MEMBER_NOT_FOUND", "Team member not found.", HttpStatus.NOT_FOUND);
        }
        if (
          actor?.status !== "ACTIVE" ||
          !canManageMember(actor.role as MemberRole, target.role as MemberRole)
        ) {
          throw new AppError(
            "MEMBER_MANAGEMENT_FORBIDDEN",
            "Your role cannot manage this team member.",
            HttpStatus.FORBIDDEN,
          );
        }
        if (input.role && !assertRoleAssignment(actor.role as MemberRole, input.role)) {
          throw new AppError(
            "ROLE_ASSIGNMENT_FORBIDDEN",
            "This role assignment is not allowed.",
            HttpStatus.FORBIDDEN,
          );
        }
        const removesActiveOwner =
          target.role === "OWNER" &&
          target.status === "ACTIVE" &&
          ((input.role !== undefined && input.role !== "OWNER") ||
            (input.status !== undefined && input.status !== "ACTIVE"));
        if (removesActiveOwner) {
          await this.ensureNotFinalOwner(transaction, organizationId, target.id);
        }
        const effectiveRole = input.role ?? (target.role as MemberRole);
        const reactivatesSeat =
          target.status !== "ACTIVE" &&
          input.status === "ACTIVE" &&
          (effectiveRole === "MANAGER" || effectiveRole === "STAFF");
        if (reactivatesSeat) {
          const plan = toPlanCode(organization.selectedPlan);
          const usage = await this.currentSeatUsage(transaction, organizationId);
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
        }
        return transaction.organizationMember.update({
          where: { id: target.id },
          data: {
            ...(input.role ? { role: input.role } : {}),
            ...(input.status ? { status: input.status } : {}),
          },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: input.role ? "member.role_changed" : "member.status_changed",
        targetType: "organization_member",
        targetId: updated.id,
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
    await this.tenant.requireMembership(userId, organizationId, "team.remove");
    const target = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const [actor, current] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
          }),
          transaction.organizationMember.findFirst({
            where: { id: memberId, organizationId, status: { not: "REMOVED" } },
          }),
        ]);
        if (!current) {
          throw new AppError("MEMBER_NOT_FOUND", "Team member not found.", HttpStatus.NOT_FOUND);
        }
        if (
          actor?.status !== "ACTIVE" ||
          !canManageMember(actor.role as MemberRole, current.role as MemberRole)
        ) {
          throw new AppError(
            "MEMBER_REMOVAL_FORBIDDEN",
            "Your role cannot remove this team member.",
            HttpStatus.FORBIDDEN,
          );
        }
        if (current.role === "OWNER" && current.status === "ACTIVE") {
          await this.ensureNotFinalOwner(transaction, organizationId, current.id);
        }
        await transaction.organizationMember.update({
          where: { id: current.id },
          data: { status: "REMOVED" },
        });
        return current;
      },
    );
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

  private async ensureNotFinalOwner(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    memberId: string,
  ): Promise<void> {
    const activeOwners = await transaction.organizationMember.count({
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

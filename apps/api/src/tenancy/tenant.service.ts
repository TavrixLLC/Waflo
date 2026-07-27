import { HttpStatus, Injectable } from "@nestjs/common";
import type { MemberRole } from "@waflo/contracts";
import { hasPermission, type Permission } from "@waflo/permissions";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async requireMembership(userId: string, organizationId: string, permission: Permission) {
    const membership = await this.prisma.client.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: {
        organization: {
          include: { billingProfile: true },
        },
      },
    });
    if (membership?.status !== "ACTIVE" || membership.organization.status === "ARCHIVED") {
      await this.audit.security({
        userId,
        ...(membership ? { organizationId } : {}),
        eventType: "tenant.access_denied",
        severity: "MEDIUM",
        metadata: {
          attemptedOrganizationId: organizationId,
          reason: membership ? "inactive_membership_or_organization" : "membership_not_found",
        },
      });
      throw new AppError(
        "ORGANIZATION_ACCESS_DENIED",
        "You do not have access to this organization.",
        HttpStatus.FORBIDDEN,
      );
    }
    if (!hasPermission(membership.role as MemberRole, permission)) {
      await this.audit.security({
        userId,
        organizationId,
        eventType: "permission.denied",
        severity: "MEDIUM",
        metadata: { permission, role: membership.role },
      });
      throw new AppError(
        "PERMISSION_DENIED",
        "Your role does not allow this action.",
        HttpStatus.FORBIDDEN,
      );
    }
    return membership;
  }

  async requireOwner(userId: string, organizationId: string) {
    const membership = await this.requireMembership(userId, organizationId, "organization.view");
    if (membership.role !== "OWNER") {
      throw new AppError(
        "OWNER_REQUIRED",
        "Only an organization Owner can perform this action.",
        HttpStatus.FORBIDDEN,
      );
    }
    return membership;
  }
}

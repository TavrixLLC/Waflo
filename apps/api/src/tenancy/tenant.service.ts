import { HttpStatus, Injectable } from "@nestjs/common";
import type { MemberRole } from "@waflo/contracts";
import { hasPermission, type Permission } from "@waflo/permissions";
import { AuditService } from "../audit/audit.service.js";
import { AccountAccessService } from "../account/account-access.service.js";
import { AppError } from "../common/app-error.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accountAccess: AccountAccessService = new AccountAccessService(prisma),
  ) {}

  private readonly recoveryPermissions = new Set<Permission>([
    "organization.view",
    "organization.audit.view",
    "billing.view",
    "billing.manage",
    "locations.view",
    "team.view",
    "programs.view",
    "programs.validate",
    "customers.view",
    "memberships.view",
    "ledger.view",
    "devices.view",
    "risk.view",
    "analytics.view_basic",
    "analytics.view_advanced",
    "customers.privacy_export",
    "customers.erase",
  ]);

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
    if (!this.recoveryPermissions.has(permission)) {
      const account = await this.accountAccess.resolveOrganization(organizationId);
      const firstLocationRecovery =
        account?.access === "onboarding_only" &&
        account.onboarding === "location_required" &&
        permission === "locations.create";
      if (account?.access !== "full" && !firstLocationRecovery) {
        throw new AppError(
          account?.access === "onboarding_only"
            ? "MERCHANT_ONBOARDING_REQUIRED"
            : "BILLING_ACTION_REQUIRED",
          account?.access === "onboarding_only"
            ? "Finish setting up your Waflo account before making operational changes."
            : "Your subscription needs attention before you can make changes.",
          HttpStatus.PAYMENT_REQUIRED,
          {
            accessState: account?.access ?? "read_only_billing_recovery",
            billingState: account?.billing ?? "restricted",
            billingUrl: "/dashboard/billing",
          },
        );
      }
    }
    return membership;
  }

  async requireOnboardingMembership(
    userId: string,
    organizationId: string,
    permission: Permission,
  ) {
    const membership = await this.prisma.client.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { organization: { include: { billingProfile: true } } },
    });
    if (
      membership?.status !== "ACTIVE" ||
      membership.organization.status === "ARCHIVED" ||
      !hasPermission(membership.role as MemberRole, permission)
    ) {
      throw new AppError(
        "ORGANIZATION_ACCESS_DENIED",
        "You do not have access to this organization.",
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

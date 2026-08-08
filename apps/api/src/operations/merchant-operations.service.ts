import { createDecipheriv, createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { HttpStatus, Injectable } from "@nestjs/common";
import { planCatalog } from "@waflo/billing";
import type { AnalyticsQuery, AnalyticsRebuildInput } from "@waflo/contracts";
import { canonicalJson } from "@waflo/loyalty-ledger";
import { cohortMetrics, operationalDateBucket, safeRate } from "@waflo/operational-analytics";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { CustomerSecurityService } from "../customer/customer-security.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { LoyaltyOperationService } from "../loyalty/loyalty-operation.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

function normalizedPlan(value: "STARTER" | "GROWTH" | "SCALE") {
  return value.toLocaleLowerCase("en-US") as "starter" | "growth" | "scale";
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function decryptPrivateObject(encrypted: Buffer, objectKey: string, secret: string): Buffer {
  const [version, nonceValue, ciphertextValue, tagValue, extra] = encrypted
    .toString("utf8")
    .split(".");
  if (version !== "wpo1" || !nonceValue || !ciphertextValue || !tagValue || extra !== undefined) {
    throw new Error("Unsupported private-object format.");
  }
  const key = createHash("sha256").update(secret, "utf8").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonceValue, "base64url"));
  decipher.setAAD(Buffer.from(`waflo-private-object:${objectKey}`, "utf8"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
}

@Injectable()
export class MerchantOperationsService {
  private readonly objectStorage: S3Client;
  private readonly privateObjectSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly customerSecurity: CustomerSecurityService,
    private readonly loyalty: LoyaltyOperationService,
    private readonly audit: AuditService,
    environment: EnvironmentService,
  ) {
    this.objectStorage = new S3Client({
      endpoint: environment.values.OBJECT_STORAGE_ENDPOINT,
      region: environment.values.OBJECT_STORAGE_REGION,
      forcePathStyle: environment.values.OBJECT_STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: environment.values.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: environment.values.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
    });
    this.objectStorageBucket = environment.values.OBJECT_STORAGE_BUCKET;
    this.privateObjectSecret = environment.values.OBJECT_STORAGE_SIGNING_SECRET;
  }

  private readonly objectStorageBucket: string;

  async listCustomers(
    userId: string,
    organizationId: string,
    query: {
      search?: string;
      cursor?: string;
      limit?: number;
      programId?: string;
      membershipStatus?: "ACTIVE" | "SUSPENDED" | "EXPIRED" | "REVOKED";
      rewardReady?: boolean;
    },
  ) {
    await this.tenant.requireMembership(userId, organizationId, "customers.view");
    const search = query.search?.trim();
    let exactCustomerIds: string[] | undefined;
    if (search?.includes("@")) {
      const contactHash = this.customerSecurity.emailRequestFingerprint(search);
      exactCustomerIds = (
        await this.prisma.client.customerContact.findMany({
          where: {
            organizationId,
            type: "EMAIL",
            normalizedValueHash: contactHash,
            archivedAt: null,
          },
          select: { customerId: true },
        })
      ).map((contact) => contact.customerId);
    }
    const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
    const customers = await this.prisma.client.customer.findMany({
      where: {
        organizationId,
        ...(search
          ? search.includes("@")
            ? { id: { in: exactCustomerIds ?? [] } }
            : { displayName: { contains: search, mode: "insensitive" } }
          : {}),
        memberships: {
          some: {
            ...(query.programId ? { programId: query.programId } : {}),
            ...(query.membershipStatus ? { status: query.membershipStatus } : {}),
            ...(query.rewardReady !== undefined
              ? { progress: { rewardReady: query.rewardReady } }
              : {}),
          },
        },
      },
      include: {
        contacts: {
          where: { type: "EMAIL", isPrimary: true, archivedAt: null },
          select: { maskedDisplayValue: true, verificationStatus: true },
        },
        memberships: {
          include: {
            program: { select: { internalName: true } },
            progress: true,
          },
          orderBy: { enrolledAt: "desc" },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = customers.slice(0, limit);
    return {
      items: page.map((customer) => ({
        id: customer.id,
        displayName: customer.displayName,
        preferredLocale: customer.preferredLocale,
        status: customer.status,
        maskedEmail: customer.contacts[0]?.maskedDisplayValue ?? null,
        emailVerificationStatus: customer.contacts[0]?.verificationStatus ?? null,
        memberships: customer.memberships.map((membership) => ({
          id: membership.id,
          publicMembershipId: membership.publicMembershipId,
          programName: membership.program.internalName,
          status: membership.status,
          enrolledAt: membership.enrolledAt,
          progress: membership.progress?.currentCycleStampCount ?? 0,
          completedCycles: membership.progress?.completedCycleCount ?? 0,
          rewardReady: membership.progress?.rewardReady ?? false,
          lastActivityAt: membership.progress?.updatedAt ?? membership.enrolledAt,
        })),
        createdAt: customer.createdAt,
      })),
      nextCursor: customers.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async customerDetail(userId: string, organizationId: string, customerId: string) {
    await this.tenant.requireMembership(userId, organizationId, "customers.view");
    const customer = await this.prisma.client.customer.findFirst({
      where: { id: customerId, organizationId },
      include: {
        contacts: {
          where: { archivedAt: null },
          select: {
            id: true,
            type: true,
            maskedDisplayValue: true,
            verificationStatus: true,
            verifiedAt: true,
            isPrimary: true,
          },
        },
        consents: {
          select: {
            id: true,
            consentType: true,
            granted: true,
            locale: true,
            capturedAt: true,
            revokedAt: true,
          },
          orderBy: { capturedAt: "desc" },
        },
        memberships: {
          include: {
            program: { select: { internalName: true } },
            progress: true,
            enrollmentProgramVersion: {
              select: {
                id: true,
                versionNumber: true,
                operationalTimezone: true,
                stampRule: { select: { requiredStampCount: true } },
              },
            },
            walletPassInstances: {
              select: {
                provider: true,
                status: true,
                lastProviderSyncAt: true,
                lastProviderErrorCode: true,
              },
            },
            rewardEntitlements: {
              where: { status: { in: ["AVAILABLE", "PARTIALLY_REDEEMED"] } },
              select: { publicId: true, threshold: true, status: true, expiresAt: true },
            },
          },
          orderBy: { enrolledAt: "desc" },
        },
        privacyRequests: {
          select: {
            publicId: true,
            requestType: true,
            status: true,
            createdAt: true,
            completedAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found.", 404);
    return customer;
  }

  async membershipDetail(userId: string, organizationId: string, membershipId: string) {
    await this.tenant.requireMembership(userId, organizationId, "memberships.view");
    const membership = await this.prisma.client.membership.findFirst({
      where: { id: membershipId, organizationId },
      include: {
        customer: {
          select: {
            id: true,
            displayName: true,
            preferredLocale: true,
            status: true,
            contacts: {
              where: { type: "EMAIL", isPrimary: true, archivedAt: null },
              select: { maskedDisplayValue: true, verificationStatus: true },
            },
          },
        },
        program: { select: { id: true, internalName: true, status: true } },
        enrollmentProgramVersion: {
          include: {
            stampRule: true,
            translations: true,
          },
        },
        progress: true,
        walletPassInstances: {
          select: {
            provider: true,
            status: true,
            updateTag: true,
            lastRenderedProjectionVersion: true,
            lastProviderSyncAt: true,
            lastProviderErrorCode: true,
          },
        },
        rewardEntitlements: {
          include: {
            rewardDefinition: {
              select: {
                internalName: true,
                requiresManagerApproval: true,
                thresholdStampCount: true,
              },
            },
            redemptions: {
              select: {
                publicId: true,
                status: true,
                redeemedAt: true,
                reversedAt: true,
              },
            },
          },
          orderBy: [{ cycleNumber: "desc" }, { threshold: "asc" }],
        },
      },
    });
    if (!membership) throw new AppError("MEMBERSHIP_NOT_FOUND", "Membership not found.", 404);
    const riskCount = await this.prisma.client.operationalRiskSignal.count({
      where: { membershipId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    });
    return { ...membership, openRiskSignalCount: riskCount };
  }

  async ledger(
    userId: string,
    organizationId: string,
    membershipId: string,
    cursor?: string,
    limit = 50,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "ledger.view");
    const membership = await this.prisma.client.membership.findFirst({
      where: { id: membershipId, organizationId },
      select: { id: true },
    });
    if (!membership) throw new AppError("MEMBERSHIP_NOT_FOUND", "Membership not found.", 404);
    const take = Math.min(Math.max(limit, 1), 100);
    const entries = await this.prisma.client.loyaltyLedgerEntry.findMany({
      where: { membershipId, organizationId },
      orderBy: { membershipSequence: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { publicId: cursor }, skip: 1 } : {}),
      select: {
        publicId: true,
        eventType: true,
        membershipSequence: true,
        cycleNumber: true,
        stampDelta: true,
        rewardEntitlementId: true,
        reversalOfEntryId: true,
        operationalTimezone: true,
        operationalLocalDate: true,
        occurredAt: true,
        recordedAt: true,
        safeMetadata: true,
        locationId: true,
        staffOrganizationMemberId: true,
        staffDeviceId: true,
        operationCommand: {
          select: { publicId: true, operationType: true },
        },
      },
    });
    const page = entries.slice(0, take);
    return {
      items: page,
      nextCursor: entries.length > take ? (page.at(-1)?.publicId ?? null) : null,
    };
  }

  async rewards(userId: string, organizationId: string, membershipId: string) {
    await this.tenant.requireMembership(userId, organizationId, "memberships.view");
    return this.prisma.client.rewardEntitlement.findMany({
      where: { organizationId, membershipId },
      include: {
        rewardDefinition: {
          select: {
            internalName: true,
            thresholdStampCount: true,
            requiresManagerApproval: true,
            translations: true,
          },
        },
        redemptions: {
          select: {
            publicId: true,
            status: true,
            redeemedAt: true,
            reversedAt: true,
          },
        },
      },
      orderBy: [{ cycleNumber: "desc" }, { threshold: "asc" }],
    });
  }

  async statusOperation(
    userId: string,
    organizationId: string,
    membershipId: string,
    input: {
      commandId: string;
      reason: string;
      locationId: string;
      action: "SUSPEND" | "RESTORE" | "REVOKE";
    },
    request: WafloRequest,
  ) {
    const permission =
      input.action === "SUSPEND"
        ? "memberships.suspend"
        : input.action === "RESTORE"
          ? "memberships.restore"
          : "memberships.revoke";
    const actor = await this.tenant.requireMembership(userId, organizationId, permission);
    if (actor.role === "STAFF") throw new AppError("PERMISSION_DENIED", "Staff denied.", 403);
    return this.loyalty.changeMembershipStatus({
      organizationId,
      membershipId,
      actorUserId: userId,
      actorMemberId: actor.id,
      actorRole: actor.role,
      locationId: input.locationId,
      commandId: input.commandId,
      action: input.action,
      reason: input.reason,
      request,
    });
  }

  async manualAdjustment(
    userId: string,
    organizationId: string,
    membershipId: string,
    input: {
      commandId: string;
      stampDelta: number;
      reason: string;
      locationId: string;
    },
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(
      userId,
      organizationId,
      "operations.manual_adjust",
    );
    if (actor.role === "STAFF") throw new AppError("PERMISSION_DENIED", "Staff denied.", 403);
    return this.loyalty.manualAdjustment({
      organizationId,
      membershipId,
      actorUserId: userId,
      actorMemberId: actor.id,
      actorRole: actor.role,
      ...input,
      request,
    });
  }

  async verifyProjection(userId: string, organizationId: string, membershipId: string) {
    await this.tenant.requireMembership(userId, organizationId, "ledger.view");
    return this.loyalty.verifyProjection(organizationId, membershipId);
  }

  async rebuildProjection(
    userId: string,
    organizationId: string,
    membershipId: string,
    commandId: string,
    expectedProjectionVersion: number,
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(userId, organizationId, "customers.manage");
    if (actor.role === "STAFF") throw new AppError("PERMISSION_DENIED", "Staff denied.", 403);
    return this.loyalty.rebuildProjection({
      organizationId,
      membershipId,
      commandId,
      expectedProjectionVersion,
      actorUserId: userId,
      actorRole: actor.role,
      request,
    });
  }

  async createApproval(
    userId: string,
    organizationId: string,
    input: {
      membershipId: string;
      rewardEntitlementId: string;
      staffDeviceId: string;
      locationId: string;
      requestFingerprint: string;
    },
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(
      userId,
      organizationId,
      "operations.manager_approve",
    );
    if (actor.role === "STAFF") throw new AppError("PERMISSION_DENIED", "Staff denied.", 403);
    const [entitlement, device] = await Promise.all([
      this.prisma.client.rewardEntitlement.findFirst({
        where: {
          id: input.rewardEntitlementId,
          membershipId: input.membershipId,
          organizationId,
        },
      }),
      this.prisma.client.staffDevice.findFirst({
        where: { id: input.staffDeviceId, organizationId, status: "ACTIVE" },
      }),
    ]);
    if (!entitlement || !device) {
      throw new AppError("MANAGER_APPROVAL_INVALID", "Approval context is invalid.", 422);
    }
    const approval = await this.prisma.client.$transaction(async (transaction) => {
      const created = await transaction.managerApprovalChallenge.create({
        data: {
          organizationId,
          membershipId: input.membershipId,
          rewardEntitlementId: entitlement.id,
          staffDeviceId: device.id,
          locationId: input.locationId,
          requestFingerprint: input.requestFingerprint,
          operationType: "REDEEM",
          requestedByMemberId: device.organizationMemberId,
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action: "operation.manager_approval_requested",
          targetType: "manager_approval",
          targetId: created.id,
          locationId: input.locationId,
        },
        request,
      );
      return created;
    });
    return {
      publicId: approval.publicId,
      status: approval.status,
      expiresAt: approval.expiresAt,
    };
  }

  async listApprovals(
    userId: string,
    organizationId: string,
    query: {
      status?: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
      cursor?: string;
      limit?: number;
    },
  ) {
    const actor = await this.tenant.requireMembership(
      userId,
      organizationId,
      "operations.manager_approve",
    );
    if (actor.role === "STAFF") throw new AppError("PERMISSION_DENIED", "Staff denied.", 403);
    const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
    const approvals = await this.prisma.client.managerApprovalChallenge.findMany({
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { publicId: query.cursor }, skip: 1 } : {}),
    });
    const page = approvals.slice(0, limit);
    const [memberships, entitlements, devices, locations, requestingMembers, decidingUsers] =
      await Promise.all([
        this.prisma.client.membership.findMany({
          where: { id: { in: page.map((item) => item.membershipId) }, organizationId },
          select: {
            id: true,
            publicMembershipId: true,
            customer: { select: { displayName: true } },
          },
        }),
        this.prisma.client.rewardEntitlement.findMany({
          where: { id: { in: page.map((item) => item.rewardEntitlementId) }, organizationId },
          select: {
            id: true,
            publicId: true,
            threshold: true,
            rewardDefinition: { select: { internalName: true } },
          },
        }),
        this.prisma.client.staffDevice.findMany({
          where: { id: { in: page.map((item) => item.staffDeviceId) }, organizationId },
          select: { id: true, publicId: true, displayName: true },
        }),
        this.prisma.client.location.findMany({
          where: { id: { in: page.map((item) => item.locationId) }, organizationId },
          select: { id: true, name: true },
        }),
        this.prisma.client.organizationMember.findMany({
          where: { id: { in: page.map((item) => item.requestedByMemberId) }, organizationId },
          select: { id: true, user: { select: { displayName: true } } },
        }),
        this.prisma.client.user.findMany({
          where: {
            id: {
              in: page.flatMap((item) => (item.approvedByUserId ? [item.approvedByUserId] : [])),
            },
          },
          select: { id: true, displayName: true },
        }),
      ]);
    const membershipById = new Map(memberships.map((item) => [item.id, item]));
    const entitlementById = new Map(entitlements.map((item) => [item.id, item]));
    const deviceById = new Map(devices.map((item) => [item.id, item]));
    const locationById = new Map(locations.map((item) => [item.id, item]));
    const requesterById = new Map(requestingMembers.map((item) => [item.id, item]));
    const decidingUserById = new Map(decidingUsers.map((item) => [item.id, item]));
    return {
      items: page.map((approval) => ({
        publicId: approval.publicId,
        status: approval.status,
        membership: membershipById.get(approval.membershipId) ?? null,
        rewardEntitlement: entitlementById.get(approval.rewardEntitlementId) ?? null,
        staffDevice: deviceById.get(approval.staffDeviceId) ?? null,
        location: locationById.get(approval.locationId) ?? null,
        requestedBy: requesterById.get(approval.requestedByMemberId)?.user ?? null,
        approvedBy: approval.approvedByUserId
          ? (decidingUserById.get(approval.approvedByUserId) ?? null)
          : null,
        expiresAt: approval.expiresAt,
        approvedAt: approval.approvedAt,
        rejectedAt: approval.rejectedAt,
        consumedAt: approval.consumedAt,
        createdAt: approval.createdAt,
      })),
      nextCursor: approvals.length > limit ? (page.at(-1)?.publicId ?? null) : null,
    };
  }

  async decideApproval(
    userId: string,
    organizationId: string,
    publicId: string,
    decision: "APPROVED" | "REJECTED",
    reason: string | undefined,
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(
      userId,
      organizationId,
      "operations.manager_approve",
    );
    if (actor.role === "STAFF") throw new AppError("PERMISSION_DENIED", "Staff denied.", 403);
    const approval = await this.prisma.client.managerApprovalChallenge.findFirst({
      where: { publicId, organizationId },
    });
    if (approval?.status !== "PENDING" || approval.expiresAt <= new Date()) {
      throw new AppError("MANAGER_APPROVAL_INVALID", "Approval is unavailable.", 409);
    }
    const now = new Date();
    const updated = await this.prisma.client.$transaction(async (transaction) => {
      const decisionResult = await transaction.managerApprovalChallenge.updateMany({
        where: { id: approval.id, status: "PENDING", expiresAt: { gt: now } },
        data:
          decision === "APPROVED"
            ? { status: "APPROVED", approvedByUserId: userId, approvedAt: now }
            : { status: "REJECTED", rejectedAt: now },
      });
      if (decisionResult.count !== 1) {
        throw new AppError("MANAGER_APPROVAL_INVALID", "Approval is unavailable.", 409);
      }
      const value = await transaction.managerApprovalChallenge.findUniqueOrThrow({
        where: { id: approval.id },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action:
            decision === "APPROVED"
              ? "operation.manager_approval_granted"
              : "operation.manager_approval_rejected",
          targetType: "manager_approval",
          targetId: approval.id,
          locationId: approval.locationId,
          metadata: reason ? { reason } : {},
        },
        request,
      );
      return value;
    });
    return { publicId: updated.publicId, status: updated.status, decidedAt: now };
  }

  async listRisk(
    userId: string,
    organizationId: string,
    query: {
      status?: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
      severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      cursor?: string;
      limit?: number;
    },
  ) {
    await this.tenant.requireMembership(userId, organizationId, "risk.view");
    const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
    const signals = await this.prisma.client.operationalRiskSignal.findMany({
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { publicId: query.cursor }, skip: 1 } : {}),
      select: {
        publicId: true,
        ruleCode: true,
        severity: true,
        status: true,
        score: true,
        safeEvidence: true,
        membershipId: true,
        staffMemberId: true,
        staffDeviceId: true,
        locationId: true,
        createdAt: true,
        acknowledgedAt: true,
        resolutionNote: true,
        resolvedAt: true,
      },
    });
    const page = signals.slice(0, limit);
    return {
      items: page,
      nextCursor: signals.length > limit ? (page.at(-1)?.publicId ?? null) : null,
    };
  }

  async riskDetail(userId: string, organizationId: string, publicId: string) {
    await this.tenant.requireMembership(userId, organizationId, "risk.view");
    const signal = await this.prisma.client.operationalRiskSignal.findFirst({
      where: { publicId, organizationId },
    });
    if (!signal) throw new AppError("RISK_SIGNAL_NOT_FOUND", "Risk signal not found.", 404);
    return signal;
  }

  async decideRisk(
    userId: string,
    organizationId: string,
    publicId: string,
    status: "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED",
    note: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "risk.manage");
    const signal = await this.prisma.client.operationalRiskSignal.findFirst({
      where: { publicId, organizationId },
    });
    if (!signal) throw new AppError("RISK_SIGNAL_NOT_FOUND", "Risk signal not found.", 404);
    const updated = await this.prisma.client.$transaction(async (transaction) => {
      const value = await transaction.operationalRiskSignal.update({
        where: { id: signal.id },
        data:
          status === "ACKNOWLEDGED"
            ? {
                status,
                acknowledgedByUserId: userId,
                acknowledgedAt: new Date(),
                resolutionNote: note,
              }
            : {
                status,
                resolvedByUserId: userId,
                resolvedAt: new Date(),
                resolutionNote: note,
              },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action: `risk.signal_${status.toLocaleLowerCase("en-US")}`,
          targetType: "risk_signal",
          targetId: signal.id,
          metadata: { note },
        },
        request,
      );
      return value;
    });
    return { publicId: updated.publicId, status: updated.status };
  }

  async analyticsOverview(userId: string, organizationId: string) {
    await this.tenant.requireMembership(userId, organizationId, "analytics.view_basic");
    const [organization, aggregate, activeMemberships, recentOperations] = await Promise.all([
      this.prisma.client.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { selectedPlan: true },
      }),
      this.prisma.client.operationalDailyAggregate.aggregate({
        where: { organizationId },
        _sum: {
          enrollments: true,
          stampUnitsIssued: true,
          stampOperations: true,
          rewardsUnlocked: true,
          rewardsRedeemed: true,
          completedCycles: true,
          uniqueActiveMembers: true,
          reversals: true,
          riskSignals: true,
        },
      }),
      this.prisma.client.membership.count({
        where: { organizationId, status: "ACTIVE" },
      }),
      this.prisma.client.loyaltyLedgerEntry.findMany({
        where: { organizationId },
        orderBy: { recordedAt: "desc" },
        take: 20,
        select: {
          publicId: true,
          eventType: true,
          stampDelta: true,
          occurredAt: true,
          operationalLocalDate: true,
        },
      }),
    ]);
    const sums = aggregate._sum;
    const unlocked = sums.rewardsUnlocked ?? 0;
    const redeemed = sums.rewardsRedeemed ?? 0;
    return {
      activeMemberships,
      newEnrollments: sums.enrollments ?? 0,
      stampUnitsIssued: sums.stampUnitsIssued ?? 0,
      stampOperations: sums.stampOperations ?? 0,
      rewardsUnlocked: unlocked,
      rewardsRedeemed: redeemed,
      redemptionRate: unlocked === 0 ? 0 : redeemed / unlocked,
      completedCycles: sums.completedCycles ?? 0,
      uniqueActiveMembers: sums.uniqueActiveMembers ?? 0,
      reversals: sums.reversals ?? 0,
      riskSignals: sums.riskSignals ?? 0,
      recentOperations,
      plan: normalizedPlan(organization.selectedPlan),
      advancedAnalyticsAvailable:
        planCatalog[normalizedPlan(organization.selectedPlan)].features.advancedAnalytics,
    };
  }

  async analyticsDimension(
    userId: string,
    organizationId: string,
    dimension: "program" | "location" | "staff" | "cohort",
    query: AnalyticsQuery,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "analytics.view_advanced");
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { selectedPlan: true },
    });
    const plan = normalizedPlan(organization.selectedPlan);
    if (!planCatalog[plan].features.advancedAnalytics) {
      throw new AppError(
        "PLAN_UPGRADE_REQUIRED",
        "Advanced analytics requires Growth or Scale.",
        HttpStatus.PAYMENT_REQUIRED,
        { recommendedPlan: "growth" },
      );
    }
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
    const from = query.from
      ? new Date(`${query.from}T00:00:00.000Z`)
      : new Date(to.getTime() - 30 * 86_400_000);
    if (from > to || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new AppError("ANALYTICS_DATE_RANGE_INVALID", "Analytics range is invalid.", 422);
    }
    if (dimension === "cohort") {
      return this.cohortAnalytics(organizationId, plan, from, to, query);
    }
    const rows = await this.prisma.client.operationalDailyAggregate.findMany({
      where: { organizationId, localDate: { gte: from, lte: to } },
      orderBy: [{ localDate: "asc" }, { aggregateKey: "asc" }],
      take: 10_001,
    });
    if (rows.length > 10_000) {
      throw new AppError(
        "ANALYTICS_RESULT_SET_TOO_LARGE",
        "Narrow the analytics date range before continuing.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (dimension === "program") {
      const grouped = new Map<
        string,
        {
          cursor: string;
          programId: string;
          programVersionId: string | null;
          timezone: string;
          enrollments: number;
          activeMembers: number;
          stampOperations: number;
          stampUnits: number;
          rewardsUnlocked: number;
          rewardsRedeemed: number;
          completedCycles: number;
          reversals: number;
          riskSignals: number;
          walletAdoptions: number;
        }
      >();
      for (const row of rows) {
        const cursor = `${row.programId}:${row.programVersionId ?? "none"}`;
        const item = grouped.get(cursor) ?? {
          cursor,
          programId: row.programId,
          programVersionId: row.programVersionId,
          timezone: row.timezone,
          enrollments: 0,
          activeMembers: 0,
          stampOperations: 0,
          stampUnits: 0,
          rewardsUnlocked: 0,
          rewardsRedeemed: 0,
          completedCycles: 0,
          reversals: 0,
          riskSignals: 0,
          walletAdoptions: 0,
        };
        item.enrollments += row.enrollments;
        item.activeMembers += row.activeMemberships;
        item.stampOperations += row.stampOperations;
        item.stampUnits += row.stampUnitsIssued;
        item.rewardsUnlocked += row.rewardsUnlocked;
        item.rewardsRedeemed += row.rewardsRedeemed;
        item.completedCycles += row.completedCycles;
        item.reversals += row.reversals + row.redemptionReversals;
        item.riskSignals += row.riskSignals;
        item.walletAdoptions += row.walletAdoptions;
        grouped.set(cursor, item);
      }
      const identities = [...grouped.values()];
      const activityEvidence = await this.boundedActivityEvidence(organizationId, from, to);
      const [programs, versions, activeGroups] = await Promise.all([
        this.prisma.client.loyaltyProgram.findMany({
          where: { id: { in: [...new Set(identities.map((item) => item.programId))] } },
          select: { id: true, internalName: true },
        }),
        this.prisma.client.loyaltyProgramVersion.findMany({
          where: {
            id: {
              in: identities.flatMap((item) =>
                item.programVersionId ? [item.programVersionId] : [],
              ),
            },
          },
          select: { id: true, versionNumber: true },
        }),
        this.prisma.client.membership.groupBy({
          by: ["programId", "enrollmentProgramVersionId"],
          where: { organizationId, status: "ACTIVE" },
          _count: { _all: true },
        }),
      ]);
      const programNames = new Map(programs.map((item) => [item.id, item.internalName]));
      const versionNumbers = new Map(versions.map((item) => [item.id, item.versionNumber]));
      const activeCounts = new Map(
        activeGroups.map((item) => [
          `${item.programId}:${item.enrollmentProgramVersionId}`,
          item._count._all,
        ]),
      );
      const allItems = identities
        .map((item) => {
          const evidence = activityEvidence.programs.get(item.cursor) ?? {
            enrollments: 0,
            firstActivities: 0,
            activeMembers: 0,
            repeatVisitors: 0,
          };
          return {
            cursor: item.cursor,
            programId: item.programId,
            programVersionId: item.programVersionId,
            programName: programNames.get(item.programId) ?? "Program",
            versionNumber: item.programVersionId
              ? (versionNumbers.get(item.programVersionId) ?? null)
              : null,
            timezone: item.timezone,
            enrollments: item.enrollments,
            activeMembers:
              activeCounts.get(`${item.programId}:${item.programVersionId ?? ""}`) ?? 0,
            stampOperations: item.stampOperations,
            stampUnits: item.stampUnits,
            rewardsUnlocked: item.rewardsUnlocked,
            rewardsRedeemed: item.rewardsRedeemed,
            completedCycles: item.completedCycles,
            completionRate: safeRate(item.completedCycles, item.enrollments),
            redemptionRate: safeRate(item.rewardsRedeemed, item.rewardsUnlocked),
            reversalRate: safeRate(item.reversals, item.stampOperations + item.rewardsRedeemed),
            walletAdoptionRate: safeRate(item.walletAdoptions, item.enrollments),
            riskRate: safeRate(item.riskSignals, item.stampOperations + item.rewardsRedeemed),
            firstActivityCount: evidence.firstActivities,
            firstActivityConversionRate: safeRate(evidence.firstActivities, evidence.enrollments),
            repeatVisitors: evidence.repeatVisitors,
            repeatVisitRate: safeRate(evidence.repeatVisitors, evidence.activeMembers),
          };
        })
        .sort((left, right) => left.cursor.localeCompare(right.cursor, "en"));
      return this.analyticsPage(dimension, plan, from, to, allItems, query);
    }
    if (dimension === "location") {
      const activityEvidence = await this.boundedActivityEvidence(organizationId, from, to);
      const grouped = new Map<
        string,
        {
          cursor: string;
          locationId: string | null;
          timezone: string;
          activity: number;
          uniqueMembers: number;
          redemptions: number;
          reversals: number;
          risks: number;
        }
      >();
      for (const row of rows) {
        const cursor = row.locationId ?? "unattributed";
        const item = grouped.get(cursor) ?? {
          cursor,
          locationId: row.locationId,
          timezone: row.timezone,
          activity: 0,
          uniqueMembers: 0,
          redemptions: 0,
          reversals: 0,
          risks: 0,
        };
        item.activity += row.stampOperations + row.rewardsRedeemed;
        item.uniqueMembers += row.uniqueActiveMembers;
        item.redemptions += row.rewardsRedeemed;
        item.reversals += row.reversals + row.redemptionReversals;
        item.risks += row.riskSignals;
        grouped.set(cursor, item);
      }
      const locations = await this.prisma.client.location.findMany({
        where: {
          organizationId,
          id: {
            in: [...grouped.values()].flatMap((item) => (item.locationId ? [item.locationId] : [])),
          },
        },
        select: { id: true, name: true },
      });
      const names = new Map(locations.map((item) => [item.id, item.name]));
      const allItems = [...grouped.values()]
        .map((item) => {
          const evidence = activityEvidence.locations.get(item.cursor) ?? {
            firstActivities: 0,
            activeMembers: 0,
            repeatVisitors: 0,
          };
          return {
            cursor: item.cursor,
            locationId: item.locationId,
            locationName: item.locationId
              ? (names.get(item.locationId) ?? "Location")
              : "Unattributed",
            timezone: item.timezone,
            activity: item.activity,
            uniqueMembers: item.uniqueMembers,
            redemptions: item.redemptions,
            reversals: item.reversals,
            riskRate: safeRate(item.risks, item.activity),
            conversionRate: safeRate(evidence.firstActivities, activityEvidence.enrollments),
            firstActivityConversions: evidence.firstActivities,
            repeatVisitors: evidence.repeatVisitors,
            repeatVisitRate: safeRate(evidence.repeatVisitors, evidence.activeMembers),
          };
        })
        .sort((left, right) => left.cursor.localeCompare(right.cursor, "en"));
      return this.analyticsPage(dimension, plan, from, to, allItems, query);
    }
    const grouped = new Map<
      string,
      {
        cursor: string;
        staffMemberId: string | null;
        timezone: string;
        operations: number;
        stampUnits: number;
        redemptions: number;
        reversals: number;
        overrides: number;
        risks: number;
      }
    >();
    for (const row of rows) {
      const cursor = row.staffMemberId ?? "system";
      const item = grouped.get(cursor) ?? {
        cursor,
        staffMemberId: row.staffMemberId,
        timezone: row.timezone,
        operations: 0,
        stampUnits: 0,
        redemptions: 0,
        reversals: 0,
        overrides: 0,
        risks: 0,
      };
      item.operations += row.stampOperations + row.rewardsRedeemed;
      item.stampUnits += row.stampUnitsIssued;
      item.redemptions += row.rewardsRedeemed;
      item.reversals += row.reversals + row.redemptionReversals;
      item.overrides += row.overrides;
      item.risks += row.riskSignals;
      grouped.set(cursor, item);
    }
    const members = await this.prisma.client.organizationMember.findMany({
      where: {
        organizationId,
        id: {
          in: [...grouped.values()].flatMap((item) =>
            item.staffMemberId ? [item.staffMemberId] : [],
          ),
        },
      },
      select: { id: true, user: { select: { displayName: true } } },
    });
    const names = new Map(members.map((item) => [item.id, item.user.displayName]));
    const allItems = [...grouped.values()]
      .map((item) => ({
        cursor: item.cursor,
        staffMemberId: item.staffMemberId,
        staffName: item.staffMemberId ? (names.get(item.staffMemberId) ?? "Staff") : "System",
        timezone: item.timezone,
        operations: item.operations,
        stampUnits: item.stampUnits,
        redemptions: item.redemptions,
        reversals: item.reversals,
        overrides: item.overrides,
        riskRate: safeRate(item.risks, item.operations),
      }))
      .sort((left, right) => left.cursor.localeCompare(right.cursor, "en"));
    return this.analyticsPage(dimension, plan, from, to, allItems, query);
  }

  private async boundedActivityEvidence(organizationId: string, from: Date, to: Date) {
    const [enrollments, facts] = await Promise.all([
      this.prisma.client.membership.findMany({
        where: { organizationId, enrolledAt: { gte: from, lte: to } },
        select: {
          id: true,
          programId: true,
          enrollmentProgramVersionId: true,
        },
        orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
        take: 10_001,
      }),
      this.prisma.client.operationalAnalyticsFact.findMany({
        where: {
          organizationId,
          occurredAt: { gte: from, lte: to },
          factType: { in: ["STAMP_ISSUED", "REWARD_REDEEMED"] },
          membershipId: { not: null },
        },
        select: {
          membershipId: true,
          programId: true,
          programVersionId: true,
          locationId: true,
          localDate: true,
          occurredAt: true,
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: 50_001,
      }),
    ]);
    if (enrollments.length > 10_000 || facts.length > 50_000) {
      throw new AppError(
        "ANALYTICS_RESULT_SET_TOO_LARGE",
        "Narrow the analytics date range before continuing.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const enrolledByMembership = new Map(enrollments.map((item) => [item.id, item]));
    const factsByMembership = new Map<string, typeof facts>();
    for (const fact of facts) {
      if (!fact.membershipId) continue;
      const values = factsByMembership.get(fact.membershipId) ?? [];
      values.push(fact);
      factsByMembership.set(fact.membershipId, values);
    }
    const programs = new Map<
      string,
      {
        enrollments: number;
        firstActivities: number;
        activeMembers: number;
        repeatVisitors: number;
      }
    >();
    for (const enrollment of enrollments) {
      const key = `${enrollment.programId}:${enrollment.enrollmentProgramVersionId}`;
      const value = programs.get(key) ?? {
        enrollments: 0,
        firstActivities: 0,
        activeMembers: 0,
        repeatVisitors: 0,
      };
      value.enrollments += 1;
      if ((factsByMembership.get(enrollment.id)?.length ?? 0) > 0) value.firstActivities += 1;
      programs.set(key, value);
    }
    const locations = new Map<
      string,
      { firstActivities: number; activeMembers: number; repeatVisitors: number }
    >();
    for (const [membershipId, membershipFacts] of factsByMembership) {
      const first = membershipFacts[0];
      if (!first) continue;
      const programKey = `${first.programId}:${first.programVersionId ?? "none"}`;
      const program = programs.get(programKey) ?? {
        enrollments: 0,
        firstActivities: 0,
        activeMembers: 0,
        repeatVisitors: 0,
      };
      program.activeMembers += 1;
      if (new Set(membershipFacts.map((fact) => fact.localDate.toISOString())).size >= 2) {
        program.repeatVisitors += 1;
      }
      programs.set(programKey, program);
      const locationDates = new Map<string, Set<string>>();
      for (const fact of membershipFacts) {
        const key = fact.locationId ?? "unattributed";
        const dates = locationDates.get(key) ?? new Set<string>();
        dates.add(fact.localDate.toISOString());
        locationDates.set(key, dates);
      }
      for (const [locationKey, dates] of locationDates) {
        const location = locations.get(locationKey) ?? {
          firstActivities: 0,
          activeMembers: 0,
          repeatVisitors: 0,
        };
        location.activeMembers += 1;
        if (dates.size >= 2) location.repeatVisitors += 1;
        locations.set(locationKey, location);
      }
      if (enrolledByMembership.has(membershipId)) {
        const firstLocationKey = first.locationId ?? "unattributed";
        const location = locations.get(firstLocationKey) ?? {
          firstActivities: 0,
          activeMembers: 0,
          repeatVisitors: 0,
        };
        location.firstActivities += 1;
        locations.set(firstLocationKey, location);
      }
    }
    return { enrollments: enrollments.length, programs, locations };
  }

  private analyticsPage<T extends { cursor: string }>(
    dimension: "program" | "location" | "staff" | "cohort",
    plan: "starter" | "growth" | "scale",
    from: Date,
    to: Date,
    items: readonly T[],
    query: AnalyticsQuery,
  ) {
    const afterCursor = query.cursor
      ? items.filter((item) => item.cursor.localeCompare(query.cursor ?? "", "en") > 0)
      : [...items];
    const page = afterCursor.slice(0, query.limit);
    return {
      dimension,
      plan,
      dateRange: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      },
      items: page,
      nextCursor: afterCursor.length > query.limit ? (page.at(-1)?.cursor ?? null) : null,
    };
  }

  private async cohortAnalytics(
    organizationId: string,
    plan: "starter" | "growth" | "scale",
    from: Date,
    to: Date,
    query: AnalyticsQuery,
  ) {
    const memberships = await this.prisma.client.membership.findMany({
      where: { organizationId, enrolledAt: { gte: from, lte: to } },
      select: {
        id: true,
        enrolledAt: true,
        status: true,
        progress: { select: { completedCycleCount: true } },
        enrollmentProgramVersion: { select: { operationalTimezone: true } },
      },
      orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
      take: 10_001,
    });
    if (memberships.length > 10_000) {
      throw new AppError(
        "ANALYTICS_RESULT_SET_TOO_LARGE",
        "Narrow the cohort enrollment range before continuing.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const facts = await this.prisma.client.operationalAnalyticsFact.findMany({
      where: {
        organizationId,
        membershipId: { in: memberships.map((item) => item.id) },
        factType: {
          in: [
            "STAMP_ISSUED",
            "MILESTONE_REWARD_UNLOCKED",
            "FINAL_REWARD_UNLOCKED",
            "REWARD_REDEEMED",
          ],
        },
      },
      select: { membershipId: true, factType: true, occurredAt: true, localDate: true },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 50_001,
    });
    if (facts.length > 50_000) {
      throw new AppError(
        "ANALYTICS_RESULT_SET_TOO_LARGE",
        "Narrow the cohort date range before continuing.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const factsByMembership = new Map<
      string,
      {
        firstActivityAt: Date | null;
        firstRewardAt: Date | null;
        firstRedemptionAt: Date | null;
        activityDates: Set<string>;
      }
    >();
    for (const fact of facts) {
      if (!fact.membershipId) continue;
      const value = factsByMembership.get(fact.membershipId) ?? {
        firstActivityAt: null,
        firstRewardAt: null,
        firstRedemptionAt: null,
        activityDates: new Set<string>(),
      };
      if (fact.factType === "STAMP_ISSUED" && !value.firstActivityAt) {
        value.firstActivityAt = fact.occurredAt;
      }
      if (fact.factType === "STAMP_ISSUED" || fact.factType === "REWARD_REDEEMED") {
        value.activityDates.add(fact.localDate.toISOString());
      }
      if (
        ["MILESTONE_REWARD_UNLOCKED", "FINAL_REWARD_UNLOCKED"].includes(fact.factType) &&
        !value.firstRewardAt
      ) {
        value.firstRewardAt = fact.occurredAt;
      }
      if (fact.factType === "REWARD_REDEEMED" && !value.firstRedemptionAt) {
        value.firstRedemptionAt = fact.occurredAt;
      }
      factsByMembership.set(fact.membershipId, value);
    }
    const cohorts = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      const timezone = membership.enrollmentProgramVersion.operationalTimezone;
      const month = operationalDateBucket(membership.enrolledAt, timezone).slice(0, 7);
      const cohort = `${timezone}:${month}`;
      const values = cohorts.get(cohort) ?? [];
      values.push(membership);
      cohorts.set(cohort, values);
    }
    const items = [...cohorts.entries()]
      .map(([cursor, values]) => {
        const timezone = values[0]?.enrollmentProgramVersion.operationalTimezone ?? "UTC";
        return {
          cursor,
          cohort: cursor.slice(timezone.length + 1),
          timezone,
          ...cohortMetrics(
            values.map((membership) => ({
              membershipId: membership.id,
              enrolledAt: membership.enrolledAt,
              firstActivityAt: factsByMembership.get(membership.id)?.firstActivityAt ?? null,
              firstRewardAt: factsByMembership.get(membership.id)?.firstRewardAt ?? null,
              firstRedemptionAt: factsByMembership.get(membership.id)?.firstRedemptionAt ?? null,
              active: (factsByMembership.get(membership.id)?.activityDates.size ?? 0) >= 2,
              completedCycles: membership.progress?.completedCycleCount ?? 0,
            })),
          ),
        };
      })
      .sort((left, right) => left.cursor.localeCompare(right.cursor, "en"));
    return this.analyticsPage("cohort", plan, from, to, items, query);
  }

  async createAnalyticsRebuild(
    userId: string,
    organizationId: string,
    input: AnalyticsRebuildInput,
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(
      userId,
      organizationId,
      "analytics.view_advanced",
    );
    if (actor.role === "STAFF") throw new AppError("PERMISSION_DENIED", "Staff denied.", 403);
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T00:00:00.000Z`);
    if (from > to || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new AppError("ANALYTICS_DATE_RANGE_INVALID", "Analytics range is invalid.", 422);
    }
    const requestFingerprint = fingerprint({
      organizationId,
      from: input.from,
      to: input.to,
      sourceKinds: [...input.sourceKinds].sort(),
    });
    const existing = await this.prisma.client.operationalAnalyticsJob.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey: input.commandId },
      },
    });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new AppError("OPERATION_IDEMPOTENCY_CONFLICT", "Command conflict.", 409);
      }
      return { publicId: existing.publicId, status: existing.status, replayed: true };
    }
    const job = await this.prisma.client.$transaction(async (transaction) => {
      const created = await transaction.operationalAnalyticsJob.create({
        data: {
          organizationId,
          jobType: "DATE_RANGE_REBUILD",
          fromDate: from,
          toDate: to,
          sourceKinds: input.sourceKinds,
          idempotencyKey: input.commandId,
          requestFingerprint,
        },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action: "analytics.rebuild_requested",
          targetType: "operational_analytics_job",
          targetId: created.id,
          metadata: { from: input.from, to: input.to, sourceKinds: input.sourceKinds },
        },
        request,
      );
      return created;
    });
    return { publicId: job.publicId, status: job.status, replayed: false };
  }

  async createExport(
    userId: string,
    organizationId: string,
    exportType:
      | "MEMBERSHIP_SUMMARY"
      | "LEDGER_OPERATIONS"
      | "REWARD_REDEMPTIONS"
      | "LOCATION_PERFORMANCE"
      | "STAFF_PERFORMANCE"
      | "RISK_SIGNALS"
      | "AGGREGATE_ANALYTICS",
    filters: Record<string, string | number | boolean | null>,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "exports.create");
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { selectedPlan: true },
    });
    const plan = normalizedPlan(organization.selectedPlan);
    if (!planCatalog[plan].features.advancedExports) {
      throw new AppError(
        "PLAN_UPGRADE_REQUIRED",
        "Advanced exports require Scale.",
        HttpStatus.PAYMENT_REQUIRED,
        { recommendedPlan: "scale" },
      );
    }
    const command = await this.prisma.client.$transaction(async (transaction) => {
      const created = await transaction.exportCommand.create({
        data: {
          organizationId,
          requestedByUserId: userId,
          exportType,
          filters,
          filterFingerprint: fingerprint(filters),
        },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action: "export.requested",
          targetType: "export_command",
          targetId: created.id,
          metadata: { exportType },
        },
        request,
      );
      return created;
    });
    return { publicId: command.publicId, status: command.status, createdAt: command.createdAt };
  }

  async listExports(
    userId: string,
    organizationId: string,
    query: { cursor?: string; limit?: number },
  ) {
    await this.tenant.requireMembership(userId, organizationId, "exports.create");
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { selectedPlan: true },
    });
    const plan = normalizedPlan(organization.selectedPlan);
    if (!planCatalog[plan].features.advancedExports) {
      throw new AppError(
        "PLAN_UPGRADE_REQUIRED",
        "Advanced exports require Scale.",
        HttpStatus.PAYMENT_REQUIRED,
        { recommendedPlan: "scale" },
      );
    }
    const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
    const commands = await this.prisma.client.exportCommand.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { publicId: query.cursor }, skip: 1 } : {}),
      select: {
        publicId: true,
        exportType: true,
        status: true,
        rowCount: true,
        safeFailureCode: true,
        createdAt: true,
        completedAt: true,
        expiresAt: true,
      },
    });
    const page = commands.slice(0, limit);
    return {
      items: page,
      nextCursor: commands.length > limit ? (page.at(-1)?.publicId ?? null) : null,
    };
  }

  async exportStatus(userId: string, organizationId: string, publicId: string) {
    await this.tenant.requireMembership(userId, organizationId, "exports.create");
    const command = await this.prisma.client.exportCommand.findFirst({
      where: { publicId, organizationId },
      select: {
        publicId: true,
        exportType: true,
        status: true,
        rowCount: true,
        expiresAt: true,
        safeFailureCode: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!command) throw new AppError("EXPORT_NOT_FOUND", "Export not found.", 404);
    return command;
  }

  async downloadExport(userId: string, organizationId: string, publicId: string) {
    await this.tenant.requireMembership(userId, organizationId, "exports.create");
    const command = await this.prisma.client.exportCommand.findFirst({
      where: { publicId, organizationId },
      select: {
        publicId: true,
        exportType: true,
        status: true,
        objectKey: true,
        expiresAt: true,
      },
    });
    if (
      command?.status !== "COMPLETED" ||
      !command.objectKey ||
      !command.expiresAt ||
      command.expiresAt <= new Date()
    ) {
      throw new AppError("EXPORT_NOT_READY", "Export is not available.", HttpStatus.CONFLICT);
    }
    const object = await this.objectStorage.send(
      new GetObjectCommand({
        Bucket: this.objectStorageBucket,
        Key: command.objectKey,
      }),
    );
    if (!object.Body) {
      throw new AppError("EXPORT_NOT_READY", "Export object is unavailable.", HttpStatus.CONFLICT);
    }
    let body: Buffer;
    try {
      body = decryptPrivateObject(
        Buffer.from(await object.Body.transformToByteArray()),
        command.objectKey,
        this.privateObjectSecret,
      );
    } catch {
      throw new AppError(
        "EXPORT_NOT_READY",
        "Export object could not be decrypted.",
        HttpStatus.CONFLICT,
      );
    }
    return {
      body,
      contentType: "text/csv; charset=utf-8",
      filename: `waflo-${command.exportType.toLocaleLowerCase("en-US")}-${command.publicId}.csv`,
    };
  }

  async createPrivacyRequest(
    userId: string,
    organizationId: string,
    customerId: string,
    requestType: "EXPORT" | "ERASURE",
    input: {
      commandId: string;
      confirmation: "CONFIRM";
      reasonOrLegalBasis: string;
    },
    request: WafloRequest,
  ) {
    if (requestType === "ERASURE") {
      await this.tenant.requireOwner(userId, organizationId);
    } else {
      await this.tenant.requireMembership(userId, organizationId, "customers.privacy_export");
    }
    const customer = await this.prisma.client.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found.", 404);
    const requestFingerprint = fingerprint({
      customerId,
      requestType,
      confirmation: input.confirmation,
      reasonOrLegalBasis: input.reasonOrLegalBasis,
    });
    const existing = await this.prisma.client.customerPrivacyRequest.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId,
          idempotencyKey: input.commandId,
        },
      },
    });
    if (existing) {
      if (
        existing.customerId !== customerId ||
        existing.requestType !== requestType ||
        existing.requestFingerprint !== requestFingerprint
      ) {
        throw new AppError("OPERATION_IDEMPOTENCY_CONFLICT", "Command conflict.", 409);
      }
      return { publicId: existing.publicId, status: existing.status, replayed: true };
    }
    const command = await this.prisma.client.$transaction(async (transaction) => {
      const created = await transaction.customerPrivacyRequest.create({
        data: {
          organizationId,
          customerId,
          requestType,
          requestedByUserId: userId,
          idempotencyKey: input.commandId,
          requestFingerprint,
          confirmationMetadata: {
            confirmed: true,
            reasonOrLegalBasis: input.reasonOrLegalBasis,
          },
        },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action:
            requestType === "EXPORT"
              ? "customer.privacy_export_requested"
              : "customer.erasure_requested",
          targetType: "customer",
          targetId: customerId,
          metadata: {
            privacyRequestPublicId: created.publicId,
            reasonOrLegalBasis: input.reasonOrLegalBasis,
          },
        },
        request,
      );
      return created;
    });
    return { publicId: command.publicId, status: command.status, replayed: false };
  }

  async privacyStatus(userId: string, organizationId: string, publicId: string) {
    await this.tenant.requireMembership(userId, organizationId, "customers.privacy_export");
    const command = await this.prisma.client.customerPrivacyRequest.findFirst({
      where: { publicId, organizationId },
      select: {
        publicId: true,
        requestType: true,
        status: true,
        completedAt: true,
        expiresAt: true,
        failureCode: true,
        createdAt: true,
      },
    });
    if (!command) throw new AppError("PRIVACY_REQUEST_NOT_FOUND", "Request not found.", 404);
    return command;
  }

  async downloadPrivacyExport(userId: string, organizationId: string, publicId: string) {
    await this.tenant.requireMembership(userId, organizationId, "customers.privacy_export");
    const command = await this.prisma.client.customerPrivacyRequest.findFirst({
      where: { publicId, organizationId, requestType: "EXPORT" },
      select: { publicId: true, status: true, objectKey: true, expiresAt: true },
    });
    if (
      command?.status !== "COMPLETED" ||
      !command.objectKey ||
      !command.expiresAt ||
      command.expiresAt <= new Date()
    ) {
      throw new AppError("PRIVACY_EXPORT_NOT_READY", "Privacy export is not available.", 409);
    }
    const object = await this.objectStorage.send(
      new GetObjectCommand({ Bucket: this.objectStorageBucket, Key: command.objectKey }),
    );
    if (!object.Body)
      throw new AppError("PRIVACY_EXPORT_NOT_READY", "Privacy export is unavailable.", 409);
    try {
      return {
        body: decryptPrivateObject(
          Buffer.from(await object.Body.transformToByteArray()),
          command.objectKey,
          this.privateObjectSecret,
        ),
        filename: `waflo-privacy-export-${command.publicId}.json`,
      };
    } catch {
      throw new AppError("PRIVACY_EXPORT_NOT_READY", "Privacy export is unavailable.", 409);
    }
  }
}

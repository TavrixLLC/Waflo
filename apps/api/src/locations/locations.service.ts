import { HttpStatus, Injectable } from "@nestjs/common";
import { canCreateLocation } from "@waflo/billing";
import type { LocationInput } from "@waflo/contracts";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withOrganizationInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

function toPlanCode(plan: "STARTER" | "GROWTH" | "SCALE"): "starter" | "growth" | "scale" {
  return plan.toLocaleLowerCase("en-US") as "starter" | "growth" | "scale";
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly environment: EnvironmentService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, organizationId: string, cursor?: string) {
    const membership = await this.tenant.requireMembership(
      userId,
      organizationId,
      "locations.view",
    );
    const [locations, activeCount] = await Promise.all([
      this.prisma.client.location.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 21,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.client.location.count({ where: { organizationId, status: "ACTIVE" } }),
    ]);
    const hasMore = locations.length > 20;
    const items = hasMore ? locations.slice(0, 20) : locations;
    const plan = toPlanCode(membership.organization.selectedPlan);
    const usage = canCreateLocation(
      plan,
      activeCount,
      plan === "scale" ? this.environment.values.SCALE_LOCATION_LIMIT : undefined,
    );
    return {
      items,
      usage,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async get(userId: string, organizationId: string, locationId: string) {
    await this.tenant.requireMembership(userId, organizationId, "locations.view");
    const location = await this.prisma.client.location.findFirst({
      where: { id: locationId, organizationId },
    });
    if (!location) {
      throw new AppError("LOCATION_NOT_FOUND", "Location not found.", HttpStatus.NOT_FOUND);
    }
    return location;
  }

  async create(
    userId: string,
    organizationId: string,
    input: LocationInput,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "locations.create");
    const location = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const [actor, organization] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
          }),
          transaction.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        ]);
        if (actor?.status !== "ACTIVE" || (actor.role !== "OWNER" && actor.role !== "MANAGER")) {
          throw new AppError(
            "PERMISSION_DENIED",
            "Your role does not allow this action.",
            HttpStatus.FORBIDDEN,
          );
        }
        const plan = toPlanCode(organization.selectedPlan);
        const activeCount = await transaction.location.count({
          where: { organizationId, status: "ACTIVE" },
        });
        const decision = canCreateLocation(
          plan,
          activeCount,
          plan === "scale" ? this.environment.values.SCALE_LOCATION_LIMIT : undefined,
        );
        if (!decision.allowed) {
          throw new AppError(
            "LOCATION_LIMIT_REACHED",
            "Your current plan has reached its active location limit.",
            HttpStatus.CONFLICT,
            {
              limit: decision.limit,
              currentUsage: decision.currentUsage,
              remaining: decision.remaining,
              recommendedPlan: decision.recommendedPlan,
            },
          );
        }
        return transaction.location.create({
          data: {
            organizationId,
            name: input.name,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            region: input.region ?? null,
            postalCode: input.postalCode ?? null,
            countryCode: input.countryCode ?? null,
            phone: input.phone ?? null,
            timezone: input.timezone ?? organization.timezone,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
          },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "location.created",
        targetType: "location",
        targetId: location.id,
        locationId: location.id,
      },
      request,
    );
    return location;
  }

  async update(
    userId: string,
    organizationId: string,
    locationId: string,
    input: {
      name?: string | undefined;
      addressLine1?: string | undefined;
      addressLine2?: string | undefined;
      city?: string | undefined;
      region?: string | undefined;
      postalCode?: string | undefined;
      countryCode?: string | undefined;
      phone?: string | undefined;
      timezone?: string | undefined;
      latitude?: number | null | undefined;
      longitude?: number | null | undefined;
    },
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "locations.manage");
    await this.get(userId, organizationId, locationId);
    const location = await this.prisma.client.location.update({
      where: { id: locationId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
        ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.region !== undefined ? { region: input.region } : {}),
        ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
        ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      },
    });
    if (input.latitude !== undefined || input.longitude !== undefined) {
      await this.queueNearbyLocationRefresh(organizationId, locationId, location.updatedAt);
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "location.updated",
        targetType: "location",
        targetId: locationId,
        locationId,
        metadata: { fields: Object.keys(input) },
      },
      request,
    );
    return location;
  }

  async archive(userId: string, organizationId: string, locationId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "locations.archive");
    const updated = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const [actor, location] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
          }),
          transaction.location.findFirst({ where: { id: locationId, organizationId } }),
        ]);
        if (actor?.status !== "ACTIVE" || (actor.role !== "OWNER" && actor.role !== "MANAGER")) {
          throw new AppError(
            "PERMISSION_DENIED",
            "Your role does not allow this action.",
            HttpStatus.FORBIDDEN,
          );
        }
        if (!location) {
          throw new AppError("LOCATION_NOT_FOUND", "Location not found.", HttpStatus.NOT_FOUND);
        }
        if (location.status === "ARCHIVED") return location;
        const activeCount = await transaction.location.count({
          where: { organizationId, status: "ACTIVE" },
        });
        if (activeCount <= 1) {
          throw new AppError(
            "FINAL_LOCATION_REQUIRED",
            "Your organization must keep at least one active location.",
            HttpStatus.CONFLICT,
          );
        }
        return transaction.location.update({
          where: { id: locationId },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "location.archived",
        targetType: "location",
        targetId: locationId,
        locationId,
      },
      request,
    );
    await this.removeArchivedNearbyLocation(
      userId,
      organizationId,
      locationId,
      updated.updatedAt,
      request,
    );
    return updated;
  }

  async restore(userId: string, organizationId: string, locationId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "locations.manage");
    const updated = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const [actor, organization, location] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
          }),
          transaction.organization.findUniqueOrThrow({ where: { id: organizationId } }),
          transaction.location.findFirst({ where: { id: locationId, organizationId } }),
        ]);
        if (actor?.status !== "ACTIVE" || (actor.role !== "OWNER" && actor.role !== "MANAGER")) {
          throw new AppError(
            "PERMISSION_DENIED",
            "Your role does not allow this action.",
            HttpStatus.FORBIDDEN,
          );
        }
        if (!location) {
          throw new AppError("LOCATION_NOT_FOUND", "Location not found.", HttpStatus.NOT_FOUND);
        }
        if (location.status === "ACTIVE") return location;
        const activeCount = await transaction.location.count({
          where: { organizationId, status: "ACTIVE" },
        });
        const plan = toPlanCode(organization.selectedPlan);
        const decision = canCreateLocation(
          plan,
          activeCount,
          plan === "scale" ? this.environment.values.SCALE_LOCATION_LIMIT : undefined,
        );
        if (!decision.allowed) {
          throw new AppError(
            "LOCATION_LIMIT_REACHED",
            "This location cannot be restored until capacity is available.",
            HttpStatus.CONFLICT,
            {
              limit: decision.limit,
              currentUsage: decision.currentUsage,
              recommendedPlan: decision.recommendedPlan,
            },
          );
        }
        return transaction.location.update({
          where: { id: locationId },
          data: { status: "ACTIVE", archivedAt: null },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "location.restored",
        targetType: "location",
        targetId: locationId,
        locationId,
      },
      request,
    );
    return updated;
  }

  private async queueNearbyLocationRefresh(
    organizationId: string,
    locationId: string,
    changedAt: Date,
  ) {
    const selection = await this.prisma.client.walletNearbyLocation.findFirst({
      where: { locationId, configuration: { organizationId, enabled: true } },
    });
    if (!selection) return;
    const programs = await this.prisma.client.loyaltyProgram.findMany({
      where: {
        organizationId,
        OR: [
          { walletBindings: { some: {} } },
          { memberships: { some: { walletPassInstances: { some: {} } } } },
        ],
      },
      select: { id: true },
    });
    for (const program of programs) {
      const programId = program.id;
      const fingerprint = `${locationId}:${changedAt.toISOString()}`;
      await this.prisma.client.programWalletSyncJob.upsert({
        where: { idempotencyKey: `program-wallet-nearby-location:${programId}:${fingerprint}` },
        create: {
          organizationId,
          programId,
          action: "update",
          reason: "NEARBY_RELEVANCE_CHANGED",
          commandType: "UPDATE",
          idempotencyKey: `program-wallet-nearby-location:${programId}:${fingerprint}`,
          batchSize: 500,
        },
        update: {},
      });
    }
  }

  private async removeArchivedNearbyLocation(
    userId: string,
    organizationId: string,
    locationId: string,
    changedAt: Date,
    request: WafloRequest,
  ) {
    const configuration = await this.prisma.client.walletNearbyConfiguration.findFirst({
      where: { organizationId, locations: { some: { locationId } } },
      select: { id: true, revision: true },
    });
    if (configuration) {
      await this.prisma.client.$transaction(async (transaction) => {
        await transaction.walletNearbyLocation.deleteMany({
          where: { configurationId: configuration.id, locationId },
        });
        const remainingLocations = await transaction.walletNearbyLocation.count({
          where: { configurationId: configuration.id },
        });
        await transaction.walletNearbyConfiguration.update({
          where: { id: configuration.id },
          data: {
            revision: { increment: 1 },
            ...(remainingLocations === 0 ? { enabled: false } : {}),
          },
        });
        const programs = await transaction.loyaltyProgram.findMany({
          where: {
            organizationId,
            OR: [
              { walletBindings: { some: {} } },
              { memberships: { some: { walletPassInstances: { some: {} } } } },
            ],
          },
          select: { id: true },
        });
        await transaction.programWalletSyncJob.createMany({
          data: programs.map(({ id: programId }) => ({
            organizationId,
            programId,
            action: "update",
            reason: "NEARBY_RELEVANCE_CHANGED",
            commandType: "UPDATE",
            idempotencyKey: `program-wallet-nearby-archive:${programId}:${changedAt.toISOString()}`,
            batchSize: 500,
          })),
          skipDuplicates: true,
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "wallet.nearby_location_selection_changed",
            targetType: "wallet_nearby_configuration",
            targetId: configuration.id,
            metadata: {
              scope: "ORGANIZATION",
              affectedProgramIds: programs.map((program) => program.id),
              removedLocationId: locationId,
              nearbyDisabled: remainingLocations === 0,
              revision: configuration.revision + 1,
            },
          },
          request,
        );
      });
    }
  }
}

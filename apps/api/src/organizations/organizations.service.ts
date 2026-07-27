import { HttpStatus, Injectable } from "@nestjs/common";
import { verifyPassword } from "@waflo/auth";
import type { OrganizationInput } from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { TenantService } from "../tenancy/tenant.service.js";
import { oldSlugReservedUntil, validateSlug } from "../tenancy/slug.js";

const localeToDb = (locale: "en" | "ar"): "EN" | "AR" => (locale === "ar" ? "AR" : "EN");
const planToDb = (plan: "starter" | "growth" | "scale") =>
  plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE";

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly environment: EnvironmentService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    return this.prisma.client.organizationMember.findMany({
      where: { userId, status: "ACTIVE", organization: { status: { not: "ARCHIVED" } } },
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
            status: true,
            billingProfile: {
              select: {
                subscriptionStatus: true,
                trialStart: true,
                trialEnd: true,
              },
            },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });
  }

  async create(userId: string, input: OrganizationInput, request: WafloRequest) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user?.emailVerifiedAt) {
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verify your email before continuing onboarding.",
        HttpStatus.FORBIDDEN,
      );
    }
    const availability = await this.slugAvailability(input.merchantSlug);
    if (!availability.available) {
      throw new AppError(
        availability.reason ?? "SLUG_UNAVAILABLE",
        "That merchant URL is not available.",
        HttpStatus.CONFLICT,
      );
    }
    const merchantSlug = availability.slug;
    const selectedPlan = planToDb(input.selectedPlan);
    const organization = await this.prisma.client.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        const created = await transaction.organization.create({
          data: {
            name: input.name,
            normalizedName: input.name.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
            merchantSlug,
            businessCategory: input.businessCategory ?? null,
            defaultLocale: localeToDb(input.defaultLocale),
            timezone: input.timezone,
            selectedPlan,
            onboardingState: "LOCATION",
          },
        });
        await transaction.organizationMember.create({
          data: { organizationId: created.id, userId, role: "OWNER" },
        });
        await transaction.organizationBillingProfile.create({
          data: {
            organizationId: created.id,
            selectedPlan,
            subscriptionStatus: "PENDING_ACTIVATION",
            trialStart: null,
            trialEnd: null,
          },
        });
        await transaction.organizationDomain.create({
          data: {
            organizationId: created.id,
            hostname: `${merchantSlug}.${this.environment.values.MERCHANT_BASE_DOMAIN}`,
            type: "SUBDOMAIN",
            status: "ACTIVE",
            isPrimary: true,
          },
        });
        await transaction.user.update({
          where: { id: userId },
          data: { lastSelectedOrganizationId: created.id },
        });
        return created;
      },
    );
    await this.audit.record(
      {
        organizationId: organization.id,
        actorUserId: userId,
        action: "organization.created",
        targetType: "organization",
        targetId: organization.id,
        metadata: { selectedPlan, merchantSlug },
      },
      request,
    );
    return organization;
  }

  async get(userId: string, organizationId: string) {
    await this.tenant.requireMembership(userId, organizationId, "organization.view");
    return this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        billingProfile: true,
        domains: { where: { isPrimary: true }, take: 1 },
        locations: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
        _count: {
          select: {
            locations: { where: { status: "ACTIVE" } },
            members: { where: { status: "ACTIVE" } },
          },
        },
      },
    });
  }

  async update(
    userId: string,
    organizationId: string,
    input: {
      name?: string | undefined;
      businessCategory?: string | null | undefined;
      defaultLocale?: "en" | "ar" | undefined;
      timezone?: string | undefined;
    },
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "organization.manage");
    const organization = await this.prisma.client.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        const updated = await transaction.organization.update({
          where: { id: organizationId },
          data: {
            ...(input.name
              ? {
                  name: input.name,
                  normalizedName: input.name.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
                }
              : {}),
            ...(input.businessCategory !== undefined
              ? { businessCategory: input.businessCategory }
              : {}),
            ...(input.defaultLocale ? { defaultLocale: localeToDb(input.defaultLocale) } : {}),
            ...(input.timezone ? { timezone: input.timezone } : {}),
          },
        });
        return updated;
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "organization.updated",
        targetType: "organization",
        targetId: organizationId,
        metadata: { fields: Object.keys(input) },
      },
      request,
    );
    return organization;
  }

  async select(userId: string, organizationId: string) {
    await this.tenant.requireMembership(userId, organizationId, "organization.view");
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { lastSelectedOrganizationId: organizationId },
    });
    return { organizationId };
  }

  async slugAvailability(value: string, excludeOrganizationId?: string) {
    const validation = validateSlug(value);
    if (!validation.valid) {
      return {
        available: false,
        slug: validation.slug,
        reason: validation.reason,
      };
    }
    const [current, history] = await Promise.all([
      this.prisma.client.organization.findFirst({
        where: {
          merchantSlug: validation.slug,
          ...(excludeOrganizationId ? { id: { not: excludeOrganizationId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.client.merchantSlugHistory.findFirst({
        where: { slug: validation.slug, reservedUntil: { gt: new Date() } },
        select: { id: true },
      }),
    ]);
    return {
      available: !current && !history,
      slug: validation.slug,
      ...((current || history) && { reason: "SLUG_UNAVAILABLE" }),
    };
  }

  async changeSlug(
    userId: string,
    organizationId: string,
    slugInput: string,
    password: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "organization.slug.change");
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new AppError(
        "SENSITIVE_ACTION_CONFIRMATION_FAILED",
        "Password confirmation failed.",
        HttpStatus.FORBIDDEN,
      );
    }
    const availability = await this.slugAvailability(slugInput, organizationId);
    if (!availability.available) {
      throw new AppError(
        availability.reason ?? "SLUG_UNAVAILABLE",
        "That merchant URL is not available.",
        HttpStatus.CONFLICT,
      );
    }
    const changedAt = new Date();
    const result = await this.prisma.client.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        const current = await transaction.organization.findUniqueOrThrow({
          where: { id: organizationId },
        });
        if (current.merchantSlug === availability.slug) return current;
        await transaction.merchantSlugHistory.create({
          data: {
            organizationId,
            slug: current.merchantSlug,
            releasedAt: changedAt,
            reservedUntil: oldSlugReservedUntil(changedAt),
          },
        });
        await transaction.organizationDomain.updateMany({
          where: { organizationId, isPrimary: true, type: "SUBDOMAIN" },
          data: {
            hostname: `${availability.slug}.${this.environment.values.MERCHANT_BASE_DOMAIN}`,
          },
        });
        return transaction.organization.update({
          where: { id: organizationId },
          data: { merchantSlug: availability.slug },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "organization.slug_changed",
        targetType: "organization",
        targetId: organizationId,
        metadata: { previousSlugReservedUntil: oldSlugReservedUntil(changedAt).toISOString() },
      },
      request,
    );
    return result;
  }

  async completeOnboarding(userId: string, organizationId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "organization.manage");
    const activeLocations = await this.prisma.client.location.count({
      where: { organizationId, status: "ACTIVE" },
    });
    if (activeLocations < 1) {
      throw new AppError(
        "FIRST_LOCATION_REQUIRED",
        "Create your first active location before completing onboarding.",
      );
    }
    const organization = await this.prisma.client.organization.update({
      where: { id: organizationId },
      data: { onboardingState: "COMPLETE", onboardingCompletedAt: new Date() },
      include: { billingProfile: true, locations: { where: { status: "ACTIVE" } } },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "organization.onboarding_completed",
        targetType: "organization",
        targetId: organizationId,
      },
      request,
    );
    return organization;
  }
}

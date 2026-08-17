import { createHash } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { ProgramEnrollmentPolicyInput } from "@waflo/contracts";
import {
  canonicalJoinUrl,
  createQrPng,
  createQrSvg,
  validateProgramPublicSlug,
} from "@waflo/qr-core";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withOrganizationInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

const reservedProgramSlugs = new Set([
  "admin",
  "api",
  "card",
  "join",
  "privacy",
  "program",
  "support",
  "terms",
  "transfer",
  "wallet",
  "waflo",
]);

@Injectable()
export class EnrollmentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly environment: EnvironmentService,
  ) {}

  async get(userId: string, organizationId: string, programId: string) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const program = await this.prisma.client.loyaltyProgram.findFirst({
      where: { id: programId, organizationId },
      include: {
        organization: { select: { merchantSlug: true, name: true } },
        currentDraftVersion: { include: { enrollmentPolicy: true } },
        currentPublishedVersion: { include: { enrollmentPolicy: true } },
      },
    });
    if (!program)
      throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
    const editable = program.currentDraftVersion;
    const published = program.currentPublishedVersion;
    const publicUrl =
      program.publicSlug && published
        ? canonicalJoinUrl({
            merchantSlug: program.organization.merchantSlug,
            programSlug: program.publicSlug,
            customerBaseUrl: this.environment.values.CUSTOMER_WEB_URL,
            merchantBaseDomain: this.environment.values.MERCHANT_BASE_DOMAIN,
          })
        : null;
    return {
      programId: program.id,
      status: program.status,
      publicSlug: program.publicSlug,
      publicUrl,
      enrollmentLinkStatus: !published
        ? "NOT_PUBLISHED"
        : program.status === "PUBLISHED"
          ? "ACTIVE"
          : "BLOCKED",
      editableVersion: editable
        ? {
            id: editable.id,
            versionNumber: editable.versionNumber,
            status: editable.status,
            policy: this.policy(editable.enrollmentPolicy),
          }
        : null,
      publishedVersion: published
        ? {
            id: published.id,
            versionNumber: published.versionNumber,
            status: published.status,
            policy: this.policy(published.enrollmentPolicy),
          }
        : null,
    };
  }

  async updatePolicy(
    userId: string,
    organizationId: string,
    programId: string,
    versionId: string,
    input: ProgramEnrollmentPolicyInput,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    return withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          include: { currentDraftVersion: true },
        });
        if (!program)
          throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
        if (
          program.currentDraftVersionId !== versionId ||
          !program.currentDraftVersion ||
          ["PUBLISHED", "SUPERSEDED", "ABANDONED"].includes(program.currentDraftVersion.status)
        ) {
          throw new AppError(
            "PROGRAM_DRAFT_REQUIRED",
            "Enrollment settings can only be changed on the current draft version.",
            HttpStatus.CONFLICT,
          );
        }
        const policy = await transaction.programEnrollmentPolicy.upsert({
          where: { programVersionId: versionId },
          create: {
            organizationId,
            programVersionId: versionId,
            ...this.policyData(input),
          },
          update: this.policyData(input),
        });
        await transaction.loyaltyProgramVersion.update({
          where: { id: versionId },
          data: {
            revision: { increment: 1 },
            status: "DRAFT",
            validatedAt: null,
            testReadyAt: null,
            validationFingerprint: null,
            renderFingerprint: null,
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.enrollment_policy_changed",
            targetType: "program_enrollment_policy",
            targetId: policy.id,
            metadata: {
              programId,
              versionId,
              emailCollectionMode: policy.emailCollectionMode,
              enrollmentOpen: policy.enrollmentOpen,
            },
          },
          request,
        );
        return this.policy(policy);
      },
    );
  }

  async changePublicSlug(
    userId: string,
    organizationId: string,
    programId: string,
    slugInput: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    const slug = validateProgramPublicSlug(slugInput);
    if (reservedProgramSlugs.has(slug)) {
      throw new AppError(
        "PROGRAM_PUBLIC_SLUG_RESERVED",
        "This public program URL is reserved.",
        HttpStatus.CONFLICT,
      );
    }
    return withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          include: { organization: { select: { merchantSlug: true } } },
        });
        if (!program)
          throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
        if (program.publicSlug === slug)
          return this.slugResult(program.organization.merchantSlug, slug);
        const collision = await transaction.loyaltyProgram.findFirst({
          where: { organizationId, publicSlug: slug, id: { not: programId } },
          select: { id: true },
        });
        const reserved = await transaction.programPublicSlugHistory.findFirst({
          where: { organizationId, slug, reservedUntil: { gt: new Date() } },
          select: { id: true },
        });
        if (collision || reserved) {
          throw new AppError(
            "PROGRAM_PUBLIC_SLUG_UNAVAILABLE",
            "This public program URL is not available.",
            HttpStatus.CONFLICT,
          );
        }
        if (program.publicSlug) {
          await transaction.programPublicSlugHistory.create({
            data: {
              organizationId,
              programId,
              slug: program.publicSlug,
              releasedAt: new Date(),
              reservedUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            },
          });
        }
        await transaction.loyaltyProgram.update({
          where: { id: programId },
          data: { publicSlug: slug, revision: { increment: 1 } },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.public_slug_changed",
            targetType: "loyalty_program",
            targetId: programId,
            metadata: {
              previousSlugHash: program.publicSlug
                ? createHash("sha256").update(program.publicSlug).digest("hex")
                : null,
              publicSlug: slug,
            },
          },
          request,
        );
        return this.slugResult(program.organization.merchantSlug, slug);
      },
    );
  }

  async enrollmentQr(
    userId: string,
    organizationId: string,
    programId: string,
    format: "png" | "svg",
    locale: "en" | "ar",
    request?: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const program = await this.prisma.client.loyaltyProgram.findFirst({
      where: { id: programId, organizationId },
      include: { organization: { select: { merchantSlug: true } } },
    });
    if (!program?.publicSlug) {
      throw new AppError(
        "PROGRAM_PUBLIC_SLUG_REQUIRED",
        "The program has no public enrollment URL.",
        HttpStatus.CONFLICT,
      );
    }
    const url = canonicalJoinUrl({
      merchantSlug: program.organization.merchantSlug,
      programSlug: program.publicSlug,
      customerBaseUrl: this.environment.values.CUSTOMER_WEB_URL,
      merchantBaseDomain: this.environment.values.MERCHANT_BASE_DOMAIN,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.enrollment_qr_generated",
        targetType: "loyalty_program",
        targetId: programId,
        metadata: { format, locale },
      },
      request,
    );
    return format === "svg"
      ? { content: Buffer.from(await createQrSvg(url), "utf8"), mimeType: "image/svg+xml", url }
      : { content: await createQrPng(url), mimeType: "image/png", url };
  }

  private slugResult(merchantSlug: string, programSlug: string) {
    return {
      publicSlug: programSlug,
      publicUrl: canonicalJoinUrl({
        merchantSlug,
        programSlug,
        customerBaseUrl: this.environment.values.CUSTOMER_WEB_URL,
        merchantBaseDomain: this.environment.values.MERCHANT_BASE_DOMAIN,
      }),
    };
  }

  private policyData(input: ProgramEnrollmentPolicyInput) {
    return {
      emailCollectionMode: input.emailCollectionMode,
      primaryCustomerLocale:
        input.primaryCustomerLocale === "ar" ? ("AR" as const) : ("EN" as const),
      allowLocaleSelection: input.allowLocaleSelection,
      marketingConsentVisible: input.marketingConsentVisible,
      marketingConsentDefault: false,
      customerTermsRequired: true,
      transferWithoutEmailAllowed: input.transferWithoutEmailAllowed,
      enrollmentOpen: input.enrollmentOpen,
    };
  }

  private policy(
    value: {
      emailCollectionMode: "HIDDEN" | "OPTIONAL" | "REQUIRED";
      primaryCustomerLocale: "EN" | "AR";
      allowLocaleSelection: boolean;
      marketingConsentVisible: boolean;
      marketingConsentDefault: boolean;
      customerTermsRequired: boolean;
      transferWithoutEmailAllowed: boolean;
      enrollmentOpen: boolean;
    } | null,
  ) {
    return {
      emailCollectionMode: value?.emailCollectionMode ?? "OPTIONAL",
      primaryCustomerLocale: value?.primaryCustomerLocale === "AR" ? "ar" : "en",
      allowLocaleSelection: value?.allowLocaleSelection ?? true,
      marketingConsentVisible: value?.marketingConsentVisible ?? false,
      marketingConsentDefault: false,
      customerTermsRequired: true,
      transferWithoutEmailAllowed: value?.transferWithoutEmailAllowed ?? true,
      enrollmentOpen: value?.enrollmentOpen ?? true,
    };
  }
}

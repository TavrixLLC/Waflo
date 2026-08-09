import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { HostResolutionService } from "../public/host-resolution.service.js";
import { AuditService } from "../audit/audit.service.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../programs/object-storage.js";
import {
  publishedVisualThemeInclude,
  renderPublishedStampArtwork,
} from "../programs/published-stamp-render.js";
import { CustomerSecurityService } from "./customer-security.service.js";
import { withInvariantLock } from "../common/organization-transaction.js";
import { WalletProviderRegistry } from "../wallet/wallet-provider.registry.js";

const customerCardMembershipInclude = {
  organization: true,
  customer: {
    include: {
      contacts: {
        where: { archivedAt: null, isPrimary: true },
        select: { maskedDisplayValue: true, verificationStatus: true, type: true },
      },
    },
  },
  program: true,
  enrollmentProgramVersion: {
    include: {
      translations: true,
      stampRule: true,
      rewards: { include: { translations: true }, orderBy: { sortOrder: "asc" as const } },
      visualTheme: publishedVisualThemeInclude,
      enrollmentPolicy: true,
    },
  },
  progress: true,
  credentials: { orderBy: { credentialVersion: "desc" as const } },
  walletPassInstances: {
    orderBy: { createdAt: "desc" as const },
    select: {
      provider: true,
      status: true,
      membershipCredentialId: true,
      lastProviderErrorCode: true,
      providerState: true,
    },
  },
} as const;

@Injectable()
export class CustomerCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly security: CustomerSecurityService,
    private readonly hosts: HostResolutionService,
    private readonly audit: AuditService,
    private readonly walletProviders: WalletProviderRegistry,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  customerCsrfToken(rawSessionToken: string): string {
    return this.security.customerCsrfToken(rawSessionToken);
  }

  async session(
    request: WafloRequest,
    expectedPublicMembershipId?: string,
    developmentOverride?: string,
  ) {
    const context = await this.requireSession(request, developmentOverride);
    if (
      expectedPublicMembershipId &&
      context.session.membership.publicMembershipId !== expectedPublicMembershipId
    ) {
      throw new AppError(
        "CUSTOMER_CARD_NOT_FOUND",
        "This customer card is unavailable.",
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      publicMembershipId: context.session.membership.publicMembershipId,
      expiresAt: context.session.expiresAt,
      credentialStatus: context.session.membershipCredential?.status ?? "REVOKED",
      locale:
        context.session.membership.customer.preferredLocale === "AR"
          ? ("ar" as const)
          : ("en" as const),
    };
  }

  async card(
    request: WafloRequest,
    expectedPublicMembershipId?: string,
    developmentOverride?: string,
  ) {
    const context = await this.requireSession(request, developmentOverride);
    const membership = context.session.membership;
    if (
      expectedPublicMembershipId &&
      membership.publicMembershipId !== expectedPublicMembershipId
    ) {
      throw new AppError(
        "CUSTOMER_CARD_NOT_FOUND",
        "This customer card is unavailable.",
        HttpStatus.NOT_FOUND,
      );
    }
    const boundCredential = context.session.membershipCredential;
    const credentialStatus = boundCredential?.status ?? "REVOKED";
    const credentialActive =
      credentialStatus === "ACTIVE" &&
      membership.status === "ACTIVE" &&
      membership.customer.status === "ACTIVE";
    const locale = membership.customer.preferredLocale === "AR" ? "AR" : "EN";
    const translations = membership.enrollmentProgramVersion.translations;
    const selected =
      translations.find((item) => item.locale === locale) ??
      translations.find((item) => item.locale === "EN") ??
      translations[0];
    const goal = membership.enrollmentProgramVersion.stampRule?.requiredStampCount ?? 8;
    const progress = membership.progress?.currentCycleStampCount ?? 0;
    const wallet = membership.walletPassInstances.filter(
      (item) => item.membershipCredentialId === boundCredential?.id,
    );
    const email = membership.customer.contacts.find((item) => item.type === "EMAIL");
    if (!membership.enrollmentProgramVersion.visualTheme) {
      throw new AppError(
        "PROGRAM_ASSET_CONTENT_UNAVAILABLE",
        "The published card artwork is unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const stampRender = await renderPublishedStampArtwork({
      storage: this.objectStorage,
      organizationId: membership.organizationId,
      programId: membership.programId,
      programVersionId: membership.enrollmentProgramVersionId,
      membershipId: membership.id,
      locale: locale === "AR" ? "ar" : "en",
      requiredStampCount: goal,
      currentStampCount: progress,
      rewardReady: membership.progress?.rewardReady ?? false,
      theme: membership.enrollmentProgramVersion.visualTheme,
      outputProfile: "CUSTOMER_WEB",
    });
    await this.touch(context.session.id, context.session.lastActiveAt);
    return {
      publicMembershipId: membership.publicMembershipId,
      customer: {
        displayName: membership.customer.displayName,
        preferredLocale: locale === "AR" ? "ar" : "en",
        maskedEmail: email?.maskedDisplayValue ?? null,
        emailVerificationStatus: email?.verificationStatus ?? null,
      },
      merchant: {
        name: membership.organization.name,
        slug: membership.organization.merchantSlug,
      },
      program: {
        slug: membership.program.publicSlug,
        status: membership.program.status,
        name: selected?.programName ?? membership.program.internalName,
        description: selected?.shortDescription ?? "",
        rewardSummary: selected?.rewardSummary ?? "",
        termsAndConditions: selected?.termsAndConditions ?? "",
        pausedMessage: selected?.pausedMessage ?? null,
        enrollmentVersionNumber: membership.enrollmentProgramVersion.versionNumber,
      },
      membership: {
        status: membership.status,
        credentialStatus,
        state:
          credentialStatus === "TRANSFERRED"
            ? "TRANSFERRED"
            : membership.program.status === "PAUSED"
              ? "PROGRAM_PAUSED"
              : membership.program.status === "ARCHIVED"
                ? "PROGRAM_ARCHIVED"
                : membership.program.status === "SUSPENDED"
                  ? "PROGRAM_UNAVAILABLE"
                  : membership.status,
        enrolledAt: membership.enrolledAt,
      },
      progress: {
        currentCycleStampCount: progress,
        completedCycleCount: membership.progress?.completedCycleCount ?? 0,
        rewardReady: membership.progress?.rewardReady ?? false,
        projectionVersion: membership.progress?.projectionVersion ?? 0,
        goal,
        stamps: Array.from({ length: goal }, (_, index) =>
          index < progress ? ("FILLED" as const) : ("EMPTY" as const),
        ),
        render: {
          dataUri: stampRender.dataUri,
          contentDigest: stampRender.contentDigest,
          configurationDigest: stampRender.configurationDigest,
          width: stampRender.width,
          height: stampRender.height,
        },
      },
      theme: {
        backgroundColor:
          membership.enrollmentProgramVersion.visualTheme?.backgroundColor ?? "#F7F4EE",
        foregroundColor:
          membership.enrollmentProgramVersion.visualTheme?.foregroundColor ?? "#241916",
        accentColor: membership.enrollmentProgramVersion.visualTheme?.accentColor ?? "#E4572E",
        secondaryColor:
          membership.enrollmentProgramVersion.visualTheme?.secondaryColor ?? "#F3A712",
        layoutType: membership.enrollmentProgramVersion.visualTheme?.layoutType ?? "GRID",
      },
      membershipQr:
        credentialActive && boundCredential
          ? {
              payload: this.security.payloadForCredential(boundCredential),
              format: "wfl1",
              containsPii: false,
            }
          : null,
      wallet: {
        apple: this.walletState(
          "APPLE",
          wallet.find((item) => item.provider === "APPLE"),
          credentialActive,
        ),
        google: this.walletState(
          "GOOGLE",
          wallet.find((item) => item.provider === "GOOGLE"),
          credentialActive,
        ),
      },
      transfer: {
        allowed:
          credentialActive &&
          membership.program.status !== "ARCHIVED" &&
          membership.program.status !== "SUSPENDED",
        emailConfirmationRequired: Boolean(email),
        transferWithoutEmailAllowed:
          membership.enrollmentProgramVersion.enrollmentPolicy?.transferWithoutEmailAllowed ?? true,
      },
      privacy: {
        operator: "Tavrix LLC",
        privacyVersion: this.environment.values.LEGAL_PRIVACY_VERSION,
        legalReviewPending: true,
      },
    };
  }

  async walletStatus(request: WafloRequest, developmentOverride?: string) {
    const card = await this.card(request, undefined, developmentOverride);
    return { wallet: card.wallet, credentialStatus: card.membership.credentialStatus };
  }

  async rotate(request: WafloRequest, developmentOverride?: string) {
    const context = await this.requireSession(request, developmentOverride);
    if (context.session.membershipCredential?.status !== "ACTIVE") {
      throw new AppError(
        "CUSTOMER_SESSION_ROTATION_DENIED",
        "This card credential is no longer active.",
        HttpStatus.CONFLICT,
      );
    }
    const rawToken = this.security.randomCustomerSessionToken();
    const next = await withInvariantLock(
      this.prisma.client,
      `customer-session-rotation:${context.session.id}`,
      async (transaction) => {
        const current = await transaction.membershipAccessSession.findUnique({
          where: { id: context.session.id },
          select: { revokedAt: true, expiresAt: true },
        });
        if (!current || current.revokedAt || current.expiresAt <= new Date()) {
          throw new AppError(
            "CUSTOMER_SESSION_ALREADY_ROTATED",
            "This customer session was already rotated.",
            HttpStatus.CONFLICT,
          );
        }
        await transaction.membershipAccessSession.update({
          where: { id: context.session.id },
          data: { revokedAt: new Date() },
        });
        return transaction.membershipAccessSession.create({
          data: {
            organizationId: context.session.organizationId,
            membershipId: context.session.membershipId,
            membershipCredentialId: context.session.membershipCredentialId,
            tokenHash: this.security.hashSessionToken(rawToken),
            expiresAt: this.security.customerSessionExpiresAt(),
            userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
          },
        });
      },
    );
    return { sessionToken: rawToken, expiresAt: next.expiresAt };
  }

  async logout(request: WafloRequest, developmentOverride?: string) {
    const context = await this.requireSession(request, developmentOverride);
    await this.prisma.client.membershipAccessSession.update({
      where: { id: context.session.id },
      data: { revokedAt: new Date() },
    });
    return { status: "logged_out" as const };
  }

  async createPrivacyRequest(
    request: WafloRequest,
    input: { commandId: string; requestType: "EXPORT" | "ERASURE"; confirmation: string },
    developmentOverride?: string,
  ) {
    const context = await this.requireSession(request, developmentOverride);
    if (input.confirmation !== "CONFIRM") {
      throw new AppError(
        "PRIVACY_REQUEST_CONFIRMATION_REQUIRED",
        "Confirm the privacy request to continue.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const organizationId = context.session.organizationId;
    const customerId = context.session.membership.customerId;
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ customerId, requestType: input.requestType }), "utf8")
      .digest("hex");
    const now = new Date();
    return withInvariantLock(
      this.prisma.client,
      `customer-privacy:${organizationId}:${input.commandId}`,
      async (transaction) => {
        const existing = await transaction.customerPrivacyRequest.findUnique({
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
            existing.requestType !== input.requestType ||
            existing.requestFingerprint !== requestFingerprint
          ) {
            throw new AppError(
              "OPERATION_IDEMPOTENCY_CONFLICT",
              "Command conflict.",
              HttpStatus.CONFLICT,
            );
          }
          return { publicId: existing.publicId, status: existing.status, replayed: true };
        }
        const privacy = await transaction.customerPrivacyRequest.create({
          data: {
            organizationId,
            customerId,
            requestType: input.requestType,
            requestedByUserId: null,
            requestedByCustomerSessionId: context.session.id,
            identityValidatedAt: now,
            idempotencyKey: input.commandId,
            requestFingerprint,
            confirmationMetadata: {
              confirmed: true,
              source: "CUSTOMER_AUTHENTICATED_SESSION",
            },
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            action: "customer.privacy_request_received",
            targetType: "customer_privacy_request",
            targetId: privacy.id,
            metadata: { requestType: input.requestType, identityValidated: true },
          },
          request,
        );
        return { publicId: privacy.publicId, status: privacy.status, replayed: false };
      },
    );
  }

  async privacyRequestStatus(
    request: WafloRequest,
    publicId: string,
    developmentOverride?: string,
  ) {
    const context = await this.requireSession(request, developmentOverride);
    const privacy = await this.prisma.client.customerPrivacyRequest.findFirst({
      where: {
        publicId,
        organizationId: context.session.organizationId,
        customerId: context.session.membership.customerId,
      },
      select: {
        publicId: true,
        requestType: true,
        status: true,
        outcomeDisposition: true,
        retentionNoticeCode: true,
        createdAt: true,
        completedAt: true,
        expiresAt: true,
      },
    });
    if (!privacy) {
      throw new AppError(
        "PRIVACY_REQUEST_NOT_FOUND",
        "Privacy request not found.",
        HttpStatus.NOT_FOUND,
      );
    }
    return privacy;
  }

  async requireSession(request: WafloRequest, developmentOverride?: string) {
    const rawToken = request.cookies[this.environment.values.CUSTOMER_COOKIE_NAME];
    if (!rawToken) {
      throw new AppError(
        "CUSTOMER_AUTH_REQUIRED",
        "Open this card from the device where it was enrolled or transferred.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.prisma.client.membershipAccessSession.findUnique({
      where: { tokenHash: this.security.hashSessionToken(rawToken) },
      include: {
        membershipCredential: true,
        membership: { include: customerCardMembershipInclude },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new AppError(
        "CUSTOMER_SESSION_EXPIRED",
        "This customer card session has expired.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const resolved = await this.hosts.resolveOrganization(request.hostname, developmentOverride);
    if (resolved.status !== "active" || resolved.organization.id !== session.organizationId) {
      await this.audit.security(
        {
          organizationId: session.organizationId,
          eventType: "customer_session.cross_host_rejected",
          severity: "HIGH",
          metadata: { hostMatched: false },
        },
        request,
      );
      throw new AppError(
        "CUSTOMER_SESSION_HOST_MISMATCH",
        "This card session cannot be used on this merchant host.",
        HttpStatus.FORBIDDEN,
      );
    }
    return { session };
  }

  private walletState(
    provider: "APPLE" | "GOOGLE",
    instance:
      | {
          status: string;
          lastProviderErrorCode: string | null;
          providerState: unknown;
        }
      | undefined,
    credentialActive: boolean,
  ) {
    const mode = this.walletProviders.get(provider).mode;
    return {
      mode,
      status:
        !credentialActive || mode === "DISABLED"
          ? ("UNAVAILABLE" as const)
          : instance?.status === "ACTIVE" || instance?.status === "ISSUED"
            ? ("READY" as const)
            : instance?.status === "ERROR"
              ? ("UNAVAILABLE" as const)
              : ("PREPARING" as const),
      testAdapter: mode === "TEST_ADAPTER",
      safeErrorCode: instance?.lastProviderErrorCode ?? null,
    };
  }

  private async touch(sessionId: string, lastActiveAt: Date) {
    if (lastActiveAt > new Date(Date.now() - 5 * 60 * 1000)) return;
    await this.prisma.client.membershipAccessSession.update({
      where: { id: sessionId },
      data: { lastActiveAt: new Date() },
    });
  }
}

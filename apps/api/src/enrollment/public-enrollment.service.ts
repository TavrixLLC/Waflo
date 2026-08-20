import { createHash, randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  effectiveBillingStatus,
  enrollmentBillingDecision,
  walletIncludedForPlan,
} from "@waflo/billing";
import type { BillingStatus, EnrollmentInput } from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import { canonicalCustomerUrl } from "@waflo/qr-core";
import { googleLoyaltyObjectId } from "@waflo/wallet-google";
import { walletCommandIdempotencyKey, type WalletProviderCode } from "@waflo/wallet-core";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withProgramLifecycleInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { CustomerSecurityService } from "../customer/customer-security.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { HostResolutionService } from "../public/host-resolution.service.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../programs/object-storage.js";
import {
  publishedVisualThemeInclude,
  renderPublishedStampArtwork,
} from "../programs/published-stamp-render.js";
import { resolvePreviewAssetContent, type PreviewAsset } from "../programs/preview-assets.js";

const visibleProgramStates = ["PUBLISHED", "PAUSED", "ARCHIVED", "SUSPENDED"] as const;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function billingStatus(value: string): BillingStatus {
  return value.toLocaleLowerCase("en-US") as BillingStatus;
}

const publicVersionInclude = {
  enrollmentPolicy: true,
  translations: true,
  cardLocales: {
    where: { enabled: true },
    orderBy: [{ position: "asc" }, { locale: "asc" }],
    include: { rewardTranslations: true },
  },
  stampRule: true,
  rewards: { include: { translations: true }, orderBy: { sortOrder: "asc" as const } },
  locations: {
    include: {
      location: {
        select: {
          name: true,
          city: true,
          region: true,
          status: true,
        },
      },
    },
  },
  visualTheme: publishedVisualThemeInclude,
} satisfies Prisma.LoyaltyProgramVersionInclude;

@Injectable()
export class PublicEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hosts: HostResolutionService,
    private readonly security: CustomerSecurityService,
    private readonly environment: EnvironmentService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async merchantPrograms(host: string, developmentOverride?: string) {
    const resolved = await this.hosts.resolveOrganization(host, developmentOverride);
    if (resolved.status !== "active") return { status: resolved.status, programs: [] };
    const organization = resolved.organization;
    const programs = await this.prisma.client.loyaltyProgram.findMany({
      where: {
        organizationId: organization.id,
        status: { in: ["PUBLISHED", "PAUSED"] },
        currentPublishedVersionId: { not: null },
      },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      take: 50,
      include: { currentPublishedVersion: { include: publicVersionInclude } },
    });
    const renderedPrograms = await Promise.allSettled(
      programs
        .filter((program) => program.currentPublishedVersion)
        .map((program) => this.publicProgram(program, organization)),
    );
    return {
      status: "active" as const,
      merchant: {
        name: organization.name,
        slug: organization.merchantSlug,
        defaultLocale: organization.defaultLocale === "AR" ? "ar" : "en",
        brandLogoDataUri: await this.publicBrandLogoDataUri(organization.brandLogoAsset),
      },
      // A broken historical asset must not take the entire merchant discovery root
      // offline. The affected program remains unavailable (and its direct route
      // still returns the strict artwork error); no substitute artwork is rendered.
      programs: renderedPrograms.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
    };
  }

  async program(host: string, programSlug: string, developmentOverride?: string) {
    const resolved = await this.hosts.resolveOrganization(host, developmentOverride);
    if (resolved.status !== "active") return { status: resolved.status };
    const program = await this.prisma.client.loyaltyProgram.findFirst({
      where: {
        organizationId: resolved.organization.id,
        publicSlug: programSlug,
        status: { in: [...visibleProgramStates] },
      },
      include: { currentPublishedVersion: { include: publicVersionInclude } },
    });
    if (!program?.currentPublishedVersion) {
      throw new AppError(
        "PUBLIC_PROGRAM_NOT_FOUND",
        "This loyalty program is unavailable.",
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      status: "active" as const,
      merchant: {
        name: resolved.organization.name,
        slug: resolved.organization.merchantSlug,
        defaultLocale: resolved.organization.defaultLocale === "AR" ? "ar" : "en",
        brandLogoDataUri: await this.publicBrandLogoDataUri(resolved.organization.brandLogoAsset),
      },
      program: await this.publicProgram(program, resolved.organization),
    };
  }

  async enroll(
    host: string,
    programSlug: string,
    idempotencyKey: string,
    input: EnrollmentInput,
    request: WafloRequest,
    developmentOverride?: string,
  ) {
    if (!/^[A-Za-z0-9._:-]{16,255}$/.test(idempotencyKey)) {
      throw new AppError(
        "ENROLLMENT_IDEMPOTENCY_KEY_REQUIRED",
        "A valid enrollment idempotency key is required.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const resolved = await this.hosts.resolveOrganization(host, developmentOverride);
    if (resolved.status !== "active") {
      throw new AppError(
        "ENROLLMENT_UNAVAILABLE",
        "Enrollment is unavailable.",
        HttpStatus.NOT_FOUND,
      );
    }
    const organizationId = resolved.organization.id;
    const lockProgram = await this.prisma.client.loyaltyProgram.findFirst({
      where: { organizationId, publicSlug: programSlug },
      select: { id: true },
    });
    if (!lockProgram) {
      throw new AppError(
        "PROGRAM_NOT_ENROLLABLE",
        "This program is not accepting enrollment.",
        HttpStatus.CONFLICT,
      );
    }
    const email = input.email?.trim() ?? "";
    const requestFingerprint = sha256({
      programSlug,
      displayName: input.displayName.normalize("NFKC").trim(),
      emailHash: email ? this.security.emailRequestFingerprint(email) : null,
      preferredLocale: input.preferredLocale,
      programTermsAccepted: input.programTermsAccepted,
      wafloPrivacyAccepted: input.wafloPrivacyAccepted,
      marketingEmailConsent: input.marketingEmailConsent,
    });
    const result = await withProgramLifecycleInvariantLock(
      this.prisma.client,
      organizationId,
      lockProgram.id,
      async (transaction) => {
        const organization = await transaction.organization.findUnique({
          where: { id: organizationId },
          include: { billingProfile: true },
        });
        if (organization?.status !== "ACTIVE") {
          throw new AppError(
            "ENROLLMENT_UNAVAILABLE",
            "Enrollment is unavailable.",
            HttpStatus.CONFLICT,
          );
        }
        const existing = await transaction.enrollmentCommand.findUnique({
          where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
          include: { membership: true, accessSession: true },
        });
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) {
            throw new AppError(
              "ENROLLMENT_IDEMPOTENCY_KEY_CONFLICT",
              "This idempotency key was already used for different enrollment data.",
              HttpStatus.CONFLICT,
            );
          }
          if (existing.status === "COMPLETED" && existing.membership && existing.accessSession) {
            return this.completedEnrollment(
              transaction,
              organization.merchantSlug,
              existing.id,
              existing.membership,
              true,
            );
          }
          if (
            existing.status === "PROCESSING" &&
            existing.leaseExpiresAt &&
            existing.leaseExpiresAt > new Date()
          ) {
            throw new AppError(
              "ENROLLMENT_PROCESSING",
              "Enrollment is still processing. Retry with the same key.",
              HttpStatus.CONFLICT,
            );
          }
        }
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: lockProgram.id, organizationId, publicSlug: programSlug },
          include: {
            currentPublishedVersion: { include: publicVersionInclude },
          },
        });
        const version = program?.currentPublishedVersion;
        if (!program || !version || program.status !== "PUBLISHED") {
          throw new AppError(
            "PROGRAM_NOT_ENROLLABLE",
            "This program is not accepting enrollment.",
            HttpStatus.CONFLICT,
          );
        }
        const policy = version.enrollmentPolicy;
        if (!policy?.enrollmentOpen) {
          throw new AppError(
            "PROGRAM_ENROLLMENT_CLOSED",
            "This program is not accepting enrollment.",
            HttpStatus.CONFLICT,
          );
        }
        const billing = organization.billingProfile
          ? enrollmentBillingDecision(
              effectiveBillingStatus(
                billingStatus(organization.billingProfile.subscriptionStatus),
                organization.billingProfile.trialEnd,
              ),
            )
          : enrollmentBillingDecision("pending_activation");
        if (!billing.allowed) {
          throw new AppError(
            "ORGANIZATION_ENROLLMENT_BILLING_BLOCKED",
            "New enrollment is unavailable for this merchant.",
            HttpStatus.PAYMENT_REQUIRED,
            { reason: billing.code },
          );
        }
        if (policy.emailCollectionMode === "REQUIRED" && !email) {
          throw new AppError(
            "ENROLLMENT_EMAIL_REQUIRED",
            "Email is required for this program.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        if (policy.emailCollectionMode === "HIDDEN" && email) {
          throw new AppError(
            "ENROLLMENT_EMAIL_NOT_COLLECTED",
            "This program does not collect email.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        if (input.marketingEmailConsent && (!policy.marketingConsentVisible || !email)) {
          throw new AppError(
            "MARKETING_CONSENT_INVALID",
            "Marketing consent is not available for this enrollment.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const activeLocations = version.locations.filter(
          (item) => item.location.status === "ACTIVE",
        );
        if (activeLocations.length === 0 || !version.visualTheme) {
          throw new AppError(
            "PROGRAM_PUBLICATION_INCONSISTENT",
            "This program is temporarily unavailable.",
            HttpStatus.CONFLICT,
          );
        }
        const riskSignals: string[] = [];
        const completionTime = Date.now() - input.formStartedAt;
        if (completionTime >= 0 && completionTime < 500) riskSignals.push("fast_completion");
        const commandId = existing?.id ?? randomUUID();
        if (existing) {
          await transaction.enrollmentCommand.update({
            where: { id: existing.id },
            data: {
              status: "PROCESSING",
              leaseOwner: request.requestId,
              leaseExpiresAt: new Date(Date.now() + 30_000),
              failureCode: null,
            },
          });
        } else {
          await transaction.enrollmentCommand.create({
            data: {
              id: commandId,
              organizationId,
              programId: program.id,
              programVersionId: version.id,
              idempotencyKey,
              requestFingerprint,
              status: "PROCESSING",
              leaseOwner: request.requestId,
              leaseExpiresAt: new Date(Date.now() + 30_000),
            },
          });
        }
        const customerId = randomUUID();
        const membershipId = randomUUID();
        const accessSessionId = randomUUID();
        const credentialId = randomUUID();
        const credential = this.security.createCredential(1);
        const rawSessionToken = this.security.deterministicEnrollmentSessionToken(commandId);
        const preparedEmail = email ? this.security.prepareEmail(organizationId, email) : null;
        await transaction.customer.create({
          data: {
            id: customerId,
            organizationId,
            displayName: input.displayName.normalize("NFKC").trim(),
            preferredLocale: input.preferredLocale === "ar" ? "AR" : "EN",
            ...(preparedEmail
              ? {
                  contacts: {
                    create: {
                      ...preparedEmail,
                      organizationId,
                      type: "EMAIL",
                      verificationStatus: "UNVERIFIED",
                      isPrimary: true,
                    },
                  },
                }
              : {}),
          },
        });
        const membership = await transaction.membership.create({
          data: {
            id: membershipId,
            organizationId,
            customerId,
            programId: program.id,
            enrollmentProgramVersionId: version.id,
            publicMembershipId: this.security.createPublicMembershipId(),
            progress: {
              create: {
                organizationId,
                currentCycleStampCount: 0,
                completedCycleCount: 0,
                rewardReady: false,
                projectionVersion: 0,
              },
            },
            credentials: {
              create: {
                id: credentialId,
                organizationId,
                credentialVersion: 1,
                publicCredentialId: credential.publicCredentialId,
                secretVersion: credential.secretVersion,
                secretHash: credential.secretHash,
                status: "ACTIVE",
              },
            },
            accessSessions: {
              create: {
                id: accessSessionId,
                organizationId,
                membershipCredentialId: credentialId,
                tokenHash: this.security.hashSessionToken(rawSessionToken),
                expiresAt: this.security.customerSessionExpiresAt(),
                userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
              },
            },
          },
        });
        const consentFingerprint =
          version.validationFingerprint ??
          sha256({
            versionId: version.id,
            terms: version.translations.map((item) => [item.locale, item.termsAndConditions]),
          });
        await transaction.customerConsent.createMany({
          data: [
            {
              organizationId,
              customerId,
              membershipId,
              consentType: "WAFLO_PRIVACY",
              granted: true,
              documentFingerprint: this.environment.values.LEGAL_PRIVACY_VERSION,
              locale: input.preferredLocale === "ar" ? "AR" : "EN",
              safeMetadata: { riskSignals },
            },
            {
              organizationId,
              customerId,
              membershipId,
              consentType: "PROGRAM_TERMS",
              granted: true,
              documentFingerprint: consentFingerprint,
              locale: input.preferredLocale === "ar" ? "AR" : "EN",
            },
            ...(policy.marketingConsentVisible
              ? [
                  {
                    organizationId,
                    customerId,
                    membershipId,
                    consentType: "MARKETING_EMAIL" as const,
                    granted: input.marketingEmailConsent,
                    documentFingerprint: consentFingerprint,
                    locale: input.preferredLocale === "ar" ? ("AR" as const) : ("EN" as const),
                  },
                ]
              : []),
          ],
        });
        const providerStates = await this.createWalletOutbox(
          transaction,
          organization,
          program,
          version,
          membership,
          credentialId,
        );
        await transaction.enrollmentCommand.update({
          where: { id: commandId },
          data: {
            status: "COMPLETED",
            customerId,
            membershipId,
            accessSessionId,
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        for (const event of [
          ["customer.enrolled", "customer", customerId],
          ["membership.created", "membership", membershipId],
          ["membership.credential_created", "membership_credential", credentialId],
          ["membership.access_session_created", "membership_access_session", accessSessionId],
        ] as const) {
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              action: event[0],
              targetType: event[1],
              targetId: event[2],
              metadata: {
                programId: program.id,
                programVersionId: version.id,
                ...(event[0] === "customer.enrolled"
                  ? { contact: preparedEmail?.maskedDisplayValue ?? null }
                  : {}),
              },
            },
            request,
          );
        }
        return {
          ...(await this.completedEnrollment(
            transaction,
            organization.merchantSlug,
            commandId,
            membership,
            false,
          )),
          providerStates,
        };
      },
      [`enrollment:${organizationId}:${idempotencyKey}`],
    );
    return result;
  }

  private async completedEnrollment(
    transaction: Prisma.TransactionClient,
    merchantSlug: string,
    commandId: string,
    membership: { id: string; publicMembershipId: string },
    replayed: boolean,
  ) {
    const providerStates = await this.providerStates(transaction, membership.id);
    return {
      membership: {
        publicMembershipId: membership.publicMembershipId,
        cardUrl: canonicalCustomerUrl({
          customerBaseUrl: this.environment.values.CUSTOMER_WEB_URL,
          merchantBaseDomain: this.environment.values.MERCHANT_BASE_DOMAIN,
          merchantSlug,
          pathname: `/card/${membership.publicMembershipId}`,
        }),
      },
      providerStates,
      replayed,
      sessionToken: this.security.deterministicEnrollmentSessionToken(commandId),
    };
  }

  private async providerStates(transaction: Prisma.TransactionClient, membershipId: string) {
    const instances = await transaction.walletPassInstance.findMany({
      where: { membershipId },
      select: { provider: true, status: true },
    });
    const byProvider = new Map(instances.map((item) => [item.provider, item.status]));
    return {
      apple: this.providerPublicState("APPLE", byProvider.get("APPLE")),
      google: this.providerPublicState("GOOGLE", byProvider.get("GOOGLE")),
    };
  }

  private providerPublicState(provider: WalletProviderCode, status?: string) {
    const mode =
      provider === "APPLE"
        ? this.environment.values.APPLE_WALLET_MODE
        : this.environment.values.GOOGLE_WALLET_MODE;
    return {
      mode,
      status:
        mode === "DISABLED"
          ? ("UNAVAILABLE" as const)
          : status === "ACTIVE" || status === "ISSUED"
            ? ("READY" as const)
            : status === "ERROR"
              ? ("UNAVAILABLE" as const)
              : ("PREPARING" as const),
      testAdapter: mode === "TEST_ADAPTER",
    };
  }

  private async createWalletOutbox(
    transaction: Prisma.TransactionClient,
    organization: {
      id: string;
      name: string;
      selectedPlan: "STARTER" | "GROWTH" | "SCALE";
    },
    program: { id: string },
    version: {
      id: string;
      renderFingerprint: string | null;
      validationFingerprint: string | null;
    },
    membership: { id: string },
    credentialId: string,
  ) {
    if (
      !walletIncludedForPlan(
        organization.selectedPlan.toLocaleLowerCase("en-US") as "starter" | "growth" | "scale",
      )
    ) {
      return {
        apple: this.providerPublicState("APPLE"),
        google: this.providerPublicState("GOOGLE"),
      };
    }
    for (const provider of ["APPLE", "GOOGLE"] as const) {
      const mode =
        provider === "APPLE"
          ? this.environment.values.APPLE_WALLET_MODE
          : this.environment.values.GOOGLE_WALLET_MODE;
      if (mode === "DISABLED") continue;
      const configurationFingerprint =
        version.renderFingerprint ??
        version.validationFingerprint ??
        sha256({ version: version.id });
      const binding = await transaction.walletProgramBinding.upsert({
        where: {
          organizationId_programVersionId_provider: {
            organizationId: organization.id,
            programVersionId: version.id,
            provider,
          },
        },
        create: {
          organizationId: organization.id,
          programId: program.id,
          programVersionId: version.id,
          provider,
          status: "PENDING",
          configurationFingerprint,
          providerState: { mode },
        },
        update: {},
      });
      const passId = randomUUID();
      const providerIdentity =
        provider === "APPLE"
          ? `waflo.${passId.replaceAll("-", "")}`
          : googleLoyaltyObjectId(
              this.environment.values.GOOGLE_WALLET_ISSUER_ID ?? "test-issuer",
              passId,
            );
      const pass = await transaction.walletPassInstance.create({
        data: {
          id: passId,
          organizationId: organization.id,
          membershipId: membership.id,
          membershipCredentialId: credentialId,
          provider,
          walletProgramBindingId: binding.id,
          providerIdentity,
          status: "PENDING",
          providerState: { mode },
        },
      });
      const ensureKey = `wallet:${provider.toLocaleLowerCase("en-US")}:ensure-template:${version.id}`;
      await transaction.walletCommand.upsert({
        where: { idempotencyKey: ensureKey },
        create: {
          organizationId: organization.id,
          membershipId: membership.id,
          provider,
          commandType: "ENSURE_TEMPLATE",
          idempotencyKey: ensureKey,
          payloadFingerprint: configurationFingerprint,
          safePayload: { programVersionId: version.id, bindingId: binding.id },
        },
        update: {},
      });
      const issueKey = walletCommandIdempotencyKey({
        provider,
        commandType: "ISSUE",
        membershipId: membership.id,
        credentialVersion: 1,
      });
      await transaction.walletCommand.create({
        data: {
          organizationId: organization.id,
          membershipId: membership.id,
          walletPassInstanceId: pass.id,
          provider,
          commandType: "ISSUE",
          idempotencyKey: issueKey,
          payloadFingerprint: sha256({ passId, configurationFingerprint }),
          safePayload: { credentialVersion: 1 },
        },
      });
    }
    return this.providerStates(transaction, membership.id);
  }

  private async publicProgram(
    program: {
      id: string;
      publicSlug: string | null;
      status: string;
      currentPublishedVersion: {
        id: string;
        validationFingerprint: string | null;
        defaultCardLocale: string;
        translations: Array<{
          locale: "EN" | "AR";
          programName: string;
          shortDescription: string;
          fullDescription: string | null;
          rewardSummary: string;
          joinInstructions: string | null;
          termsAndConditions: string;
          pausedMessage: string | null;
        }>;
        cardLocales: Array<{
          locale: string;
          enabled: boolean;
          position: number;
          programName: string | null;
          shortDescription: string | null;
          earningDescription: string | null;
          fullDescription: string | null;
          rewardSummary: string | null;
          joinInstructions: string | null;
          termsAndConditions: string | null;
          pausedMessage: string | null;
          rewardTranslations: Array<{
            rewardId: string;
            name: string | null;
            description: string | null;
          }>;
        }>;
        stampRule: { requiredStampCount: number; earningDescription: string } | null;
        rewards: Array<{
          id: string;
          thresholdStampCount: number;
          translations: Array<{ locale: "EN" | "AR"; name: string; description: string }>;
        }>;
        locations: Array<{
          location: {
            name: string;
            city: string | null;
            region: string | null;
            status: string;
          };
        }>;
        visualTheme: {
          backgroundColor: string;
          foregroundColor: string;
          accentColor: string;
          secondaryColor: string;
          layoutType: "ROW" | "GRID" | "PATH" | "RING";
          layoutConfiguration: unknown;
          stampSize: number;
          stampSpacing: number;
          filledStampAsset: PreviewAsset;
          emptyStampAsset: PreviewAsset;
        } | null;
        enrollmentPolicy: {
          emailCollectionMode: "HIDDEN" | "OPTIONAL" | "REQUIRED";
          primaryCustomerLocale: "EN" | "AR";
          allowLocaleSelection: boolean;
          marketingConsentVisible: boolean;
          transferWithoutEmailAllowed: boolean;
          enrollmentOpen: boolean;
        } | null;
      } | null;
    },
    organization: {
      id: string;
      billingProfile: { subscriptionStatus: string; trialEnd: Date | null } | null;
      brandLogoAsset: PreviewAsset | null;
    },
  ) {
    const version = program.currentPublishedVersion;
    if (!version) throw new Error("Published program version is required.");
    const policy = version.enrollmentPolicy;
    const visualTheme = version.visualTheme;
    if (!visualTheme)
      throw new AppError(
        "PROGRAM_ASSET_CONTENT_UNAVAILABLE",
        "The published program artwork is unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    const goal = version.stampRule?.requiredStampCount ?? 8;
    const legacyCardLocales = version.translations.map((item, position) => ({
      locale: item.locale === "AR" ? "ar" : "en",
      enabled: true,
      position,
      programName: item.programName,
      shortDescription: item.shortDescription,
      earningDescription: version.stampRule?.earningDescription ?? null,
      fullDescription: item.fullDescription,
      rewardSummary: item.rewardSummary,
      joinInstructions: item.joinInstructions,
      termsAndConditions: item.termsAndConditions,
      pausedMessage: item.pausedMessage,
      rewardTranslations: version.rewards.flatMap((reward) =>
        reward.translations
          .filter((translation) => translation.locale === item.locale)
          .map((translation) => ({
            rewardId: reward.id,
            name: translation.name,
            description: translation.description,
          })),
      ),
    }));
    const cardLocales = (version.cardLocales.length ? version.cardLocales : legacyCardLocales)
      .filter((item) => item.enabled)
      .toSorted(
        (left, right) => left.position - right.position || left.locale.localeCompare(right.locale),
      );
    if (cardLocales.length === 0)
      throw new AppError(
        "PROGRAM_CARD_LOCALES_INVALID",
        "The published program has no enabled card language.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const firstCardLocale = cardLocales[0];
    if (!firstCardLocale)
      throw new AppError(
        "PROGRAM_CARD_LOCALES_INVALID",
        "The published program has no enabled card language.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const defaultLocale =
      cardLocales.find((item) => item.locale === version.defaultCardLocale)?.locale ??
      firstCardLocale.locale;
    const defaultPreview = await renderPublishedStampArtwork({
      storage: this.objectStorage,
      organizationId: organization.id,
      programId: program.id,
      programVersionId: version.id,
      membershipId: `join-preview:${version.id}`,
      locale: defaultLocale,
      requiredStampCount: goal,
      currentStampCount: 0,
      rewardReady: false,
      theme: visualTheme,
      outputProfile: "JOIN_PREVIEW",
    });
    const safePreview = (preview: typeof defaultPreview) => ({
      dataUri: preview.dataUri,
      contentDigest: preview.contentDigest,
      configurationDigest: preview.configurationDigest,
      width: preview.width,
      height: preview.height,
    });
    const billing = organization.billingProfile
      ? enrollmentBillingDecision(
          effectiveBillingStatus(
            billingStatus(organization.billingProfile.subscriptionStatus),
            organization.billingProfile.trialEnd,
          ),
        )
      : enrollmentBillingDecision("pending_activation");
    return {
      slug: program.publicSlug,
      status: program.status,
      enrollmentStatus:
        program.status !== "PUBLISHED"
          ? "PROGRAM_UNAVAILABLE"
          : !policy?.enrollmentOpen
            ? "CLOSED"
            : !billing.allowed
              ? "MERCHANT_UNAVAILABLE"
              : "OPEN",
      versionFingerprint:
        version.validationFingerprint ??
        sha256({ version: version.id, programSlug: program.publicSlug }),
      defaultLocale,
      enabledLocales: cardLocales.map((item) => item.locale),
      translations: Object.fromEntries(
        cardLocales.map((item) => [
          item.locale,
          {
            programName: item.programName ?? "",
            shortDescription: item.shortDescription ?? "",
            earningDescription:
              item.earningDescription ?? version.stampRule?.earningDescription ?? "",
            fullDescription: item.fullDescription,
            rewardSummary: item.rewardSummary ?? "",
            joinInstructions: item.joinInstructions,
            termsAndConditions: item.termsAndConditions ?? "",
            pausedMessage: item.pausedMessage,
          },
        ]),
      ),
      goal,
      stampPreview: safePreview(defaultPreview),
      stampPreviews: Object.fromEntries(
        cardLocales.map((item) => [item.locale, safePreview(defaultPreview)]),
      ),
      earningDescription: version.stampRule?.earningDescription ?? "",
      rewards: version.rewards.map((reward) => ({
        thresholdStampCount: reward.thresholdStampCount,
        translations: Object.fromEntries(
          cardLocales.map((item) => {
            const translation = item.rewardTranslations.find(
              (candidate) => candidate.rewardId === reward.id,
            );
            const legacy = reward.translations.find(
              (candidate) => candidate.locale === (item.locale === "ar" ? "AR" : "EN"),
            );
            return [
              item.locale,
              {
                name: translation?.name ?? legacy?.name ?? "",
                description: translation?.description ?? legacy?.description ?? "",
              },
            ];
          }),
        ),
      })),
      locations: version.locations
        .filter((item) => item.location.status === "ACTIVE")
        .map((item) => ({
          name: item.location.name,
          city: item.location.city,
          region: item.location.region,
        })),
      theme: {
        backgroundColor: version.visualTheme?.backgroundColor ?? "#F7F4EE",
        foregroundColor: version.visualTheme?.foregroundColor ?? "#241916",
        accentColor: version.visualTheme?.accentColor ?? "#E4572E",
        secondaryColor: version.visualTheme?.secondaryColor ?? "#F3A712",
        layoutType: version.visualTheme?.layoutType ?? "GRID",
      },
      policy: {
        emailCollectionMode: policy?.emailCollectionMode ?? "OPTIONAL",
        primaryCustomerLocale: policy?.primaryCustomerLocale === "AR" ? "ar" : "en",
        allowLocaleSelection: policy?.allowLocaleSelection ?? true,
        marketingConsentVisible: policy?.marketingConsentVisible ?? false,
        transferWithoutEmailAllowed: policy?.transferWithoutEmailAllowed ?? true,
      },
    };
  }

  private async publicBrandLogoDataUri(asset: PreviewAsset | null): Promise<string | null> {
    try {
      const resolved = await resolvePreviewAssetContent(
        this.objectStorage,
        asset,
        "THUMBNAIL_96",
        "merchant brand logo",
      );
      return resolved?.dataUri ?? null;
    } catch {
      // Public card discovery must retain the intentional Waflo issuer fallback
      // when a historical logo object is no longer readable.
      return null;
    }
  }
}

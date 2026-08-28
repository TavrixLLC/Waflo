import { HttpStatus, Injectable } from "@nestjs/common";
import { AppError } from "../common/app-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  type AdminCustomerDirectoryQuery,
  adminCustomerOrderBy,
  adminCustomerWhere,
  currentCustomerSubscription,
  entitlementStateForBillingStatus,
  safeAuditMetadata,
} from "./admin-customers.js";

type FinancePolicy = { canViewFinance: boolean };

function minor(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function date(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function commercialVersion(
  version: {
    id: string;
    version: number;
    planCode: string;
    cadence: string;
    currency: string;
    amountMinor: bigint;
    stripePriceId: string | null;
    market: { code: string };
  } | null,
) {
  if (!version) return null;
  return {
    id: version.id,
    version: version.version,
    plan: version.planCode,
    cadence: version.cadence,
    market: version.market.code,
    currency: version.currency,
    amountMinor: version.amountMinor.toString(),
    stripePriceReference: version.stripePriceId,
  };
}

function commercialNotice(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const string = (key: string) => (typeof snapshot[key] === "string" ? snapshot[key] : null);
  const number = (key: string) =>
    typeof snapshot[key] === "number" || typeof snapshot[key] === "string"
      ? String(snapshot[key])
      : null;
  return {
    marketCode: string("marketCode"),
    sourcePricingVersionId: string("sourcePricingVersionId") ?? string("oldPricingVersionId"),
    targetPricingVersionId: string("targetPricingVersionId"),
    sourceCurrency: string("sourceCurrency") ?? string("oldCurrency"),
    sourceAmountMinor: number("sourceAmountMinor") ?? number("oldAmountMinor"),
    targetCurrency: string("targetCurrency") ?? string("newCurrency"),
    targetAmountMinor: number("targetAmountMinor") ?? number("newAmountMinor"),
    noticeDays: number("noticeDays"),
    effectiveRenewalAt: string("effectiveRenewalAt"),
    replacesCommandId: string("replacesCommandId"),
  };
}

function groupInvoices(
  events: readonly {
    providerObjectId: string;
    type: "BILLED" | "COLLECTED" | "PAYMENT_FAILED";
    currency: string;
    amountMinor: bigint;
    providerOccurredAt: Date;
    planCode: string | null;
    pricingMarketCode: string | null;
  }[],
) {
  const invoices = new Map<
    string,
    {
      stripeInvoiceReference: string;
      currency: string;
      amountDueMinor: string | null;
      amountPaidMinor: string | null;
      status: "BILLED" | "PAID" | "PAYMENT_FAILED";
      finalizedAt: string | null;
      paidAt: string | null;
      failedAt: string | null;
      plan: string | null;
      market: string | null;
      billingReason: null;
    }
  >();
  for (const event of events) {
    const existing = invoices.get(event.providerObjectId) ?? {
      stripeInvoiceReference: event.providerObjectId,
      currency: event.currency,
      amountDueMinor: null,
      amountPaidMinor: null,
      status: "BILLED" as const,
      finalizedAt: null,
      paidAt: null,
      failedAt: null,
      plan: event.planCode,
      market: event.pricingMarketCode,
      billingReason: null,
    };
    if (event.type === "BILLED") {
      existing.amountDueMinor = event.amountMinor.toString();
      existing.finalizedAt = event.providerOccurredAt.toISOString();
    }
    if (event.type === "COLLECTED") {
      existing.amountPaidMinor = event.amountMinor.toString();
      existing.paidAt = event.providerOccurredAt.toISOString();
      existing.status = "PAID";
    }
    if (event.type === "PAYMENT_FAILED" && existing.status !== "PAID") {
      existing.failedAt = event.providerOccurredAt.toISOString();
      existing.status = "PAYMENT_FAILED";
    }
    invoices.set(event.providerObjectId, existing);
  }
  return [...invoices.values()].sort((left, right) => {
    const leftDate = left.paidAt ?? left.failedAt ?? left.finalizedAt ?? "";
    const rightDate = right.paidAt ?? right.failedAt ?? right.finalizedAt ?? "";
    return rightDate.localeCompare(leftDate);
  });
}

function currencyTotals(
  events: readonly { type: string; currency: string; amountMinor: bigint }[],
  type: string,
) {
  const totals = new Map<string, bigint>();
  for (const event of events) {
    if (event.type !== type) continue;
    totals.set(event.currency, (totals.get(event.currency) ?? 0n) + event.amountMinor);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({ currency, amountMinor: amountMinor.toString() }));
}

@Injectable()
export class AdminCustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminCustomerDirectoryQuery) {
    const where = adminCustomerWhere(query);
    const [totalCount, organizations] = await Promise.all([
      this.prisma.client.organization.count({ where }),
      this.prisma.client.organization.findMany({
        where,
        orderBy: adminCustomerOrderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          merchantSlug: true,
          status: true,
          onboardingState: true,
          createdAt: true,
          selectedPlan: true,
          billingProfile: {
            select: {
              billingCountryCode: true,
              stripeCustomerId: true,
              subscriptionStatus: true,
              trialStart: true,
              trialEnd: true,
            },
          },
          members: {
            where: { role: "OWNER", status: "ACTIVE" },
            orderBy: { joinedAt: "asc" },
            take: 1,
            select: { user: { select: { displayName: true, email: true, status: true } } },
          },
          subscriptions: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 10,
            select: {
              id: true,
              stripeSubscriptionId: true,
              stripePriceId: true,
              pricingVersionId: true,
              pricingMarketCode: true,
              pricingCurrency: true,
              pricingAmountMinor: true,
              cadence: true,
              grandfathered: true,
              planCode: true,
              status: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              createdAt: true,
              updatedAt: true,
              repricingTransitions: {
                where: { status: "SCHEDULED" },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      }),
    ]);
    return {
      page: query.page,
      pageSize: query.pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.pageSize)),
      items: organizations.map((organization) => {
        const subscription = currentCustomerSubscription(organization.subscriptions);
        const owner = organization.members[0]?.user ?? null;
        return {
          customerId: organization.id,
          organization: {
            name: organization.name,
            merchantSlug: organization.merchantSlug,
            status: organization.status,
            onboardingState: organization.onboardingState,
            createdAt: organization.createdAt.toISOString(),
            owner: owner
              ? { displayName: owner.displayName, email: owner.email, accountStatus: owner.status }
              : null,
          },
          billing: {
            country: organization.billingProfile?.billingCountryCode ?? null,
            stripeCustomerReference: organization.billingProfile?.stripeCustomerId ?? null,
            profileStatus: organization.billingProfile?.subscriptionStatus ?? null,
            trialStart: date(organization.billingProfile?.trialStart),
            trialEnd: date(organization.billingProfile?.trialEnd),
          },
          subscription: subscription
            ? {
                stripeSubscriptionReference: subscription.stripeSubscriptionId,
                plan: subscription.planCode,
                cadence: subscription.cadence,
                status: subscription.status,
                entitlement: entitlementStateForBillingStatus(subscription.status),
                market: subscription.pricingMarketCode,
                currency: subscription.pricingCurrency,
                amountMinor: minor(subscription.pricingAmountMinor),
                pricingVersionId: subscription.pricingVersionId,
                grandfathered: subscription.grandfathered,
                startedAt: subscription.createdAt.toISOString(),
                nextRenewalAt: date(subscription.currentPeriodEnd),
                scheduledRepricing: subscription.repricingTransitions.length > 0,
              }
            : null,
        };
      }),
    };
  }

  async detail(customerId: string, policy: FinancePolicy, now = new Date()) {
    const organization = await this.prisma.client.organization.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        merchantSlug: true,
        businessCategory: true,
        defaultLocale: true,
        timezone: true,
        status: true,
        onboardingState: true,
        onboardingCompletedAt: true,
        createdAt: true,
        billingProfile: {
          select: {
            billingCountryCode: true,
            stripeCustomerId: true,
            selectedPlan: true,
            subscriptionStatus: true,
            trialStart: true,
            trialEnd: true,
            gracePeriodEnd: true,
          },
        },
        members: {
          where: { role: "OWNER", status: "ACTIVE" },
          orderBy: { joinedAt: "asc" },
          take: 1,
          select: {
            joinedAt: true,
            user: { select: { displayName: true, email: true, status: true, lastLoginAt: true } },
          },
        },
        loyaltyPrograms: {
          where: { status: { not: "ARCHIVED" } },
          select: { id: true, status: true, publishedAt: true },
        },
        subscriptions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
          select: {
            id: true,
            stripeSubscriptionId: true,
            stripePriceId: true,
            pricingVersionId: true,
            pricingMarketCode: true,
            pricingCurrency: true,
            pricingAmountMinor: true,
            cadence: true,
            grandfathered: true,
            planCode: true,
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            canceledAt: true,
            createdAt: true,
            updatedAt: true,
            pricingVersion: {
              select: {
                id: true,
                version: true,
                planCode: true,
                cadence: true,
                currency: true,
                amountMinor: true,
                stripePriceId: true,
                market: { select: { code: true } },
              },
            },
            changePreviews: {
              orderBy: { createdAt: "desc" },
              take: 50,
              select: {
                publicId: true,
                sourcePlan: true,
                sourceCadence: true,
                sourcePricingVersionId: true,
                sourceStripePriceId: true,
                sourceAmountMinor: true,
                sourceCurrency: true,
                targetPlan: true,
                targetCadence: true,
                targetPricingVersionId: true,
                targetStripePriceId: true,
                targetAmountMinor: true,
                targetCurrency: true,
                amountDueNowMinor: true,
                creditAmountMinor: true,
                status: true,
                createdAt: true,
                expiresAt: true,
                confirmedAt: true,
                invalidatedAt: true,
              },
            },
            repricingTransitions: {
              orderBy: { createdAt: "desc" },
              take: 50,
              select: {
                id: true,
                status: true,
                effectiveAt: true,
                noticeSentAt: true,
                noticeStatus: true,
                noticeSnapshot: true,
                replacesRepricingId: true,
                replacedByRepricingId: true,
                failureCode: true,
                createdAt: true,
                updatedAt: true,
                targetPricingVersion: {
                  select: {
                    id: true,
                    version: true,
                    planCode: true,
                    cadence: true,
                    currency: true,
                    amountMinor: true,
                    stripePriceId: true,
                    market: { select: { code: true } },
                  },
                },
              },
            },
            financialEvents: policy.canViewFinance
              ? {
                  orderBy: { providerOccurredAt: "desc" },
                  take: 100,
                  select: {
                    providerObjectId: true,
                    type: true,
                    currency: true,
                    amountMinor: true,
                    providerOccurredAt: true,
                    planCode: true,
                    pricingMarketCode: true,
                  },
                }
              : false,
          },
        },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            action: true,
            targetType: true,
            targetId: true,
            metadata: true,
            createdAt: true,
            actor: { select: { displayName: true } },
            adminActor: { select: { displayName: true, role: true } },
          },
        },
      },
    });
    if (!organization) {
      throw new AppError(
        "ADMIN_CUSTOMER_NOT_FOUND",
        "The customer record was not found.",
        HttpStatus.NOT_FOUND,
      );
    }
    const subscription = currentCustomerSubscription(organization.subscriptions);
    const owner = organization.members[0] ?? null;
    const financialEvents = policy.canViewFinance
      ? organization.subscriptions.flatMap((candidate) => candidate.financialEvents)
      : [];
    const invoices = policy.canViewFinance ? groupInvoices(financialEvents) : [];
    const paidInvoices = invoices.filter((invoice) => invoice.status === "PAID");
    const failedInvoices = invoices.filter((invoice) => invoice.status === "PAYMENT_FAILED");
    const trialEnd = organization.billingProfile?.trialEnd ?? null;
    const firstPaidAfterTrial =
      policy.canViewFinance && trialEnd
        ? financialEvents
            .filter((event) => event.type === "COLLECTED" && event.providerOccurredAt >= trialEnd)
            .sort(
              (left, right) =>
                left.providerOccurredAt.getTime() - right.providerOccurredAt.getTime(),
            )[0]
        : null;
    return {
      customerId: organization.id,
      organization: {
        name: organization.name,
        merchantSlug: organization.merchantSlug,
        businessCategory: organization.businessCategory,
        locale: organization.defaultLocale === "AR" ? "ar" : "en",
        timezone: organization.timezone,
        status: organization.status,
        billingCountry: organization.billingProfile?.billingCountryCode ?? null,
        onboardingState: organization.onboardingState,
        onboardingCompletedAt: date(organization.onboardingCompletedAt),
        createdAt: organization.createdAt.toISOString(),
        owner: owner
          ? {
              displayName: owner.user.displayName,
              email: owner.user.email,
              accountStatus: owner.user.status,
              joinedAt: owner.joinedAt.toISOString(),
              lastLoginAt: date(owner.user.lastLoginAt),
            }
          : null,
      },
      account: {
        activeProgramCount: organization.loyaltyPrograms.length,
        publishedProgramCount: organization.loyaltyPrograms.filter(
          (program) => program.status === "PUBLISHED",
        ).length,
        latestProgramPublicationAt:
          organization.loyaltyPrograms
            .reduce<Date | null>(
              (latest, program) =>
                !latest || (program.publishedAt && program.publishedAt > latest)
                  ? program.publishedAt
                  : latest,
              null,
            )
            ?.toISOString() ?? null,
      },
      trial: {
        contractDays: 15,
        start: date(organization.billingProfile?.trialStart),
        end: date(organization.billingProfile?.trialEnd),
        status:
          organization.billingProfile?.subscriptionStatus === "TRIALING" &&
          organization.billingProfile.trialEnd &&
          organization.billingProfile.trialEnd > now
            ? "ACTIVE"
            : organization.billingProfile?.trialEnd
              ? "ENDED"
              : "NOT_STARTED",
        converted: firstPaidAfterTrial ? true : null,
        convertedAt: firstPaidAfterTrial?.providerOccurredAt.toISOString() ?? null,
      },
      subscription: subscription
        ? {
            stripeCustomerReference: organization.billingProfile?.stripeCustomerId ?? null,
            stripeSubscriptionReference: subscription.stripeSubscriptionId,
            stripePriceReference: subscription.stripePriceId,
            plan: subscription.planCode,
            cadence: subscription.cadence,
            status: subscription.status,
            entitlement: entitlementStateForBillingStatus(subscription.status),
            startedAt: subscription.createdAt.toISOString(),
            currentPeriodStart: date(subscription.currentPeriodStart),
            nextRenewalAt: date(subscription.currentPeriodEnd),
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: date(subscription.canceledAt),
            commercialTerms: {
              market: subscription.pricingMarketCode,
              pricingVersionId: subscription.pricingVersionId,
              pricingVersion: commercialVersion(subscription.pricingVersion),
              amountMinor: minor(subscription.pricingAmountMinor),
              currency: subscription.pricingCurrency,
              grandfathered: subscription.grandfathered,
              currentCatalogVersion: null,
            },
          }
        : null,
      pricingHistory: organization.subscriptions.map((candidate) => ({
        subscriptionReference: candidate.stripeSubscriptionId,
        plan: candidate.planCode,
        cadence: candidate.cadence,
        status: candidate.status,
        startedAt: candidate.createdAt.toISOString(),
        endedAt: date(candidate.canceledAt),
        market: candidate.pricingMarketCode,
        pricingVersionId: candidate.pricingVersionId,
        pricingVersion: commercialVersion(candidate.pricingVersion),
        currency: candidate.pricingCurrency,
        amountMinor: minor(candidate.pricingAmountMinor),
        stripePriceReference: candidate.stripePriceId,
        grandfathered: candidate.grandfathered,
      })),
      subscriptionChanges: organization.subscriptions.flatMap((candidate) =>
        candidate.changePreviews.map((preview) => ({
          previewId: preview.publicId,
          subscriptionReference: candidate.stripeSubscriptionId,
          source: {
            plan: preview.sourcePlan,
            cadence: preview.sourceCadence,
            pricingVersionId: preview.sourcePricingVersionId,
            stripePriceReference: preview.sourceStripePriceId,
            currency: preview.sourceCurrency,
            amountMinor: preview.sourceAmountMinor.toString(),
          },
          target: {
            plan: preview.targetPlan,
            cadence: preview.targetCadence,
            pricingVersionId: preview.targetPricingVersionId,
            stripePriceReference: preview.targetStripePriceId,
            currency: preview.targetCurrency,
            amountMinor: preview.targetAmountMinor.toString(),
          },
          proration: {
            amountDueNowMinor: preview.amountDueNowMinor.toString(),
            creditAmountMinor: preview.creditAmountMinor.toString(),
          },
          status: preview.status,
          createdAt: preview.createdAt.toISOString(),
          expiresAt: preview.expiresAt.toISOString(),
          confirmedAt: date(preview.confirmedAt),
          invalidatedAt: date(preview.invalidatedAt),
        })),
      ),
      repricingHistory: organization.subscriptions.flatMap((candidate) =>
        candidate.repricingTransitions.map((transition) => ({
          commandId: transition.id,
          subscriptionReference: candidate.stripeSubscriptionId,
          status: transition.status,
          effectiveAt: transition.effectiveAt.toISOString(),
          createdAt: transition.createdAt.toISOString(),
          updatedAt: transition.updatedAt.toISOString(),
          notice: {
            status: transition.noticeStatus,
            createdAt: date(transition.noticeSentAt),
            snapshot: commercialNotice(transition.noticeSnapshot),
          },
          targetPricingVersion: commercialVersion(transition.targetPricingVersion),
          replacesCommandId: transition.replacesRepricingId,
          replacedByCommandId: transition.replacedByRepricingId,
          failureCode: transition.failureCode,
        })),
      ),
      audit: organization.auditLogs.map((event) => ({
        id: event.id,
        occurredAt: event.createdAt.toISOString(),
        actor: event.adminActor
          ? {
              type: "ADMIN",
              displayName: event.adminActor.displayName,
              role: event.adminActor.role,
            }
          : event.actor
            ? { type: "MERCHANT", displayName: event.actor.displayName, role: null }
            : { type: "SYSTEM", displayName: null, role: null },
        action: event.action,
        targetType: event.targetType,
        targetReference: event.targetId,
        metadata: safeAuditMetadata(event.metadata),
      })),
      ...(policy.canViewFinance
        ? {
            financial: {
              historicalDataMayBePartial: true,
              collected: currencyTotals(financialEvents, "COLLECTED"),
              paidInvoiceCount: paidInvoices.length,
              failedPaymentCount: failedInvoices.length,
              invoices,
              refunds: { supported: false, reason: "Refund evidence is not yet available." },
            },
          }
        : {}),
    };
  }
}

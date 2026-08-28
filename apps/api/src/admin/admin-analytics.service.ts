import { HttpStatus, Injectable } from "@nestjs/common";
import { AppError } from "../common/app-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  adminAnalyticsWindow,
  buildAdminFinanceAnalytics,
  buildAdminOperationalAnalytics,
  isAdminAnalyticsRange,
} from "./admin-analytics.js";

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(rawRange = "30D", now = new Date()) {
    const range = this.range(rawRange, now);
    const [subscriptions, organizations, trials, markets, repricings, financialEvents] =
      await Promise.all([
        this.prisma.client.subscription.findMany({
          select: {
            id: true,
            organizationId: true,
            planCode: true,
            status: true,
            pricingMarketCode: true,
            pricingCurrency: true,
            pricingAmountMinor: true,
            cadence: true,
            grandfathered: true,
            createdAt: true,
            pricingVersion: {
              select: { id: true, version: true, status: true },
            },
          },
        }),
        this.prisma.client.organization.findMany({ select: { id: true, createdAt: true } }),
        this.prisma.client.organizationBillingProfile.findMany({
          select: { organizationId: true, trialStart: true, trialEnd: true },
        }),
        this.prisma.client.pricingMarket.findMany({
          select: { code: true, countryCode: true },
        }),
        this.prisma.client.subscriptionRepricing.findMany({
          where: { status: "SCHEDULED" },
          select: { subscriptionId: true },
        }),
        this.prisma.client.billingFinancialEvent.findMany({
          where: { type: "COLLECTED" },
          select: {
            subscriptionId: true,
            organizationId: true,
            type: true,
            planCode: true,
            pricingMarketCode: true,
            pricingVersionId: true,
            currency: true,
            amountMinor: true,
            providerOccurredAt: true,
            createdAt: true,
          },
        }),
      ]);
    return buildAdminOperationalAnalytics({
      subscriptions,
      organizations,
      trials,
      markets,
      scheduledSubscriptionIds: new Set(repricings.map((repricing) => repricing.subscriptionId)),
      financialEvents,
      range,
      now,
    });
  }

  async finance(rawRange = "30D", now = new Date()) {
    const range = this.range(rawRange, now);
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const eventStart = range.start < yearStart ? range.start : yearStart;
    const [subscriptions, financialEvents] = await Promise.all([
      this.prisma.client.subscription.findMany({
        select: {
          id: true,
          organizationId: true,
          planCode: true,
          status: true,
          pricingMarketCode: true,
          pricingCurrency: true,
          pricingAmountMinor: true,
          cadence: true,
          grandfathered: true,
          createdAt: true,
          pricingVersion: { select: { id: true, version: true, status: true } },
        },
      }),
      this.prisma.client.billingFinancialEvent.findMany({
        where: { providerOccurredAt: { gte: eventStart, lte: now } },
        select: {
          subscriptionId: true,
          organizationId: true,
          type: true,
          planCode: true,
          pricingMarketCode: true,
          pricingVersionId: true,
          currency: true,
          amountMinor: true,
          providerOccurredAt: true,
          createdAt: true,
        },
      }),
    ]);
    return buildAdminFinanceAnalytics({ subscriptions, financialEvents, range, now });
  }

  private range(rawRange: string, now: Date) {
    const normalized = rawRange.toUpperCase();
    if (!isAdminAnalyticsRange(normalized)) {
      throw new AppError(
        "ADMIN_ANALYTICS_RANGE_INVALID",
        "Select one of the supported analytics ranges.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return adminAnalyticsWindow(normalized, now);
  }
}

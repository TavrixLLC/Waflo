import { HttpStatus } from "@nestjs/common";
import type { Prisma } from "@waflo/database";
import { AppError } from "../common/app-error.js";

export const ADMIN_CUSTOMER_PAGE_SIZES = [25, 50, 100] as const;
export const ADMIN_CUSTOMER_MAX_PAGE_SIZE = 100;
export const ADMIN_CUSTOMER_MAX_PAGE = 10_000;
export const ADMIN_CUSTOMER_STATUSES = [
  "PENDING_ACTIVATION",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "SUSPENDED",
  "CANCELED",
] as const;
export const ADMIN_CUSTOMER_PLANS = ["STARTER", "GROWTH", "SCALE"] as const;
export const ADMIN_CUSTOMER_SORTS = ["name", "createdAt", "status"] as const;

export type AdminCustomerStatus = (typeof ADMIN_CUSTOMER_STATUSES)[number];
export type AdminCustomerPlan = (typeof ADMIN_CUSTOMER_PLANS)[number];
export type AdminCustomerSort = (typeof ADMIN_CUSTOMER_SORTS)[number];
export type AdminCustomerSortDirection = "asc" | "desc";
export type AdminCustomerToggle = "all" | "yes" | "no";

export interface AdminCustomerDirectoryQuery {
  search: string | null;
  page: number;
  pageSize: number;
  status: AdminCustomerStatus | null;
  plan: AdminCustomerPlan | null;
  market: string | null;
  currency: string | null;
  country: string | null;
  grandfathered: AdminCustomerToggle;
  scheduledRepricing: AdminCustomerToggle;
  createdFrom: Date | null;
  createdTo: Date | null;
  sort: AdminCustomerSort;
  direction: AdminCustomerSortDirection;
}

function firstQueryValue(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new AppError(
      "ADMIN_CUSTOMER_QUERY_INVALID",
      `The ${field} query value is invalid.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return value;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim();
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
): T | null {
  const candidate = firstQueryValue(value, field);
  if (!candidate) return null;
  const result = normalized(candidate).toUpperCase() as T;
  if (!values.includes(result)) {
    throw new AppError(
      "ADMIN_CUSTOMER_FILTER_INVALID",
      `The ${field} filter is not supported.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return result;
}

function optionalCode(value: unknown, field: string, length: number): string | null {
  const candidate = firstQueryValue(value, field);
  if (!candidate) return null;
  const result = normalized(candidate).toUpperCase();
  if (!new RegExp(`^[A-Z0-9_]{1,${length}}$`, "u").test(result)) {
    throw new AppError(
      "ADMIN_CUSTOMER_FILTER_INVALID",
      `The ${field} filter is invalid.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return result;
}

function optionalToggle(value: unknown, field: string): AdminCustomerToggle {
  const candidate = firstQueryValue(value, field);
  if (!candidate) return "all";
  const result = normalized(candidate).toLowerCase();
  if (result === "all" || result === "yes" || result === "no") return result;
  throw new AppError(
    "ADMIN_CUSTOMER_FILTER_INVALID",
    `The ${field} filter is invalid.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function optionalDate(value: unknown, field: string, endOfDay: boolean): Date | null {
  const candidate = firstQueryValue(value, field);
  if (!candidate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) {
    throw new AppError(
      "ADMIN_CUSTOMER_DATE_INVALID",
      `The ${field} date must use YYYY-MM-DD.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const parsed = new Date(`${candidate}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    throw new AppError(
      "ADMIN_CUSTOMER_DATE_INVALID",
      `The ${field} date is invalid.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return parsed;
}

function boundedInteger(value: unknown, field: string, fallback: number, max: number): number {
  const candidate = firstQueryValue(value, field);
  if (!candidate) return fallback;
  if (!/^\d+$/u.test(candidate)) {
    throw new AppError(
      "ADMIN_CUSTOMER_PAGINATION_INVALID",
      `The ${field} value is invalid.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const number = Number(candidate);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new AppError(
      "ADMIN_CUSTOMER_PAGINATION_INVALID",
      `The ${field} value is invalid.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return Math.min(number, max);
}

export function parseAdminCustomerDirectoryQuery(
  query: Record<string, unknown>,
): AdminCustomerDirectoryQuery {
  const rawSearch = firstQueryValue(query.search, "search");
  const search = rawSearch ? normalized(rawSearch) : null;
  if (search && search.length > 254) {
    throw new AppError(
      "ADMIN_CUSTOMER_SEARCH_INVALID",
      "The customer search is too long.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const createdFrom = optionalDate(query.createdFrom, "createdFrom", false);
  const createdTo = optionalDate(query.createdTo, "createdTo", true);
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AppError(
      "ADMIN_CUSTOMER_DATE_RANGE_INVALID",
      "The customer date range is invalid.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const rawSort = firstQueryValue(query.sort, "sort");
  const sort = (rawSort ? normalized(rawSort) : "createdAt") as AdminCustomerSort;
  if (!ADMIN_CUSTOMER_SORTS.includes(sort)) {
    throw new AppError(
      "ADMIN_CUSTOMER_SORT_INVALID",
      "The customer sort is not supported.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const rawDirection = firstQueryValue(query.direction, "direction");
  const direction = (
    rawDirection ? normalized(rawDirection).toLowerCase() : "desc"
  ) as AdminCustomerSortDirection;
  if (direction !== "asc" && direction !== "desc") {
    throw new AppError(
      "ADMIN_CUSTOMER_SORT_INVALID",
      "The customer sort direction is not supported.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return {
    search,
    page: boundedInteger(query.page, "page", 1, ADMIN_CUSTOMER_MAX_PAGE),
    pageSize: boundedInteger(query.pageSize, "pageSize", 25, ADMIN_CUSTOMER_MAX_PAGE_SIZE),
    status: optionalEnum(query.status, "status", ADMIN_CUSTOMER_STATUSES),
    plan: optionalEnum(query.plan, "plan", ADMIN_CUSTOMER_PLANS),
    market: optionalCode(query.market, "market", 32),
    currency: optionalCode(query.currency, "currency", 3),
    country: optionalCode(query.country, "country", 2),
    grandfathered: optionalToggle(query.grandfathered, "grandfathered"),
    scheduledRepricing: optionalToggle(query.scheduledRepricing, "scheduledRepricing"),
    createdFrom,
    createdTo,
    sort,
    direction,
  };
}

export function adminCustomerOrderBy(
  query: Pick<AdminCustomerDirectoryQuery, "sort" | "direction">,
): Prisma.OrganizationOrderByWithRelationInput[] {
  switch (query.sort) {
    case "name":
      return [{ normalizedName: query.direction }, { id: query.direction }];
    case "status":
      return [{ billingProfile: { subscriptionStatus: query.direction } }, { id: query.direction }];
    default:
      return [{ createdAt: query.direction }, { id: query.direction }];
  }
}

export function adminCustomerWhere(
  query: AdminCustomerDirectoryQuery,
): Prisma.OrganizationWhereInput {
  const subscriptionTerms: Prisma.SubscriptionWhereInput = {
    ...(query.plan ? { planCode: query.plan } : {}),
    ...(query.market ? { pricingMarketCode: query.market } : {}),
    ...(query.currency ? { pricingCurrency: query.currency } : {}),
    ...(query.grandfathered === "all" ? {} : { grandfathered: query.grandfathered === "yes" }),
    ...(query.scheduledRepricing === "all"
      ? {}
      : {
          repricingTransitions:
            query.scheduledRepricing === "yes"
              ? { some: { status: "SCHEDULED" } }
              : { none: { status: "SCHEDULED" } },
        }),
  };
  const needsSubscriptionTerms = Object.keys(subscriptionTerms).length > 0;
  const normalizedSearch = query.search?.toLocaleLowerCase("en-US") ?? null;
  const searchPredicates: Prisma.OrganizationWhereInput[] = normalizedSearch
    ? [
        { normalizedName: { contains: normalizedSearch, mode: "insensitive" } },
        {
          members: {
            some: {
              role: "OWNER",
              user: { normalizedEmail: { contains: normalizedSearch, mode: "insensitive" } },
            },
          },
        },
        { billingProfile: { is: { stripeCustomerId: { contains: query.search ?? "" } } } },
        { subscriptions: { some: { stripeSubscriptionId: { contains: query.search ?? "" } } } },
      ]
    : [];
  if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(normalizedSearch ?? "")) {
    searchPredicates.push({ id: normalizedSearch ?? "" });
  }
  return {
    ...(query.status ? { billingProfile: { is: { subscriptionStatus: query.status } } } : {}),
    ...(query.country ? { billingProfile: { is: { billingCountryCode: query.country } } } : {}),
    ...(query.createdFrom || query.createdTo
      ? {
          createdAt: {
            ...(query.createdFrom ? { gte: query.createdFrom } : {}),
            ...(query.createdTo ? { lte: query.createdTo } : {}),
          },
        }
      : {}),
    ...(needsSubscriptionTerms ? { subscriptions: { some: subscriptionTerms } } : {}),
    ...(searchPredicates.length > 0 ? { OR: searchPredicates } : {}),
  };
}

export interface CanonicalCustomerSubscription {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Current billing code uses the newest stored subscription as the canonical local snapshot. */
export function currentCustomerSubscription<T extends CanonicalCustomerSubscription>(
  subscriptions: readonly T[],
): T | null {
  return (
    [...subscriptions].sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        right.id.localeCompare(left.id),
    )[0] ?? null
  );
}

export function entitlementStateForBillingStatus(status: string | null) {
  if (status === "ACTIVE" || status === "TRIALING" || status === "GRACE_PERIOD") {
    return { code: "ALLOWED", enrollmentAllowed: true, existingCardsViewable: true };
  }
  if (status === "PENDING_ACTIVATION") {
    return {
      code: "PENDING_ACTIVATION_INCONSISTENCY",
      enrollmentAllowed: false,
      existingCardsViewable: true,
    };
  }
  if (status === "PAST_DUE") {
    return { code: "PAST_DUE", enrollmentAllowed: false, existingCardsViewable: true };
  }
  return {
    code: status === "SUSPENDED" ? "SUSPENDED" : "CANCELED",
    enrollmentAllowed: false,
    existingCardsViewable: false,
  };
}

export function safeAuditMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 240);
  if (depth >= 3 || Array.isArray(value)) return undefined;
  if (typeof value !== "object") return undefined;
  const hidden = /password|secret|token|authorization|cookie|session|hash|cipher|email/iu;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !hidden.test(key))
      .slice(0, 20)
      .flatMap(([key, child]) => {
        const safe = safeAuditMetadata(child, depth + 1);
        return safe === undefined ? [] : [[key, safe]];
      }),
  );
}

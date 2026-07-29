import { HttpStatus, Injectable } from "@nestjs/common";
import { AppError } from "../common/app-error.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { reservedSlugs } from "../tenancy/slug.js";

export type HostResolutionStatus = "active" | "unknown" | "reserved" | "suspended" | "malformed";

export interface ParsedMerchantHost {
  status: "merchant" | "reserved" | "malformed";
  slug: string | null;
  normalizedHost: string | null;
}

export function parseMerchantHostname(input: string, baseDomain: string): ParsedMerchantHost {
  const normalizedHost = input.trim().toLocaleLowerCase("en-US").replace(/\.$/, "").split(":")[0];
  if (!normalizedHost || normalizedHost.length > 253 || /[^a-z0-9.-]/.test(normalizedHost)) {
    return { status: "malformed", slug: null, normalizedHost: null };
  }
  const localSuffixes = [".localhost", ".lvh.me"];
  const productionSuffix = `.${baseDomain.toLocaleLowerCase("en-US")}`;
  const suffix =
    localSuffixes.find((candidate) => normalizedHost.endsWith(candidate)) ??
    (normalizedHost.endsWith(productionSuffix) ? productionSuffix : null);
  if (!suffix) return { status: "malformed", slug: null, normalizedHost };
  const slug = normalizedHost.slice(0, -suffix.length);
  if (!slug || slug.includes(".")) {
    return { status: "malformed", slug: null, normalizedHost };
  }
  if (reservedSlugs.has(slug)) return { status: "reserved", slug, normalizedHost };
  return { status: "merchant", slug, normalizedHost };
}

@Injectable()
export class HostResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
  ) {}

  async resolve(host: string, developmentOverride?: string) {
    const resolved = await this.resolveOrganization(host, developmentOverride);
    if (resolved.status !== "active") return { status: resolved.status };
    return {
      status: "active" as HostResolutionStatus,
      merchant: {
        name: resolved.organization.name,
        slug: resolved.organization.merchantSlug,
        defaultLocale: resolved.organization.defaultLocale === "AR" ? "ar" : "en",
        hostname: `${resolved.organization.merchantSlug}.${this.environment.values.MERCHANT_BASE_DOMAIN}`,
      },
    };
  }

  async resolveOrganization(host: string, developmentOverride?: string) {
    if (developmentOverride && this.environment.values.NODE_ENV === "production") {
      throw new AppError(
        "TENANT_OVERRIDE_FORBIDDEN",
        "Tenant overrides are disabled in production.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const effectiveHost =
      developmentOverride && this.environment.values.NODE_ENV !== "production"
        ? `${developmentOverride}.localhost`
        : host;
    const parsed = parseMerchantHostname(
      effectiveHost,
      this.environment.values.MERCHANT_BASE_DOMAIN,
    );
    if (
      this.environment.values.NODE_ENV === "production" &&
      (parsed.normalizedHost?.endsWith(".localhost") || parsed.normalizedHost?.endsWith(".lvh.me"))
    ) {
      return { status: "malformed" as const };
    }
    if (parsed.status === "malformed") {
      return { status: "malformed" as const };
    }
    if (parsed.status === "reserved") {
      return { status: "reserved" as const };
    }
    const organization = await this.prisma.client.organization.findUnique({
      where: { merchantSlug: parsed.slug ?? "" },
      include: { billingProfile: true },
    });
    if (!organization || organization.status === "ARCHIVED") {
      return { status: "unknown" as const };
    }
    if (organization.status === "SUSPENDED") {
      return { status: "suspended" as const };
    }
    return {
      status: "active" as const,
      organization,
      normalizedHost: parsed.normalizedHost,
    };
  }
}

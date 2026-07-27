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
    if (parsed.status === "malformed") {
      return { status: "malformed" as HostResolutionStatus };
    }
    if (parsed.status === "reserved") {
      return { status: "reserved" as HostResolutionStatus };
    }
    const organization = await this.prisma.client.organization.findUnique({
      where: { merchantSlug: parsed.slug ?? "" },
      select: {
        name: true,
        merchantSlug: true,
        defaultLocale: true,
        status: true,
      },
    });
    if (!organization || organization.status === "ARCHIVED") {
      return { status: "unknown" as HostResolutionStatus };
    }
    if (organization.status === "SUSPENDED") {
      return { status: "suspended" as HostResolutionStatus };
    }
    return {
      status: "active" as HostResolutionStatus,
      merchant: {
        name: organization.name,
        slug: organization.merchantSlug,
        defaultLocale: organization.defaultLocale === "AR" ? "ar" : "en",
        hostname: `${organization.merchantSlug}.${this.environment.values.MERCHANT_BASE_DOMAIN}`,
      },
    };
  }
}

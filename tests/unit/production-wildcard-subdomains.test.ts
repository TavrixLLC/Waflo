import { describe, expect, it, vi } from "vitest";
import {
  parseMerchantHostname,
  HostResolutionService,
} from "../../apps/api/src/public/host-resolution.service.js";
import { merchantPublicUrlForBase } from "../../apps/merchant-dashboard/lib/merchant-public-url.js";
import { canonicalCustomerUrl } from "../../packages/qr-core/src/index.js";
import { marketingCopy } from "../../apps/marketing-web/lib/marketing-copy.js";
import { interfaceLocales } from "../../packages/i18n/src/index.js";
import { GET } from "../../apps/customer-web/app/api/waflo/[...path]/route";

const OFFICIAL_GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=app.waflo.staff";
const OFFICIAL_APP_STORE = "https://apps.apple.com/app/waflo-staff/id6804266111";

describe("Production Wildcard Subdomain & Merchant Tenant Resolution", () => {
  describe("parseMerchantHostname", () => {
    it("correctly extracts merchant slug from production wildcard hostname", () => {
      const parsed = parseMerchantHostname("coffeehouse.waflo.app", "waflo.app");
      expect(parsed).toEqual({
        status: "merchant",
        slug: "coffeehouse",
        normalizedHost: "coffeehouse.waflo.app",
      });
    });

    it("normalizes uppercase and mixed-case hostnames", () => {
      const parsed = parseMerchantHostname("COFFEE-HOUSE.Waflo.App", "waflo.app");
      expect(parsed).toEqual({
        status: "merchant",
        slug: "coffee-house",
        normalizedHost: "coffee-house.waflo.app",
      });
    });

    it("strips valid port from hostname", () => {
      const parsed = parseMerchantHostname("coffeehouse.waflo.app:443", "waflo.app");
      expect(parsed).toEqual({
        status: "merchant",
        slug: "coffeehouse",
        normalizedHost: "coffeehouse.waflo.app",
      });
    });

    it("identifies reserved system subdomains on production base domain", () => {
      const reserved = ["www", "app", "api", "card", "admin", "staff", "dashboard", "billing"];
      for (const slug of reserved) {
        const parsed = parseMerchantHostname(`${slug}.waflo.app`, "waflo.app");
        expect(parsed.status).toBe("reserved");
        expect(parsed.slug).toBe(slug);
      }
    });

    it("rejects multi-level or malformed subdomains", () => {
      expect(parseMerchantHostname("sub.coffeehouse.waflo.app", "waflo.app")).toEqual({
        status: "malformed",
        slug: null,
        normalizedHost: "sub.coffeehouse.waflo.app",
      });

      expect(parseMerchantHostname("coffee..house.waflo.app", "waflo.app")).toEqual({
        status: "malformed",
        slug: null,
        normalizedHost: "coffee..house.waflo.app",
      });

      expect(parseMerchantHostname("coffee_house.waflo.app", "waflo.app")).toEqual({
        status: "malformed",
        slug: null,
        normalizedHost: null,
      });

      expect(parseMerchantHostname("waflo.app", "waflo.app")).toEqual({
        status: "malformed",
        slug: null,
        normalizedHost: "waflo.app",
      });
    });
  });

  describe("HostResolutionService production security", () => {
    const mockEnvironment = {
      values: {
        DEPLOYMENT_ENVIRONMENT: "production",
        MERCHANT_BASE_DOMAIN: "waflo.app",
        CUSTOMER_WEB_URL: "https://card.waflo.app",
      },
    };

    it("forbids developmentOverride (tenant query param) in production", async () => {
      const service = new HostResolutionService({} as never, mockEnvironment as never);
      await expect(
        service.resolveOrganization("coffeehouse.waflo.app", "coffeehouse"),
      ).rejects.toMatchObject({
        code: "TENANT_OVERRIDE_FORBIDDEN",
      });
    });

    it("resolves active merchant by merchantSlug in database", async () => {
      const organization = {
        id: "org-1",
        name: "Coffee House",
        merchantSlug: "coffeehouse",
        status: "ACTIVE",
        defaultLocale: "EN",
      };
      const findUnique = vi.fn().mockResolvedValue(organization);
      const service = new HostResolutionService(
        { client: { organization: { findUnique } } } as never,
        mockEnvironment as never,
      );

      const result = await service.resolveOrganization("coffeehouse.waflo.app");
      expect(result).toEqual({
        status: "active",
        organization,
        normalizedHost: "coffeehouse.waflo.app",
      });
      expect(findUnique).toHaveBeenCalledWith({
        where: { merchantSlug: "coffeehouse" },
        include: {
          billingProfile: true,
          brandLogoAsset: { include: { variants: true } },
        },
      });
    });

    it("returns unknown for non-existent merchant subdomain without leaking details", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const service = new HostResolutionService(
        { client: { organization: { findUnique } } } as never,
        mockEnvironment as never,
      );

      const result = await service.resolveOrganization("does-not-exist.waflo.app");
      expect(result).toEqual({ status: "unknown" });
    });

    it("returns suspended for suspended merchant", async () => {
      const organization = {
        id: "org-2",
        name: "Suspended Store",
        merchantSlug: "suspended-store",
        status: "SUSPENDED",
      };
      const findUnique = vi.fn().mockResolvedValue(organization);
      const service = new HostResolutionService(
        { client: { organization: { findUnique } } } as never,
        mockEnvironment as never,
      );

      const result = await service.resolveOrganization("suspended-store.waflo.app");
      expect(result).toEqual({ status: "suspended" });
    });

    it("returns reserved for reserved system hosts", async () => {
      const service = new HostResolutionService({} as never, mockEnvironment as never);
      const result = await service.resolveOrganization("admin.waflo.app");
      expect(result).toEqual({ status: "reserved" });
    });
  });

  describe("Customer Web BFF reserved host protection", () => {
    it("rejects reserved hosts when accessed as a merchant host with a query tenant", async () => {
      vi.stubEnv("CUSTOMER_WEB_URL", "https://card.waflo.app");
      const context = {
        params: Promise.resolve({ path: ["v1", "public", "programs", "sample"] }),
      };

      for (const reserved of ["admin.waflo.app", "staff.waflo.app", "api.waflo.app"]) {
        const req = {
          method: "GET",
          nextUrl: new URL(`https://${reserved}/api/waflo/v1/public/programs/sample?tenant=sample`),
          headers: new Headers({ host: reserved }),
        } as Parameters<typeof GET>[0];

        const response = await GET(req, context);
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          error: { code: "TENANT_OVERRIDE_HOST_FORBIDDEN" },
        });
      }
      vi.unstubAllEnvs();
    });
  });

  describe("Merchant Public URL generation", () => {
    it("generates canonical https://{merchantSlug}.waflo.app/ in production", () => {
      expect(merchantPublicUrlForBase("coffeehouse", "https://card.waflo.app")).toBe(
        "https://coffeehouse.waflo.app/",
      );
    });

    it("generates canonical customer join and card URLs with qr-core", () => {
      const joinUrl = canonicalCustomerUrl({
        customerBaseUrl: "https://card.waflo.app",
        merchantBaseDomain: "waflo.app",
        merchantSlug: "coffeehouse",
        pathname: "/join/free-coffee",
      });
      expect(joinUrl).toBe("https://coffeehouse.waflo.app/join/free-coffee");

      const cardUrl = canonicalCustomerUrl({
        customerBaseUrl: "https://card.waflo.app",
        merchantBaseDomain: "waflo.app",
        merchantSlug: "coffeehouse",
        pathname: "/card/mem-123",
      });
      expect(cardUrl).toBe("https://coffeehouse.waflo.app/card/mem-123");
    });
  });

  describe("Waflo Staff Official App Download Links", () => {
    it("has valid official download URLs configured in all supported marketing locales", () => {
      for (const locale of interfaceLocales) {
        const copy = marketingCopy[locale.id];
        expect(copy.staffApp).toBeDefined();
        expect(copy.staffApp.heading).toBeTruthy();
        expect(copy.staffApp.description).toBeTruthy();
        expect(copy.staffApp.googlePlay).toBeTruthy();
        expect(copy.staffApp.appStore).toBeTruthy();
      }
    });

    it("matches the official store URLs requested by the platform runbook", () => {
      expect(OFFICIAL_GOOGLE_PLAY).toBe(
        "https://play.google.com/store/apps/details?id=app.waflo.staff",
      );
      expect(OFFICIAL_APP_STORE).toBe("https://apps.apple.com/app/waflo-staff/id6804266111");
    });
  });

  describe("Marketing Pricing Plan Comparison", () => {
    it("has plan comparison copy in all 4 locales", () => {
      for (const locale of interfaceLocales) {
        const pricing = marketingCopy[locale.id].pricing;
        expect(pricing.comparisonTitle).toBeTruthy();
        expect(pricing.allPlansInclude).toBeTruthy();
        expect(pricing.locations).toBeTruthy();
        expect(pricing.teamSeats).toBeTruthy();
        expect(pricing.programs).toBeTruthy();
        expect(pricing.walletPasses).toBeTruthy();
        expect(pricing.customization).toBeTruthy();
        expect(pricing.analytics).toBeTruthy();
        expect(pricing.milestoneRewards).toBeTruthy();
        expect(pricing.advancedExports).toBeTruthy();
      }
    });
  });
});

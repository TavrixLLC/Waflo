import { Controller, Get, Header, Headers, Query } from "@nestjs/common";
import { isCountryCode } from "@waflo/contracts";
import { PricingCatalogService } from "../billing/pricing-catalog.service.js";
import { Public, RateLimit } from "../common/decorators.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { HostResolutionService } from "./host-resolution.service.js";
import { parseHost } from "../common/validation.js";

@Controller("v1/public")
export class PublicController {
  constructor(
    private readonly hosts: HostResolutionService,
    private readonly organizations: OrganizationsService,
    private readonly pricing: PricingCatalogService,
  ) {}

  @Get("merchant-host/resolve")
  @Public()
  @RateLimit(60)
  resolve(@Query("host") host = "", @Query("tenant") tenant?: string) {
    return this.hosts.resolve(parseHost(host), tenant);
  }

  @Get("merchant-slug/availability")
  @Public()
  @RateLimit(20)
  slugAvailability(@Query("slug") slug = "") {
    return this.organizations.slugAvailability(slug);
  }

  /**
   * Public presentation only. cf-ipcountry is set by the Cloudflare edge in
   * normal deployments; a malformed or absent value deterministically falls
   * back to GLOBAL USD. Responses are never shared across visitor markets.
   */
  @Get("pricing")
  @Public()
  @RateLimit(60)
  @Header("Cache-Control", "private, no-store")
  pricingCatalog(@Headers("cf-ipcountry") edgeCountry = "") {
    const country = edgeCountry.trim().toLocaleUpperCase("en-US");
    return this.pricing.publicCatalogTermsForCountry(isCountryCode(country) ? country : null);
  }
}

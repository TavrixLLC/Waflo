import { Controller, Get, Query } from "@nestjs/common";
import { Public, RateLimit } from "../common/decorators.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { HostResolutionService } from "./host-resolution.service.js";
import { parseHost } from "../common/validation.js";

@Controller("v1/public")
export class PublicController {
  constructor(
    private readonly hosts: HostResolutionService,
    private readonly organizations: OrganizationsService,
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
}

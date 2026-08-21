import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { organizationSchema, organizationUpdateSchema, slugChangeSchema } from "@waflo/contracts";
import { CurrentSession, CurrentUser, RateLimit } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { OrganizationsService } from "./organizations.service.js";

@Controller("v1/organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.organizations.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.organizations.create(user.id, parseInput(organizationSchema, body), request);
  }

  @Get(":organizationId")
  get(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.organizations.get(user.id, parseUuid(organizationId));
  }

  @Patch(":organizationId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.organizations.update(
      user.id,
      parseUuid(organizationId),
      parseInput(organizationUpdateSchema, body),
      request,
    );
  }

  @Post(":organizationId/select")
  select(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.organizations.select(user.id, parseUuid(organizationId));
  }

  @Get(":organizationId/slug-availability")
  @RateLimit(20)
  async availability(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("slug") slug = "",
  ) {
    const parsedOrganizationId = parseUuid(organizationId);
    await this.organizations.get(user.id, parsedOrganizationId);
    return this.organizations.slugAvailability(slug, parsedOrganizationId);
  }

  @Patch(":organizationId/slug")
  changeSlug(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(slugChangeSchema, body);
    return this.organizations.changeSlug(
      user.id,
      parseUuid(organizationId),
      input.slug,
      input.password ?? "",
      sessionId,
      request,
    );
  }

  @Post(":organizationId/complete-onboarding")
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.organizations.completeOnboarding(user.id, parseUuid(organizationId), request);
  }

  @Post(":organizationId/close")
  close(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return this.organizations.close(
      user.id,
      parseUuid(organizationId),
      {
        confirmation: typeof input.confirmation === "string" ? input.confirmation : "",
        currentPassword: typeof input.currentPassword === "string" ? input.currentPassword : "",
        sessionId,
      },
      request,
    );
  }
}

import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { locationSchema, locationUpdateSchema } from "@waflo/contracts";
import { CurrentUser } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput } from "../common/validation.js";
import { LocationsService } from "./locations.service.js";

@Controller("v1/organizations/:organizationId/locations")
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.locations.list(user.id, organizationId, cursor);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.locations.create(
      user.id,
      organizationId,
      parseInput(locationSchema, body),
      request,
    );
  }

  @Get(":locationId")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("locationId") locationId: string,
  ) {
    return this.locations.get(user.id, organizationId, locationId);
  }

  @Patch(":locationId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("locationId") locationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.locations.update(
      user.id,
      organizationId,
      locationId,
      parseInput(locationUpdateSchema, body),
      request,
    );
  }

  @Post(":locationId/archive")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("locationId") locationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.locations.archive(user.id, organizationId, locationId, request);
  }

  @Post(":locationId/restore")
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("locationId") locationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.locations.restore(user.id, organizationId, locationId, request);
  }
}

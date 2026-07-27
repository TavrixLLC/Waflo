import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { invitationSchema, memberUpdateSchema, tokenSchema } from "@waflo/contracts";
import { CurrentUser, Public, RateLimit } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { TeamService } from "./team.service.js";

@Controller("v1/organizations/:organizationId")
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get("members")
  list(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.team.list(user.id, parseUuid(organizationId));
  }

  @Patch("members/:memberId")
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("memberId") memberId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.team.updateMember(
      user.id,
      parseUuid(organizationId),
      parseUuid(memberId),
      parseInput(memberUpdateSchema, body),
      request,
    );
  }

  @Delete("members/:memberId")
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("memberId") memberId: string,
    @Req() request: WafloRequest,
  ) {
    return this.team.removeMember(user.id, parseUuid(organizationId), parseUuid(memberId), request);
  }

  @Get("invitations")
  invitations(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
  ) {
    return this.team.list(user.id, parseUuid(organizationId)).then((result) => result.invitations);
  }

  @Post("invitations")
  @RateLimit(10, 300)
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(invitationSchema, body);
    return this.team.invite(user.id, parseUuid(organizationId), input.email, input.role, request);
  }

  @Post("invitations/:invitationId/resend")
  @RateLimit(5, 300)
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.team.resend(user.id, parseUuid(organizationId), parseUuid(invitationId), request);
  }

  @Delete("invitations/:invitationId")
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.team.cancel(user.id, parseUuid(organizationId), parseUuid(invitationId), request);
  }
}

@Controller("v1/invitations")
export class InvitationsController {
  constructor(private readonly team: TeamService) {}

  @Post("inspect")
  @Public()
  @RateLimit(20, 300)
  inspect(@Body() body: unknown) {
    const input = parseInput(tokenSchema, body);
    return this.team.inspect(input.token);
  }

  @Post("accept")
  @RateLimit(10, 300)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(tokenSchema, body);
    return this.team.accept(user.id, input.token, request);
  }
}

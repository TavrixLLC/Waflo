import { Body, Controller, Get, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { AppError } from "../common/app-error.js";
import {
  programCreateSchema,
  programPublishSchema,
  programTestResetSchema,
  programTestStampSchema,
  programUpdateSchema,
} from "@waflo/contracts";
import { CurrentUser } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { ProgramsService } from "./programs.service.js";

@Controller("v1/organizations/:organizationId/programs")
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.programs.list(user.id, parseUuid(organizationId));
  }

  @Get("templates")
  templates(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
  ) {
    return this.programs.templates(user.id, parseUuid(organizationId));
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.programs.create(
      user.id,
      parseUuid(organizationId),
      parseInput(programCreateSchema, body),
      request,
    );
  }

  @Get(":programId")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
  ) {
    return this.programs.get(user.id, parseUuid(organizationId), parseUuid(programId));
  }

  @Get(":programId/versions")
  versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
  ) {
    return this.programs.listVersions(user.id, parseUuid(organizationId), parseUuid(programId));
  }

  @Get(":programId/versions/:versionId")
  version(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Param("versionId") versionId: string,
  ) {
    return this.programs.version(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      parseUuid(versionId),
    );
  }

  @Patch(":programId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.programs.update(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      parseInput(programUpdateSchema, body),
      request,
    );
  }

  @Post(":programId/draft")
  draft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.programs.createDraft(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      request,
    );
  }

  @Post(":programId/draft/abandon")
  abandonDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.programs.abandonDraft(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      request,
    );
  }

  @Get(":programId/preview")
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Query("progress") progress = "0",
    @Query("layout") layout = "GRID",
    @Query("profile") profile = "CUSTOMER_WEB",
  ) {
    const numericProgress = Number(progress);
    const normalizedLayout = layout.toUpperCase();
    const normalizedProfile = profile.toUpperCase();
    if (
      !Number.isInteger(numericProgress) ||
      numericProgress < 0 ||
      !["ROW", "GRID", "PATH", "RING"].includes(normalizedLayout) ||
      !["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"].includes(normalizedProfile)
    )
      throw new AppError(
        "PREVIEW_PARAMETERS_INVALID",
        "Invalid preview parameters.",
        HttpStatus.BAD_REQUEST,
      );
    return this.programs.preview(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      numericProgress,
      normalizedLayout as "ROW" | "GRID" | "PATH" | "RING",
      normalizedProfile as "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET",
    );
  }

  @Post(":programId/validate")
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.programs.validate(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      request,
    );
  }

  @Post(":programId/test-sessions")
  createTestSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.programs.createTestSession(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      request,
    );
  }

  @Post("test-sessions/:sessionId/stamps")
  addStamps(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(programTestStampSchema, body);
    return this.programs.addTestStamps(
      user.id,
      parseUuid(organizationId),
      parseUuid(sessionId),
      input.amount,
      input.idempotencyKey,
      request,
    );
  }

  @Post("test-sessions/:sessionId/redeem/:rewardId")
  redeem(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Param("rewardId") rewardId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(programPublishSchema, body);
    return this.programs.redeemTestReward(
      user.id,
      parseUuid(organizationId),
      parseUuid(sessionId),
      parseUuid(rewardId),
      input.idempotencyKey,
      request,
    );
  }

  @Post("test-sessions/:sessionId/reset")
  reset(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(programTestResetSchema, body ?? {});
    return this.programs.resetTestSession(
      user.id,
      parseUuid(organizationId),
      parseUuid(sessionId),
      request,
      input.idempotencyKey,
    );
  }

  @Post(":programId/publish")
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(programPublishSchema, body);
    return this.programs.publish(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      input.idempotencyKey,
      request,
    );
  }

  @Post(":programId/pause")
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.programs.transition(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      "pause",
      request,
    );
  }

  @Post(":programId/resume")
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.programs.transition(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      "resume",
      request,
    );
  }

  @Post(":programId/archive")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.programs.transition(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      "archive",
      request,
    );
  }

  @Post(":programId/restore")
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.programs.transition(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      "restore",
      request,
    );
  }
}

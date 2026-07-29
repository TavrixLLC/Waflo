import { Body, Controller, Get, Header, Param, Patch, Query, Req, Res } from "@nestjs/common";
import { programEnrollmentPolicySchema, programPublicSlugSchema } from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import { CurrentUser, RateLimit } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseInput, parseUuid } from "../common/validation.js";
import { EnrollmentSettingsService } from "./enrollment-settings.service.js";

@Controller("v1/organizations/:organizationId/programs/:programId")
export class EnrollmentSettingsController {
  constructor(private readonly settings: EnrollmentSettingsService) {}

  @Get("enrollment")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
  ) {
    return this.settings.get(user.id, parseUuid(organizationId), parseUuid(programId));
  }

  @Patch("versions/:versionId/enrollment")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.settings.updatePolicy(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      parseUuid(versionId),
      parseInput(programEnrollmentPolicySchema, body),
      request,
    );
  }

  @Patch("public-slug")
  changeSlug(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(programPublicSlugSchema, (body as { slug?: unknown })?.slug);
    return this.settings.changePublicSlug(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      input,
      request,
    );
  }

  @Get("enrollment-qr")
  @Header("cache-control", "private, max-age=300")
  @RateLimit(30)
  async qr(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Query("format") formatInput: string | undefined,
    @Query("locale") localeInput: string | undefined,
    @Req() request: WafloRequest,
    @Res() reply: FastifyReply,
  ) {
    const format = formatInput === "svg" ? "svg" : "png";
    const locale = localeInput === "ar" ? "ar" : "en";
    const result = await this.settings.enrollmentQr(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      format,
      locale,
      request,
    );
    reply
      .header("content-type", result.mimeType)
      .header("content-disposition", `attachment; filename="waflo-enrollment-${locale}.${format}"`)
      .send(result.content);
  }
}

import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res } from "@nestjs/common";
import { enrollmentInputSchema } from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import { Public, RateLimit, SkipCsrf } from "../common/decorators.js";
import type { WafloRequest } from "../common/request-context.js";
import { parseInput } from "../common/validation.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PublicEnrollmentService } from "./public-enrollment.service.js";

function requestHost(request: WafloRequest): string {
  return request.hostname || String(request.headers.host ?? "");
}

@Controller("v1/public")
@SkipCsrf()
export class PublicEnrollmentController {
  constructor(
    private readonly enrollment: PublicEnrollmentService,
    private readonly environment: EnvironmentService,
  ) {}

  @Get("merchant-programs")
  @Public()
  @RateLimit(60)
  merchantPrograms(@Req() request: WafloRequest, @Query("tenant") tenant?: string) {
    return this.enrollment.merchantPrograms(requestHost(request), tenant);
  }

  @Get("programs/:programSlug")
  @Public()
  @RateLimit(60)
  program(
    @Req() request: WafloRequest,
    @Param("programSlug") programSlug: string,
    @Query("tenant") tenant?: string,
  ) {
    return this.enrollment.program(requestHost(request), programSlug, tenant);
  }

  @Post("programs/:programSlug/enroll")
  @Public()
  @RateLimit(12, 60)
  async enrollCustomer(
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("programSlug") programSlug: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Query("tenant") tenant?: string,
  ) {
    const result = await this.enrollment.enroll(
      requestHost(request),
      programSlug,
      idempotencyKey ?? "",
      parseInput(enrollmentInputSchema, body),
      request,
      tenant,
    );
    reply.setCookie(this.environment.values.CUSTOMER_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: this.environment.values.CUSTOMER_SESSION_TTL_DAYS * 24 * 60 * 60,
    });
    const { sessionToken: _sessionToken, ...safeResult } = result;
    return safeResult;
  }
}

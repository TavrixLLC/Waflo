import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  transferEmailConfirmSchema,
  transferInspectSchema,
  transferRequestSchema,
  transferResendSchema,
  transferWithoutEmailConfirmSchema,
} from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import { AppError } from "../common/app-error.js";
import { CustomerCsrfOptionalSession, Public, RateLimit, SkipCsrf } from "../common/decorators.js";
import type { WafloRequest } from "../common/request-context.js";
import { parseInput } from "../common/validation.js";
import { EnvironmentService } from "../config/environment.service.js";
import { TransferService } from "./transfer.service.js";

const TRANSFER_BROWSER_COOKIE = "waflo_transfer_browser";

function requestHost(request: WafloRequest): string {
  return request.hostname || String(request.headers.host ?? "");
}

@Controller("v1/public/transfers")
@Public()
@SkipCsrf()
export class TransferController {
  constructor(
    private readonly transfers: TransferService,
    private readonly environment: EnvironmentService,
  ) {}

  @Post("inspect")
  @RateLimit(30)
  inspect(@Req() request: WafloRequest, @Body() body: unknown, @Query("tenant") tenant?: string) {
    const input = parseInput(transferInspectSchema, body);
    return this.transfers.inspect(requestHost(request), input.qrPayload, tenant);
  }

  @Post("request")
  @CustomerCsrfOptionalSession()
  @RateLimit(10)
  async requestTransfer(
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Query("tenant") tenant?: string,
  ) {
    const result = await this.transfers.request(
      requestHost(request),
      idempotencyKey ?? "",
      parseInput(transferRequestSchema, body),
      request,
      tenant,
    );
    if (result.browserNonce) {
      reply.setCookie(TRANSFER_BROWSER_COOKIE, result.browserNonce, {
        httpOnly: true,
        secure: this.environment.values.COOKIE_SECURE,
        sameSite: "strict",
        path: "/",
        maxAge: this.environment.values.TRANSFER_CHALLENGE_TTL_MINUTES * 60,
      });
    }
    const { browserNonce: _browserNonce, ...safeResult } = result;
    return safeResult;
  }

  @Post("resend")
  @RateLimit(3, 60)
  resend(@Req() request: WafloRequest, @Body() body: unknown, @Query("tenant") tenant?: string) {
    const input = parseInput(transferResendSchema, body);
    return this.transfers.resend(requestHost(request), input.transferPublicId, request, tenant);
  }

  @Post("confirm-email")
  @RateLimit(10)
  async confirmEmail(
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
    @Query("tenant") tenant?: string,
  ) {
    const input = parseInput(transferEmailConfirmSchema, body);
    const result = await this.transfers.confirmEmail(
      requestHost(request),
      input.transferPublicId,
      input.token,
      request,
      tenant,
    );
    this.setCustomerSession(reply, result.sessionToken);
    const {
      sessionToken: _sessionToken,
      newCredentialId: _newCredentialId,
      ...safeResult
    } = result;
    return safeResult;
  }

  @Post("confirm-without-email")
  @RateLimit(10)
  async confirmWithoutEmail(
    @Req() request: WafloRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
    @Query("tenant") tenant?: string,
  ) {
    const input = parseInput(transferWithoutEmailConfirmSchema, body);
    const result = await this.transfers.confirmWithoutEmail(
      requestHost(request),
      input.transferPublicId,
      input.challenge,
      request.cookies[TRANSFER_BROWSER_COOKIE],
      request,
      tenant,
    );
    this.setCustomerSession(reply, result.sessionToken);
    reply.clearCookie(TRANSFER_BROWSER_COOKIE, { path: "/" });
    const {
      sessionToken: _sessionToken,
      newCredentialId: _newCredentialId,
      ...safeResult
    } = result;
    return safeResult;
  }

  @Post("decode-qr-image")
  @RateLimit(10)
  async decodeQrImage(@Req() request: WafloRequest) {
    let upload: { mimeType: string; bytes: Buffer } | null = null;
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (upload) {
        throw new AppError(
          "TRANSFER_QR_FILE_COUNT_INVALID",
          "Upload exactly one QR image.",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      upload = { mimeType: part.mimetype, bytes: await part.toBuffer() };
    }
    if (!upload) {
      throw new AppError(
        "TRANSFER_QR_IMAGE_REQUIRED",
        "A QR image is required.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.transfers.decodeQrImage(upload.bytes, upload.mimeType);
  }

  @Get(":transferPublicId/status")
  @RateLimit(30)
  status(
    @Req() request: WafloRequest,
    @Param("transferPublicId") transferPublicId: string,
    @Query("tenant") tenant?: string,
  ) {
    return this.transfers.status(requestHost(request), transferPublicId, tenant);
  }

  private setCustomerSession(reply: FastifyReply, sessionToken: string) {
    reply.setCookie(this.environment.values.CUSTOMER_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: this.environment.values.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: this.environment.values.CUSTOMER_SESSION_TTL_DAYS * 24 * 60 * 60,
    });
  }
}

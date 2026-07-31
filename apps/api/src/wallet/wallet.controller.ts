import { Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentUser, CustomerCsrf, Public, RateLimit } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import { parseUuid } from "../common/validation.js";
import { WalletService } from "./wallet.service.js";

@Controller()
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get("v1/organizations/:organizationId/wallet/providers")
  providers(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.wallets.providerHealth(user.id, parseUuid(organizationId), request);
  }

  @Get("v1/organizations/:organizationId/programs/:programId/wallet-status")
  programStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
  ) {
    return this.wallets.programStatus(user.id, parseUuid(organizationId), parseUuid(programId));
  }

  @Post("v1/organizations/:organizationId/programs/:programId/wallet/reconcile")
  reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Req() request: WafloRequest,
  ) {
    return this.wallets.reconcile(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      request,
    );
  }

  @Get("v1/organizations/:organizationId/programs/:programId/wallet-sync/:jobId")
  reconciliationStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("programId") programId: string,
    @Param("jobId") jobId: string,
  ) {
    return this.wallets.reconciliationStatus(
      user.id,
      parseUuid(organizationId),
      parseUuid(programId),
      parseUuid(jobId),
    );
  }

  @Get("v1/customer/wallet/apple/pass")
  @Public()
  @RateLimit(20)
  async applePass(
    @Req() request: WafloRequest,
    @Res() reply: FastifyReply,
    @Query("tenant") tenant?: string,
  ) {
    const artifact = await this.wallets.customerApplePass(request, tenant);
    reply
      .header("content-type", "application/vnd.apple.pkpass")
      .header("content-disposition", 'attachment; filename="waflo-membership.pkpass"')
      .header("cache-control", "private, no-store")
      .send(artifact);
  }

  @Post("v1/customer/wallet/google/add-action")
  @Public()
  @CustomerCsrf()
  @RateLimit(20)
  googleAction(@Req() request: WafloRequest, @Query("tenant") tenant?: string) {
    return this.wallets.customerGoogleAction(request, tenant);
  }
}

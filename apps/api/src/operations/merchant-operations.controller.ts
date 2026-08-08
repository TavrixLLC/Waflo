import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import {
  analyticsQuerySchema,
  analyticsRebuildSchema,
  createExportSchema,
  managerApprovalDecisionSchema,
  managerApprovalRequestSchema,
  manualAdjustmentSchema,
  membershipStatusOperationSchema,
  privacyRequestSchema,
  projectionCommandSchema,
  riskSignalDecisionSchema,
} from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import { CurrentUser, RateLimit } from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import {
  parseInput,
  parseOptionalCursor,
  parseOptionalPaginationLimit,
  parseUuid,
} from "../common/validation.js";
import { MerchantOperationsService } from "./merchant-operations.service.js";

function membershipStatus(value: string | undefined) {
  return ["ACTIVE", "SUSPENDED", "EXPIRED", "REVOKED"].includes(value ?? "")
    ? (value as "ACTIVE" | "SUSPENDED" | "EXPIRED" | "REVOKED")
    : undefined;
}

function riskStatus(value: string | undefined) {
  return ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"].includes(value ?? "")
    ? (value as "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED")
    : undefined;
}

function riskSeverity(value: string | undefined) {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(value ?? "")
    ? (value as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL")
    : undefined;
}

function approvalStatus(value: string | undefined) {
  return ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CONSUMED"].includes(value ?? "")
    ? (value as "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED")
    : undefined;
}

@Controller("v1/organizations/:organizationId")
export class MerchantOperationsController {
  constructor(private readonly operations: MerchantOperationsService) {}

  @Get("customers")
  customers(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("search") search?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("programId") programId?: string,
    @Query("membershipStatus") status?: string,
    @Query("rewardReady") rewardReady?: string,
  ) {
    const parsedCursor = cursor ? parseOptionalCursor(cursor) : undefined;
    const parsedLimit = limit ? parseOptionalPaginationLimit(limit) : undefined;
    const parsedMembershipStatus = membershipStatus(status);
    return this.operations.listCustomers(user.id, parseUuid(organizationId), {
      ...(search ? { search } : {}),
      ...(parsedCursor ? { cursor: parsedCursor } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
      ...(programId ? { programId: parseUuid(programId) } : {}),
      ...(parsedMembershipStatus ? { membershipStatus: parsedMembershipStatus } : {}),
      ...(rewardReady === "true" || rewardReady === "false"
        ? { rewardReady: rewardReady === "true" }
        : {}),
    });
  }

  @Get("customers/:customerId")
  customer(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("customerId") customerId: string,
  ) {
    return this.operations.customerDetail(
      user.id,
      parseUuid(organizationId),
      parseUuid(customerId),
    );
  }

  @Get("memberships/:membershipId")
  membership(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
  ) {
    return this.operations.membershipDetail(
      user.id,
      parseUuid(organizationId),
      parseUuid(membershipId),
    );
  }

  @Get("memberships/:membershipId/ledger")
  ledger(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.operations.ledger(
      user.id,
      parseUuid(organizationId),
      parseUuid(membershipId),
      cursor ? parseUuid(cursor) : undefined,
      parseOptionalPaginationLimit(limit),
    );
  }

  @Get("memberships/:membershipId/rewards")
  rewards(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
  ) {
    return this.operations.rewards(user.id, parseUuid(organizationId), parseUuid(membershipId));
  }

  @Post("memberships/:membershipId/suspend")
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.statusOperation(user, organizationId, membershipId, "SUSPEND", body, request);
  }

  @Post("memberships/:membershipId/restore")
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.statusOperation(user, organizationId, membershipId, "RESTORE", body, request);
  }

  @Post("memberships/:membershipId/revoke")
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.statusOperation(user, organizationId, membershipId, "REVOKE", body, request);
  }

  @Post("memberships/:membershipId/manual-adjustment")
  manualAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.operations.manualAdjustment(
      user.id,
      parseUuid(organizationId),
      parseUuid(membershipId),
      parseInput(manualAdjustmentSchema, body),
      request,
    );
  }

  @Post("memberships/:membershipId/verify-projection")
  verifyProjection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
  ) {
    return this.operations.verifyProjection(
      user.id,
      parseUuid(organizationId),
      parseUuid(membershipId),
    );
  }

  @Post("memberships/:membershipId/rebuild-projection")
  rebuildProjection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(projectionCommandSchema, body);
    return this.operations.rebuildProjection(
      user.id,
      parseUuid(organizationId),
      parseUuid(membershipId),
      input.commandId,
      input.expectedProjectionVersion,
      request,
    );
  }

  @Post("operation-approvals")
  @RateLimit(60)
  createApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.operations.createApproval(
      user.id,
      parseUuid(organizationId),
      parseInput(managerApprovalRequestSchema, body),
      request,
    );
  }

  @Get("operation-approvals")
  approvals(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedStatus = approvalStatus(status);
    const parsedLimit = limit ? parseOptionalPaginationLimit(limit) : undefined;
    return this.operations.listApprovals(user.id, parseUuid(organizationId), {
      ...(parsedStatus ? { status: parsedStatus } : {}),
      ...(cursor ? { cursor: parseUuid(cursor) } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
    });
  }

  @Post("operation-approvals/:approvalId/approve")
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("approvalId") approvalId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(managerApprovalDecisionSchema, body);
    return this.operations.decideApproval(
      user.id,
      parseUuid(organizationId),
      parseUuid(approvalId),
      "APPROVED",
      input.reason,
      request,
    );
  }

  @Post("operation-approvals/:approvalId/reject")
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("approvalId") approvalId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(managerApprovalDecisionSchema, body);
    return this.operations.decideApproval(
      user.id,
      parseUuid(organizationId),
      parseUuid(approvalId),
      "REJECTED",
      input.reason,
      request,
    );
  }

  @Get("risk-signals")
  riskSignals(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedStatus = riskStatus(status);
    const parsedSeverity = riskSeverity(severity);
    const parsedLimit = limit ? parseOptionalPaginationLimit(limit) : undefined;
    return this.operations.listRisk(user.id, parseUuid(organizationId), {
      ...(parsedStatus ? { status: parsedStatus } : {}),
      ...(parsedSeverity ? { severity: parsedSeverity } : {}),
      ...(cursor ? { cursor: parseUuid(cursor) } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
    });
  }

  @Get("risk-signals/:signalId")
  riskSignal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("signalId") signalId: string,
  ) {
    return this.operations.riskDetail(user.id, parseUuid(organizationId), parseUuid(signalId));
  }

  @Post("risk-signals/:signalId/acknowledge")
  acknowledgeRisk(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("signalId") signalId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.riskDecision(user, organizationId, signalId, "ACKNOWLEDGED", body, request);
  }

  @Post("risk-signals/:signalId/resolve")
  resolveRisk(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("signalId") signalId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.riskDecision(user, organizationId, signalId, "RESOLVED", body, request);
  }

  @Post("risk-signals/:signalId/dismiss")
  dismissRisk(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("signalId") signalId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.riskDecision(user, organizationId, signalId, "DISMISSED", body, request);
  }

  @Get("analytics/overview")
  analyticsOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
  ) {
    return this.operations.analyticsOverview(user.id, parseUuid(organizationId));
  }

  @Get("analytics/programs")
  analyticsPrograms(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.operations.analyticsDimension(
      user.id,
      parseUuid(organizationId),
      "program",
      parseInput(analyticsQuerySchema, query),
    );
  }

  @Get("analytics/locations")
  analyticsLocations(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.operations.analyticsDimension(
      user.id,
      parseUuid(organizationId),
      "location",
      parseInput(analyticsQuerySchema, query),
    );
  }

  @Get("analytics/staff")
  analyticsStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.operations.analyticsDimension(
      user.id,
      parseUuid(organizationId),
      "staff",
      parseInput(analyticsQuerySchema, query),
    );
  }

  @Get("analytics/cohorts")
  analyticsCohorts(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.operations.analyticsDimension(
      user.id,
      parseUuid(organizationId),
      "cohort",
      parseInput(analyticsQuerySchema, query),
    );
  }

  @Post("analytics/rebuild")
  rebuildAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.operations.createAnalyticsRebuild(
      user.id,
      parseUuid(organizationId),
      parseInput(analyticsRebuildSchema, body),
      request,
    );
  }

  @Post("exports")
  createExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const input = parseInput(createExportSchema, body);
    return this.operations.createExport(
      user.id,
      parseUuid(organizationId),
      input.exportType,
      input.filters,
      request,
    );
  }

  @Get("exports")
  exports(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? parseOptionalPaginationLimit(limit) : undefined;
    return this.operations.listExports(user.id, parseUuid(organizationId), {
      ...(cursor ? { cursor: parseUuid(cursor) } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
    });
  }

  @Get("exports/:exportId")
  exportStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("exportId") exportId: string,
  ) {
    return this.operations.exportStatus(user.id, parseUuid(organizationId), parseUuid(exportId));
  }

  @Get("exports/:exportId/download")
  async exportDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("exportId") exportId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.operations.downloadExport(
      user.id,
      parseUuid(organizationId),
      parseUuid(exportId),
    );
    reply.header("content-type", file.contentType);
    reply.header("content-disposition", `attachment; filename="${file.filename}"`);
    reply.header("cache-control", "private, no-store");
    return reply.send(file.body);
  }

  @Post("customers/:customerId/privacy-export")
  createPrivacyExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("customerId") customerId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.operations.createPrivacyRequest(
      user.id,
      parseUuid(organizationId),
      parseUuid(customerId),
      "EXPORT",
      parseInput(privacyRequestSchema, body),
      request,
    );
  }

  @Post("customers/:customerId/erasure")
  createErasure(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("customerId") customerId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.operations.createPrivacyRequest(
      user.id,
      parseUuid(organizationId),
      parseUuid(customerId),
      "ERASURE",
      parseInput(privacyRequestSchema, body),
      request,
    );
  }

  @Get("privacy-requests/:requestId")
  privacyStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("requestId") requestId: string,
  ) {
    return this.operations.privacyStatus(user.id, parseUuid(organizationId), parseUuid(requestId));
  }

  @Get("privacy-requests/:requestId/download")
  async downloadPrivacyExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("requestId") requestId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const file = await this.operations.downloadPrivacyExport(
      user.id,
      parseUuid(organizationId),
      parseUuid(requestId),
    );
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${file.filename}"`);
    reply.header("cache-control", "private, no-store");
    return reply.send(file.body);
  }

  private statusOperation(
    user: AuthenticatedUser,
    organizationId: string,
    membershipId: string,
    action: "SUSPEND" | "RESTORE" | "REVOKE",
    body: unknown,
    request: WafloRequest,
  ) {
    const input = parseInput(membershipStatusOperationSchema, body);
    return this.operations.statusOperation(
      user.id,
      parseUuid(organizationId),
      parseUuid(membershipId),
      { ...input, action },
      request,
    );
  }

  private riskDecision(
    user: AuthenticatedUser,
    organizationId: string,
    signalId: string,
    status: "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED",
    body: unknown,
    request: WafloRequest,
  ) {
    const input = parseInput(riskSignalDecisionSchema, body);
    return this.operations.decideRisk(
      user.id,
      parseUuid(organizationId),
      parseUuid(signalId),
      status,
      input.note,
      request,
    );
  }
}

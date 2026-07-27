import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators.js";
import type { AuthenticatedUser } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";
import {
  parseOptionalAction,
  parseOptionalCursor,
  parseOptionalPaginationLimit,
  parseUuid,
} from "../common/validation.js";

@Controller("v1")
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  @Get("organizations/:organizationId/audit")
  async audit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("cursor") cursor?: string,
    @Query("action") action?: string,
    @Query("limit") limitInput?: string,
  ) {
    const parsedOrganizationId = parseUuid(organizationId);
    const parsedCursor = parseOptionalCursor(cursor);
    const parsedAction = parseOptionalAction(action);
    const limit = parseOptionalPaginationLimit(limitInput) ?? 50;
    await this.tenant.requireMembership(user.id, parsedOrganizationId, "organization.audit.view");
    const events = await this.prisma.client.auditLog.findMany({
      where: {
        organizationId: parsedOrganizationId,
        ...(parsedAction ? { action: { startsWith: parsedAction } } : {}),
      },
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true } },
        metadata: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(parsedCursor ? { cursor: { id: parsedCursor }, skip: 1 } : {}),
    });
    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, limit) : events;
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  @Get("security/events")
  async security(
    @CurrentUser() user: AuthenticatedUser,
    @Query("cursor") cursor?: string,
    @Query("limit") limitInput?: string,
  ) {
    const parsedCursor = parseOptionalCursor(cursor);
    const limit = parseOptionalPaginationLimit(limitInput) ?? 20;
    const events = await this.prisma.client.securityEvent.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        eventType: true,
        severity: true,
        createdAt: true,
        reviewedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(parsedCursor ? { cursor: { id: parsedCursor }, skip: 1 } : {}),
    });
    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, limit) : events;
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }
}

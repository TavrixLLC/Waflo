import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators.js";
import type { AuthenticatedUser } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

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
  ) {
    await this.tenant.requireMembership(user.id, organizationId, "organization.audit.view");
    const events = await this.prisma.client.auditLog.findMany({
      where: {
        organizationId,
        ...(action ? { action: { startsWith: action } } : {}),
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
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = events.length > 50;
    const items = hasMore ? events.slice(0, 50) : events;
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  @Get("security/events")
  async security(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string) {
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
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = events.length > 20;
    const items = hasMore ? events.slice(0, 20) : events;
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }
}

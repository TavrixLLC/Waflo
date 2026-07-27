import { Injectable } from "@nestjs/common";
import { redactMetadata } from "@waflo/security";
import type { WafloRequest } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";

export interface AuditInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  locationId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, request?: WafloRequest): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        locationId: input.locationId ?? null,
        requestId: request?.requestId ?? "system",
        ...(input.metadata ? { metadata: redactMetadata(input.metadata) as object } : {}),
        ipMetadata: null,
        userAgent: request?.headers["user-agent"]?.slice(0, 512) ?? null,
      },
    });
  }

  async security(
    input: {
      userId?: string | null;
      organizationId?: string | null;
      eventType: string;
      severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      metadata?: Record<string, unknown>;
    },
    request?: WafloRequest,
  ): Promise<void> {
    await this.prisma.client.securityEvent.create({
      data: {
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        eventType: input.eventType,
        severity: input.severity ?? "LOW",
        requestId: request?.requestId ?? "system",
        ...(input.metadata ? { metadata: redactMetadata(input.metadata) as object } : {}),
      },
    });
  }
}

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@waflo/database";
import { redactMetadata } from "@waflo/security";
import type { WafloRequest } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";

export interface AuditInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorAdminUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  locationId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Prisma 7's checked input path deliberately requires relation connections.
 * Keep this conversion in one place so transactional callers retain the same
 * FK-safe, redacted audit semantics as the shared service.
 */
export function auditLogCreateData(
  input: AuditInput,
  request?: WafloRequest,
): Prisma.AuditLogCreateInput {
  return {
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    requestId: request?.requestId ?? "system",
    ...(input.metadata ? { metadata: redactMetadata(input.metadata) as object } : {}),
    ipMetadata: null,
    userAgent: request?.headers["user-agent"]?.slice(0, 512) ?? null,
    ...(input.organizationId ? { organization: { connect: { id: input.organizationId } } } : {}),
    ...(input.actorUserId ? { actor: { connect: { id: input.actorUserId } } } : {}),
    ...(input.actorAdminUserId ? { adminActor: { connect: { id: input.actorAdminUserId } } } : {}),
    ...(input.locationId ? { location: { connect: { id: input.locationId } } } : {}),
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, request?: WafloRequest): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: auditLogCreateData(input, request),
    });
  }

  async recordInTransaction(
    transaction: Prisma.TransactionClient,
    input: AuditInput,
    request?: WafloRequest,
  ): Promise<void> {
    await transaction.auditLog.create({ data: auditLogCreateData(input, request) });
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
        eventType: input.eventType,
        severity: input.severity ?? "LOW",
        requestId: request?.requestId ?? "system",
        ...(input.metadata ? { metadata: redactMetadata(input.metadata) as object } : {}),
        ...(input.userId ? { user: { connect: { id: input.userId } } } : {}),
        ...(input.organizationId
          ? { organization: { connect: { id: input.organizationId } } }
          : {}),
      },
    });
  }
}

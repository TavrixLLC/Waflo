import { Injectable } from "@nestjs/common";
import type { PlanCode } from "@waflo/contracts";
import { AuditService } from "../audit/audit.service.js";
import { AnnualRepricingOperationsService } from "../billing/annual-repricing-operations.service.js";
import type { PricingCadence } from "../billing/pricing-catalog.service.js";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { AdminPricingService } from "./admin-pricing.service.js";

type AdminActor = { id: string; displayName: string };

@Injectable()
export class AdminRepricingService {
  constructor(
    private readonly operations: AnnualRepricingOperationsService,
    private readonly sensitiveActions: AdminPricingService,
    private readonly audit: AuditService,
  ) {}

  overview() {
    return this.operations.overview();
  }

  campaigns() {
    return this.operations.campaigns();
  }

  campaign(campaignId: string) {
    return this.operations.campaign(campaignId);
  }

  subscribers(
    campaignId: string,
    query: {
      page: number;
      pageSize: number;
      status?: string | undefined;
      noticeStatus?: string | undefined;
      sourcePricingVersionId?: string | undefined;
      renewalFrom?: Date | undefined;
      renewalTo?: Date | undefined;
    },
  ) {
    return this.operations.subscribers(campaignId, query);
  }

  async preview(
    input: {
      marketId: string;
      plan: PlanCode;
      cadence: PricingCadence;
      targetPricingVersionId: string;
      effectiveOnOrAfter: Date;
      noticeDays: number;
      replacesCampaignId?: string | undefined;
    },
    actor: AdminActor,
    request: WafloRequest,
  ) {
    const preview = await this.operations.preview(
      { ...input, replacesCampaignPublicId: input.replacesCampaignId },
      actor.id,
    );
    await this.record(actor, "admin.repricing.preview_created", preview.previewId, request, {
      market: preview.marketCode,
      plan: preview.plan,
      cadence: preview.cadence,
      targetPricingVersionId: preview.targetPricingVersionId,
      noticeDays: preview.noticeDays,
      effectiveOnOrAfter: preview.effectiveOnOrAfter,
      eligibleCount: preview.eligibleCount,
      excludedCount: preview.excludedCount,
    });
    return preview;
  }

  async schedule(campaignId: string, actor: AdminActor, sessionId: string, request: WafloRequest) {
    await this.sensitiveActions.requireRecentReauthentication(actor.id, sessionId);
    const result = await this.operations.schedule(campaignId);
    await this.record(actor, "admin.repricing.scheduled", campaignId, request, {
      scheduled: result.scheduled,
      scheduledAt: result.scheduledAt.toISOString(),
    });
    return result;
  }

  async cancel(campaignId: string, actor: AdminActor, sessionId: string, request: WafloRequest) {
    await this.sensitiveActions.requireRecentReauthentication(actor.id, sessionId);
    const result = await this.operations.cancel(campaignId);
    await this.record(actor, "admin.repricing.canceled", campaignId, request, {
      canceledCommands: result.canceledCommands,
    });
    return result;
  }

  async replace(
    campaignId: string,
    replacementPreviewId: string,
    actor: AdminActor,
    sessionId: string,
    request: WafloRequest,
  ) {
    await this.sensitiveActions.requireRecentReauthentication(actor.id, sessionId);
    const replacement = await this.operations.campaign(replacementPreviewId);
    if (replacement.replacesCampaignId !== campaignId) {
      throw new AppError(
        "REPRICING_REPLACEMENT_MISMATCH",
        "The replacement preview does not belong to this campaign.",
        409,
      );
    }
    const result = await this.operations.schedule(replacementPreviewId);
    await this.record(actor, "admin.repricing.replaced", campaignId, request, {
      replacementCampaignId: replacementPreviewId,
      targetPricingVersionId: replacement.target.pricingVersionId,
      scheduled: result.scheduled,
    });
    return result;
  }

  private async record(
    actor: AdminActor,
    action: string,
    targetId: string,
    request: WafloRequest,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.record(
      { actorAdminUserId: actor.id, action, targetType: "repricing_campaign", targetId, metadata },
      request,
    );
  }
}

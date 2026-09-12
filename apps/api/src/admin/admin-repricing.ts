import { billingCadenceSchema, planCodeSchema } from "@waflo/contracts";
import { z } from "zod";

const campaignIdSchema = z.uuid();

export const adminRepricingPreviewSchema = z
  .object({
    marketId: z.uuid(),
    plan: planCodeSchema,
    cadence: billingCadenceSchema,
    targetPricingVersionId: z.uuid(),
    effectiveOnOrAfter: z.coerce.date(),
    noticeDays: z.number().int().min(0).max(365),
    replacesCampaignId: campaignIdSchema.optional(),
  })
  .strict();

export const adminRepricingScheduleSchema = z.object({ campaignId: campaignIdSchema }).strict();

export const adminRepricingReplaceSchema = z
  .object({ replacementPreviewId: campaignIdSchema })
  .strict();

export const adminRepricingSubscriberQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z
      .enum(["PENDING", "APPLIED", "FAILED", "CANCELED", "SUPERSEDED", "EXCLUDED"])
      .optional(),
    noticeStatus: z.enum(["SCHEDULED", "CREATED", "CANCELED"]).optional(),
    sourcePricingVersionId: z.uuid().optional(),
    renewalFrom: z.coerce.date().optional(),
    renewalTo: z.coerce.date().optional(),
  })
  .strict();

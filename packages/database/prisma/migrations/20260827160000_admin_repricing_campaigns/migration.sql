-- Groups one reviewed Admin repricing action without duplicating immutable
-- subscriber commercial terms held by subscription_repricing.notice_snapshot.
CREATE TYPE "RepricingCampaignStatus" AS ENUM ('PREVIEWED', 'SCHEDULED', 'CANCELED', 'SUPERSEDED');
CREATE TYPE "RepricingCampaignMemberDisposition" AS ENUM ('ELIGIBLE', 'EXCLUDED');

CREATE TABLE "repricing_campaigns" (
  "id" UUID NOT NULL,
  "public_id" UUID NOT NULL,
  "market_id" UUID NOT NULL,
  "plan_code" "PlanCode" NOT NULL,
  "cadence" "BillingCadence" NOT NULL,
  "target_pricing_version_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "effective_on_or_after" TIMESTAMPTZ(6) NOT NULL,
  "notice_days" INTEGER NOT NULL,
  "status" "RepricingCampaignStatus" NOT NULL DEFAULT 'PREVIEWED',
  "preview_snapshot" JSONB NOT NULL,
  "previewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "preview_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "scheduled_at" TIMESTAMPTZ(6),
  "canceled_at" TIMESTAMPTZ(6),
  "created_by_admin_user_id" UUID,
  "replaces_campaign_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "repricing_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "repricing_campaigns_public_id_key" ON "repricing_campaigns"("public_id");
CREATE UNIQUE INDEX "repricing_campaigns_replaces_campaign_id_key" ON "repricing_campaigns"("replaces_campaign_id");
CREATE INDEX "repricing_campaigns_market_id_plan_code_cadence_status_idx" ON "repricing_campaigns"("market_id", "plan_code", "cadence", "status");
CREATE INDEX "repricing_campaigns_status_effective_on_or_after_idx" ON "repricing_campaigns"("status", "effective_on_or_after");
ALTER TABLE "repricing_campaigns" ADD CONSTRAINT "repricing_campaigns_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "pricing_markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repricing_campaigns" ADD CONSTRAINT "repricing_campaigns_target_pricing_version_id_fkey" FOREIGN KEY ("target_pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repricing_campaigns" ADD CONSTRAINT "repricing_campaigns_created_by_admin_user_id_fkey" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "repricing_campaigns" ADD CONSTRAINT "repricing_campaigns_replaces_campaign_id_fkey" FOREIGN KEY ("replaces_campaign_id") REFERENCES "repricing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "repricing_campaign_members" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "disposition" "RepricingCampaignMemberDisposition" NOT NULL,
  "exclusion_code" VARCHAR(80),
  "expected_renewal_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "repricing_campaign_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "repricing_campaign_members_campaign_id_subscription_id_key" ON "repricing_campaign_members"("campaign_id", "subscription_id");
CREATE INDEX "repricing_campaign_members_campaign_id_disposition_expected_renewal_at_idx" ON "repricing_campaign_members"("campaign_id", "disposition", "expected_renewal_at");
ALTER TABLE "repricing_campaign_members" ADD CONSTRAINT "repricing_campaign_members_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "repricing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repricing_campaign_members" ADD CONSTRAINT "repricing_campaign_members_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_repricing" ADD COLUMN "campaign_id" UUID;
CREATE INDEX "subscription_repricing_campaign_id_status_idx" ON "subscription_repricing"("campaign_id", "status");
ALTER TABLE "subscription_repricing" ADD CONSTRAINT "subscription_repricing_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "repricing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additive release migration. Existing applications continue to work while
-- campaign workers progressively begin populating the new provider details.
ALTER TYPE "WalletCampaignDeliveryStatus" ADD VALUE IF NOT EXISTS 'THROTTLED';
ALTER TYPE "WalletCampaignDeliveryStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';
ALTER TYPE "WalletCampaignDeliveryStatus" ADD VALUE IF NOT EXISTS 'INVALID';

ALTER TABLE "wallet_pass_instances"
  ADD COLUMN IF NOT EXISTS "apple_merchant_message_title" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "apple_merchant_message_body" VARCHAR(240),
  ADD COLUMN IF NOT EXISTS "apple_merchant_message_url" VARCHAR(2048),
  ADD COLUMN IF NOT EXISTS "apple_merchant_message_locale" "Locale";

ALTER TABLE "wallet_engagement_campaigns"
  ADD COLUMN IF NOT EXISTS "branch_id" UUID,
  ADD COLUMN IF NOT EXISTS "apple_eligible_pass_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "apple_registered_device_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "google_eligible_object_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unknown_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "throttled_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "wallet_engagement_campaigns"
  ADD CONSTRAINT "wallet_engagement_campaigns_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "wallet_engagement_campaigns_organization_id_branch_id_created_at_idx"
  ON "wallet_engagement_campaigns" ("organization_id", "branch_id", "created_at" DESC);

-- Wallet Engagement is additive and defaults existing customers to no promotional consent.
ALTER TYPE "CustomerConsentType" ADD VALUE 'WALLET_PROMOTIONS';
ALTER TYPE "WalletCommandType" ADD VALUE 'SEND_PROMOTION';

CREATE TYPE "WalletCampaignKind" AS ENUM ('MANUAL_PROMOTION', 'LOYALTY_OPERATIONAL');
CREATE TYPE "WalletCampaignStatus" AS ENUM ('PENDING', 'PROCESSING', 'DISPATCHED', 'COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELED');
CREATE TYPE "WalletCampaignAudienceRule" AS ENUM ('ALL_ELIGIBLE_WALLET_HOLDERS');
CREATE TYPE "WalletCampaignDeliveryStatus" AS ENUM ('QUEUED', 'SUCCEEDED', 'SKIPPED', 'FAILED');

ALTER TABLE "locations"
  ADD COLUMN "latitude" DECIMAL(9,6),
  ADD COLUMN "longitude" DECIMAL(9,6),
  ADD CONSTRAINT "locations_coordinate_pair_check"
    CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL)),
  ADD CONSTRAINT "locations_latitude_range_check"
    CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)),
  ADD CONSTRAINT "locations_longitude_range_check"
    CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180));

CREATE TABLE "wallet_nearby_configurations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "program_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "apple_custom_text_en" VARCHAR(120),
  "apple_custom_text_ar" VARCHAR(120),
  "desired_apple_max_distance" INTEGER NOT NULL DEFAULT 2000,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "wallet_nearby_configurations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_nearby_configurations_distance_check" CHECK ("desired_apple_max_distance" = 2000),
  CONSTRAINT "wallet_nearby_configurations_program_id_key" UNIQUE ("program_id"),
  CONSTRAINT "wallet_nearby_configurations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_nearby_configurations_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_nearby_configurations_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "wallet_nearby_configurations_organization_id_enabled_idx" ON "wallet_nearby_configurations"("organization_id", "enabled");

CREATE TABLE "wallet_nearby_locations" (
  "configuration_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_nearby_locations_pkey" PRIMARY KEY ("configuration_id", "location_id"),
  CONSTRAINT "wallet_nearby_locations_sort_order_check" CHECK ("sort_order" >= 0 AND "sort_order" < 10),
  CONSTRAINT "wallet_nearby_locations_configuration_id_sort_order_key" UNIQUE ("configuration_id", "sort_order"),
  CONSTRAINT "wallet_nearby_locations_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "wallet_nearby_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wallet_nearby_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "wallet_nearby_locations_location_id_idx" ON "wallet_nearby_locations"("location_id");

CREATE TABLE "wallet_engagement_campaigns" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "program_id" UUID NOT NULL,
  "kind" "WalletCampaignKind" NOT NULL DEFAULT 'MANUAL_PROMOTION',
  "locale" "Locale" NOT NULL,
  "title" VARCHAR(60) NOT NULL,
  "body" VARCHAR(240) NOT NULL,
  "destination_url" VARCHAR(2048),
  "intended_providers" JSONB NOT NULL,
  "audience_rule" "WalletCampaignAudienceRule" NOT NULL DEFAULT 'ALL_ELIGIBLE_WALLET_HOLDERS',
  "content_fingerprint" CHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "status" "WalletCampaignStatus" NOT NULL DEFAULT 'PENDING',
  "eligible_count" INTEGER NOT NULL DEFAULT 0,
  "queued_count" INTEGER NOT NULL DEFAULT 0,
  "succeeded_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "cursor_pass_instance_id" UUID,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" VARCHAR(120),
  "lease_expires_at" TIMESTAMPTZ(6),
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "safe_failure_code" VARCHAR(120),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatched_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "canceled_at" TIMESTAMPTZ(6),
  CONSTRAINT "wallet_engagement_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_engagement_campaigns_counts_check" CHECK ("eligible_count" >= 0 AND "queued_count" >= 0 AND "succeeded_count" >= 0 AND "skipped_count" >= 0 AND "failed_count" >= 0),
  CONSTRAINT "wallet_engagement_campaigns_organization_id_idempotency_key_key" UNIQUE ("organization_id", "idempotency_key"),
  CONSTRAINT "wallet_engagement_campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_engagement_campaigns_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_engagement_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "wallet_engagement_campaigns_status_scheduled_at_next_attempt_at_lease_expires_at_idx" ON "wallet_engagement_campaigns"("status", "scheduled_at", "next_attempt_at", "lease_expires_at");
CREATE INDEX "wallet_engagement_campaigns_organization_id_program_id_created_at_idx" ON "wallet_engagement_campaigns"("organization_id", "program_id", "created_at" DESC);
CREATE INDEX "wallet_engagement_campaigns_organization_id_program_id_content_fingerprint_created_at_idx" ON "wallet_engagement_campaigns"("organization_id", "program_id", "content_fingerprint", "created_at" DESC);

CREATE TABLE "wallet_campaign_deliveries" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "wallet_pass_instance_id" UUID NOT NULL,
  "provider" "WalletProviderCode" NOT NULL,
  "provider_message_id" VARCHAR(80) NOT NULL,
  "status" "WalletCampaignDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "safe_skip_code" VARCHAR(120),
  "safe_failure_code" VARCHAR(120),
  "provider_request_id" VARCHAR(255),
  "logical_sent_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_campaign_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_campaign_deliveries_campaign_id_wallet_pass_instance_id_key" UNIQUE ("campaign_id", "wallet_pass_instance_id"),
  CONSTRAINT "wallet_campaign_deliveries_provider_provider_message_id_key" UNIQUE ("provider", "provider_message_id"),
  CONSTRAINT "wallet_campaign_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_campaign_deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "wallet_engagement_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_campaign_deliveries_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_campaign_deliveries_wallet_pass_instance_id_fkey" FOREIGN KEY ("wallet_pass_instance_id") REFERENCES "wallet_pass_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "wallet_campaign_deliveries_organization_id_membership_id_provider_logical_sent_at_idx" ON "wallet_campaign_deliveries"("organization_id", "membership_id", "provider", "logical_sent_at");
CREATE INDEX "wallet_campaign_deliveries_campaign_id_status_idx" ON "wallet_campaign_deliveries"("campaign_id", "status");

ALTER TABLE "wallet_commands"
  ADD COLUMN "campaign_delivery_id" UUID,
  ADD CONSTRAINT "wallet_commands_campaign_delivery_id_key" UNIQUE ("campaign_delivery_id"),
  ADD CONSTRAINT "wallet_commands_campaign_delivery_id_fkey" FOREIGN KEY ("campaign_delivery_id") REFERENCES "wallet_campaign_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "customer_consents_membership_id_consent_type_captured_at_id_idx"
  ON "customer_consents"("membership_id", "consent_type", "captured_at" DESC, "id" DESC);

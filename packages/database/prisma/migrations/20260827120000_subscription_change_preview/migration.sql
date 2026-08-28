CREATE TYPE "SubscriptionChangePreviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED', 'INVALIDATED');

CREATE TABLE "billing_subscription_change_previews" (
  "id" UUID NOT NULL,
  "public_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "stripe_subscription_id" VARCHAR(255) NOT NULL,
  "stripe_subscription_item_id" VARCHAR(255) NOT NULL,
  "source_plan" "PlanCode" NOT NULL,
  "source_cadence" "BillingCadence" NOT NULL,
  "source_pricing_version_id" UUID NOT NULL,
  "source_stripe_price_id" VARCHAR(255) NOT NULL,
  "source_amount_minor" BIGINT NOT NULL,
  "source_currency" CHAR(3) NOT NULL,
  "target_plan" "PlanCode" NOT NULL,
  "target_cadence" "BillingCadence" NOT NULL,
  "target_pricing_version_id" UUID NOT NULL,
  "target_stripe_price_id" VARCHAR(255) NOT NULL,
  "target_amount_minor" BIGINT NOT NULL,
  "target_currency" CHAR(3) NOT NULL,
  "proration_date" TIMESTAMPTZ(6) NOT NULL,
  "provider_fingerprint" CHAR(64) NOT NULL,
  "amount_due_now_minor" BIGINT NOT NULL,
  "credit_amount_minor" BIGINT NOT NULL,
  "proration_summary" JSONB NOT NULL,
  "next_renewal_amount_minor" BIGINT,
  "next_renewal_at" TIMESTAMPTZ(6),
  "status" "SubscriptionChangePreviewStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(6),
  "invalidated_at" TIMESTAMPTZ(6),
  CONSTRAINT "billing_subscription_change_previews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_subscription_change_previews_public_id_key" ON "billing_subscription_change_previews"("public_id");
CREATE INDEX "billing_subscription_change_previews_organization_id_status_expires_at_idx" ON "billing_subscription_change_previews"("organization_id", "status", "expires_at");
CREATE INDEX "billing_subscription_change_previews_subscription_id_status_expires_at_idx" ON "billing_subscription_change_previews"("subscription_id", "status", "expires_at");

ALTER TABLE "billing_subscription_change_previews" ADD CONSTRAINT "billing_subscription_change_previews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_subscription_change_previews" ADD CONSTRAINT "billing_subscription_change_previews_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_subscription_change_previews" ADD CONSTRAINT "billing_subscription_change_previews_source_pricing_version_id_fkey" FOREIGN KEY ("source_pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_subscription_change_previews" ADD CONSTRAINT "billing_subscription_change_previews_target_pricing_version_id_fkey" FOREIGN KEY ("target_pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

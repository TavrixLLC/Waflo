-- Waflo-owned, append-only pricing catalog. Existing subscriptions deliberately
-- remain unbound until the controlled bootstrap maps their legacy Stripe Price.
CREATE TYPE "PricingMarketKind" AS ENUM ('GLOBAL', 'COUNTRY_OVERRIDE');
CREATE TYPE "PricingVersionStatus" AS ENUM ('DRAFT', 'VALIDATED', 'ACTIVE_FOR_NEW_SUBSCRIPTIONS', 'RETIRED_FOR_NEW_SUBSCRIPTIONS');
CREATE TYPE "RepricingStatus" AS ENUM ('SCHEDULED', 'APPLIED', 'CANCELED', 'FAILED');

CREATE TABLE "pricing_markets" (
  "id" UUID NOT NULL, "code" VARCHAR(32) NOT NULL,
  "kind" "PricingMarketKind" NOT NULL, "country_code" CHAR(2), "active" BOOLEAN NOT NULL DEFAULT true,
  "fallback_market_code" VARCHAR(32), "annual_effective_month" INTEGER, "annual_effective_day" INTEGER,
  "annual_notice_days" INTEGER NOT NULL DEFAULT 30, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL, CONSTRAINT "pricing_markets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_markets_code_key" ON "pricing_markets"("code");
CREATE UNIQUE INDEX "pricing_markets_country_code_key" ON "pricing_markets"("country_code");
CREATE INDEX "pricing_markets_kind_active_idx" ON "pricing_markets"("kind", "active");

CREATE TABLE "pricing_versions" (
  "id" UUID NOT NULL, "market_id" UUID NOT NULL, "plan_code" "PlanCode" NOT NULL,
  "cadence" "BillingCadence" NOT NULL, "version" INTEGER NOT NULL, "currency" CHAR(3) NOT NULL,
  "amount_minor" BIGINT NOT NULL, "status" "PricingVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "stripe_product_id" VARCHAR(255), "stripe_price_id" VARCHAR(255), "stripe_binding_key" VARCHAR(180) NOT NULL,
  "published_at" TIMESTAMPTZ(6), "retired_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_versions_stripe_price_id_key" ON "pricing_versions"("stripe_price_id");
CREATE UNIQUE INDEX "pricing_versions_stripe_binding_key_key" ON "pricing_versions"("stripe_binding_key");
CREATE UNIQUE INDEX "pricing_versions_market_id_plan_code_cadence_version_key" ON "pricing_versions"("market_id", "plan_code", "cadence", "version");
CREATE INDEX "pricing_versions_market_id_plan_code_cadence_status_idx" ON "pricing_versions"("market_id", "plan_code", "cadence", "status");
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "pricing_markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscriptions" ADD COLUMN "pricing_version_id" UUID, ADD COLUMN "pricing_market_code" VARCHAR(32), ADD COLUMN "pricing_currency" CHAR(3), ADD COLUMN "pricing_amount_minor" BIGINT, ADD COLUMN "grandfathered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pricing_version_id_fkey" FOREIGN KEY ("pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "subscription_repricing" (
  "id" UUID NOT NULL, "subscription_id" UUID NOT NULL, "target_pricing_version_id" UUID NOT NULL,
  "effective_at" TIMESTAMPTZ(6) NOT NULL, "notice_sent_at" TIMESTAMPTZ(6), "status" "RepricingStatus" NOT NULL DEFAULT 'SCHEDULED',
  "stripe_schedule_id" VARCHAR(255), "idempotency_key" VARCHAR(255) NOT NULL, "failure_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "subscription_repricing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subscription_repricing_stripe_schedule_id_key" ON "subscription_repricing"("stripe_schedule_id");
CREATE UNIQUE INDEX "subscription_repricing_idempotency_key_key" ON "subscription_repricing"("idempotency_key");
CREATE UNIQUE INDEX "subscription_repricing_subscription_id_status_key" ON "subscription_repricing"("subscription_id", "status");
CREATE INDEX "subscription_repricing_status_effective_at_idx" ON "subscription_repricing"("status", "effective_at");
ALTER TABLE "subscription_repricing" ADD CONSTRAINT "subscription_repricing_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_repricing" ADD CONSTRAINT "subscription_repricing_target_pricing_version_id_fkey" FOREIGN KEY ("target_pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Global is the mandatory fallback. No amount is seeded: importing old
-- environment Price IDs without an independently verified amount is unsafe.
INSERT INTO "pricing_markets" ("id", "code", "kind", "active", "annual_notice_days", "updated_at")
VALUES ('00000000-0000-4000-8000-000000000099', 'GLOBAL', 'GLOBAL', true, 30, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

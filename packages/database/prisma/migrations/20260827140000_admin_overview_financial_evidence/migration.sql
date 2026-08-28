CREATE TYPE "BillingFinancialEventType" AS ENUM ('BILLED', 'COLLECTED', 'PAYMENT_FAILED');

CREATE TABLE "billing_financial_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "pricing_version_id" UUID,
    "provider" VARCHAR(40) NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "provider_object_id" VARCHAR(255) NOT NULL,
    "type" "BillingFinancialEventType" NOT NULL,
    "plan_code" "PlanCode",
    "pricing_market_code" VARCHAR(32),
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "provider_occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_financial_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_financial_events_provider_provider_event_id_key"
    ON "billing_financial_events"("provider", "provider_event_id");
CREATE INDEX "billing_financial_events_type_provider_occurred_at_idx"
    ON "billing_financial_events"("type", "provider_occurred_at");
CREATE INDEX "billing_financial_events_currency_type_provider_occurred_at_idx"
    ON "billing_financial_events"("currency", "type", "provider_occurred_at");
CREATE INDEX "billing_financial_events_plan_code_type_provider_occurred_at_idx"
    ON "billing_financial_events"("plan_code", "type", "provider_occurred_at");
CREATE INDEX "billing_financial_events_pricing_market_code_type_provider_occurred_at_idx"
    ON "billing_financial_events"("pricing_market_code", "type", "provider_occurred_at");
CREATE INDEX "billing_financial_events_organization_id_provider_occurred_at_idx"
    ON "billing_financial_events"("organization_id", "provider_occurred_at");

ALTER TABLE "billing_financial_events"
    ADD CONSTRAINT "billing_financial_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_financial_events"
    ADD CONSTRAINT "billing_financial_events_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_financial_events"
    ADD CONSTRAINT "billing_financial_events_pricing_version_id_fkey"
    FOREIGN KEY ("pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

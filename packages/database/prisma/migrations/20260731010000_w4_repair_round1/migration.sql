ALTER TYPE "LoyaltyLedgerEventType" ADD VALUE IF NOT EXISTS 'REWARD_EXPIRED';
ALTER TYPE "LoyaltyOperationType" ADD VALUE IF NOT EXISTS 'EXPIRE_REWARD';
ALTER TYPE "ExportCommandStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';
ALTER TYPE "CustomerPrivacyRequestStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';

CREATE TYPE "RewardExpiryCommandStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');
CREATE TYPE "OperationalAnalyticsSourceKind" AS ENUM ('ENROLLMENT', 'LEDGER', 'RISK');
CREATE TYPE "OperationalAnalyticsJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

ALTER TABLE "loyalty_operation_commands"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "projection_rebuild_commands"
  ADD COLUMN "idempotency_key" VARCHAR(255),
  ADD COLUMN "request_fingerprint" CHAR(64),
  ADD COLUMN "lease_owner" VARCHAR(120),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "result_payload" JSONB;

UPDATE "projection_rebuild_commands"
SET "idempotency_key" = 'legacy-projection-rebuild:' || "id"::text,
    "request_fingerprint" = repeat('0', 64)
WHERE "idempotency_key" IS NULL;

ALTER TABLE "projection_rebuild_commands"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "request_fingerprint" SET NOT NULL;

CREATE UNIQUE INDEX "projection_rebuild_commands_organization_id_idempotency_key_key"
  ON "projection_rebuild_commands"("organization_id", "idempotency_key");

DROP INDEX IF EXISTS "projection_rebuild_commands_status_created_at_idx";
CREATE INDEX "projection_rebuild_commands_status_lease_expires_at_created_at_idx"
  ON "projection_rebuild_commands"("status", "lease_expires_at", "created_at");

ALTER TABLE "loyalty_ledger_entries"
  ADD COLUMN "merchant_transaction_reference_key_version" INTEGER,
  ADD COLUMN "merchant_transaction_reference_normalization_version" INTEGER;

ALTER TABLE "staff_device_sessions"
  ADD CONSTRAINT "staff_device_sessions_rotation_source_key" UNIQUE ("rotation_source");

ALTER TABLE "operational_risk_signals"
  ALTER COLUMN "program_id" DROP NOT NULL,
  ADD COLUMN "rule_version" VARCHAR(40) NOT NULL DEFAULT 'w4r1-v1',
  ADD COLUMN "deduplication_key" CHAR(64),
  ADD COLUMN "deduplication_window_start" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "operational_risk_signals_organization_id_deduplication_key_key"
  ON "operational_risk_signals"("organization_id", "deduplication_key");

ALTER TABLE "operational_daily_aggregates"
  ADD COLUMN "overrides" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wallet_adoptions" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "aggregate_key" VARCHAR(255);

UPDATE "operational_daily_aggregates"
SET "aggregate_key" = concat_ws(':',
  "organization_id"::text,
  "program_id"::text,
  coalesce("program_version_id"::text, '-'),
  coalesce("location_id"::text, '-'),
  coalesce("staff_member_id"::text, '-'),
  "local_date"::text,
  "timezone"
);

ALTER TABLE "operational_daily_aggregates"
  ALTER COLUMN "aggregate_key" SET NOT NULL;

CREATE UNIQUE INDEX "operational_daily_aggregates_aggregate_key_key"
  ON "operational_daily_aggregates"("aggregate_key");

ALTER TABLE "customer_privacy_requests"
  ADD COLUMN "request_fingerprint" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN "lease_owner" VARCHAR(120),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "customer_privacy_requests"
SET "request_fingerprint" = md5(concat("organization_id"::text, ':', "customer_id"::text, ':', "request_type"::text, ':', "idempotency_key")) ||
                            md5(concat("idempotency_key", ':', "request_type"::text));

CREATE TABLE "reward_expiry_commands" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "program_id" UUID NOT NULL,
  "entitlement_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "operation_command_id" UUID,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "status" "RewardExpiryCommandStatus" NOT NULL DEFAULT 'PENDING',
  "lease_owner" VARCHAR(120),
  "lease_expires_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "safe_failure_code" VARCHAR(120),
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "reward_expiry_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reward_expiry_commands_public_id_key" ON "reward_expiry_commands"("public_id");
CREATE UNIQUE INDEX "reward_expiry_commands_entitlement_id_key" ON "reward_expiry_commands"("entitlement_id");
CREATE UNIQUE INDEX "reward_expiry_commands_operation_command_id_key" ON "reward_expiry_commands"("operation_command_id");
CREATE UNIQUE INDEX "reward_expiry_commands_organization_id_idempotency_key_key" ON "reward_expiry_commands"("organization_id", "idempotency_key");
CREATE INDEX "reward_expiry_commands_status_next_attempt_at_lease_expires_at_idx" ON "reward_expiry_commands"("status", "next_attempt_at", "lease_expires_at");
CREATE INDEX "reward_expiry_commands_membership_id_status_created_at_idx" ON "reward_expiry_commands"("membership_id", "status", "created_at");

CREATE TABLE "operational_analytics_checkpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_kind" "OperationalAnalyticsSourceKind" NOT NULL,
  "cursor_occurred_at" TIMESTAMPTZ(6),
  "cursor_source_id" UUID,
  "status" "OperationalAnalyticsJobStatus" NOT NULL DEFAULT 'PENDING',
  "lease_owner" VARCHAR(120),
  "lease_expires_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "safe_failure_code" VARCHAR(120),
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_analytics_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_analytics_checkpoints_source_kind_key" ON "operational_analytics_checkpoints"("source_kind");
CREATE INDEX "operational_analytics_checkpoints_status_next_attempt_at_lease_expires_at_idx" ON "operational_analytics_checkpoints"("status", "next_attempt_at", "lease_expires_at");

CREATE TABLE "operational_analytics_contributions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_kind" "OperationalAnalyticsSourceKind" NOT NULL,
  "source_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "aggregate_key" VARCHAR(255) NOT NULL,
  "metrics" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_analytics_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_analytics_contributions_source_kind_source_id_key" ON "operational_analytics_contributions"("source_kind", "source_id");
CREATE INDEX "operational_analytics_contributions_organization_id_occurred_at_idx" ON "operational_analytics_contributions"("organization_id", "occurred_at");
CREATE INDEX "operational_analytics_contributions_aggregate_key_idx" ON "operational_analytics_contributions"("aggregate_key");

CREATE TABLE "operational_analytics_facts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_kind" "OperationalAnalyticsSourceKind" NOT NULL,
  "source_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "program_id" UUID NOT NULL,
  "program_version_id" UUID,
  "membership_id" UUID,
  "location_id" UUID,
  "staff_member_id" UUID,
  "fact_type" VARCHAR(80) NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 1,
  "local_date" DATE NOT NULL,
  "timezone" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "safe_dimensions" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_analytics_facts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_analytics_facts_source_kind_source_id_key" ON "operational_analytics_facts"("source_kind", "source_id");
CREATE INDEX "operational_analytics_facts_organization_id_fact_type_local_date_idx" ON "operational_analytics_facts"("organization_id", "fact_type", "local_date");
CREATE INDEX "operational_analytics_facts_program_id_program_version_id_local_date_idx" ON "operational_analytics_facts"("program_id", "program_version_id", "local_date");
CREATE INDEX "operational_analytics_facts_membership_id_occurred_at_idx" ON "operational_analytics_facts"("membership_id", "occurred_at");

CREATE TABLE "operational_analytics_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "job_type" VARCHAR(40) NOT NULL,
  "from_date" DATE NOT NULL,
  "to_date" DATE NOT NULL,
  "source_kinds" JSONB NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "status" "OperationalAnalyticsJobStatus" NOT NULL DEFAULT 'PENDING',
  "lease_owner" VARCHAR(120),
  "lease_expires_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "safe_failure_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "operational_analytics_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_analytics_jobs_public_id_key" ON "operational_analytics_jobs"("public_id");
CREATE UNIQUE INDEX "operational_analytics_jobs_organization_id_idempotency_key_key" ON "operational_analytics_jobs"("organization_id", "idempotency_key");
CREATE INDEX "operational_analytics_jobs_status_lease_expires_at_created_at_idx" ON "operational_analytics_jobs"("status", "lease_expires_at", "created_at");

-- Durable, aggregate evidence for each non-empty scheduled Stripe reconciliation batch.
-- Provider payloads and credentials are intentionally not stored here.
CREATE TYPE "StripeReconciliationRunStatus" AS ENUM (
  'RUNNING',
  'SUCCEEDED',
  'PARTIALLY_FAILED',
  'FAILED'
);

CREATE TABLE "stripe_reconciliation_runs" (
  "id" UUID NOT NULL,
  "worker_id" VARCHAR(120) NOT NULL,
  "status" "StripeReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "subscriptions_scanned" INTEGER NOT NULL DEFAULT 0,
  "subscriptions_converged" INTEGER NOT NULL DEFAULT 0,
  "subscriptions_failed" INTEGER NOT NULL DEFAULT 0,
  "safe_failure_code" VARCHAR(120),
  CONSTRAINT "stripe_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stripe_reconciliation_runs_started_at_idx"
  ON "stripe_reconciliation_runs"("started_at" DESC);

CREATE INDEX "stripe_reconciliation_runs_status_completed_at_idx"
  ON "stripe_reconciliation_runs"("status", "completed_at" DESC);

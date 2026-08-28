CREATE TYPE "RepricingNoticeStatus" AS ENUM ('SCHEDULED', 'CREATED', 'CANCELED');
ALTER TYPE "RepricingStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
ALTER TABLE "subscription_repricing"
  ADD COLUMN "notice_status" "RepricingNoticeStatus" NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "notice_snapshot" JSONB,
  ADD COLUMN "replaces_repricing_id" UUID,
  ADD COLUMN "replaced_by_repricing_id" UUID;
CREATE UNIQUE INDEX "subscription_repricing_replaced_by_repricing_id_key" ON "subscription_repricing"("replaced_by_repricing_id");

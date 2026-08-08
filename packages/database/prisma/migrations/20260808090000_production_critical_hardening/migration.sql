-- Bind manager approvals to an explicit operational purpose and give privacy
-- export objects the same bounded lifecycle as ordinary exports.
ALTER TABLE "manager_approval_challenges"
  ADD COLUMN "operation_type" VARCHAR(32) NOT NULL DEFAULT 'REDEEM';

ALTER TABLE "customer_privacy_requests"
  ADD COLUMN "expires_at" TIMESTAMPTZ(6);

ALTER TYPE "CustomerPrivacyRequestStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

CREATE INDEX "customer_privacy_requests_request_type_status_expires_at_idx"
  ON "customer_privacy_requests"("request_type", "status", "expires_at");

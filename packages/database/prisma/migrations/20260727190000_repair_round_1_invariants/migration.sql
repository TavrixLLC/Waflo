CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED');

ALTER TABLE "organization_invitations"
ADD COLUMN "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "organization_invitations"
SET "status" = CASE
  WHEN "accepted_at" IS NOT NULL THEN 'ACCEPTED'::"InvitationStatus"
  WHEN "canceled_at" IS NOT NULL THEN 'CANCELED'::"InvitationStatus"
  WHEN "expires_at" <= CURRENT_TIMESTAMP THEN 'EXPIRED'::"InvitationStatus"
  ELSE 'PENDING'::"InvitationStatus"
END;

DROP INDEX IF EXISTS "organization_invitations_one_active_email";

CREATE UNIQUE INDEX "organization_invitations_one_pending_email"
ON "organization_invitations" ("organization_id", "normalized_email")
WHERE "status" = 'PENDING';

DROP INDEX IF EXISTS "organization_invitations_organization_id_normalized_email_idx";

CREATE INDEX "organization_invitations_organization_id_normalized_email_status_idx"
ON "organization_invitations" ("organization_id", "normalized_email", "status");

ALTER TABLE "processed_webhook_events"
ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "processed_webhook_events_status_lease_expires_at_idx"
ON "processed_webhook_events" ("status", "lease_expires_at");

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "organization_invitations_status_timestamps"
CHECK (
  ("status" = 'PENDING' AND "accepted_at" IS NULL AND "canceled_at" IS NULL)
  OR ("status" = 'ACCEPTED' AND "accepted_at" IS NOT NULL AND "canceled_at" IS NULL)
  OR ("status" = 'CANCELED' AND "canceled_at" IS NOT NULL AND "accepted_at" IS NULL)
  OR ("status" = 'EXPIRED' AND "accepted_at" IS NULL AND "canceled_at" IS NULL)
);

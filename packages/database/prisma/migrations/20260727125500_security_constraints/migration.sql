-- Active invitations must be unique without preventing historical reinvites.
CREATE UNIQUE INDEX "organization_invitations_one_active_email"
ON "organization_invitations" ("organization_id", "normalized_email")
WHERE "accepted_at" IS NULL AND "canceled_at" IS NULL;

-- An organization may expose only one primary domain at a time.
CREATE UNIQUE INDEX "organization_domains_one_primary"
ON "organization_domains" ("organization_id")
WHERE "is_primary" = true;

-- Defense in depth for normalized merchant slugs.
ALTER TABLE "organizations"
ADD CONSTRAINT "organizations_merchant_slug_format"
CHECK (
  "merchant_slug" ~ '^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$'
);

-- W1 must never represent a pending trial with timestamps or trigger references.
ALTER TABLE "organization_billing_profiles"
ADD CONSTRAINT "billing_pending_activation_has_no_trial"
CHECK (
  "subscription_status" <> 'PENDING_ACTIVATION'
  OR (
    "trial_start" IS NULL
    AND "trial_end" IS NULL
    AND "trial_triggering_program_id" IS NULL
    AND "trial_triggering_user_id" IS NULL
  )
);

-- Audit history is append-only even if an application path bypasses the service layer.
CREATE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- Bind every signed Staff session to one authoritative Location.
ALTER TABLE "staff_device_sessions"
  ADD COLUMN "location_id" UUID NOT NULL;

ALTER TABLE "staff_device_sessions"
  ADD CONSTRAINT "staff_device_sessions_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION waflo_validate_device_session_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "staff_devices" d
    JOIN "organization_members" m ON m."id" = NEW."organization_member_id"
    JOIN "staff_device_locations" dl
      ON dl."staff_device_id" = d."id"
     AND dl."location_id" = NEW."location_id"
     AND dl."active" = true
    WHERE d."id" = NEW."staff_device_id"
      AND d."organization_id" = NEW."organization_id"
      AND d."organization_member_id" = NEW."organization_member_id"
      AND m."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'WAFLO_DEVICE_SESSION_CONTEXT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "w4_device_session_context_guard"
BEFORE INSERT OR UPDATE ON "staff_device_sessions"
FOR EACH ROW EXECUTE FUNCTION waflo_validate_device_session_context();

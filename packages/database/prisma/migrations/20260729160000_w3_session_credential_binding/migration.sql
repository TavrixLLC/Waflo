ALTER TABLE membership_access_sessions
ADD COLUMN membership_credential_id UUID;

CREATE INDEX membership_access_sessions_membership_credential_id_revoked_at_idx
ON membership_access_sessions(membership_credential_id, revoked_at);

ALTER TABLE membership_access_sessions
ADD CONSTRAINT membership_access_sessions_membership_credential_id_fkey
FOREIGN KEY (membership_credential_id)
REFERENCES membership_credentials(id)
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION waflo_assert_session_credential_binding() RETURNS trigger AS $$
BEGIN
  IF NEW.membership_credential_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM membership_credentials c
    WHERE c.id = NEW.membership_credential_id
      AND c.membership_id = NEW.membership_id
      AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'membership session credential mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER membership_access_session_credential_guard
BEFORE INSERT OR UPDATE ON membership_access_sessions
FOR EACH ROW EXECUTE FUNCTION waflo_assert_session_credential_binding();

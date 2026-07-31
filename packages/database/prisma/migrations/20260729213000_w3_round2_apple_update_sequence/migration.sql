CREATE SEQUENCE apple_pass_update_sequence AS BIGINT;

ALTER TABLE wallet_pass_instances
ADD COLUMN apple_update_sequence BIGINT;

-- Existing Apple passes receive globally comparable initial tags. The advisory
-- lock also establishes the lock key used by application-side state changes.
SELECT pg_advisory_xact_lock(hashtextextended('apple-pass-update-sequence', 0));

WITH apple_passes AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS sequence_value
  FROM wallet_pass_instances
  WHERE provider = 'APPLE'
)
UPDATE wallet_pass_instances AS pass
SET apple_update_sequence = apple_passes.sequence_value
FROM apple_passes
WHERE pass.id = apple_passes.id;

SELECT setval(
  'apple_pass_update_sequence',
  GREATEST(
    COALESCE((SELECT MAX(apple_update_sequence) FROM wallet_pass_instances), 0),
    1
  ),
  EXISTS (SELECT 1 FROM wallet_pass_instances WHERE provider = 'APPLE')
);

CREATE OR REPLACE FUNCTION waflo_assign_initial_apple_update_sequence()
RETURNS trigger AS $$
BEGIN
  IF NEW.provider = 'APPLE' AND NEW.apple_update_sequence IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('apple-pass-update-sequence', 0));
    NEW.apple_update_sequence := nextval('apple_pass_update_sequence');
  ELSIF NEW.provider <> 'APPLE' THEN
    NEW.apple_update_sequence := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_pass_instances_initial_apple_update_sequence
BEFORE INSERT OR UPDATE OF provider ON wallet_pass_instances
FOR EACH ROW EXECUTE FUNCTION waflo_assign_initial_apple_update_sequence();

ALTER TABLE wallet_pass_instances
ADD CONSTRAINT wallet_pass_instances_apple_update_sequence_check
CHECK (
  (provider = 'APPLE' AND apple_update_sequence IS NOT NULL)
  OR
  (provider <> 'APPLE' AND apple_update_sequence IS NULL)
);

CREATE INDEX wallet_pass_instances_provider_apple_update_sequence_idx
ON wallet_pass_instances(provider, apple_update_sequence);

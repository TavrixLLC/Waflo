ALTER TABLE "loyalty_program_versions"
  ADD COLUMN "base_template_version" INTEGER;

UPDATE "loyalty_program_versions"
SET "base_template_version" = 1
WHERE "base_template_code" IS NOT NULL;

ALTER TABLE "loyalty_program_versions"
  ALTER COLUMN "base_template_version" SET DEFAULT 1;

ALTER TABLE "generated_program_previews"
  ADD COLUMN "content_digest" CHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN "warnings" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION waflo_assert_program_version_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM loyalty_programs p
    WHERE p.id = NEW.program_id
      AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'program version tenant mismatch';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'PUBLISHED' THEN
    IF NEW.status <> 'SUPERSEDED'
      OR (
        NEW.id,
        NEW.program_id,
        NEW.organization_id,
        NEW.version_number,
        NEW.editing_mode,
        NEW.base_template_code,
        NEW.base_template_version,
        NEW.configuration_schema_version,
        NEW.revision,
        NEW.created_by_user_id,
        NEW.created_at,
        NEW.validated_at,
        NEW.test_ready_at,
        NEW.published_at,
        NEW.abandoned_at,
        NEW.change_summary,
        NEW.validation_fingerprint,
        NEW.render_fingerprint
      ) IS DISTINCT FROM (
        OLD.id,
        OLD.program_id,
        OLD.organization_id,
        OLD.version_number,
        OLD.editing_mode,
        OLD.base_template_code,
        OLD.base_template_version,
        OLD.configuration_schema_version,
        OLD.revision,
        OLD.created_by_user_id,
        OLD.created_at,
        OLD.validated_at,
        OLD.test_ready_at,
        OLD.published_at,
        OLD.abandoned_at,
        OLD.change_summary,
        OLD.validation_fingerprint,
        OLD.render_fingerprint
      )
    THEN
      RAISE EXCEPTION 'published program version configuration is immutable';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'SUPERSEDED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'superseded program versions are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS loyalty_program_version_tenant_guard ON loyalty_program_versions;
CREATE TRIGGER loyalty_program_version_tenant_guard
BEFORE INSERT OR UPDATE ON loyalty_program_versions
FOR EACH ROW EXECUTE FUNCTION waflo_assert_program_version_tenant();

CREATE OR REPLACE FUNCTION waflo_reject_protected_version_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'published and superseded program versions cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS loyalty_program_version_delete_guard ON loyalty_program_versions;
CREATE TRIGGER loyalty_program_version_delete_guard
BEFORE DELETE ON loyalty_program_versions
FOR EACH ROW EXECUTE FUNCTION waflo_reject_protected_version_delete();

CREATE OR REPLACE FUNCTION waflo_assert_visual_asset_tenant() RETURNS trigger AS $$
DECLARE
  version_org UUID;
  asset_id UUID;
BEGIN
  SELECT organization_id INTO version_org
  FROM loyalty_program_versions
  WHERE id = NEW.version_id;

  IF version_org IS NULL THEN
    RAISE EXCEPTION 'visual theme version missing';
  END IF;

  FOREACH asset_id IN ARRAY ARRAY[
    NEW.logo_asset_id,
    NEW.hero_asset_id,
    NEW.background_asset_id,
    NEW.filled_stamp_asset_id,
    NEW.empty_stamp_asset_id,
    NEW.default_milestone_asset_id
  ]
  LOOP
    IF asset_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM merchant_assets
      WHERE id = asset_id
        AND organization_id = version_org
    ) THEN
      RAISE EXCEPTION 'visual theme asset tenant mismatch';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS program_visual_theme_tenant_guard ON program_visual_themes;
CREATE TRIGGER program_visual_theme_tenant_guard
BEFORE INSERT OR UPDATE ON program_visual_themes
FOR EACH ROW EXECUTE FUNCTION waflo_assert_visual_asset_tenant();

CREATE OR REPLACE FUNCTION waflo_assert_reward_asset_tenant() RETURNS trigger AS $$
DECLARE
  version_org UUID;
BEGIN
  SELECT v.organization_id INTO version_org
  FROM reward_definitions r
  JOIN loyalty_program_versions v ON v.id = r.version_id
  WHERE r.id = NEW.reward_id;

  IF version_org IS NULL THEN
    RAISE EXCEPTION 'reward visual version missing';
  END IF;

  IF NEW.stamp_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM merchant_assets
    WHERE id = NEW.stamp_asset_id
      AND organization_id = version_org
  ) THEN
    RAISE EXCEPTION 'reward visual asset tenant mismatch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reward_visual_override_tenant_guard ON reward_visual_overrides;
CREATE TRIGGER reward_visual_override_tenant_guard
BEFORE INSERT OR UPDATE ON reward_visual_overrides
FOR EACH ROW EXECUTE FUNCTION waflo_assert_reward_asset_tenant();

CREATE OR REPLACE FUNCTION waflo_reject_immutable_library_asset_change() RETURNS trigger AS $$
BEGIN
  IF OLD.source = 'WAFLO_LIBRARY' THEN
    RAISE EXCEPTION 'Waflo library assets are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS merchant_library_asset_update_guard ON merchant_assets;
CREATE TRIGGER merchant_library_asset_update_guard
BEFORE UPDATE OR DELETE ON merchant_assets
FOR EACH ROW EXECUTE FUNCTION waflo_reject_immutable_library_asset_change();

CREATE OR REPLACE FUNCTION waflo_version_is_protected(target_version_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM loyalty_program_versions
    WHERE id = target_version_id
      AND status IN ('PUBLISHED', 'SUPERSEDED')
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION waflo_reject_protected_child_change() RETURNS trigger AS $$
DECLARE
  target_version_id UUID;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF waflo_version_is_protected(target_version_id) THEN
    RAISE EXCEPTION 'published and superseded program configuration is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'program_translations',
    'stamp_rules',
    'reward_definitions',
    'program_locations',
    'program_visual_themes'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_immutable_guard', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION waflo_reject_protected_child_change()',
      table_name || '_immutable_guard',
      table_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION waflo_reject_protected_reward_child_change() RETURNS trigger AS $$
DECLARE
  target_reward_id UUID;
  target_version_id UUID;
BEGIN
  target_reward_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.reward_id ELSE NEW.reward_id END;
  SELECT version_id INTO target_version_id
  FROM reward_definitions
  WHERE id = target_reward_id;
  IF waflo_version_is_protected(target_version_id) THEN
    RAISE EXCEPTION 'published and superseded reward configuration is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reward_translations_immutable_guard ON reward_translations;
CREATE TRIGGER reward_translations_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON reward_translations
FOR EACH ROW EXECUTE FUNCTION waflo_reject_protected_reward_child_change();

DROP TRIGGER IF EXISTS reward_visual_overrides_immutable_guard ON reward_visual_overrides;
CREATE TRIGGER reward_visual_overrides_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON reward_visual_overrides
FOR EACH ROW EXECUTE FUNCTION waflo_reject_protected_reward_child_change();

CREATE OR REPLACE FUNCTION waflo_assert_version_organization(
  supplied_organization_id UUID,
  supplied_version_id UUID
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM loyalty_program_versions
    WHERE id = supplied_version_id
      AND organization_id = supplied_organization_id
  ) THEN
    RAISE EXCEPTION 'program child organization/version mismatch';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION waflo_assert_preview_tenant() RETURNS trigger AS $$
BEGIN
  PERFORM waflo_assert_version_organization(NEW.organization_id, NEW.version_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generated_program_preview_tenant_guard ON generated_program_previews;
CREATE TRIGGER generated_program_preview_tenant_guard
BEFORE INSERT OR UPDATE ON generated_program_previews
FOR EACH ROW EXECUTE FUNCTION waflo_assert_preview_tenant();

DROP TRIGGER IF EXISTS program_validation_run_tenant_guard ON program_validation_runs;
CREATE TRIGGER program_validation_run_tenant_guard
BEFORE INSERT OR UPDATE ON program_validation_runs
FOR EACH ROW EXECUTE FUNCTION waflo_assert_preview_tenant();

DROP TRIGGER IF EXISTS program_test_session_tenant_guard ON program_test_sessions;
CREATE TRIGGER program_test_session_tenant_guard
BEFORE INSERT OR UPDATE ON program_test_sessions
FOR EACH ROW EXECUTE FUNCTION waflo_assert_preview_tenant();

CREATE OR REPLACE FUNCTION waflo_assert_publish_command_tenant() RETURNS trigger AS $$
BEGIN
  PERFORM waflo_assert_version_organization(NEW.organization_id, NEW.version_id);
  IF NOT EXISTS (
    SELECT 1
    FROM loyalty_program_versions
    WHERE id = NEW.version_id
      AND program_id = NEW.program_id
  ) THEN
    RAISE EXCEPTION 'publish command program/version mismatch';
  END IF;
  IF NEW.published_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM loyalty_program_versions
    WHERE id = NEW.published_version_id
      AND program_id = NEW.program_id
      AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'published version program/organization mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS program_publish_command_tenant_guard ON program_publish_commands;
CREATE TRIGGER program_publish_command_tenant_guard
BEFORE INSERT OR UPDATE ON program_publish_commands
FOR EACH ROW EXECUTE FUNCTION waflo_assert_publish_command_tenant();

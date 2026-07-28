CREATE OR REPLACE FUNCTION waflo_assert_program_version_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM loyalty_programs p WHERE p.id = NEW.program_id AND p.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'program version tenant mismatch';
  END IF;
  IF OLD.status = 'SUPERSEDED' AND (NEW.program_id, NEW.organization_id, NEW.version_number, NEW.editing_mode, NEW.base_template_code, NEW.configuration_schema_version, NEW.revision, NEW.created_by_user_id) IS DISTINCT FROM (OLD.program_id, OLD.organization_id, OLD.version_number, OLD.editing_mode, OLD.base_template_code, OLD.configuration_schema_version, OLD.revision, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'superseded program versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS loyalty_program_version_tenant_guard ON loyalty_program_versions;
CREATE TRIGGER loyalty_program_version_tenant_guard BEFORE INSERT OR UPDATE ON loyalty_program_versions FOR EACH ROW EXECUTE FUNCTION waflo_assert_program_version_tenant();

CREATE OR REPLACE FUNCTION waflo_assert_program_location_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM loyalty_program_versions v JOIN locations l ON l.id = NEW.location_id WHERE v.id = NEW.version_id AND v.organization_id = l.organization_id) THEN
    RAISE EXCEPTION 'program location tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS program_location_tenant_guard ON program_locations;
CREATE TRIGGER program_location_tenant_guard BEFORE INSERT OR UPDATE ON program_locations FOR EACH ROW EXECUTE FUNCTION waflo_assert_program_location_tenant();

CREATE OR REPLACE FUNCTION waflo_assert_visual_asset_tenant() RETURNS trigger AS $$
DECLARE version_org UUID;
BEGIN
  SELECT organization_id INTO version_org FROM loyalty_program_versions WHERE id = NEW.version_id;
  IF version_org IS NULL THEN RAISE EXCEPTION 'visual theme version missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM merchant_assets WHERE id = NEW.filled_stamp_asset_id AND organization_id = version_org) OR NOT EXISTS (SELECT 1 FROM merchant_assets WHERE id = NEW.empty_stamp_asset_id AND organization_id = version_org) THEN
    RAISE EXCEPTION 'visual theme asset tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS program_visual_theme_tenant_guard ON program_visual_themes;
CREATE TRIGGER program_visual_theme_tenant_guard BEFORE INSERT OR UPDATE ON program_visual_themes FOR EACH ROW EXECUTE FUNCTION waflo_assert_visual_asset_tenant();

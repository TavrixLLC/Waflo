-- Prisma cannot express conditional uniqueness. Keep one editable version per program.
CREATE UNIQUE INDEX "loyalty_program_versions_one_active_draft"
  ON "loyalty_program_versions" ("program_id")
  WHERE "status" IN ('DRAFT', 'VALIDATED', 'TEST_READY');

-- A NULL progress value represents a non-progress-specific preview. COALESCE keeps
-- the cache key unique for that case as well.
CREATE UNIQUE INDEX "generated_program_previews_cache_key"
  ON "generated_program_previews" ("version_id", "preview_type", COALESCE("progress_state", -1), "configuration_hash");

ALTER TABLE "export_commands"
  ADD COLUMN "filters" JSONB NOT NULL DEFAULT '{}'::jsonb;

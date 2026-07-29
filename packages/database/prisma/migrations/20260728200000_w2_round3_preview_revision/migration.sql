ALTER TABLE "generated_program_previews"
ADD COLUMN "version_revision" INTEGER NOT NULL DEFAULT 1;

UPDATE "generated_program_previews" AS preview
SET "version_revision" = version."revision"
FROM "loyalty_program_versions" AS version
WHERE version."id" = preview."version_id";

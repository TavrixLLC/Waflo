ALTER TABLE "loyalty_program_versions" ADD COLUMN IF NOT EXISTS "abandoned_at" TIMESTAMPTZ(6);

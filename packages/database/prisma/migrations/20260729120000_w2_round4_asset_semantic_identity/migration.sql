DROP INDEX IF EXISTS "merchant_assets_organization_id_sha256_digest_key";

CREATE UNIQUE INDEX "merchant_assets_organization_id_sha256_digest_category_key"
ON "merchant_assets"("organization_id", "sha256_digest", "category");

-- Additive merchant-branding reference. Existing organizations retain their current Wallet fallback.
ALTER TABLE "organizations"
  ADD COLUMN "brand_logo_asset_id" UUID;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_brand_logo_asset_id_fkey"
  FOREIGN KEY ("brand_logo_asset_id") REFERENCES "merchant_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "organizations_brand_logo_asset_id_idx"
  ON "organizations"("brand_logo_asset_id");

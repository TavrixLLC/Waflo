ALTER TABLE "organization_members"
ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE "locations"
ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "organization_members_public_id_key"
ON "organization_members"("public_id");

CREATE UNIQUE INDEX "locations_public_id_key"
ON "locations"("public_id");

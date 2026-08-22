ALTER TABLE "device_pairing_sessions"
ADD COLUMN "pairing_manual_code_hash" CHAR(64);

CREATE UNIQUE INDEX "device_pairing_sessions_pairing_manual_code_hash_key"
ON "device_pairing_sessions"("pairing_manual_code_hash");

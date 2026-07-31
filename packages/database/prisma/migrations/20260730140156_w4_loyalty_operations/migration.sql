-- CreateEnum
CREATE TYPE "LoyaltyLedgerEventType" AS ENUM ('STAMP_ISSUED', 'STAMP_REVERSED', 'MILESTONE_REWARD_UNLOCKED', 'FINAL_REWARD_UNLOCKED', 'REWARD_REDEEMED', 'REWARD_REDEMPTION_REVERSED', 'CYCLE_RESET', 'CYCLE_RESET_REVERSED', 'MANUAL_STAMP_ADJUSTMENT', 'MEMBERSHIP_SUSPENDED', 'MEMBERSHIP_RESTORED', 'MEMBERSHIP_REVOKED', 'PROJECTION_REBUILT');

-- CreateEnum
CREATE TYPE "LoyaltyOperationType" AS ENUM ('ISSUE_STAMP', 'REDEEM_REWARD', 'REVERSE_STAMP', 'REVERSE_REDEMPTION', 'MANUAL_ADJUSTMENT', 'SUSPEND_MEMBERSHIP', 'RESTORE_MEMBERSHIP', 'REVOKE_MEMBERSHIP');

-- CreateEnum
CREATE TYPE "LoyaltyOperationStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RewardEntitlementStatus" AS ENUM ('AVAILABLE', 'PARTIALLY_REDEEMED', 'REDEEMED', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RewardRedemptionStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- CreateEnum
CREATE TYPE "StaffDevicePlatform" AS ENUM ('IOS', 'ANDROID', 'TEST_CLIENT');

-- CreateEnum
CREATE TYPE "StaffDeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'COMPROMISED');

-- CreateEnum
CREATE TYPE "DevicePairingStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OperationalRiskSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OperationalRiskStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "OperationalExportType" AS ENUM ('MEMBERSHIP_SUMMARY', 'LEDGER_OPERATIONS', 'REWARD_REDEMPTIONS', 'LOCATION_PERFORMANCE', 'STAFF_PERFORMANCE', 'RISK_SIGNALS', 'AGGREGATE_ANALYTICS');

-- CreateEnum
CREATE TYPE "ExportCommandStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CustomerPrivacyRequestType" AS ENUM ('EXPORT', 'ERASURE');

-- CreateEnum
CREATE TYPE "CustomerPrivacyRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProjectionRebuildStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectionRebuildInitiator" AS ENUM ('SYSTEM', 'OWNER', 'MANAGER');

-- CreateEnum
CREATE TYPE "ManagerApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED');

-- AlterTable
ALTER TABLE "loyalty_program_versions" ADD COLUMN     "manager_override_allowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "manager_reversal_window_minutes" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN     "operational_timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Baghdad',
ADD COLUMN     "staff_own_reversal_window_seconds" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "membership_progress_projections" ADD COLUMN     "current_cycle_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "last_ledger_sequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "projection_fingerprint" CHAR(64);

-- CreateTable
CREATE TABLE "loyalty_operation_commands" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "operation_type" "LoyaltyOperationType" NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "status" "LoyaltyOperationStatus" NOT NULL DEFAULT 'PROCESSING',
    "actor_member_id" UUID,
    "actor_device_id" UUID,
    "location_id" UUID,
    "result_ledger_entry_ids" JSONB NOT NULL DEFAULT '[]',
    "result_projection_version" INTEGER,
    "result_payload" JSONB,
    "safe_failure_code" VARCHAR(120),
    "lease_owner" VARCHAR(120),
    "lease_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "loyalty_operation_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger_entries" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "program_version_id" UUID NOT NULL,
    "location_id" UUID,
    "staff_organization_member_id" UUID,
    "staff_device_id" UUID,
    "event_type" "LoyaltyLedgerEventType" NOT NULL,
    "membership_sequence" INTEGER NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "stamp_delta" INTEGER NOT NULL DEFAULT 0,
    "reward_entitlement_id" UUID,
    "reward_redemption_id" UUID,
    "reversal_of_entry_id" UUID,
    "operation_command_id" UUID NOT NULL,
    "purchase_amount_minor" INTEGER,
    "purchase_currency" CHAR(3),
    "merchant_transaction_reference" VARCHAR(160),
    "operational_timezone" VARCHAR(64) NOT NULL,
    "operational_local_date" DATE NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "safe_metadata" JSONB,
    "ledger_hash_version" INTEGER NOT NULL DEFAULT 1,
    "previous_entry_hash" CHAR(64) NOT NULL,
    "entry_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_entitlements" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "program_version_id" UUID NOT NULL,
    "reward_definition_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "status" "RewardEntitlementStatus" NOT NULL DEFAULT 'AVAILABLE',
    "maximum_redemption_count" INTEGER NOT NULL DEFAULT 1,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "unlocked_by_ledger_entry_id" UUID,
    "unlocked_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "fully_redeemed_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reward_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "reward_entitlement_id" UUID NOT NULL,
    "reward_definition_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "entitlement_sequence" INTEGER NOT NULL,
    "status" "RewardRedemptionStatus" NOT NULL DEFAULT 'COMPLETED',
    "location_id" UUID NOT NULL,
    "staff_member_id" UUID NOT NULL,
    "staff_device_id" UUID,
    "operation_command_id" UUID NOT NULL,
    "redeemed_at" TIMESTAMPTZ(6) NOT NULL,
    "reversed_at" TIMESTAMPTZ(6),
    "reversal_ledger_entry_id" UUID,
    "safe_metadata" JSONB,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_location_assignments" (
    "organization_id" UUID NOT NULL,
    "organization_member_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "earning_allowed" BOOLEAN NOT NULL DEFAULT true,
    "redemption_allowed" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_location_assignments_pkey" PRIMARY KEY ("organization_member_id","location_id")
);

-- CreateTable
CREATE TABLE "staff_devices" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "organization_member_id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "platform" "StaffDevicePlatform" NOT NULL,
    "installation_id" VARCHAR(160) NOT NULL,
    "public_key" TEXT NOT NULL,
    "key_algorithm" VARCHAR(32) NOT NULL DEFAULT 'Ed25519',
    "status" "StaffDeviceStatus" NOT NULL DEFAULT 'PENDING',
    "trust_level" VARCHAR(32) NOT NULL DEFAULT 'PAIRED',
    "app_version" VARCHAR(40) NOT NULL,
    "os_version" VARCHAR(80),
    "model" VARCHAR(120),
    "paired_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" VARCHAR(240),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_device_locations" (
    "staff_device_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "earning_allowed" BOOLEAN NOT NULL DEFAULT true,
    "redemption_allowed" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_device_locations_pkey" PRIMARY KEY ("staff_device_id","location_id")
);

-- CreateTable
CREATE TABLE "device_pairing_sessions" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "intended_staff_member_id" UUID NOT NULL,
    "pairing_token_hash" CHAR(64) NOT NULL,
    "requested_location_assignments" JSONB NOT NULL,
    "device_label_suggestion" VARCHAR(120),
    "created_by_user_id" UUID NOT NULL,
    "status" "DevicePairingStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "claimed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "challenge_hash" CHAR(64),
    "challenge_expires_at" TIMESTAMPTZ(6),
    "claimed_installation_id" VARCHAR(160),
    "claimed_public_key" TEXT,
    "claimed_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pairing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_device_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "staff_device_id" UUID NOT NULL,
    "organization_member_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "refresh_token_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "rotation_source" VARCHAR(80),
    "app_version" VARCHAR(40) NOT NULL,
    "ip_metadata_hash" CHAR(64),
    "device_metadata" JSONB,

    CONSTRAINT "staff_device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_request_nonces" (
    "staff_device_id" UUID NOT NULL,
    "nonce" VARCHAR(128) NOT NULL,
    "request_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "body_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_request_nonces_pkey" PRIMARY KEY ("staff_device_id","nonce")
);

-- CreateTable
CREATE TABLE "manager_approval_challenges" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "reward_entitlement_id" UUID NOT NULL,
    "pending_operation_id" UUID,
    "staff_device_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "status" "ManagerApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_member_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_approval_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_risk_signals" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "membership_id" UUID,
    "staff_member_id" UUID,
    "staff_device_id" UUID,
    "location_id" UUID,
    "operation_command_id" UUID,
    "rule_code" VARCHAR(120) NOT NULL,
    "severity" "OperationalRiskSeverity" NOT NULL,
    "status" "OperationalRiskStatus" NOT NULL DEFAULT 'OPEN',
    "score" INTEGER NOT NULL,
    "safe_evidence" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_user_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" UUID,
    "resolution_note" VARCHAR(500),
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "operational_risk_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_daily_aggregates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "program_version_id" UUID,
    "location_id" UUID,
    "staff_member_id" UUID,
    "local_date" DATE NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "enrollments" INTEGER NOT NULL DEFAULT 0,
    "active_memberships" INTEGER NOT NULL DEFAULT 0,
    "stamp_units_issued" INTEGER NOT NULL DEFAULT 0,
    "stamp_operations" INTEGER NOT NULL DEFAULT 0,
    "reversals" INTEGER NOT NULL DEFAULT 0,
    "rewards_unlocked" INTEGER NOT NULL DEFAULT 0,
    "rewards_redeemed" INTEGER NOT NULL DEFAULT 0,
    "redemption_reversals" INTEGER NOT NULL DEFAULT 0,
    "unique_active_members" INTEGER NOT NULL DEFAULT 0,
    "completed_cycles" INTEGER NOT NULL DEFAULT 0,
    "risk_signals" INTEGER NOT NULL DEFAULT 0,
    "source_sequence" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_daily_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_commands" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "export_type" "OperationalExportType" NOT NULL,
    "filter_fingerprint" CHAR(64) NOT NULL,
    "status" "ExportCommandStatus" NOT NULL DEFAULT 'PENDING',
    "object_key" VARCHAR(500),
    "row_count" INTEGER,
    "expires_at" TIMESTAMPTZ(6),
    "lease_owner" VARCHAR(120),
    "lease_expires_at" TIMESTAMPTZ(6),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "safe_failure_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_privacy_requests" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "request_type" "CustomerPrivacyRequestType" NOT NULL,
    "status" "CustomerPrivacyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "confirmation_metadata" JSONB,
    "object_key" VARCHAR(500),
    "completed_at" TIMESTAMPTZ(6),
    "failure_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projection_rebuild_commands" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "expected_projection_version" INTEGER NOT NULL,
    "status" "ProjectionRebuildStatus" NOT NULL DEFAULT 'PENDING',
    "detected_drift" BOOLEAN,
    "before_fingerprint" CHAR(64),
    "after_fingerprint" CHAR(64),
    "initiated_by" "ProjectionRebuildInitiator" NOT NULL,
    "initiated_by_user_id" UUID,
    "safe_failure_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "projection_rebuild_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_operation_commands_public_id_key" ON "loyalty_operation_commands"("public_id");

-- CreateIndex
CREATE INDEX "loyalty_operation_commands_membership_id_created_at_idx" ON "loyalty_operation_commands"("membership_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "loyalty_operation_commands_organization_id_status_created_a_idx" ON "loyalty_operation_commands"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_operation_commands_organization_id_idempotency_key_key" ON "loyalty_operation_commands"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_public_id_key" ON "loyalty_ledger_entries"("public_id");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_organization_id_recorded_at_idx" ON "loyalty_ledger_entries"("organization_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_membership_id_membership_sequence_idx" ON "loyalty_ledger_entries"("membership_id", "membership_sequence" DESC);

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_membership_id_operational_local_date_idx" ON "loyalty_ledger_entries"("membership_id", "operational_local_date", "event_type");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_operation_command_id_idx" ON "loyalty_ledger_entries"("operation_command_id");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_reversal_of_entry_id_idx" ON "loyalty_ledger_entries"("reversal_of_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_membership_id_membership_sequence_key" ON "loyalty_ledger_entries"("membership_id", "membership_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "reward_entitlements_public_id_key" ON "reward_entitlements"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_entitlements_unlocked_by_ledger_entry_id_key" ON "reward_entitlements"("unlocked_by_ledger_entry_id");

-- CreateIndex
CREATE INDEX "reward_entitlements_organization_id_status_expires_at_idx" ON "reward_entitlements"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "reward_entitlements_membership_id_status_unlocked_at_idx" ON "reward_entitlements"("membership_id", "status", "unlocked_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reward_entitlements_membership_id_cycle_number_reward_defin_key" ON "reward_entitlements"("membership_id", "cycle_number", "reward_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_public_id_key" ON "reward_redemptions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_operation_command_id_key" ON "reward_redemptions"("operation_command_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_reversal_ledger_entry_id_key" ON "reward_redemptions"("reversal_ledger_entry_id");

-- CreateIndex
CREATE INDEX "reward_redemptions_membership_id_redeemed_at_idx" ON "reward_redemptions"("membership_id", "redeemed_at" DESC);

-- CreateIndex
CREATE INDEX "reward_redemptions_organization_id_status_redeemed_at_idx" ON "reward_redemptions"("organization_id", "status", "redeemed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_reward_entitlement_id_entitlement_sequen_key" ON "reward_redemptions"("reward_entitlement_id", "entitlement_sequence");

-- CreateIndex
CREATE INDEX "staff_location_assignments_organization_id_location_id_acti_idx" ON "staff_location_assignments"("organization_id", "location_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "staff_devices_public_id_key" ON "staff_devices"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_devices_installation_id_key" ON "staff_devices"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_devices_public_key_key" ON "staff_devices"("public_key");

-- CreateIndex
CREATE INDEX "staff_devices_organization_id_status_created_at_idx" ON "staff_devices"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "staff_devices_organization_member_id_status_idx" ON "staff_devices"("organization_member_id", "status");

-- CreateIndex
CREATE INDEX "staff_device_locations_location_id_active_idx" ON "staff_device_locations"("location_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_sessions_public_id_key" ON "device_pairing_sessions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_sessions_pairing_token_hash_key" ON "device_pairing_sessions"("pairing_token_hash");

-- CreateIndex
CREATE INDEX "device_pairing_sessions_organization_id_status_expires_at_idx" ON "device_pairing_sessions"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "device_pairing_sessions_intended_staff_member_id_status_idx" ON "device_pairing_sessions"("intended_staff_member_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "staff_device_sessions_token_hash_key" ON "staff_device_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "staff_device_sessions_refresh_token_hash_key" ON "staff_device_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "staff_device_sessions_staff_device_id_revoked_at_expires_at_idx" ON "staff_device_sessions"("staff_device_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "staff_device_sessions_organization_id_last_active_at_idx" ON "staff_device_sessions"("organization_id", "last_active_at");

-- CreateIndex
CREATE INDEX "device_request_nonces_expires_at_idx" ON "device_request_nonces"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "manager_approval_challenges_public_id_key" ON "manager_approval_challenges"("public_id");

-- CreateIndex
CREATE INDEX "manager_approval_challenges_organization_id_status_expires__idx" ON "manager_approval_challenges"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "manager_approval_challenges_membership_id_reward_entitlemen_idx" ON "manager_approval_challenges"("membership_id", "reward_entitlement_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "operational_risk_signals_public_id_key" ON "operational_risk_signals"("public_id");

-- CreateIndex
CREATE INDEX "operational_risk_signals_organization_id_status_severity_cr_idx" ON "operational_risk_signals"("organization_id", "status", "severity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "operational_risk_signals_membership_id_created_at_idx" ON "operational_risk_signals"("membership_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "operational_risk_signals_staff_device_id_created_at_idx" ON "operational_risk_signals"("staff_device_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "operational_daily_aggregates_organization_id_local_date_idx" ON "operational_daily_aggregates"("organization_id", "local_date" DESC);

-- CreateIndex
CREATE INDEX "operational_daily_aggregates_program_id_local_date_idx" ON "operational_daily_aggregates"("program_id", "local_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "export_commands_public_id_key" ON "export_commands"("public_id");

-- CreateIndex
CREATE INDEX "export_commands_organization_id_created_at_idx" ON "export_commands"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "export_commands_status_lease_expires_at_idx" ON "export_commands"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_privacy_requests_public_id_key" ON "customer_privacy_requests"("public_id");

-- CreateIndex
CREATE INDEX "customer_privacy_requests_customer_id_created_at_idx" ON "customer_privacy_requests"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "customer_privacy_requests_status_created_at_idx" ON "customer_privacy_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_privacy_requests_organization_id_idempotency_key_key" ON "customer_privacy_requests"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "projection_rebuild_commands_public_id_key" ON "projection_rebuild_commands"("public_id");

-- CreateIndex
CREATE INDEX "projection_rebuild_commands_membership_id_created_at_idx" ON "projection_rebuild_commands"("membership_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "projection_rebuild_commands_status_created_at_idx" ON "projection_rebuild_commands"("status", "created_at");

-- RenameIndex
ALTER INDEX "membership_access_sessions_membership_credential_id_revoked_at_" RENAME TO "membership_access_sessions_membership_credential_id_revoked_idx";

-- RenameIndex
ALTER INDEX "program_wallet_sync_jobs_organization_id_program_id_created_at_" RENAME TO "program_wallet_sync_jobs_organization_id_program_id_created_idx";

-- RenameIndex
ALTER INDEX "program_wallet_sync_jobs_program_snapshot_cursor_idx" RENAME TO "program_wallet_sync_jobs_program_id_snapshot_at_cursor_crea_idx";

-- RenameIndex
ALTER INDEX "program_wallet_sync_jobs_status_next_attempt_at_lease_expires_a" RENAME TO "program_wallet_sync_jobs_status_next_attempt_at_lease_expir_idx";

-- W4 domain checks and cross-tenant foreign keys.
ALTER TABLE "loyalty_program_versions"
  ADD CONSTRAINT "w4_program_operational_timezone_nonempty"
  CHECK (length(trim("operational_timezone")) BETWEEN 3 AND 64),
  ADD CONSTRAINT "w4_program_reversal_windows_safe"
  CHECK (
    "staff_own_reversal_window_seconds" BETWEEN 15 AND 900
    AND "manager_reversal_window_minutes" BETWEEN 1 AND 10080
  );

ALTER TABLE "membership_progress_projections"
  ADD CONSTRAINT "w4_projection_cycle_nonnegative"
  CHECK (
    "current_cycle_stamp_count" >= 0
    AND "completed_cycle_count" >= 0
    AND "current_cycle_number" = "completed_cycle_count" + 1
    AND "projection_version" >= 0
    AND "last_ledger_sequence" = "projection_version"
  );

ALTER TABLE "loyalty_operation_commands"
  ADD CONSTRAINT "loyalty_operation_commands_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_operation_commands_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_operation_commands_actor_member_id_fkey"
    FOREIGN KEY ("actor_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_operation_commands_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT;

ALTER TABLE "loyalty_ledger_entries"
  ADD CONSTRAINT "loyalty_ledger_entries_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_ledger_entries_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_ledger_entries_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_ledger_entries_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_ledger_entries_program_version_id_fkey"
    FOREIGN KEY ("program_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_ledger_entries_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_ledger_entries_staff_member_id_fkey"
    FOREIGN KEY ("staff_organization_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_ledger_entries_operation_command_id_fkey"
    FOREIGN KEY ("operation_command_id") REFERENCES "loyalty_operation_commands"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "loyalty_ledger_entries_reversal_of_entry_id_fkey"
    FOREIGN KEY ("reversal_of_entry_id") REFERENCES "loyalty_ledger_entries"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "w4_ledger_positive_sequence" CHECK ("membership_sequence" > 0),
  ADD CONSTRAINT "w4_ledger_positive_cycle" CHECK ("cycle_number" > 0),
  ADD CONSTRAINT "w4_ledger_hash_format" CHECK (
    "ledger_hash_version" = 1
    AND "previous_entry_hash" ~ '^[0-9a-f]{64}$'
    AND "entry_hash" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "w4_ledger_money_minor_nonnegative"
    CHECK ("purchase_amount_minor" IS NULL OR "purchase_amount_minor" >= 0),
  ADD CONSTRAINT "w4_ledger_currency_shape"
    CHECK ("purchase_currency" IS NULL OR "purchase_currency" ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX "w4_ledger_one_reversal_per_target"
  ON "loyalty_ledger_entries" ("reversal_of_entry_id")
  WHERE "reversal_of_entry_id" IS NOT NULL;

ALTER TABLE "reward_entitlements"
  ADD CONSTRAINT "reward_entitlements_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_entitlements_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_entitlements_program_version_id_fkey"
    FOREIGN KEY ("program_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_entitlements_reward_definition_id_fkey"
    FOREIGN KEY ("reward_definition_id") REFERENCES "reward_definitions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_entitlements_unlocked_ledger_id_fkey"
    FOREIGN KEY ("unlocked_by_ledger_entry_id") REFERENCES "loyalty_ledger_entries"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "w4_entitlement_redemption_count"
    CHECK (
      "maximum_redemption_count" > 0
      AND "redemption_count" >= 0
      AND "redemption_count" <= "maximum_redemption_count"
    ),
  ADD CONSTRAINT "w4_entitlement_cycle_threshold"
    CHECK ("cycle_number" > 0 AND "threshold" > 0);

ALTER TABLE "reward_redemptions"
  ADD CONSTRAINT "reward_redemptions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_redemptions_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_redemptions_entitlement_id_fkey"
    FOREIGN KEY ("reward_entitlement_id") REFERENCES "reward_entitlements"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_redemptions_definition_id_fkey"
    FOREIGN KEY ("reward_definition_id") REFERENCES "reward_definitions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_redemptions_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_redemptions_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_redemptions_operation_command_id_fkey"
    FOREIGN KEY ("operation_command_id") REFERENCES "loyalty_operation_commands"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "reward_redemptions_reversal_ledger_id_fkey"
    FOREIGN KEY ("reversal_ledger_entry_id") REFERENCES "loyalty_ledger_entries"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "w4_redemption_positive_sequence"
    CHECK ("cycle_number" > 0 AND "entitlement_sequence" > 0);

ALTER TABLE "staff_location_assignments"
  ADD CONSTRAINT "staff_location_assignments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "staff_location_assignments_member_id_fkey"
    FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "staff_location_assignments_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "staff_location_assignments_assigner_id_fkey"
    FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "staff_devices"
  ADD CONSTRAINT "staff_devices_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "staff_devices_member_id_fkey"
    FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "w4_device_key_algorithm" CHECK ("key_algorithm" = 'Ed25519');

ALTER TABLE "loyalty_operation_commands"
  ADD CONSTRAINT "loyalty_operation_commands_actor_device_id_fkey"
    FOREIGN KEY ("actor_device_id") REFERENCES "staff_devices"("id") ON DELETE RESTRICT;

ALTER TABLE "loyalty_ledger_entries"
  ADD CONSTRAINT "loyalty_ledger_entries_staff_device_id_fkey"
    FOREIGN KEY ("staff_device_id") REFERENCES "staff_devices"("id") ON DELETE RESTRICT;

ALTER TABLE "reward_redemptions"
  ADD CONSTRAINT "reward_redemptions_staff_device_id_fkey"
    FOREIGN KEY ("staff_device_id") REFERENCES "staff_devices"("id") ON DELETE RESTRICT;

ALTER TABLE "staff_device_locations"
  ADD CONSTRAINT "staff_device_locations_device_id_fkey"
    FOREIGN KEY ("staff_device_id") REFERENCES "staff_devices"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "staff_device_locations_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT;

ALTER TABLE "device_pairing_sessions"
  ADD CONSTRAINT "device_pairing_sessions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "device_pairing_sessions_member_id_fkey"
    FOREIGN KEY ("intended_staff_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "device_pairing_sessions_creator_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "w4_one_active_pairing_per_member"
  ON "device_pairing_sessions" ("intended_staff_member_id")
  WHERE "status" IN ('PENDING', 'CLAIMED');

ALTER TABLE "staff_device_sessions"
  ADD CONSTRAINT "staff_device_sessions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "staff_device_sessions_device_id_fkey"
    FOREIGN KEY ("staff_device_id") REFERENCES "staff_devices"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "staff_device_sessions_member_id_fkey"
    FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT;

ALTER TABLE "device_request_nonces"
  ADD CONSTRAINT "device_request_nonces_device_id_fkey"
    FOREIGN KEY ("staff_device_id") REFERENCES "staff_devices"("id") ON DELETE CASCADE;

ALTER TABLE "manager_approval_challenges"
  ADD CONSTRAINT "manager_approval_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "manager_approval_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "manager_approval_entitlement_id_fkey"
    FOREIGN KEY ("reward_entitlement_id") REFERENCES "reward_entitlements"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "manager_approval_operation_id_fkey"
    FOREIGN KEY ("pending_operation_id") REFERENCES "loyalty_operation_commands"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "manager_approval_device_id_fkey"
    FOREIGN KEY ("staff_device_id") REFERENCES "staff_devices"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "manager_approval_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "manager_approval_requester_id_fkey"
    FOREIGN KEY ("requested_by_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "manager_approval_approver_id_fkey"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "operational_risk_signals"
  ADD CONSTRAINT "risk_signals_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "risk_signals_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "risk_signals_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "risk_signals_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "risk_signals_device_id_fkey"
    FOREIGN KEY ("staff_device_id") REFERENCES "staff_devices"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "risk_signals_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "risk_signals_operation_id_fkey"
    FOREIGN KEY ("operation_command_id") REFERENCES "loyalty_operation_commands"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "w4_risk_score_range" CHECK ("score" BETWEEN 0 AND 100);

ALTER TABLE "operational_daily_aggregates"
  ADD CONSTRAINT "operational_aggregates_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "operational_aggregates_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "operational_aggregates_program_version_id_fkey"
    FOREIGN KEY ("program_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "operational_aggregates_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "operational_aggregates_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "w4_aggregate_counts_nonnegative" CHECK (
    "enrollments" >= 0
    AND "active_memberships" >= 0
    AND "stamp_units_issued" >= 0
    AND "stamp_operations" >= 0
    AND "reversals" >= 0
    AND "rewards_unlocked" >= 0
    AND "rewards_redeemed" >= 0
    AND "redemption_reversals" >= 0
    AND "unique_active_members" >= 0
    AND "completed_cycles" >= 0
    AND "risk_signals" >= 0
    AND "source_sequence" >= 0
  );

CREATE UNIQUE INDEX "w4_operational_aggregate_identity"
  ON "operational_daily_aggregates" (
    "organization_id",
    "program_id",
    COALESCE("program_version_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("staff_member_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "local_date",
    "timezone"
  );

ALTER TABLE "export_commands"
  ADD CONSTRAINT "export_commands_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "export_commands_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "w4_export_row_count_nonnegative"
    CHECK ("row_count" IS NULL OR "row_count" >= 0);

ALTER TABLE "customer_privacy_requests"
  ADD CONSTRAINT "privacy_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "privacy_requests_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "privacy_requests_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "projection_rebuild_commands"
  ADD CONSTRAINT "projection_rebuild_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "projection_rebuild_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "projection_rebuild_initiator_id_fkey"
    FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "w4_projection_rebuild_version_nonnegative"
    CHECK ("expected_projection_version" >= 0);

-- Ledger rows are immutable. Reversals are new compensating rows.
CREATE OR REPLACE FUNCTION waflo_reject_loyalty_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'WAFLO_LEDGER_APPEND_ONLY'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "w4_loyalty_ledger_no_update"
BEFORE UPDATE ON "loyalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION waflo_reject_loyalty_ledger_mutation();

CREATE TRIGGER "w4_loyalty_ledger_no_delete"
BEFORE DELETE ON "loyalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION waflo_reject_loyalty_ledger_mutation();

-- Validate tenant, pinned-version, actor/device, command and reversal consistency.
CREATE OR REPLACE FUNCTION waflo_validate_loyalty_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  membership_row "memberships"%ROWTYPE;
  command_row "loyalty_operation_commands"%ROWTYPE;
  actor_row "organization_members"%ROWTYPE;
  device_row "staff_devices"%ROWTYPE;
BEGIN
  SELECT * INTO membership_row FROM "memberships" WHERE "id" = NEW."membership_id";
  IF NOT FOUND
     OR membership_row."organization_id" <> NEW."organization_id"
     OR membership_row."customer_id" <> NEW."customer_id"
     OR membership_row."program_id" <> NEW."program_id"
     OR membership_row."enrollment_program_version_id" <> NEW."program_version_id" THEN
    RAISE EXCEPTION 'WAFLO_LEDGER_MEMBERSHIP_CONTEXT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO command_row FROM "loyalty_operation_commands"
  WHERE "id" = NEW."operation_command_id";
  IF NOT FOUND
     OR command_row."organization_id" <> NEW."organization_id"
     OR command_row."membership_id" <> NEW."membership_id" THEN
    RAISE EXCEPTION 'WAFLO_LEDGER_COMMAND_CONTEXT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."location_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "locations"
    WHERE "id" = NEW."location_id" AND "organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'WAFLO_LEDGER_LOCATION_CONTEXT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."staff_organization_member_id" IS NOT NULL THEN
    SELECT * INTO actor_row FROM "organization_members"
    WHERE "id" = NEW."staff_organization_member_id";
    IF NOT FOUND OR actor_row."organization_id" <> NEW."organization_id" THEN
      RAISE EXCEPTION 'WAFLO_LEDGER_STAFF_CONTEXT_MISMATCH'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."staff_device_id" IS NOT NULL THEN
    SELECT * INTO device_row FROM "staff_devices" WHERE "id" = NEW."staff_device_id";
    IF NOT FOUND
       OR device_row."organization_id" <> NEW."organization_id"
       OR device_row."organization_member_id" IS DISTINCT FROM NEW."staff_organization_member_id" THEN
      RAISE EXCEPTION 'WAFLO_LEDGER_DEVICE_CONTEXT_MISMATCH'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."reversal_of_entry_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "loyalty_ledger_entries"
    WHERE "id" = NEW."reversal_of_entry_id"
      AND "membership_id" = NEW."membership_id"
      AND "organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'WAFLO_LEDGER_REVERSAL_CONTEXT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "w4_loyalty_ledger_context_guard"
BEFORE INSERT ON "loyalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION waflo_validate_loyalty_ledger_entry();

CREATE OR REPLACE FUNCTION waflo_validate_projection_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."projection_version" = 0 THEN
    IF NEW."last_source_event_id" IS NOT NULL OR NEW."last_ledger_sequence" <> 0 THEN
      RAISE EXCEPTION 'WAFLO_PROJECTION_SOURCE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "loyalty_ledger_entries"
    WHERE "id" = NEW."last_source_event_id"
      AND "membership_id" = NEW."membership_id"
      AND "organization_id" = NEW."organization_id"
      AND "membership_sequence" = NEW."projection_version"
      AND "membership_sequence" = NEW."last_ledger_sequence"
  ) THEN
    RAISE EXCEPTION 'WAFLO_PROJECTION_SOURCE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "w4_projection_source_guard"
BEFORE INSERT OR UPDATE ON "membership_progress_projections"
FOR EACH ROW EXECUTE FUNCTION waflo_validate_projection_source();

CREATE OR REPLACE FUNCTION waflo_validate_staff_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "organization_members"
    WHERE "id" = NEW."organization_member_id"
      AND "organization_id" = NEW."organization_id"
  ) OR NOT EXISTS (
    SELECT 1 FROM "locations"
    WHERE "id" = NEW."location_id"
      AND "organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'WAFLO_STAFF_ASSIGNMENT_TENANT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "w4_staff_assignment_context_guard"
BEFORE INSERT OR UPDATE ON "staff_location_assignments"
FOR EACH ROW EXECUTE FUNCTION waflo_validate_staff_assignment();

CREATE OR REPLACE FUNCTION waflo_validate_device_location()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  device_row "staff_devices"%ROWTYPE;
BEGIN
  SELECT * INTO device_row FROM "staff_devices" WHERE "id" = NEW."staff_device_id";
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM "staff_location_assignments"
    WHERE "organization_member_id" = device_row."organization_member_id"
      AND "location_id" = NEW."location_id"
      AND "organization_id" = device_row."organization_id"
      AND "active" = true
      AND ("earning_allowed" OR NOT NEW."earning_allowed")
      AND ("redemption_allowed" OR NOT NEW."redemption_allowed")
  ) THEN
    RAISE EXCEPTION 'WAFLO_DEVICE_ASSIGNMENT_EXCEEDS_STAFF'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "w4_device_location_context_guard"
BEFORE INSERT OR UPDATE ON "staff_device_locations"
FOR EACH ROW EXECUTE FUNCTION waflo_validate_device_location();

CREATE OR REPLACE FUNCTION waflo_reject_device_reassignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."organization_id" <> NEW."organization_id"
     OR OLD."organization_member_id" <> NEW."organization_member_id"
     OR OLD."installation_id" <> NEW."installation_id"
     OR OLD."public_key" <> NEW."public_key"
     OR OLD."key_algorithm" <> NEW."key_algorithm" THEN
    RAISE EXCEPTION 'WAFLO_DEVICE_IDENTITY_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "w4_device_identity_immutable"
BEFORE UPDATE ON "staff_devices"
FOR EACH ROW EXECUTE FUNCTION waflo_reject_device_reassignment();

CREATE OR REPLACE FUNCTION waflo_validate_reward_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "memberships" m
    JOIN "reward_definitions" r ON r."id" = NEW."reward_definition_id"
    WHERE m."id" = NEW."membership_id"
      AND m."organization_id" = NEW."organization_id"
      AND m."enrollment_program_version_id" = NEW."program_version_id"
      AND r."version_id" = NEW."program_version_id"
      AND r."threshold_stamp_count" = NEW."threshold"
  ) THEN
    RAISE EXCEPTION 'WAFLO_REWARD_CONTEXT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "w4_reward_entitlement_context_guard"
BEFORE INSERT OR UPDATE ON "reward_entitlements"
FOR EACH ROW EXECUTE FUNCTION waflo_validate_reward_context();

CREATE OR REPLACE FUNCTION waflo_validate_redemption_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "reward_entitlements" e
    WHERE e."id" = NEW."reward_entitlement_id"
      AND e."organization_id" = NEW."organization_id"
      AND e."membership_id" = NEW."membership_id"
      AND e."reward_definition_id" = NEW."reward_definition_id"
      AND e."cycle_number" = NEW."cycle_number"
      AND NEW."entitlement_sequence" <= e."maximum_redemption_count"
  ) THEN
    RAISE EXCEPTION 'WAFLO_REDEMPTION_CONTEXT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "w4_reward_redemption_context_guard"
BEFORE INSERT OR UPDATE ON "reward_redemptions"
FOR EACH ROW EXECUTE FUNCTION waflo_validate_redemption_context();

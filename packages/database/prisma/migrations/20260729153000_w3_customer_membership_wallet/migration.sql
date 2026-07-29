-- CreateEnum
CREATE TYPE "EmailCollectionMode" AS ENUM ('HIDDEN', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CustomerContactType" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "ContactVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "CustomerConsentType" AS ENUM ('WAFLO_PRIVACY', 'PROGRAM_TERMS', 'MARKETING_EMAIL');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EnrollmentCommandStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MembershipCredentialStatus" AS ENUM ('ACTIVE', 'TRANSFERRED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WalletProviderCode" AS ENUM ('APPLE', 'GOOGLE');

-- CreateEnum
CREATE TYPE "WalletPassStatus" AS ENUM ('PENDING', 'ISSUED', 'ACTIVE', 'UPDATE_PENDING', 'INVALIDATION_PENDING', 'INVALIDATED', 'ERROR');

-- CreateEnum
CREATE TYPE "WalletBindingStatus" AS ENUM ('PENDING', 'READY', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "WalletCommandType" AS ENUM ('ENSURE_TEMPLATE', 'ISSUE', 'UPDATE', 'INVALIDATE', 'RECONCILE', 'APPLE_PUSH');

-- CreateEnum
CREATE TYPE "WalletCommandStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "MembershipTransferMethod" AS ENUM ('EMAIL_CONFIRMED', 'QR_WITHOUT_EMAIL');

-- CreateEnum
CREATE TYPE "MembershipTransferStatus" AS ENUM ('PENDING_CONFIRMATION', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "MembershipTransferActorType" AS ENUM ('CUSTOMER', 'SYSTEM', 'SUPPORT');

-- AlterTable
ALTER TABLE "loyalty_programs" ADD COLUMN     "public_slug" VARCHAR(50);

-- CreateTable
CREATE TABLE "program_public_slug_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "released_at" TIMESTAMPTZ(6) NOT NULL,
    "reserved_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_public_slug_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_enrollment_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_version_id" UUID NOT NULL,
    "email_collection_mode" "EmailCollectionMode" NOT NULL DEFAULT 'OPTIONAL',
    "primary_customer_locale" "Locale" NOT NULL DEFAULT 'EN',
    "allow_locale_selection" BOOLEAN NOT NULL DEFAULT true,
    "marketing_consent_visible" BOOLEAN NOT NULL DEFAULT false,
    "marketing_consent_default" BOOLEAN NOT NULL DEFAULT false,
    "customer_terms_required" BOOLEAN NOT NULL DEFAULT true,
    "transfer_without_email_allowed" BOOLEAN NOT NULL DEFAULT true,
    "enrollment_open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "program_enrollment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "preferred_locale" "Locale" NOT NULL DEFAULT 'EN',
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "CustomerContactType" NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "encryption_key_version" INTEGER NOT NULL,
    "normalized_value_hash" CHAR(64) NOT NULL,
    "masked_display_value" VARCHAR(254) NOT NULL,
    "verification_status" "ContactVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMPTZ(6),
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "membership_id" UUID,
    "consent_type" "CustomerConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "document_fingerprint" VARCHAR(160) NOT NULL,
    "locale" "Locale" NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "safe_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "enrollment_program_version_id" UUID NOT NULL,
    "public_membership_id" VARCHAR(80) NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_at" TIMESTAMPTZ(6),
    "expired_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_progress_projections" (
    "membership_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "current_cycle_stamp_count" INTEGER NOT NULL DEFAULT 0,
    "completed_cycle_count" INTEGER NOT NULL DEFAULT 0,
    "reward_ready" BOOLEAN NOT NULL DEFAULT false,
    "projection_version" INTEGER NOT NULL DEFAULT 0,
    "last_source_event_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "membership_progress_projections_pkey" PRIMARY KEY ("membership_id")
);

-- CreateTable
CREATE TABLE "enrollment_commands" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "program_version_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "status" "EnrollmentCommandStatus" NOT NULL DEFAULT 'PROCESSING',
    "customer_id" UUID,
    "membership_id" UUID,
    "access_session_id" UUID,
    "failure_code" VARCHAR(120),
    "lease_owner" VARCHAR(120),
    "lease_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "enrollment_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_access_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent" VARCHAR(512),
    "device_label" VARCHAR(100),

    CONSTRAINT "membership_access_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_credentials" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "public_credential_id" VARCHAR(80) NOT NULL,
    "secret_version" INTEGER NOT NULL,
    "secret_hash" CHAR(64) NOT NULL,
    "status" "MembershipCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transferred_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_credential_id" UUID,

    CONSTRAINT "membership_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_program_bindings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "program_version_id" UUID NOT NULL,
    "provider" "WalletProviderCode" NOT NULL,
    "provider_template_id" VARCHAR(255),
    "status" "WalletBindingStatus" NOT NULL DEFAULT 'PENDING',
    "configuration_fingerprint" CHAR(64) NOT NULL,
    "provider_state" JSONB,
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_program_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_pass_instances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "membership_credential_id" UUID NOT NULL,
    "provider" "WalletProviderCode" NOT NULL,
    "wallet_program_binding_id" UUID,
    "provider_identity" VARCHAR(255) NOT NULL,
    "status" "WalletPassStatus" NOT NULL DEFAULT 'PENDING',
    "provider_state" JSONB,
    "update_tag" INTEGER NOT NULL DEFAULT 1,
    "last_rendered_projection_version" INTEGER NOT NULL DEFAULT 0,
    "last_provider_sync_at" TIMESTAMPTZ(6),
    "last_provider_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "invalidated_at" TIMESTAMPTZ(6),

    CONSTRAINT "wallet_pass_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apple_pass_registrations" (
    "id" UUID NOT NULL,
    "wallet_pass_instance_id" UUID NOT NULL,
    "device_library_identifier_hash" CHAR(64) NOT NULL,
    "push_token_encrypted" TEXT NOT NULL,
    "encryption_key_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "unregistered_at" TIMESTAMPTZ(6),

    CONSTRAINT "apple_pass_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_commands" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "wallet_pass_instance_id" UUID,
    "provider" "WalletProviderCode" NOT NULL,
    "command_type" "WalletCommandType" NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "payload_fingerprint" CHAR(64) NOT NULL,
    "safe_payload" JSONB,
    "status" "WalletCommandStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" VARCHAR(120),
    "lease_expires_at" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_request_id" VARCHAR(255),
    "safe_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "wallet_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_transfer_commands" (
    "id" UUID NOT NULL,
    "public_transfer_id" VARCHAR(80) NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "old_credential_id" UUID NOT NULL,
    "new_credential_id" UUID,
    "transfer_method" "MembershipTransferMethod" NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "status" "MembershipTransferStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "confirmation_token_hash" CHAR(64),
    "confirmation_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "safe_failure_code" VARCHAR(120),
    "created_from_customer_session_id" UUID,

    CONSTRAINT "membership_transfer_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_transfer_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "old_credential_id" UUID NOT NULL,
    "new_credential_id" UUID NOT NULL,
    "method" "MembershipTransferMethod" NOT NULL,
    "actor_type" "MembershipTransferActorType" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "safe_metadata" JSONB,

    CONSTRAINT "membership_transfer_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_wallet_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_version_id" UUID,
    "membership_id" UUID,
    "asset_type" VARCHAR(80) NOT NULL,
    "content_digest" CHAR(64) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "public_token" VARCHAR(100) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "public_wallet_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_public_slug_history_organization_id_slug_reserved_u_idx" ON "program_public_slug_history"("organization_id", "slug", "reserved_until");

-- CreateIndex
CREATE INDEX "program_public_slug_history_program_id_created_at_idx" ON "program_public_slug_history"("program_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "program_enrollment_policies_program_version_id_key" ON "program_enrollment_policies"("program_version_id");

-- CreateIndex
CREATE INDEX "program_enrollment_policies_organization_id_enrollment_open_idx" ON "program_enrollment_policies"("organization_id", "enrollment_open");

-- CreateIndex
CREATE INDEX "customers_organization_id_status_created_at_idx" ON "customers"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "customer_contacts_organization_id_normalized_value_hash_typ_idx" ON "customer_contacts"("organization_id", "normalized_value_hash", "type");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contacts_customer_id_type_is_primary_key" ON "customer_contacts"("customer_id", "type", "is_primary");

-- CreateIndex
CREATE INDEX "customer_consents_organization_id_customer_id_captured_at_idx" ON "customer_consents"("organization_id", "customer_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "customer_consents_membership_id_consent_type_idx" ON "customer_consents"("membership_id", "consent_type");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_public_membership_id_key" ON "memberships"("public_membership_id");

-- CreateIndex
CREATE INDEX "memberships_organization_id_program_id_status_enrolled_at_idx" ON "memberships"("organization_id", "program_id", "status", "enrolled_at" DESC);

-- CreateIndex
CREATE INDEX "memberships_customer_id_status_idx" ON "memberships"("customer_id", "status");

-- CreateIndex
CREATE INDEX "membership_progress_projections_organization_id_updated_at_idx" ON "membership_progress_projections"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "enrollment_commands_status_lease_expires_at_idx" ON "enrollment_commands"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_commands_organization_id_idempotency_key_key" ON "enrollment_commands"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "membership_access_sessions_token_hash_key" ON "membership_access_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "membership_access_sessions_organization_id_membership_id_ex_idx" ON "membership_access_sessions"("organization_id", "membership_id", "expires_at");

-- CreateIndex
CREATE INDEX "membership_access_sessions_membership_id_revoked_at_idx" ON "membership_access_sessions"("membership_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "membership_credentials_public_credential_id_key" ON "membership_credentials"("public_credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_credentials_replaced_by_credential_id_key" ON "membership_credentials"("replaced_by_credential_id");

-- CreateIndex
CREATE INDEX "membership_credentials_organization_id_membership_id_status_idx" ON "membership_credentials"("organization_id", "membership_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "membership_credentials_membership_id_credential_version_key" ON "membership_credentials"("membership_id", "credential_version");

-- CreateIndex
CREATE INDEX "wallet_program_bindings_organization_id_status_idx" ON "wallet_program_bindings"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_program_bindings_organization_id_program_version_id__key" ON "wallet_program_bindings"("organization_id", "program_version_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_program_bindings_provider_provider_template_id_key" ON "wallet_program_bindings"("provider", "provider_template_id");

-- CreateIndex
CREATE INDEX "wallet_pass_instances_organization_id_membership_id_status_idx" ON "wallet_pass_instances"("organization_id", "membership_id", "status");

-- CreateIndex
CREATE INDEX "wallet_pass_instances_provider_status_updated_at_idx" ON "wallet_pass_instances"("provider", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_pass_instances_provider_provider_identity_key" ON "wallet_pass_instances"("provider", "provider_identity");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_pass_instances_membership_credential_id_provider_key" ON "wallet_pass_instances"("membership_credential_id", "provider");

-- CreateIndex
CREATE INDEX "apple_pass_registrations_device_library_identifier_hash_unr_idx" ON "apple_pass_registrations"("device_library_identifier_hash", "unregistered_at");

-- CreateIndex
CREATE INDEX "apple_pass_registrations_wallet_pass_instance_id_unregister_idx" ON "apple_pass_registrations"("wallet_pass_instance_id", "unregistered_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_commands_idempotency_key_key" ON "wallet_commands"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_commands_status_next_attempt_at_lease_expires_at_idx" ON "wallet_commands"("status", "next_attempt_at", "lease_expires_at");

-- CreateIndex
CREATE INDEX "wallet_commands_organization_id_membership_id_provider_crea_idx" ON "wallet_commands"("organization_id", "membership_id", "provider", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "membership_transfer_commands_public_transfer_id_key" ON "membership_transfer_commands"("public_transfer_id");

-- CreateIndex
CREATE INDEX "membership_transfer_commands_membership_id_status_created_a_idx" ON "membership_transfer_commands"("membership_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "membership_transfer_commands_status_confirmation_expires_at_idx" ON "membership_transfer_commands"("status", "confirmation_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "membership_transfer_commands_organization_id_idempotency_ke_key" ON "membership_transfer_commands"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "membership_transfer_events_membership_id_created_at_idx" ON "membership_transfer_events"("membership_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "public_wallet_assets_public_token_key" ON "public_wallet_assets"("public_token");

-- CreateIndex
CREATE INDEX "public_wallet_assets_public_token_revoked_at_idx" ON "public_wallet_assets"("public_token", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "public_wallet_assets_organization_id_content_digest_asset_t_key" ON "public_wallet_assets"("organization_id", "content_digest", "asset_type");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_organization_id_public_slug_key" ON "loyalty_programs"("organization_id", "public_slug");

-- AddForeignKey
ALTER TABLE "program_public_slug_history" ADD CONSTRAINT "program_public_slug_history_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_enrollment_policies" ADD CONSTRAINT "program_enrollment_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_enrollment_policies" ADD CONSTRAINT "program_enrollment_policies_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_enrollment_program_version_id_fkey" FOREIGN KEY ("enrollment_program_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_progress_projections" ADD CONSTRAINT "membership_progress_projections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_progress_projections" ADD CONSTRAINT "membership_progress_projections_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_commands" ADD CONSTRAINT "enrollment_commands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_commands" ADD CONSTRAINT "enrollment_commands_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_commands" ADD CONSTRAINT "enrollment_commands_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_commands" ADD CONSTRAINT "enrollment_commands_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_commands" ADD CONSTRAINT "enrollment_commands_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_commands" ADD CONSTRAINT "enrollment_commands_access_session_id_fkey" FOREIGN KEY ("access_session_id") REFERENCES "membership_access_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_access_sessions" ADD CONSTRAINT "membership_access_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_access_sessions" ADD CONSTRAINT "membership_access_sessions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_credentials" ADD CONSTRAINT "membership_credentials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_credentials" ADD CONSTRAINT "membership_credentials_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_credentials" ADD CONSTRAINT "membership_credentials_replaced_by_credential_id_fkey" FOREIGN KEY ("replaced_by_credential_id") REFERENCES "membership_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_program_bindings" ADD CONSTRAINT "wallet_program_bindings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_program_bindings" ADD CONSTRAINT "wallet_program_bindings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_program_bindings" ADD CONSTRAINT "wallet_program_bindings_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_pass_instances" ADD CONSTRAINT "wallet_pass_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_pass_instances" ADD CONSTRAINT "wallet_pass_instances_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_pass_instances" ADD CONSTRAINT "wallet_pass_instances_membership_credential_id_fkey" FOREIGN KEY ("membership_credential_id") REFERENCES "membership_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_pass_instances" ADD CONSTRAINT "wallet_pass_instances_wallet_program_binding_id_fkey" FOREIGN KEY ("wallet_program_binding_id") REFERENCES "wallet_program_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apple_pass_registrations" ADD CONSTRAINT "apple_pass_registrations_wallet_pass_instance_id_fkey" FOREIGN KEY ("wallet_pass_instance_id") REFERENCES "wallet_pass_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_commands" ADD CONSTRAINT "wallet_commands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_commands" ADD CONSTRAINT "wallet_commands_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_commands" ADD CONSTRAINT "wallet_commands_wallet_pass_instance_id_fkey" FOREIGN KEY ("wallet_pass_instance_id") REFERENCES "wallet_pass_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_commands" ADD CONSTRAINT "membership_transfer_commands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_commands" ADD CONSTRAINT "membership_transfer_commands_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_commands" ADD CONSTRAINT "membership_transfer_commands_old_credential_id_fkey" FOREIGN KEY ("old_credential_id") REFERENCES "membership_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_commands" ADD CONSTRAINT "membership_transfer_commands_new_credential_id_fkey" FOREIGN KEY ("new_credential_id") REFERENCES "membership_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_commands" ADD CONSTRAINT "membership_transfer_commands_created_from_customer_session_fkey" FOREIGN KEY ("created_from_customer_session_id") REFERENCES "membership_access_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_events" ADD CONSTRAINT "membership_transfer_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_events" ADD CONSTRAINT "membership_transfer_events_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_events" ADD CONSTRAINT "membership_transfer_events_old_credential_id_fkey" FOREIGN KEY ("old_credential_id") REFERENCES "membership_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_transfer_events" ADD CONSTRAINT "membership_transfer_events_new_credential_id_fkey" FOREIGN KEY ("new_credential_id") REFERENCES "membership_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_wallet_assets" ADD CONSTRAINT "public_wallet_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_wallet_assets" ADD CONSTRAINT "public_wallet_assets_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_wallet_assets" ADD CONSTRAINT "public_wallet_assets_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing W2 programs receive an opaque, organization-scoped public slug.
-- Program creation replaces this fallback with a name-derived slug.
UPDATE loyalty_programs
SET public_slug = 'program-' || left(replace(id::text, '-', ''), 12)
WHERE public_slug IS NULL;

ALTER TABLE loyalty_programs
  ADD CONSTRAINT loyalty_programs_public_slug_format_check
  CHECK (
    public_slug IS NULL OR
    public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND char_length(public_slug) BETWEEN 3 AND 50
  );

ALTER TABLE program_enrollment_policies
  ADD CONSTRAINT enrollment_policy_marketing_default_check
  CHECK (marketing_consent_default = false),
  ADD CONSTRAINT enrollment_policy_terms_check
  CHECK (customer_terms_required = true);

ALTER TABLE membership_progress_projections
  ADD CONSTRAINT membership_progress_nonnegative_check
  CHECK (
    current_cycle_stamp_count >= 0
    AND completed_cycle_count >= 0
    AND projection_version >= 0
  );

ALTER TABLE membership_credentials
  ADD CONSTRAINT membership_credential_version_check
  CHECK (credential_version > 0 AND secret_version > 0);

ALTER TABLE wallet_pass_instances
  ADD CONSTRAINT wallet_pass_update_tag_check
  CHECK (update_tag > 0 AND last_rendered_projection_version >= 0);

ALTER TABLE wallet_commands
  ADD CONSTRAINT wallet_command_attempt_check
  CHECK (attempt_count >= 0);

CREATE UNIQUE INDEX membership_credentials_one_active_per_membership
ON membership_credentials(membership_id)
WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX membership_transfer_one_active_per_membership
ON membership_transfer_commands(membership_id)
WHERE status IN ('PENDING_CONFIRMATION', 'PROCESSING');

CREATE UNIQUE INDEX apple_registration_one_active_per_device
ON apple_pass_registrations(wallet_pass_instance_id, device_library_identifier_hash)
WHERE unregistered_at IS NULL;

CREATE OR REPLACE FUNCTION waflo_assert_w3_tenant_consistency() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'program_public_slug_history' THEN
    IF NOT EXISTS (
      SELECT 1 FROM loyalty_programs p
      WHERE p.id = NEW.program_id AND p.organization_id = NEW.organization_id
    ) THEN RAISE EXCEPTION 'program slug history tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'program_enrollment_policies' THEN
    IF NOT EXISTS (
      SELECT 1 FROM loyalty_program_versions v
      WHERE v.id = NEW.program_version_id AND v.organization_id = NEW.organization_id
    ) THEN RAISE EXCEPTION 'enrollment policy tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'customer_contacts' THEN
    IF NOT EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = NEW.customer_id AND c.organization_id = NEW.organization_id
    ) THEN RAISE EXCEPTION 'customer contact tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'customer_consents' THEN
    IF NOT EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = NEW.customer_id AND c.organization_id = NEW.organization_id
    ) OR (
      NEW.membership_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.id = NEW.membership_id
          AND m.customer_id = NEW.customer_id
          AND m.organization_id = NEW.organization_id
      )
    ) THEN RAISE EXCEPTION 'customer consent tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'memberships' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM customers c
      JOIN loyalty_programs p
        ON p.id = NEW.program_id
       AND p.organization_id = NEW.organization_id
      JOIN loyalty_program_versions v
        ON v.id = NEW.enrollment_program_version_id
       AND v.program_id = NEW.program_id
       AND v.organization_id = NEW.organization_id
      WHERE c.id = NEW.customer_id
        AND c.organization_id = NEW.organization_id
    ) THEN RAISE EXCEPTION 'membership tenant or version mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'membership_progress_projections' THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.id = NEW.membership_id AND m.organization_id = NEW.organization_id
    ) THEN RAISE EXCEPTION 'membership progress tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'membership_access_sessions' THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.id = NEW.membership_id AND m.organization_id = NEW.organization_id
    ) THEN RAISE EXCEPTION 'membership session tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'membership_credentials' THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.id = NEW.membership_id AND m.organization_id = NEW.organization_id
    ) OR (
      NEW.replaced_by_credential_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM membership_credentials c
        WHERE c.id = NEW.replaced_by_credential_id
          AND c.membership_id = NEW.membership_id
          AND c.organization_id = NEW.organization_id
      )
    ) THEN RAISE EXCEPTION 'membership credential tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'enrollment_commands' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM loyalty_programs p
      JOIN loyalty_program_versions v
        ON v.id = NEW.program_version_id
       AND v.program_id = p.id
       AND v.organization_id = p.organization_id
      WHERE p.id = NEW.program_id
        AND p.organization_id = NEW.organization_id
    ) OR (
      NEW.customer_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM customers c
        WHERE c.id = NEW.customer_id AND c.organization_id = NEW.organization_id
      )
    ) OR (
      NEW.membership_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.id = NEW.membership_id
          AND m.program_id = NEW.program_id
          AND m.organization_id = NEW.organization_id
      )
    ) OR (
      NEW.access_session_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM membership_access_sessions s
        WHERE s.id = NEW.access_session_id
          AND s.membership_id = NEW.membership_id
          AND s.organization_id = NEW.organization_id
      )
    ) THEN RAISE EXCEPTION 'enrollment command tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'wallet_program_bindings' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM loyalty_programs p
      JOIN loyalty_program_versions v
        ON v.id = NEW.program_version_id
       AND v.program_id = p.id
       AND v.organization_id = p.organization_id
      WHERE p.id = NEW.program_id
        AND p.organization_id = NEW.organization_id
    ) THEN RAISE EXCEPTION 'wallet program binding tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'wallet_pass_instances' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM memberships m
      JOIN membership_credentials c
        ON c.id = NEW.membership_credential_id
       AND c.membership_id = m.id
       AND c.organization_id = m.organization_id
      WHERE m.id = NEW.membership_id
        AND m.organization_id = NEW.organization_id
    ) OR (
      NEW.wallet_program_binding_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM wallet_program_bindings b
        JOIN memberships m
          ON m.enrollment_program_version_id = b.program_version_id
         AND m.program_id = b.program_id
         AND m.organization_id = b.organization_id
        WHERE b.id = NEW.wallet_program_binding_id
          AND b.provider = NEW.provider
          AND m.id = NEW.membership_id
      )
    ) THEN RAISE EXCEPTION 'wallet pass tenant, credential, or binding mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'wallet_commands' THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.id = NEW.membership_id AND m.organization_id = NEW.organization_id
    ) OR (
      NEW.wallet_pass_instance_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM wallet_pass_instances p
        WHERE p.id = NEW.wallet_pass_instance_id
          AND p.membership_id = NEW.membership_id
          AND p.organization_id = NEW.organization_id
          AND p.provider = NEW.provider
      )
    ) THEN RAISE EXCEPTION 'wallet command tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'membership_transfer_commands' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM memberships m
      JOIN membership_credentials c
        ON c.id = NEW.old_credential_id
       AND c.membership_id = m.id
       AND c.organization_id = m.organization_id
      WHERE m.id = NEW.membership_id
        AND m.organization_id = NEW.organization_id
    ) OR (
      NEW.new_credential_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM membership_credentials c
        WHERE c.id = NEW.new_credential_id
          AND c.membership_id = NEW.membership_id
          AND c.organization_id = NEW.organization_id
      )
    ) THEN RAISE EXCEPTION 'membership transfer command tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'membership_transfer_events' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM memberships m
      JOIN membership_credentials old_c
        ON old_c.id = NEW.old_credential_id
       AND old_c.membership_id = m.id
      JOIN membership_credentials new_c
        ON new_c.id = NEW.new_credential_id
       AND new_c.membership_id = m.id
      WHERE m.id = NEW.membership_id
        AND m.organization_id = NEW.organization_id
        AND old_c.organization_id = NEW.organization_id
        AND new_c.organization_id = NEW.organization_id
    ) THEN RAISE EXCEPTION 'membership transfer event tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'public_wallet_assets' THEN
    IF (
      NEW.program_version_id IS NULL AND NEW.membership_id IS NULL
    ) OR (
      NEW.program_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM loyalty_program_versions v
        WHERE v.id = NEW.program_version_id AND v.organization_id = NEW.organization_id
      )
    ) OR (
      NEW.membership_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.id = NEW.membership_id AND m.organization_id = NEW.organization_id
      )
    ) THEN RAISE EXCEPTION 'public wallet asset tenant mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'program_public_slug_history',
    'program_enrollment_policies',
    'customer_contacts',
    'customer_consents',
    'memberships',
    'membership_progress_projections',
    'enrollment_commands',
    'membership_access_sessions',
    'membership_credentials',
    'wallet_program_bindings',
    'wallet_pass_instances',
    'wallet_commands',
    'membership_transfer_commands',
    'membership_transfer_events',
    'public_wallet_assets'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION waflo_assert_w3_tenant_consistency()',
      table_name || '_w3_tenant_guard',
      table_name
    );
  END LOOP;
END;
$$;

INSERT INTO program_enrollment_policies (
  id,
  organization_id,
  program_version_id,
  email_collection_mode,
  primary_customer_locale,
  allow_locale_selection,
  marketing_consent_visible,
  marketing_consent_default,
  customer_terms_required,
  transfer_without_email_allowed,
  enrollment_open,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  organization_id,
  id,
  'OPTIONAL',
  'EN',
  true,
  false,
  false,
  true,
  true,
  true,
  now(),
  now()
FROM loyalty_program_versions;

CREATE OR REPLACE FUNCTION waflo_reject_published_enrollment_policy_change() RETURNS trigger AS $$
DECLARE
  target_version_id UUID;
BEGIN
  target_version_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.program_version_id
    ELSE NEW.program_version_id
  END;
  IF waflo_version_is_protected(target_version_id) THEN
    RAISE EXCEPTION 'published and superseded enrollment policy is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER program_enrollment_policy_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON program_enrollment_policies
FOR EACH ROW EXECUTE FUNCTION waflo_reject_published_enrollment_policy_change();

CREATE OR REPLACE FUNCTION waflo_reject_credential_reactivation() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'ACTIVE' AND NEW.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'historical membership credentials cannot be reactivated';
  END IF;
  IF OLD.membership_id <> NEW.membership_id
     OR OLD.public_credential_id <> NEW.public_credential_id
     OR OLD.credential_version <> NEW.credential_version
     OR OLD.secret_version <> NEW.secret_version
     OR OLD.secret_hash <> NEW.secret_hash THEN
    RAISE EXCEPTION 'membership credential identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER membership_credential_history_guard
BEFORE UPDATE ON membership_credentials
FOR EACH ROW EXECUTE FUNCTION waflo_reject_credential_reactivation();

CREATE OR REPLACE FUNCTION waflo_reject_wallet_pass_identity_change() RETURNS trigger AS $$
BEGIN
  IF OLD.organization_id <> NEW.organization_id
     OR OLD.membership_id <> NEW.membership_id
     OR OLD.membership_credential_id <> NEW.membership_credential_id
     OR OLD.provider <> NEW.provider
     OR OLD.provider_identity <> NEW.provider_identity THEN
    RAISE EXCEPTION 'wallet pass identity cannot be reassigned';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_pass_identity_guard
BEFORE UPDATE ON wallet_pass_instances
FOR EACH ROW EXECUTE FUNCTION waflo_reject_wallet_pass_identity_change();

CREATE OR REPLACE FUNCTION waflo_reject_append_only_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER membership_transfer_events_no_update
BEFORE UPDATE OR DELETE ON membership_transfer_events
FOR EACH ROW EXECUTE FUNCTION waflo_reject_append_only_change();

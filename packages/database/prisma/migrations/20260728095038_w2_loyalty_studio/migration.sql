-- CreateEnum
CREATE TYPE "LoyaltyProgramType" AS ENUM ('STAMP');

-- CreateEnum
CREATE TYPE "LoyaltyProgramStatus" AS ENUM ('DRAFT', 'VALIDATED', 'TEST', 'SCHEDULED', 'PUBLISHED', 'PAUSED', 'ARCHIVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "LoyaltyProgramVersionStatus" AS ENUM ('DRAFT', 'VALIDATED', 'TEST_READY', 'PUBLISHED', 'SUPERSEDED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ProgramEditingMode" AS ENUM ('QUICK', 'PRO');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('TEXT_REWARD', 'FREE_ITEM', 'DISCOUNT_DESCRIPTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StampLayoutType" AS ENUM ('ROW', 'GRID', 'PATH', 'RING');

-- CreateEnum
CREATE TYPE "MerchantAssetCategory" AS ENUM ('LOGO', 'HERO', 'BACKGROUND', 'STAMP_FILLED', 'STAMP_EMPTY', 'STAMP_MILESTONE', 'GENERAL');

-- CreateEnum
CREATE TYPE "MerchantAssetSource" AS ENUM ('WAFLO_LIBRARY', 'MERCHANT_UPLOAD', 'GENERATED_PREVIEW');

-- CreateEnum
CREATE TYPE "MerchantAssetProcessingStatus" AS ENUM ('PENDING', 'READY', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProgramPreviewType" AS ENUM ('STAMP_PROGRESS_WEB', 'CUSTOMER_WEB_CARD', 'APPLE_WALLET_PREVIEW', 'GOOGLE_WALLET_PREVIEW', 'THUMBNAIL');

-- CreateEnum
CREATE TYPE "ProgramValidationStatus" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProgramTestSessionStatus" AS ENUM ('ACTIVE', 'RESET', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProgramTestEventType" AS ENUM ('TEST_STAMP_EARNED', 'TEST_STAMP_REVERSED', 'TEST_REWARD_UNLOCKED', 'TEST_REWARD_REDEEMED', 'TEST_SESSION_RESET');

-- CreateEnum
CREATE TYPE "ProgramPublishCommandStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- DropForeignKey
ALTER TABLE "checkout_idempotency_keys" DROP CONSTRAINT "checkout_idempotency_keys_organization_id_fkey";

-- AlterTable
ALTER TABLE "checkout_idempotency_keys" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "processed_webhook_events" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "internal_name" VARCHAR(120) NOT NULL,
    "program_type" "LoyaltyProgramType" NOT NULL DEFAULT 'STAMP',
    "status" "LoyaltyProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "current_draft_version_id" UUID,
    "current_published_version_id" UUID,
    "latest_version_number" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "suspension_reason_code" VARCHAR(120),
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_program_versions" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "LoyaltyProgramVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "editing_mode" "ProgramEditingMode" NOT NULL DEFAULT 'QUICK',
    "base_template_code" VARCHAR(80),
    "configuration_schema_version" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "validated_at" TIMESTAMPTZ(6),
    "test_ready_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "change_summary" VARCHAR(240),
    "validation_fingerprint" CHAR(64),
    "render_fingerprint" CHAR(64),

    CONSTRAINT "loyalty_program_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_translations" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "program_name" VARCHAR(120) NOT NULL,
    "short_description" VARCHAR(240) NOT NULL,
    "full_description" TEXT,
    "reward_summary" VARCHAR(240) NOT NULL,
    "join_instructions" TEXT,
    "terms_and_conditions" TEXT NOT NULL,
    "completion_message" VARCHAR(240) NOT NULL,
    "reward_unlocked_message" VARCHAR(240) NOT NULL,
    "paused_message" VARCHAR(240),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "program_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stamp_rules" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "required_stamp_count" INTEGER NOT NULL,
    "default_stamps_per_action" INTEGER NOT NULL DEFAULT 1,
    "maximum_stamps_per_operation" INTEGER NOT NULL DEFAULT 5,
    "maximum_stamps_per_customer_per_day" INTEGER,
    "minimum_purchase_amount_minor" INTEGER,
    "minimum_purchase_currency" CHAR(3),
    "earning_description" VARCHAR(240) NOT NULL,
    "reset_behavior_after_reward" VARCHAR(20) NOT NULL DEFAULT 'RESET',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stamp_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_definitions" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "threshold_stamp_count" INTEGER NOT NULL,
    "reward_type" "RewardType" NOT NULL,
    "internal_name" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "validity_duration_days" INTEGER,
    "requires_manager_approval" BOOLEAN NOT NULL DEFAULT false,
    "maximum_redemptions_per_earned" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reward_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_translations" (
    "id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "redemption_instructions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reward_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_locations" (
    "version_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "earning_enabled" BOOLEAN NOT NULL DEFAULT true,
    "redemption_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_locations_pkey" PRIMARY KEY ("version_id","location_id")
);

-- CreateTable
CREATE TABLE "program_visual_themes" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "background_color" VARCHAR(7) NOT NULL DEFAULT '#F7F4EE',
    "foreground_color" VARCHAR(7) NOT NULL DEFAULT '#222222',
    "accent_color" VARCHAR(7) NOT NULL DEFAULT '#E4572E',
    "secondary_color" VARCHAR(7) NOT NULL DEFAULT '#F3A712',
    "muted_color" VARCHAR(7) NOT NULL DEFAULT '#6B7280',
    "logo_asset_id" UUID,
    "hero_asset_id" UUID,
    "background_asset_id" UUID,
    "filled_stamp_asset_id" UUID NOT NULL,
    "empty_stamp_asset_id" UUID NOT NULL,
    "default_milestone_asset_id" UUID,
    "layout_type" "StampLayoutType" NOT NULL DEFAULT 'GRID',
    "layout_configuration" JSONB NOT NULL,
    "stamp_size" INTEGER NOT NULL DEFAULT 48,
    "stamp_spacing" INTEGER NOT NULL DEFAULT 8,
    "border_radius" INTEGER NOT NULL DEFAULT 18,
    "progress_label_visible" BOOLEAN NOT NULL DEFAULT true,
    "reward_label_visible" BOOLEAN NOT NULL DEFAULT true,
    "customer_web_variant" VARCHAR(30) NOT NULL DEFAULT 'CARD',
    "apple_preview_config" JSONB NOT NULL DEFAULT '{}',
    "google_preview_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "program_visual_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_visual_overrides" (
    "id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "stamp_asset_id" UUID,
    "accent_override" VARCHAR(7),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_visual_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category" "MerchantAssetCategory" NOT NULL,
    "source" "MerchantAssetSource" NOT NULL,
    "original_object_key" VARCHAR(500) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256_digest" CHAR(64) NOT NULL,
    "processing_status" "MerchantAssetProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "safe_metadata" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "merchant_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_asset_variants" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "variant_code" VARCHAR(40) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "file_size" INTEGER NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_asset_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_program_previews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "preview_type" "ProgramPreviewType" NOT NULL,
    "progress_state" INTEGER,
    "configuration_hash" CHAR(64) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_accessed_at" TIMESTAMPTZ(6),

    CONSTRAINT "generated_program_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_validation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "status" "ProgramValidationStatus" NOT NULL,
    "configuration_fingerprint" CHAR(64) NOT NULL,
    "errors" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_validation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_test_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "synthetic_display_name" VARCHAR(120) NOT NULL,
    "current_stamp_count" INTEGER NOT NULL DEFAULT 0,
    "cycle_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ProgramTestSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "reset_at" TIMESTAMPTZ(6),

    CONSTRAINT "program_test_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_test_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "event_type" "ProgramTestEventType" NOT NULL,
    "amount" INTEGER,
    "reward_definition_id" UUID,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "safe_metadata" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_test_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_publish_commands" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "status" "ProgramPublishCommandStatus" NOT NULL DEFAULT 'PROCESSING',
    "published_version_id" UUID,
    "trial_started" BOOLEAN NOT NULL DEFAULT false,
    "trial_start" TIMESTAMPTZ(6),
    "trial_end" TIMESTAMPTZ(6),
    "safe_failure_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "program_publish_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_current_draft_version_id_key" ON "loyalty_programs"("current_draft_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_current_published_version_id_key" ON "loyalty_programs"("current_published_version_id");

-- CreateIndex
CREATE INDEX "loyalty_programs_organization_id_status_updated_at_idx" ON "loyalty_programs"("organization_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "loyalty_programs_organization_id_created_at_idx" ON "loyalty_programs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "loyalty_program_versions_organization_id_program_id_status_idx" ON "loyalty_program_versions"("organization_id", "program_id", "status");

-- CreateIndex
CREATE INDEX "loyalty_program_versions_organization_id_updated_at_idx" ON "loyalty_program_versions"("organization_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_program_versions_program_id_version_number_key" ON "loyalty_program_versions"("program_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "program_translations_version_id_locale_key" ON "program_translations"("version_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "stamp_rules_version_id_key" ON "stamp_rules"("version_id");

-- CreateIndex
CREATE INDEX "reward_definitions_version_id_sort_order_idx" ON "reward_definitions"("version_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "reward_definitions_version_id_threshold_stamp_count_key" ON "reward_definitions"("version_id", "threshold_stamp_count");

-- CreateIndex
CREATE UNIQUE INDEX "reward_translations_reward_id_locale_key" ON "reward_translations"("reward_id", "locale");

-- CreateIndex
CREATE INDEX "program_locations_location_id_version_id_idx" ON "program_locations"("location_id", "version_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_visual_themes_version_id_key" ON "program_visual_themes"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_visual_overrides_reward_id_key" ON "reward_visual_overrides"("reward_id");

-- CreateIndex
CREATE INDEX "merchant_assets_organization_id_category_processing_status_idx" ON "merchant_assets"("organization_id", "category", "processing_status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_assets_organization_id_sha256_digest_key" ON "merchant_assets"("organization_id", "sha256_digest");

-- CreateIndex
CREATE INDEX "merchant_asset_variants_digest_idx" ON "merchant_asset_variants"("digest");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_asset_variants_asset_id_variant_code_key" ON "merchant_asset_variants"("asset_id", "variant_code");

-- CreateIndex
CREATE INDEX "generated_program_previews_organization_id_version_id_creat_idx" ON "generated_program_previews"("organization_id", "version_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "generated_program_previews_version_id_preview_type_progress_key" ON "generated_program_previews"("version_id", "preview_type", "progress_state", "configuration_hash");

-- CreateIndex
CREATE INDEX "program_validation_runs_organization_id_version_id_created__idx" ON "program_validation_runs"("organization_id", "version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "program_test_sessions_organization_id_version_id_updated_at_idx" ON "program_test_sessions"("organization_id", "version_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "program_test_events_session_id_created_at_idx" ON "program_test_events"("session_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "program_test_events_session_id_idempotency_key_key" ON "program_test_events"("session_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "program_publish_commands_organization_id_program_id_created_idx" ON "program_publish_commands"("organization_id", "program_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "program_publish_commands_organization_id_idempotency_key_key" ON "program_publish_commands"("organization_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "checkout_idempotency_keys" ADD CONSTRAINT "checkout_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_current_draft_version_id_fkey" FOREIGN KEY ("current_draft_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_program_versions" ADD CONSTRAINT "loyalty_program_versions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_program_versions" ADD CONSTRAINT "loyalty_program_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_program_versions" ADD CONSTRAINT "loyalty_program_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_translations" ADD CONSTRAINT "program_translations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_rules" ADD CONSTRAINT "stamp_rules_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_definitions" ADD CONSTRAINT "reward_definitions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_translations" ADD CONSTRAINT "reward_translations_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "reward_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_locations" ADD CONSTRAINT "program_locations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_locations" ADD CONSTRAINT "program_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_visual_themes" ADD CONSTRAINT "program_visual_themes_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_visual_themes" ADD CONSTRAINT "program_visual_themes_logo_asset_id_fkey" FOREIGN KEY ("logo_asset_id") REFERENCES "merchant_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_visual_themes" ADD CONSTRAINT "program_visual_themes_hero_asset_id_fkey" FOREIGN KEY ("hero_asset_id") REFERENCES "merchant_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_visual_themes" ADD CONSTRAINT "program_visual_themes_background_asset_id_fkey" FOREIGN KEY ("background_asset_id") REFERENCES "merchant_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_visual_themes" ADD CONSTRAINT "program_visual_themes_filled_stamp_asset_id_fkey" FOREIGN KEY ("filled_stamp_asset_id") REFERENCES "merchant_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_visual_themes" ADD CONSTRAINT "program_visual_themes_empty_stamp_asset_id_fkey" FOREIGN KEY ("empty_stamp_asset_id") REFERENCES "merchant_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_visual_themes" ADD CONSTRAINT "program_visual_themes_default_milestone_asset_id_fkey" FOREIGN KEY ("default_milestone_asset_id") REFERENCES "merchant_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_visual_overrides" ADD CONSTRAINT "reward_visual_overrides_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "reward_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_visual_overrides" ADD CONSTRAINT "reward_visual_overrides_stamp_asset_id_fkey" FOREIGN KEY ("stamp_asset_id") REFERENCES "merchant_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_assets" ADD CONSTRAINT "merchant_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_assets" ADD CONSTRAINT "merchant_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_asset_variants" ADD CONSTRAINT "merchant_asset_variants_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "merchant_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_program_previews" ADD CONSTRAINT "generated_program_previews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_program_previews" ADD CONSTRAINT "generated_program_previews_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_validation_runs" ADD CONSTRAINT "program_validation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_validation_runs" ADD CONSTRAINT "program_validation_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_validation_runs" ADD CONSTRAINT "program_validation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_test_sessions" ADD CONSTRAINT "program_test_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_test_sessions" ADD CONSTRAINT "program_test_sessions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_test_sessions" ADD CONSTRAINT "program_test_sessions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_test_events" ADD CONSTRAINT "program_test_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "program_test_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_test_events" ADD CONSTRAINT "program_test_events_reward_definition_id_fkey" FOREIGN KEY ("reward_definition_id") REFERENCES "reward_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_publish_commands" ADD CONSTRAINT "program_publish_commands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_publish_commands" ADD CONSTRAINT "program_publish_commands_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_publish_commands" ADD CONSTRAINT "program_publish_commands_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "organization_invitations_organization_id_normalized_email_statu" RENAME TO "organization_invitations_organization_id_normalized_email_s_idx";

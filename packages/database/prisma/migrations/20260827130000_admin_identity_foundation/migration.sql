CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'PRICING_ADMIN', 'FINANCE', 'SUPPORT', 'READ_ONLY');
CREATE TYPE "AdminUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "normalized_email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "preferred_locale" "Locale" NOT NULL DEFAULT 'EN',
    "role" "AdminRole" NOT NULL,
    "status" "AdminUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(6),
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" VARCHAR(120),
    "ip_metadata" VARCHAR(64),
    "user_agent" VARCHAR(512),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "audit_logs" ADD COLUMN "actor_admin_user_id" UUID;

CREATE UNIQUE INDEX "admin_users_public_id_key" ON "admin_users"("public_id");
CREATE UNIQUE INDEX "admin_users_normalized_email_key" ON "admin_users"("normalized_email");
CREATE INDEX "admin_users_status_role_idx" ON "admin_users"("status", "role");
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");
CREATE INDEX "admin_sessions_admin_user_id_expires_at_idx" ON "admin_sessions"("admin_user_id", "expires_at");
CREATE INDEX "admin_sessions_admin_user_id_revoked_at_idx" ON "admin_sessions"("admin_user_id", "revoked_at");
CREATE INDEX "audit_logs_actor_admin_user_id_created_at_idx" ON "audit_logs"("actor_admin_user_id", "created_at" DESC);

ALTER TABLE "admin_sessions"
  ADD CONSTRAINT "admin_sessions_admin_user_id_fkey"
  FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_admin_user_id_fkey"
  FOREIGN KEY ("actor_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_single_actor_identity_check"
  CHECK (num_nonnulls("actor_user_id", "actor_admin_user_id") <= 1);

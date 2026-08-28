import { hashPassword, normalizeEmail } from "@waflo/auth";
import type { AdminRole, PrismaClient } from "@waflo/database";

export const adminRoles = [
  "SUPER_ADMIN",
  "PRICING_ADMIN",
  "FINANCE",
  "SUPPORT",
  "READ_ONLY",
] as const satisfies readonly AdminRole[];

export interface ProvisionAdminInput {
  email: string;
  displayName: string;
  role: AdminRole;
  preferredLocale: "EN" | "AR";
  write: boolean;
  password?: string;
}

export async function provisionAdminAccount(client: PrismaClient, input: ProvisionAdminInput) {
  const normalizedEmail = normalizeEmail(input.email);
  const proposed = {
    normalizedEmail,
    displayName: input.displayName.trim(),
    role: input.role,
    preferredLocale: input.preferredLocale,
  };
  if (!proposed.displayName || proposed.displayName.length > 100) {
    throw new Error("Display name must contain 1 to 100 characters.");
  }
  if (!input.write) return { mode: "dry-run" as const, account: proposed };
  if (!input.password || input.password.length < 12) {
    throw new Error("Write mode requires a password of at least 12 characters via stdin.");
  }
  const passwordHash = await hashPassword(input.password);
  const account = await client.$transaction(async (transaction) => {
    const existing = await transaction.adminUser.findUnique({ where: { normalizedEmail } });
    if (existing) throw new Error("An administrator with that email already exists.");
    const created = await transaction.adminUser.create({
      data: {
        email: input.email.normalize("NFKC").trim(),
        normalizedEmail,
        displayName: proposed.displayName,
        passwordHash,
        role: input.role,
        preferredLocale: input.preferredLocale,
      },
    });
    await transaction.auditLog.create({
      data: {
        actorAdminUserId: created.id,
        action: "admin.account.provisioned",
        targetType: "admin_user",
        targetId: created.publicId,
        requestId: "admin-provision-cli",
        metadata: { role: created.role, source: "controlled_cli" },
      },
    });
    return created;
  });
  return {
    mode: "write" as const,
    account: {
      publicId: account.publicId,
      displayName: account.displayName,
      normalizedEmail: account.normalizedEmail,
      role: account.role,
      preferredLocale: account.preferredLocale,
      status: account.status,
    },
  };
}

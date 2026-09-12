import { HttpStatus } from "@nestjs/common";
import type { AdminRole } from "@waflo/database";
import { AppError } from "../common/app-error.js";

export const adminPermissions = [
  "admin.dashboard.read",
  "admin.customers.read",
  "admin.pricing.read",
  "admin.pricing.write",
  "admin.repricing.read",
  "admin.repricing.write",
  "admin.finance.read",
  "admin.stripe_health.read",
  "admin.audit.read",
] as const;

export type AdminPermission = (typeof adminPermissions)[number];

const readPermissions = [
  "admin.dashboard.read",
  "admin.customers.read",
  "admin.pricing.read",
  "admin.repricing.read",
  "admin.finance.read",
  "admin.stripe_health.read",
  "admin.audit.read",
] as const satisfies readonly AdminPermission[];

const rolePermissions: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  SUPER_ADMIN: adminPermissions,
  PRICING_ADMIN: [
    "admin.dashboard.read",
    "admin.customers.read",
    "admin.pricing.read",
    "admin.pricing.write",
    "admin.repricing.read",
    "admin.repricing.write",
    "admin.stripe_health.read",
    "admin.audit.read",
  ],
  FINANCE: [
    "admin.dashboard.read",
    "admin.customers.read",
    "admin.pricing.read",
    "admin.repricing.read",
    "admin.finance.read",
    "admin.stripe_health.read",
    "admin.audit.read",
  ],
  SUPPORT: [
    "admin.dashboard.read",
    "admin.customers.read",
    "admin.repricing.read",
    "admin.stripe_health.read",
    "admin.audit.read",
  ],
  READ_ONLY: readPermissions,
};

export function permissionsForAdminRole(role: AdminRole): readonly AdminPermission[] {
  return rolePermissions[role];
}

export function adminRoleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return rolePermissions[role].includes(permission);
}

export function requireAdminPermission(role: AdminRole, permission: AdminPermission): void {
  if (!adminRoleHasPermission(role, permission)) {
    throw new AppError(
      "ADMIN_FORBIDDEN",
      "Your administrator role does not allow this action.",
      HttpStatus.FORBIDDEN,
    );
  }
}

import type { MemberRole } from "@waflo/contracts";

export const permissions = [
  "organization.view",
  "organization.manage",
  "organization.slug.change",
  "organization.audit.view",
  "billing.view",
  "billing.manage",
  "locations.view",
  "locations.create",
  "locations.manage",
  "locations.archive",
  "team.view",
  "team.invite",
  "team.manage_staff",
  "team.manage_managers",
  "team.remove",
  "security.sessions.view",
  "security.sessions.revoke",
  "programs.view",
  "programs.create",
  "programs.edit",
  "programs.validate",
  "programs.test",
  "programs.publish",
  "programs.manage_state",
  "customers.view",
  "customers.manage",
  "customers.privacy_export",
  "customers.erase",
  "memberships.view",
  "memberships.suspend",
  "memberships.restore",
  "memberships.revoke",
  "ledger.view",
  "operations.resolve",
  "operations.stamp",
  "operations.redeem",
  "operations.reverse_own",
  "operations.reverse_any",
  "operations.manual_adjust",
  "operations.manager_approve",
  "devices.view",
  "devices.pair",
  "devices.revoke",
  "risk.view",
  "risk.manage",
  "analytics.view_basic",
  "analytics.view_advanced",
  "exports.create",
] as const;

export type Permission = (typeof permissions)[number];

const rolePermissions: Readonly<Record<MemberRole, ReadonlySet<Permission>>> = {
  OWNER: new Set(permissions),
  MANAGER: new Set([
    "organization.view",
    "locations.view",
    "locations.create",
    "locations.manage",
    "locations.archive",
    "team.view",
    "team.invite",
    "team.manage_staff",
    "team.remove",
    "security.sessions.view",
    "security.sessions.revoke",
    "programs.view",
    "programs.create",
    "programs.edit",
    "programs.validate",
    "programs.test",
    "programs.publish",
    "programs.manage_state",
    "customers.view",
    "customers.manage",
    "customers.privacy_export",
    "memberships.view",
    "memberships.suspend",
    "memberships.restore",
    "memberships.revoke",
    "ledger.view",
    "operations.resolve",
    "operations.stamp",
    "operations.redeem",
    "operations.reverse_own",
    "operations.reverse_any",
    "operations.manual_adjust",
    "operations.manager_approve",
    "devices.view",
    "devices.pair",
    "devices.revoke",
    "risk.view",
    "risk.manage",
    "analytics.view_basic",
    "analytics.view_advanced",
    "exports.create",
  ]),
  STAFF: new Set(["organization.view"]),
};

export function hasPermission(role: MemberRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function allowedInvitationRoles(role: MemberRole): readonly MemberRole[] {
  if (role === "OWNER") return ["MANAGER", "STAFF"];
  if (role === "MANAGER") return ["STAFF"];
  return [];
}

export function canManageMember(actorRole: MemberRole, targetRole: MemberRole): boolean {
  if (actorRole === "OWNER") return true;
  return actorRole === "MANAGER" && targetRole === "STAFF";
}

export function assertRoleAssignment(actorRole: MemberRole, requestedRole: MemberRole): boolean {
  if (requestedRole === "OWNER") return false;
  if (actorRole === "OWNER") return requestedRole === "MANAGER" || requestedRole === "STAFF";
  return actorRole === "MANAGER" && requestedRole === "STAFF";
}

import { createHmac, randomUUID } from "node:crypto";
import { hashOpaqueToken, hashPassword } from "../../packages/auth/src/index";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditService } from "../../apps/api/src/audit/audit.service";
import { AuthService } from "../../apps/api/src/auth/auth.service";
import { BillingService } from "../../apps/api/src/billing/billing.service";
import type { WafloRequest } from "../../apps/api/src/common/request-context";
import { EnvironmentService } from "../../apps/api/src/config/environment.service";
import { PrismaService } from "../../apps/api/src/database/prisma.service";
import { LocationsService } from "../../apps/api/src/locations/locations.service";
import type { NotificationService } from "../../apps/api/src/notifications/notification.service";
import { OrganizationsService } from "../../apps/api/src/organizations/organizations.service";
import { HostResolutionService } from "../../apps/api/src/public/host-resolution.service";
import { TeamService } from "../../apps/api/src/team/team.service";
import { TenantService } from "../../apps/api/src/tenancy/tenant.service";
import {
  decideProgramPublicationState,
  type ProgramOperationalStatus,
} from "../../packages/contracts/src/index";

interface CapturedNotification {
  to: string;
  locale: "en" | "ar";
  kind: string;
  actionUrl?: string;
  organizationName?: string;
}

const runId = randomUUID().slice(0, 8);
const initialPassword = "Waflo Integration 2026!";
let currentPassword = initialPassword;
const registeredEmail = `owner-${runId}@integration.waflo.local`;
const request = {
  requestId: `integration-${runId}`,
  ip: "127.0.0.1",
  headers: {
    "user-agent": "Waflo Integration Test / Chrome on Windows",
  },
} as unknown as WafloRequest;

let environment: EnvironmentService;
let prisma: PrismaService;
let audit: AuditService;
let tenant: TenantService;
let auth: AuthService;
let organizations: OrganizationsService;
let locations: LocationsService;
let team: TeamService;
let billing: BillingService;
let hosts: HostResolutionService;
let notifications: CapturedNotification[];
let notificationProvider: NotificationService;

let ownerId = "";
let intruderId = "";
let managerId = "";
let staffId = "";
let ownerSessionId = "";
let ownerSessionToken = "";
let organizationAId = "";
let organizationBId = "";
let firstLocationId = "";
let archivedLocationId = "";
let existingInvitationToken = "";
let newUserInvitationToken = "";
let newInvitedUserId = "";

function latestToken(kind: string, to: string): string {
  const message = notifications.filter((item) => item.kind === kind && item.to === to).at(-1);
  if (!message?.actionUrl) throw new Error(`No ${kind} action URL captured for ${to}.`);
  const url = new URL(message.actionUrl);
  const token =
    (url.hash.startsWith("#token=")
      ? decodeURIComponent(url.hash.slice("#token=".length))
      : null) ??
    url.searchParams.get("token") ??
    decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
  if (!token) throw new Error(`No token found in ${kind} action URL.`);
  return token;
}

async function createVerifiedUser(email: string, displayName: string): Promise<string> {
  const user = await prisma.client.user.create({
    data: {
      email,
      normalizedEmail: email.toLocaleLowerCase("en-US"),
      displayName,
      passwordHash: await hashPassword(initialPassword),
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "2026-07-test",
      privacyVersion: "2026-07-test",
      legalAcceptedAt: new Date(),
    },
  });
  return user.id;
}

describe.sequential("Waflo W1 service and database integration", () => {
  beforeAll(async () => {
    environment = new EnvironmentService();
    prisma = new PrismaService(environment);
    audit = new AuditService(prisma);
    tenant = new TenantService(prisma, audit);
    notifications = [];
    notificationProvider = {
      send: vi.fn(async (message: CapturedNotification) => {
        notifications.push(message);
      }),
    } as unknown as NotificationService;
    auth = new AuthService(prisma, environment, notificationProvider, audit);
    organizations = new OrganizationsService(prisma, tenant, environment, audit);
    locations = new LocationsService(prisma, tenant, environment, audit);
    team = new TeamService(prisma, tenant, environment, notificationProvider, audit);
    billing = new BillingService(prisma, environment, tenant, audit, notificationProvider);
    hosts = new HostResolutionService(prisma, environment);
    await prisma.client.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("registers a new account and emits an email-verification notification", async () => {
    const result = await auth.register(
      {
        displayName: "Integration Owner",
        email: registeredEmail,
        password: initialPassword,
        locale: "en",
        termsAccepted: true,
        privacyAccepted: true,
      },
      request,
    );
    expect(result.status).toBe("verification_required");
    expect(latestToken("email_verification", registeredEmail)).toHaveLength(43);
    const user = await prisma.client.user.findUniqueOrThrow({
      where: { normalizedEmail: registeredEmail },
    });
    ownerId = user.id;
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.termsVersion).toBe(environment.values.LEGAL_TERMS_VERSION);
    expect(user.privacyVersion).toBe(environment.values.LEGAL_PRIVACY_VERSION);
    expect(user.legalAcceptedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("resends verification while invalidating the previous token", async () => {
    const firstToken = latestToken("email_verification", registeredEmail);
    await auth.resendVerification(registeredEmail, request);
    const secondToken = latestToken("email_verification", registeredEmail);
    expect(secondToken).not.toBe(firstToken);
    const old = await prisma.client.emailVerificationToken.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(firstToken) },
    });
    expect(old.consumedAt).not.toBeNull();
  });

  it("verifies the account with the latest single-use token", async () => {
    const token = latestToken("email_verification", registeredEmail);
    await expect(auth.verifyEmail(token, request)).resolves.toEqual({
      status: "verified",
    });
    const user = await prisma.client.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it("logs in and stores only a hash of the opaque session token", async () => {
    const session = await auth.login(registeredEmail, initialPassword, request);
    ownerSessionId = session.sessionId;
    ownerSessionToken = session.rawToken;
    const stored = await prisma.client.session.findUniqueOrThrow({
      where: { id: session.sessionId },
    });
    expect(stored.tokenHash).toBe(hashOpaqueToken(session.rawToken));
    expect(stored.tokenHash).not.toBe(session.rawToken);
  });

  it("lists active sessions and marks the current session", async () => {
    const sessions = await auth.sessions(ownerId, ownerSessionId);
    expect(sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ownerSessionId, current: true })]),
    );
  });

  it("revokes another active session without revoking the current one", async () => {
    const other = await auth.login(registeredEmail, initialPassword, request);
    await expect(
      auth.revokeSession(ownerId, other.sessionId, ownerSessionId, request),
    ).resolves.toEqual({ currentSessionRevoked: false });
    const stored = await prisma.client.session.findUniqueOrThrow({
      where: { id: other.sessionId },
    });
    expect(stored.revokedAt).not.toBeNull();
  });

  it("logs out by revoking the current session", async () => {
    await auth.logout(ownerId, ownerSessionId, request);
    const stored = await prisma.client.session.findUniqueOrThrow({
      where: { id: ownerSessionId },
    });
    expect(stored.revocationReason).toBe("logout");
  });

  it("resets a password through a single-use password-reset token", async () => {
    await auth.forgotPassword(registeredEmail, request);
    const token = latestToken("password_reset", registeredEmail);
    currentPassword = "Waflo Reset Password 2026!";
    await expect(auth.resetPassword(token, currentPassword, request)).resolves.toEqual({
      status: "password_reset",
    });
    await expect(auth.login(registeredEmail, initialPassword, request)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("logs in with the reset password", async () => {
    const session = await auth.login(registeredEmail, currentPassword, request);
    ownerSessionId = session.sessionId;
    ownerSessionToken = session.rawToken;
    expect(ownerSessionToken).toHaveLength(43);
  });

  it("changes the password and rotates all sessions", async () => {
    const oldSessionId = ownerSessionId;
    const nextPassword = "Waflo Final Password 2026!";
    const session = await auth.changePassword(
      ownerId,
      ownerSessionId,
      currentPassword,
      nextPassword,
      request,
    );
    currentPassword = nextPassword;
    ownerSessionId = session.sessionId;
    ownerSessionToken = session.rawToken;
    const oldSession = await prisma.client.session.findUniqueOrThrow({
      where: { id: oldSessionId },
    });
    expect(oldSession.revocationReason).toBe("password_change");
    expect(session.sessionId).not.toBe(oldSessionId);
  });

  it("creates an organization with pending activation and no trial timestamps", async () => {
    const organization = await organizations.create(
      ownerId,
      {
        name: `Integration Coffee ${runId}`,
        merchantSlug: `coffee-${runId}`,
        businessCategory: "Cafe",
        defaultLocale: "en",
        timezone: "Asia/Baghdad",
        selectedPlan: "starter",
      },
      request,
    );
    organizationAId = organization.id;
    const view = await organizations.get(ownerId, organization.id);
    expect(view.onboardingState).toBe("LOCATION");
    expect(view.billingProfile).toMatchObject({
      subscriptionStatus: "PENDING_ACTIVATION",
      trialStart: null,
      trialEnd: null,
    });
  });

  it("persists resumable onboarding state server-side", async () => {
    const me = await auth.me(ownerId);
    const membership = me.memberships.find((item) => item.organization.id === organizationAId);
    expect(membership?.organization.onboardingState).toBe("LOCATION");
    expect(me.lastSelectedOrganizationId).toBe(organizationAId);
  });

  it("creates a second organization and switches selection", async () => {
    const second = await organizations.create(
      ownerId,
      {
        name: `Integration Retail ${runId}`,
        merchantSlug: `retail-${runId}`,
        businessCategory: "Retail",
        defaultLocale: "ar",
        timezone: "Asia/Riyadh",
        selectedPlan: "growth",
      },
      request,
    );
    organizationBId = second.id;
    await organizations.select(ownerId, organizationAId);
    expect((await auth.me(ownerId)).lastSelectedOrganizationId).toBe(organizationAId);
    await organizations.select(ownerId, organizationBId);
    expect((await auth.me(ownerId)).lastSelectedOrganizationId).toBe(organizationBId);
  });

  it("creates the first location and completes onboarding without starting the trial", async () => {
    const location = await locations.create(
      ownerId,
      organizationAId,
      {
        name: "Main Branch",
        city: "Baghdad",
        countryCode: "IQ",
        timezone: "Asia/Baghdad",
      },
      request,
    );
    firstLocationId = location.id;
    const complete = await organizations.completeOnboarding(ownerId, organizationAId, request);
    expect(complete.onboardingState).toBe("COMPLETE");
    expect(complete.billingProfile).toMatchObject({
      subscriptionStatus: "PENDING_ACTIVATION",
      trialStart: null,
      trialEnd: null,
    });
  });

  it("enforces the Starter active-location limit", async () => {
    await expect(
      locations.create(
        ownerId,
        organizationAId,
        { name: "Blocked Branch", timezone: "Asia/Baghdad" },
        request,
      ),
    ).rejects.toMatchObject({
      code: "LOCATION_LIMIT_REACHED",
      details: { limit: 1, recommendedPlan: "growth" },
    });
  });

  it("archives a non-final location after capacity is expanded", async () => {
    await billing.selectPlan(ownerId, organizationAId, "growth", request);
    const extra = await locations.create(
      ownerId,
      organizationAId,
      { name: "Temporary Branch", timezone: "Asia/Baghdad" },
      request,
    );
    archivedLocationId = extra.id;
    const archived = await locations.archive(ownerId, organizationAId, archivedLocationId, request);
    expect(archived.status).toBe("ARCHIVED");
  });

  it("validates the plan limit again when restoring an archived location", async () => {
    await billing.selectPlan(ownerId, organizationAId, "starter", request);
    await expect(
      locations.restore(ownerId, organizationAId, archivedLocationId, request),
    ).rejects.toMatchObject({
      code: "LOCATION_LIMIT_REACHED",
      details: { recommendedPlan: "growth" },
    });
  });

  it("blocks a billing downgrade when current usage exceeds the requested plan", async () => {
    const downgradeOrganization = await organizations.create(
      ownerId,
      {
        name: `Downgrade Guard ${runId}`,
        merchantSlug: `downgrade-${runId}`,
        defaultLocale: "en",
        timezone: "Asia/Baghdad",
        selectedPlan: "growth",
      },
      request,
    );
    await locations.create(
      ownerId,
      downgradeOrganization.id,
      { name: "Downgrade Location A" },
      request,
    );
    await locations.create(
      ownerId,
      downgradeOrganization.id,
      { name: "Downgrade Location B" },
      request,
    );
    await expect(
      billing.selectPlan(ownerId, downgradeOrganization.id, "starter", request),
    ).rejects.toMatchObject({
      code: "PLAN_DOWNGRADE_BLOCKED",
      details: { requestedPlan: "starter", locationUsage: 2, locationLimit: 1 },
    });
    expect(
      await prisma.client.organization.findUniqueOrThrow({
        where: { id: downgradeOrganization.id },
      }),
    ).toMatchObject({ selectedPlan: "GROWTH" });
  });

  it("counts every non-archived program when guarding a plan downgrade", async () => {
    const downgradeOrganization = await organizations.create(
      ownerId,
      {
        name: `Program Downgrade Guard ${runId}`,
        merchantSlug: `program-downgrade-${runId}`,
        defaultLocale: "en",
        timezone: "Asia/Baghdad",
        selectedPlan: "growth",
      },
      request,
    );
    await prisma.client.loyaltyProgram.createMany({
      data: [
        {
          organizationId: downgradeOrganization.id,
          internalName: "Active program A",
          createdByUserId: ownerId,
        },
        {
          organizationId: downgradeOrganization.id,
          internalName: "Active program B",
          createdByUserId: ownerId,
          status: "VALIDATED",
        },
        {
          organizationId: downgradeOrganization.id,
          internalName: "Archived program",
          createdByUserId: ownerId,
          status: "ARCHIVED",
          archivedAt: new Date(),
        },
      ],
    });
    await expect(
      billing.selectPlan(ownerId, downgradeOrganization.id, "starter", request),
    ).rejects.toMatchObject({
      code: "PLAN_DOWNGRADE_BLOCKED",
      details: {
        requestedPlan: "starter",
        programUsage: 2,
        programLimit: 1,
      },
    });
    expect(
      await prisma.client.organization.findUniqueOrThrow({
        where: { id: downgradeOrganization.id },
      }),
    ).toMatchObject({ selectedPlan: "GROWTH" });
  });

  it("rejects cross-tenant organization, location, member, and billing access", async () => {
    intruderId = await createVerifiedUser(
      `intruder-${runId}@integration.waflo.local`,
      "Tenant Intruder",
    );
    await expect(organizations.get(intruderId, organizationAId)).rejects.toMatchObject({
      code: "ORGANIZATION_ACCESS_DENIED",
    });
    await expect(locations.get(intruderId, organizationAId, firstLocationId)).rejects.toMatchObject(
      { code: "ORGANIZATION_ACCESS_DENIED" },
    );
    await expect(team.list(intruderId, organizationAId)).rejects.toMatchObject({
      code: "ORGANIZATION_ACCESS_DENIED",
    });
    await expect(billing.get(intruderId, organizationAId)).rejects.toMatchObject({
      code: "ORGANIZATION_ACCESS_DENIED",
    });
  });

  it("allows Owner organization administration", async () => {
    const updated = await organizations.update(
      ownerId,
      organizationAId,
      { businessCategory: "Coffee shop" },
      request,
    );
    expect(updated.businessCategory).toBe("Coffee shop");
  });

  it("allows Manager location work but denies organization and billing administration", async () => {
    await billing.selectPlan(ownerId, organizationAId, "growth", request);
    managerId = await createVerifiedUser(
      `manager-${runId}@integration.waflo.local`,
      "Integration Manager",
    );
    await prisma.client.organizationMember.create({
      data: { organizationId: organizationAId, userId: managerId, role: "MANAGER" },
    });
    const managerLocation = await locations.create(
      managerId,
      organizationAId,
      { name: "Manager Branch", timezone: "Asia/Baghdad" },
      request,
    );
    expect(managerLocation.organizationId).toBe(organizationAId);
    await expect(
      organizations.update(managerId, organizationAId, { name: "Nope" }, request),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(billing.get(managerId, organizationAId)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("keeps Staff from location, team, billing, and organization management", async () => {
    staffId = await createVerifiedUser(
      `staff-${runId}@integration.waflo.local`,
      "Integration Staff",
    );
    const staffMembership = await prisma.client.organizationMember.create({
      data: { organizationId: organizationAId, userId: staffId, role: "STAFF" },
    });
    expect((await organizations.get(staffId, organizationAId)).id).toBe(organizationAId);
    await expect(locations.list(staffId, organizationAId)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await expect(team.list(staffId, organizationAId)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await expect(
      team.updateMember(staffId, organizationAId, staffMembership.id, { role: "MANAGER" }, request),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("prevents removing the final active Owner", async () => {
    const ownerMembership = await prisma.client.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: organizationAId, userId: ownerId },
      },
    });
    await expect(
      team.removeMember(ownerId, organizationAId, ownerMembership.id, request),
    ).rejects.toMatchObject({ code: "LAST_OWNER_PROTECTED" });
  });

  it("allows an Owner to change a Staff role", async () => {
    const membership = await prisma.client.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: organizationAId, userId: staffId },
      },
    });
    const updated = await team.updateMember(
      ownerId,
      organizationAId,
      membership.id,
      { role: "MANAGER" },
      request,
    );
    expect(updated.role).toBe("MANAGER");
    await team.updateMember(ownerId, organizationAId, membership.id, { role: "STAFF" }, request);
  });

  it("restricts Managers to inviting Staff", async () => {
    await expect(
      team.invite(
        managerId,
        organizationAId,
        `forbidden-manager-${runId}@integration.waflo.local`,
        "MANAGER",
        request,
      ),
    ).rejects.toMatchObject({ code: "INVITATION_ROLE_FORBIDDEN" });
  });

  it("creates and inspects an invitation for an existing verified user", async () => {
    const invitation = await team.invite(
      ownerId,
      organizationBId,
      `intruder-${runId}@integration.waflo.local`,
      "STAFF",
      request,
    );
    existingInvitationToken = latestToken(
      "team_invitation",
      `intruder-${runId}@integration.waflo.local`,
    );
    expect(invitation.intendedRole).toBe("STAFF");
    await expect(team.inspect(existingInvitationToken)).resolves.toMatchObject({
      role: "STAFF",
    });
  });

  it("accepts an invitation as an existing user", async () => {
    await expect(team.accept(intruderId, existingInvitationToken, request)).resolves.toMatchObject({
      organizationId: organizationBId,
      role: "STAFF",
    });
  });

  it("creates an invitation before the invited user account exists", async () => {
    const email = `new-invite-${runId}@integration.waflo.local`;
    await team.invite(ownerId, organizationBId, email, "STAFF", request);
    newUserInvitationToken = latestToken("team_invitation", email);
    await auth.register(
      {
        displayName: "New Invited User",
        email,
        password: initialPassword,
        locale: "ar",
        termsAccepted: true,
        privacyAccepted: true,
      },
      request,
    );
    await auth.verifyEmail(latestToken("email_verification", email), request);
    const user = await prisma.client.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
    });
    newInvitedUserId = user.id;
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it("accepts an invitation as a newly registered user", async () => {
    await expect(
      team.accept(newInvitedUserId, newUserInvitationToken, request),
    ).resolves.toMatchObject({
      organizationId: organizationBId,
      role: "STAFF",
    });
  });

  it("rejects expired invitations", async () => {
    const rawToken = `expired-${randomUUID()}-${randomUUID()}`;
    await prisma.client.organizationInvitation.create({
      data: {
        organizationId: organizationBId,
        email: registeredEmail,
        normalizedEmail: registeredEmail,
        intendedRole: "STAFF",
        tokenHash: hashOpaqueToken(rawToken),
        invitedByUserId: ownerId,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(team.inspect(rawToken)).rejects.toMatchObject({
      code: "INVITATION_EXPIRED",
    });
  });

  it("rejects canceled invitations", async () => {
    const email = `canceled-${runId}@integration.waflo.local`;
    const invitation = await team.invite(ownerId, organizationBId, email, "STAFF", request);
    const token = latestToken("team_invitation", email);
    await team.cancel(ownerId, organizationBId, invitation.id, request);
    await expect(team.accept(ownerId, token, request)).rejects.toMatchObject({
      code: "INVITATION_CANCELED",
    });
  });

  it("enforces the Starter team-seat limit including active seats", async () => {
    const organization = await organizations.create(
      ownerId,
      {
        name: `Team Limit ${runId}`,
        merchantSlug: `team-limit-${runId}`,
        defaultLocale: "en",
        timezone: "Asia/Baghdad",
        selectedPlan: "starter",
      },
      request,
    );
    for (let index = 0; index < 3; index += 1) {
      const userId = await createVerifiedUser(
        `seat-${index}-${runId}@integration.waflo.local`,
        `Seat ${index}`,
      );
      await prisma.client.organizationMember.create({
        data: { organizationId: organization.id, userId, role: "STAFF" },
      });
    }
    await expect(
      team.invite(
        ownerId,
        organization.id,
        `over-limit-${runId}@integration.waflo.local`,
        "STAFF",
        request,
      ),
    ).rejects.toMatchObject({
      code: "TEAM_LIMIT_REACHED",
      details: { limit: 3, recommendedPlan: "growth" },
    });
  });

  it("protects slug uniqueness when two organization creates race", async () => {
    const userA = await createVerifiedUser(`race-a-${runId}@integration.waflo.local`, "Race A");
    const userB = await createVerifiedUser(`race-b-${runId}@integration.waflo.local`, "Race B");
    const input = {
      name: `Slug Race ${runId}`,
      merchantSlug: `race-${runId}`,
      defaultLocale: "en" as const,
      timezone: "Asia/Baghdad",
      selectedPlan: "starter" as const,
    };
    const results = await Promise.allSettled([
      organizations.create(userA, input, request),
      organizations.create(userB, input, request),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.client.organization.count({
        where: { merchantSlug: input.merchantSlug },
      }),
    ).toBe(1);
  });

  it("changes a merchant slug with password confirmation and cooldown history", async () => {
    const previous = (await organizations.get(ownerId, organizationAId)).merchantSlug;
    const next = `changed-${runId}`;
    const changed = await organizations.changeSlug(
      ownerId,
      organizationAId,
      next,
      currentPassword,
      request,
    );
    expect(changed.merchantSlug).toBe(next);
    const history = await prisma.client.merchantSlugHistory.findFirstOrThrow({
      where: { organizationId: organizationAId, slug: previous },
    });
    expect(history.reservedUntil.getTime()).toBeGreaterThan(Date.now());
    await expect(organizations.slugAvailability(previous)).resolves.toMatchObject({
      available: false,
      reason: "SLUG_UNAVAILABLE",
    });
  });

  it("resolves active, unknown, and suspended merchant hosts from real database state", async () => {
    const activeSlug = (await organizations.get(ownerId, organizationAId)).merchantSlug;
    await expect(hosts.resolve(`${activeSlug}.waflo.app`)).resolves.toMatchObject({
      status: "active",
      merchant: { slug: activeSlug },
    });
    await expect(hosts.resolve(`unknown-${runId}.waflo.app`)).resolves.toEqual({
      status: "unknown",
    });
    await prisma.client.organization.update({
      where: { id: organizationBId },
      data: { status: "SUSPENDED" },
    });
    const secondSlug = (
      await prisma.client.organization.findUniqueOrThrow({
        where: { id: organizationBId },
      })
    ).merchantSlug;
    await expect(hosts.resolve(`${secondSlug}.waflo.app`)).resolves.toEqual({
      status: "suspended",
    });
    await prisma.client.organization.update({
      where: { id: organizationBId },
      data: { status: "ACTIVE" },
    });
  });

  it("authorizes billing reads for Owners and keeps the trial pending", async () => {
    const state = await billing.get(ownerId, organizationAId);
    expect(state.profile).toMatchObject({
      subscriptionStatus: "PENDING_ACTIVATION",
      trialStart: null,
      trialEnd: null,
    });
    expect(state.trialPolicy).toEqual({
      durationDays: 15,
      startsOnFirstProgramPublication: true,
      startedInW1: false,
    });
  });

  it("returns the authoritative saved Stripe card instead of a stale blank state", async () => {
    const previous = {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_STARTER_MONTHLY_PRICE_ID: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
      STRIPE_GROWTH_MONTHLY_PRICE_ID: process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID,
      STRIPE_SCALE_MONTHLY_PRICE_ID: process.env.STRIPE_SCALE_MONTHLY_PRICE_ID,
    };
    process.env.STRIPE_SECRET_KEY = "sk_test_saved_card";
    process.env.STRIPE_WEBHOOK_SECRET = `whsec_${randomUUID().replaceAll("-", "")}`;
    process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = "price_test_starter";
    process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = "price_test_growth";
    process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = "price_test_scale";
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: organizationAId },
      data: { stripeCustomerId: "cus_authoritative_card" },
    });
    try {
      const stripeBilling = new BillingService(
        prisma,
        new EnvironmentService(),
        tenant,
        audit,
        notificationProvider,
      );
      const stripe = (
        stripeBilling as unknown as {
          stripe: {
            customers: { retrieve: () => Promise<unknown> };
            paymentMethods: { list: () => Promise<unknown> };
          };
        }
      ).stripe;
      stripe.customers.retrieve = async () => ({
        id: "cus_authoritative_card",
        deleted: false,
        invoice_settings: { default_payment_method: { id: "pm_primary" } },
      });
      stripe.paymentMethods.list = async () => ({
        data: [
          {
            id: "pm_primary",
            card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
          },
        ],
      });
      const billingState = await stripeBilling.get(ownerId, organizationAId);
      expect(billingState).toMatchObject({
        paymentMethod: {
          status: "saved",
          brand: "visa",
          last4: "4242",
          expMonth: 12,
          expYear: 2030,
          isDefault: true,
        },
      });
      expect(billingState.paymentMethod).not.toHaveProperty("id");
    } finally {
      await prisma.client.organizationBillingProfile.update({
        where: { organizationId: organizationAId },
        data: { stripeCustomerId: null },
      });
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("uses a safe explicit error when Stripe Checkout credentials are absent", async () => {
    await expect(billing.checkout(ownerId, organizationAId, request)).rejects.toMatchObject({
      code: "STRIPE_NOT_CONFIGURED",
    });
  });

  it("blocks unauthorized Checkout and Customer Portal before external calls", async () => {
    await expect(billing.checkout(intruderId, organizationAId, request)).rejects.toMatchObject({
      code: "ORGANIZATION_ACCESS_DENIED",
    });
    await expect(billing.portal(managerId, organizationAId, request)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("verifies Stripe signatures and processes a webhook exactly once", async () => {
    const previous = {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_STARTER_MONTHLY_PRICE_ID: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
      STRIPE_GROWTH_MONTHLY_PRICE_ID: process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID,
      STRIPE_SCALE_MONTHLY_PRICE_ID: process.env.STRIPE_SCALE_MONTHLY_PRICE_ID,
    };
    const webhookSecret = `whsec_${randomUUID().replaceAll("-", "")}`;
    process.env.STRIPE_SECRET_KEY = "sk_test_waflo_integration";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = "price_test_starter";
    process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = "price_test_growth";
    process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = "price_test_scale";
    const stripeEnvironment = new EnvironmentService();
    const stripeBilling = new BillingService(
      prisma,
      stripeEnvironment,
      tenant,
      audit,
      notificationProvider,
    );
    const eventId = `evt_${runId}`;
    const payload = JSON.stringify({
      id: eventId,
      object: "event",
      api_version: "2026-06-30.basil",
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "ping",
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    const signature = `t=${timestamp},v1=${digest}`;
    await expect(
      stripeBilling.processWebhook(Buffer.from(payload), signature, request),
    ).resolves.toEqual({ received: true, duplicate: false });
    await expect(
      stripeBilling.processWebhook(Buffer.from(payload), signature, request),
    ).resolves.toEqual({ received: true, duplicate: true });
    expect(
      await prisma.client.processedWebhookEvent.count({
        where: { provider: "stripe", externalEventId: eventId },
      }),
    ).toBe(1);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("rejects an invalid Stripe webhook signature", async () => {
    const webhookSecret = `whsec_${randomUUID().replaceAll("-", "")}`;
    process.env.STRIPE_SECRET_KEY = "sk_test_waflo_invalid_signature";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = "price_test_starter";
    process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = "price_test_growth";
    process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = "price_test_scale";
    const stripeBilling = new BillingService(
      prisma,
      new EnvironmentService(),
      tenant,
      audit,
      notificationProvider,
    );
    await expect(
      stripeBilling.processWebhook(
        Buffer.from('{"id":"evt_invalid","object":"event"}'),
        "t=1,v1=invalid",
        request,
      ),
    ).rejects.toMatchObject({ code: "STRIPE_SIGNATURE_INVALID" });
  });

  it("records auditable organization and location changes", async () => {
    const events = await prisma.client.auditLog.findMany({
      where: { organizationId: organizationAId },
      select: { action: true },
    });
    const actions = new Set(events.map((event) => event.action));
    expect(actions.has("organization.created")).toBe(true);
    expect(actions.has("location.created")).toBe(true);
    expect(actions.has("organization.slug_changed")).toBe(true);
    expect(actions.has("billing.selected_plan_changed")).toBe(true);
  });

  it("persists dashboard locale preference independently of organization locale", async () => {
    const updated = await auth.updateMe(ownerId, { preferredLocale: "ar" });
    expect(updated.preferredLocale).toBe("AR");
    expect((await auth.me(ownerId)).preferredLocale).toBe("AR");
  });

  it("keeps the centralized publication policy exhaustive with the database status enum", async () => {
    const statuses = await prisma.client.$queryRaw<Array<{ status: ProgramOperationalStatus }>>`
      SELECT unnest(enum_range(NULL::"LoyaltyProgramStatus"))::text AS status
    `;
    expect(statuses.map(({ status }) => status).sort()).toEqual(
      [
        "DRAFT",
        "VALIDATED",
        "TEST",
        "SCHEDULED",
        "PUBLISHED",
        "PAUSED",
        "ARCHIVED",
        "SUSPENDED",
      ].sort(),
    );

    const allowedFirst = statuses
      .filter(
        ({ status }) =>
          decideProgramPublicationState({
            programStatus: status,
            hasCurrentPublishedVersion: false,
          }).allowed,
      )
      .map(({ status }) => status)
      .sort();
    const allowedReplacement = statuses
      .filter(
        ({ status }) =>
          decideProgramPublicationState({
            programStatus: status,
            hasCurrentPublishedVersion: true,
          }).allowed,
      )
      .map(({ status }) => status)
      .sort();

    expect(allowedFirst).toEqual(["DRAFT", "TEST", "VALIDATED"]);
    expect(allowedReplacement).toEqual(["PAUSED", "PUBLISHED"]);
  });
});

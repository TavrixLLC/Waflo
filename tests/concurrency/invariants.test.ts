import { randomUUID } from "node:crypto";
import { createOpaqueToken, hashOpaqueToken, hashPassword } from "../../packages/auth/src/index";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditService } from "../../apps/api/src/audit/audit.service";
import { AuthService } from "../../apps/api/src/auth/auth.service";
import type { WafloRequest } from "../../apps/api/src/common/request-context";
import { EnvironmentService } from "../../apps/api/src/config/environment.service";
import { PrismaService } from "../../apps/api/src/database/prisma.service";
import { LocationsService } from "../../apps/api/src/locations/locations.service";
import type {
  NotificationMessage,
  NotificationService,
} from "../../apps/api/src/notifications/notification.service";
import { TeamService } from "../../apps/api/src/team/team.service";
import { TenantService } from "../../apps/api/src/tenancy/tenant.service";

const runId = randomUUID().slice(0, 8);
const password = "Concurrency Waflo 2026!";
const request = {
  requestId: `concurrency-${runId}`,
  ip: "127.0.0.1",
  headers: { "user-agent": "Waflo concurrency tests" },
} as unknown as WafloRequest;

let environment: EnvironmentService;
let prisma: PrismaService;
let audit: AuditService;
let tenant: TenantService;
let auth: AuthService;
let team: TeamService;
let locations: LocationsService;
let messages: NotificationMessage[];

async function createUser(label: string): Promise<string> {
  const email = `${label}-${runId}-${randomUUID().slice(0, 6)}@concurrency.waflo.local`;
  const user = await prisma.client.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: label,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  return user.id;
}

async function createOrganization(
  ownerId: string,
  plan: "STARTER" | "GROWTH" | "SCALE" = "STARTER",
): Promise<string> {
  const slug = `c-${runId}-${randomUUID().slice(0, 8)}`.toLowerCase();
  const organization = await prisma.client.organization.create({
    data: {
      name: `Concurrency ${slug}`,
      normalizedName: slug,
      merchantSlug: slug,
      defaultLocale: "EN",
      timezone: "UTC",
      selectedPlan: plan,
      onboardingState: "COMPLETE",
      onboardingCompletedAt: new Date(),
      members: { create: { userId: ownerId, role: "OWNER" } },
      billingProfile: {
        create: { selectedPlan: plan, subscriptionStatus: "ACTIVE" },
      },
      locations: {
        create: {
          name: "Primary",
          countryCode: "IQ",
          timezone: "Asia/Baghdad",
          latitude: 33.3152,
          longitude: 44.3661,
        },
      },
    },
  });
  return organization.id;
}

function codes(results: PromiseSettledResult<unknown>[]): string[] {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => String((result.reason as { code?: string }).code));
}

function exactLocation(name: string, offset = 0) {
  return {
    name,
    countryCode: "IQ" as const,
    timezone: "Asia/Baghdad",
    latitude: 33.3152 + offset,
    longitude: 44.3661 + offset,
    coordinatesConfirmed: true as const,
  };
}

describe.sequential("Waflo W1 database concurrency invariants", () => {
  beforeAll(async () => {
    environment = new EnvironmentService();
    prisma = new PrismaService(environment);
    audit = new AuditService(prisma);
    tenant = new TenantService(prisma, audit);
    messages = [];
    const notifications = {
      send: vi.fn(async (message: NotificationMessage) => {
        messages.push(message);
      }),
    } as unknown as NotificationService;
    auth = new AuthService(prisma, environment, notifications, audit);
    team = new TeamService(prisma, tenant, environment, notifications, audit);
    locations = new LocationsService(prisma, tenant, environment, audit);
    await prisma.client.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("claims verification tokens exactly once under simultaneous requests", async () => {
    const userId = await createUser("verify");
    await prisma.client.user.update({ where: { id: userId }, data: { emailVerifiedAt: null } });
    const token = createOpaqueToken();
    await prisma.client.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const results = await Promise.allSettled([
      auth.verifyEmail(token, request),
      auth.verifyEmail(token, request),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(results)).toEqual(["VERIFICATION_LINK_INVALID"]);
  });

  it("claims password reset tokens exactly once and revokes sessions atomically", async () => {
    const userId = await createUser("reset");
    const token = createOpaqueToken();
    await prisma.client.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.client.session.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(createOpaqueToken()),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const results = await Promise.allSettled([
      auth.resetPassword(token, "Replacement Password 2026! A", request),
      auth.resetPassword(token, "Replacement Password 2026! B", request),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(results)).toEqual(["RESET_LINK_INVALID"]);
    expect(await prisma.client.session.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it("claims an invitation exactly once under simultaneous acceptance", async () => {
    const ownerId = await createUser("invite-owner");
    const inviteeId = await createUser("invitee");
    const organizationId = await createOrganization(ownerId);
    const invitee = await prisma.client.user.findUniqueOrThrow({ where: { id: inviteeId } });
    await team.invite(ownerId, organizationId, invitee.email, "STAFF", request);
    const invitationUrl = messages
      .filter((message) => message.kind === "team_invitation" && message.to === invitee.email)
      .at(-1)?.actionUrl;
    const token = invitationUrl
      ? new URL(invitationUrl).hash.startsWith("#token=")
        ? decodeURIComponent(new URL(invitationUrl).hash.slice("#token=".length))
        : new URL(invitationUrl).searchParams.get("token")
      : null;
    expect(token).toBeTruthy();
    const results = await Promise.allSettled([
      team.accept(inviteeId, token ?? "", request),
      team.accept(inviteeId, token ?? "", request),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(results)).toEqual(["INVITATION_ALREADY_ACCEPTED"]);
    expect(
      await prisma.client.organizationMember.count({
        where: { organizationId, userId: inviteeId, status: "ACTIVE" },
      }),
    ).toBe(1);
  });

  it("serializes simultaneous team invitations at the Starter seat limit", async () => {
    const ownerId = await createUser("seat-owner");
    const organizationId = await createOrganization(ownerId);
    const attempts = Array.from({ length: 6 }, (_, index) =>
      team.invite(
        ownerId,
        organizationId,
        `seat-${index}-${runId}@concurrency.waflo.local`,
        "STAFF",
        request,
      ),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(codes(results)).toEqual([
      "TEAM_LIMIT_REACHED",
      "TEAM_LIMIT_REACHED",
      "TEAM_LIMIT_REACHED",
    ]);
    expect(
      await prisma.client.organizationInvitation.count({
        where: { organizationId, status: "PENDING" },
      }),
    ).toBe(3);
  });

  it("serializes member reactivation against a simultaneous invitation", async () => {
    const ownerId = await createUser("reactivate-owner");
    const organizationId = await createOrganization(ownerId);
    const users = await Promise.all([
      createUser("active-one"),
      createUser("active-two"),
      createUser("suspended"),
    ]);
    const members = await Promise.all(
      users.map((userId, index) =>
        prisma.client.organizationMember.create({
          data: {
            organizationId,
            userId,
            role: "STAFF",
            status: index === 2 ? "SUSPENDED" : "ACTIVE",
          },
        }),
      ),
    );
    const results = await Promise.allSettled([
      team.updateMember(
        ownerId,
        organizationId,
        members[2]?.id ?? "",
        { status: "ACTIVE" },
        request,
      ),
      team.invite(
        ownerId,
        organizationId,
        `reactivation-race-${runId}@concurrency.waflo.local`,
        "STAFF",
        request,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(results)).toEqual(["TEAM_LIMIT_REACHED"]);
    const active = await prisma.client.organizationMember.count({
      where: {
        organizationId,
        status: "ACTIVE",
        role: { in: ["MANAGER", "STAFF"] },
      },
    });
    const pending = await prisma.client.organizationInvitation.count({
      where: { organizationId, status: "PENDING", expiresAt: { gt: new Date() } },
    });
    expect(active + pending).toBe(3);
  });

  it("supports explicit expired re-invitation and protects Manager-role invitations", async () => {
    const ownerId = await createUser("lifecycle-owner");
    const managerId = await createUser("lifecycle-manager");
    const organizationId = await createOrganization(ownerId, "GROWTH");
    await prisma.client.organizationMember.create({
      data: { organizationId, userId: managerId, role: "MANAGER" },
    });
    const expired = await prisma.client.organizationInvitation.create({
      data: {
        organizationId,
        email: `expired-${runId}@concurrency.waflo.local`,
        normalizedEmail: `expired-${runId}@concurrency.waflo.local`,
        intendedRole: "STAFF",
        tokenHash: hashOpaqueToken(createOpaqueToken()),
        invitedByUserId: ownerId,
        expiresAt: new Date(Date.now() - 1_000),
        status: "PENDING",
      },
    });
    await expect(
      team.resend(managerId, organizationId, expired.id, request),
    ).resolves.toMatchObject({ id: expired.id });
    expect(
      await prisma.client.organizationInvitation.findUniqueOrThrow({
        where: { id: expired.id },
      }),
    ).toMatchObject({ status: "PENDING", acceptedAt: null, canceledAt: null });

    const managerInvite = await team.invite(
      ownerId,
      organizationId,
      `manager-${runId}@concurrency.waflo.local`,
      "MANAGER",
      request,
    );
    await expect(
      team.resend(managerId, organizationId, managerInvite.id, request),
    ).rejects.toMatchObject({ code: "INVITATION_MANAGEMENT_FORBIDDEN" });
    await expect(
      team.cancel(managerId, organizationId, managerInvite.id, request),
    ).rejects.toMatchObject({ code: "INVITATION_MANAGEMENT_FORBIDDEN" });
  });

  it("serializes location create, restore, and final-location archive invariants", async () => {
    const ownerId = await createUser("location-owner");
    const createOrganizationId = await createOrganization(ownerId, "GROWTH");
    const creates = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        locations.create(
          ownerId,
          createOrganizationId,
          exactLocation(`Concurrent ${index}`, index / 10_000),
          request,
        ),
      ),
    );
    expect(creates.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(
      await prisma.client.location.count({
        where: { organizationId: createOrganizationId, status: "ACTIVE" },
      }),
    ).toBe(3);

    const restoreOrganizationId = await createOrganization(ownerId, "GROWTH");
    await prisma.client.location.create({
      data: { organizationId: restoreOrganizationId, name: "Active 2", timezone: "UTC" },
    });
    const archived = await Promise.all(
      ["Archived 1", "Archived 2"].map((name) =>
        prisma.client.location.create({
          data: {
            organizationId: restoreOrganizationId,
            name,
            timezone: "Asia/Baghdad",
            latitude: 33.3152,
            longitude: 44.3661,
            status: "ARCHIVED",
            archivedAt: new Date(),
          },
        }),
      ),
    );
    const restores = await Promise.allSettled(
      archived.map((location) =>
        locations.restore(ownerId, restoreOrganizationId, location.id, request),
      ),
    );
    expect(restores.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(restores)).toEqual(["LOCATION_LIMIT_REACHED"]);

    const archiveOrganizationId = await createOrganization(ownerId, "GROWTH");
    await prisma.client.location.create({
      data: { organizationId: archiveOrganizationId, name: "Archive B", timezone: "UTC" },
    });
    const activeLocations = await prisma.client.location.findMany({
      where: { organizationId: archiveOrganizationId, status: "ACTIVE" },
    });
    const archives = await Promise.allSettled(
      activeLocations.map((location) =>
        locations.archive(ownerId, archiveOrganizationId, location.id, request),
      ),
    );
    expect(archives.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(archives)).toEqual(["FINAL_LOCATION_REQUIRED"]);
  });

  it("serializes simultaneous Owner demotion and removal", async () => {
    const firstOwnerId = await createUser("owner-a");
    const secondOwnerId = await createUser("owner-b");
    const demotionOrganizationId = await createOrganization(firstOwnerId, "GROWTH");
    const secondOwnerMember = await prisma.client.organizationMember.create({
      data: {
        organizationId: demotionOrganizationId,
        userId: secondOwnerId,
        role: "OWNER",
      },
    });
    const firstOwnerMember = await prisma.client.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: demotionOrganizationId,
          userId: firstOwnerId,
        },
      },
    });
    const demotions = await Promise.allSettled([
      team.updateMember(
        firstOwnerId,
        demotionOrganizationId,
        firstOwnerMember.id,
        { role: "STAFF" },
        request,
      ),
      team.updateMember(
        secondOwnerId,
        demotionOrganizationId,
        secondOwnerMember.id,
        { role: "STAFF" },
        request,
      ),
    ]);
    expect(demotions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(demotions)).toEqual(["LAST_OWNER_PROTECTED"]);

    const removalOrganizationId = await createOrganization(firstOwnerId, "GROWTH");
    const removalSecondOwner = await prisma.client.organizationMember.create({
      data: { organizationId: removalOrganizationId, userId: secondOwnerId, role: "OWNER" },
    });
    const removalFirstOwner = await prisma.client.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: removalOrganizationId,
          userId: firstOwnerId,
        },
      },
    });
    const removals = await Promise.allSettled([
      team.removeMember(firstOwnerId, removalOrganizationId, removalFirstOwner.id, request),
      team.removeMember(secondOwnerId, removalOrganizationId, removalSecondOwner.id, request),
    ]);
    expect(removals.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(removals)).toEqual(["LAST_OWNER_PROTECTED"]);
  });
});

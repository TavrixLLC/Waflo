import "dotenv/config";
import { hashPassword } from "@waflo/auth";
import { createPrismaClient } from "../src/client";

const prisma = createPrismaClient();

const ownerId = "11111111-1111-4111-8111-111111111111";
const teammateId = "22222222-2222-4222-8222-222222222222";
const organizationAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed is disabled in production.");
  }

  const passwordHash = await hashPassword("Waflo-Development-2026");
  const now = new Date();

  await prisma.user.upsert({
    where: { id: ownerId },
    update: {},
    create: {
      id: ownerId,
      displayName: "Amina Hassan",
      email: "owner@waflo.local",
      normalizedEmail: "owner@waflo.local",
      emailVerifiedAt: now,
      passwordHash,
      preferredLocale: "EN",
      termsVersion: "2026-07-draft",
      privacyVersion: "2026-07-draft",
      legalAcceptedAt: now,
      lastSelectedOrganizationId: organizationAId,
    },
  });

  await prisma.user.upsert({
    where: { id: teammateId },
    update: {},
    create: {
      id: teammateId,
      displayName: "Omar Kareem",
      email: "staff@waflo.local",
      normalizedEmail: "staff@waflo.local",
      emailVerifiedAt: now,
      passwordHash,
      preferredLocale: "AR",
      termsVersion: "2026-07-draft",
      privacyVersion: "2026-07-draft",
      legalAcceptedAt: now,
    },
  });

  const organizationA = await prisma.organization.upsert({
    where: { id: organizationAId },
    update: {},
    create: {
      id: organizationAId,
      name: "Today Coffee",
      normalizedName: "today coffee",
      merchantSlug: "today",
      businessCategory: "Café",
      defaultLocale: "EN",
      timezone: "Asia/Baghdad",
      selectedPlan: "STARTER",
      onboardingState: "COMPLETE",
      onboardingCompletedAt: now,
    },
  });

  const organizationB = await prisma.organization.upsert({
    where: { id: organizationBId },
    update: {},
    create: {
      id: organizationBId,
      name: "مخبز النهر",
      normalizedName: "مخبز النهر",
      merchantSlug: "alnahr",
      businessCategory: "Bakery",
      defaultLocale: "AR",
      timezone: "Asia/Baghdad",
      selectedPlan: "GROWTH",
      onboardingState: "COMPLETE",
      onboardingCompletedAt: now,
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organizationA.id, userId: ownerId } },
    update: {},
    create: { organizationId: organizationA.id, userId: ownerId, role: "OWNER" },
  });
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organizationA.id, userId: teammateId } },
    update: {},
    create: { organizationId: organizationA.id, userId: teammateId, role: "MANAGER" },
  });
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organizationB.id, userId: ownerId } },
    update: {},
    create: { organizationId: organizationB.id, userId: ownerId, role: "OWNER" },
  });

  for (const organization of [organizationA, organizationB]) {
    await prisma.organizationBillingProfile.upsert({
      where: { organizationId: organization.id },
      update: {},
      create: {
        organizationId: organization.id,
        selectedPlan: organization.selectedPlan,
        subscriptionStatus: "PENDING_ACTIVATION",
        trialStart: null,
        trialEnd: null,
      },
    });
    await prisma.organizationDomain.upsert({
      where: { hostname: `${organization.merchantSlug}.waflo.app` },
      update: {},
      create: {
        organizationId: organization.id,
        hostname: `${organization.merchantSlug}.waflo.app`,
        type: "SUBDOMAIN",
        status: "ACTIVE",
        isPrimary: true,
      },
    });
  }

  const locations = [
    {
      id: "a1111111-1111-4111-8111-111111111111",
      organizationId: organizationA.id,
      name: "Today Coffee — Karrada",
    },
    {
      id: "b1111111-1111-4111-8111-111111111111",
      organizationId: organizationB.id,
      name: "فرع المنصور",
    },
  ];
  for (const location of locations) {
    await prisma.location.upsert({
      where: { id: location.id },
      update: {},
      create: { ...location, timezone: "Asia/Baghdad" },
    });
  }

  await prisma.auditLog.createMany({
    data: [
      {
        organizationId: organizationA.id,
        actorUserId: ownerId,
        action: "organization.seeded",
        targetType: "organization",
        targetId: organizationA.id,
        requestId: "seed_w1",
        metadata: { source: "development_seed" },
      },
      {
        organizationId: organizationB.id,
        actorUserId: ownerId,
        action: "organization.seeded",
        targetType: "organization",
        targetId: organizationB.id,
        requestId: "seed_w1",
        metadata: { source: "development_seed" },
      },
    ],
    skipDuplicates: true,
  });
}

seed()
  .then(() => {
    process.stdout.write("Waflo development data seeded.\n");
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

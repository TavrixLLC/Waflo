import "dotenv/config";
import { createHash } from "node:crypto";
import { hashPassword } from "@waflo/auth";
import { parseEnvironment } from "@waflo/config";
import {
  createCustomerDataKeyring,
  decodeSecret,
  encryptCustomerValue,
  hashNormalizedEmail,
  maskEmail,
  membershipCredentialHash,
  normalizeEmail,
} from "@waflo/customer-security";
import {
  calculateLedgerEntryHash,
  canonicalJson,
  LEDGER_GENESIS_HASH,
  type LoyaltyLedgerEventType,
  type ProjectionState,
  reduceProjectionEvent,
} from "@waflo/loyalty-ledger";
import { operationalLocalDate } from "@waflo/loyalty-policy";
import { hashOpaqueDeviceToken, hashPairingToken } from "@waflo/staff-device-security";
import { createPrismaClient, type Prisma } from "../src/index";

const prisma = createPrismaClient();
const environment = parseEnvironment(process.env);

const IDs = {
  owner: "11111111-1111-4111-8111-111111111111",
  manager: "22222222-2222-4222-8222-222222222222",
  staffOne: "33333333-3333-4333-8333-333333333333",
  staffTwo: "44444444-4444-4444-8444-444444444444",
  organization: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  secondOrganization: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  locationOne: "a1111111-1111-4111-8111-111111111111",
  locationTwo: "a2222222-2222-4222-8222-222222222222",
  secondLocation: "b1111111-1111-4111-8111-111111111111",
  filledAsset: "a5000000-0000-4000-8000-000000000001",
  emptyAsset: "a5000000-0000-4000-8000-000000000002",
  cookieProgram: "c0000000-0000-4000-8000-000000000001",
  cookieVersion: "c1000000-0000-4000-8000-000000000001",
  coffeeProgram: "d0000000-0000-4000-8000-000000000001",
  coffeeVersion: "d1000000-0000-4000-8000-000000000001",
  purchaseProgram: "e0000000-0000-4000-8000-000000000001",
  purchaseVersion: "e1000000-0000-4000-8000-000000000001",
} as const;

const TEST_DEVICE_ACCESS_TOKEN = "waflo-test-device-access-token-2026-fixed-for-local-evidence";
const TEST_DEVICE_REFRESH_TOKEN = "waflo-test-device-refresh-token-2026-fixed-for-local-evidence";
const TEST_DEVICE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7AOmurWm8Mzcaea5HRin3NIaC9QlC/ClOY/CttddgQ0=
-----END PUBLIC KEY-----`;
const REVOKED_DEVICE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvKNpk1q6YbfzBCW+axgJlwJ37+DEnemGG3zinz3TXb8=
-----END PUBLIC KEY-----`;

const customerKeyring = createCustomerDataKeyring(environment.CUSTOMER_DATA_ACTIVE_KEY_VERSION, {
  1: environment.CUSTOMER_DATA_ENCRYPTION_KEY_V1,
});
const contactLookupKey = decodeSecret(environment.CUSTOMER_CONTACT_LOOKUP_HMAC_KEY);
const membershipCredentialSecret = {
  version: environment.MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION,
  secret: decodeSecret(environment.MEMBERSHIP_CREDENTIAL_SECRET_V1),
};

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function projectionFingerprint(projection: ProjectionState): string {
  return digest({
    currentCycleStampCount: projection.currentCycleStampCount,
    completedCycleCount: projection.completedCycleCount,
    rewardReady: projection.rewardReady,
    projectionVersion: projection.projectionVersion,
    lastSourceEventId: projection.lastSourceEventId,
  });
}

async function seedUsersAndOrganization(now: Date) {
  const passwordHash = await hashPassword("Waflo-Development-2026");
  const users = [
    {
      id: IDs.owner,
      displayName: "Amina Hassan",
      email: "owner@waflo.local",
      locale: "EN" as const,
    },
    {
      id: IDs.manager,
      displayName: "Omar Kareem",
      email: "manager@waflo.local",
      locale: "AR" as const,
    },
    {
      id: IDs.staffOne,
      displayName: "Layla Abbas",
      email: "staff@waflo.local",
      locale: "EN" as const,
    },
    {
      id: IDs.staffTwo,
      displayName: "Hussein Ali",
      email: "staff2@waflo.local",
      locale: "AR" as const,
    },
  ];
  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        displayName: user.displayName,
        email: user.email,
        normalizedEmail: user.email,
        emailVerifiedAt: now,
        passwordHash,
        preferredLocale: user.locale,
        termsVersion: environment.LEGAL_TERMS_VERSION,
        privacyVersion: environment.LEGAL_PRIVACY_VERSION,
        legalAcceptedAt: now,
        ...(user.id === IDs.owner ? { lastSelectedOrganizationId: IDs.organization } : {}),
      },
      create: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        normalizedEmail: user.email,
        emailVerifiedAt: now,
        passwordHash,
        preferredLocale: user.locale,
        termsVersion: environment.LEGAL_TERMS_VERSION,
        privacyVersion: environment.LEGAL_PRIVACY_VERSION,
        legalAcceptedAt: now,
        ...(user.id === IDs.owner ? { lastSelectedOrganizationId: IDs.organization } : {}),
      },
    });
  }
  const organization = await prisma.organization.upsert({
    where: { id: IDs.organization },
    update: {
      name: "Today Coffee",
      selectedPlan: "SCALE",
      status: "ACTIVE",
    },
    create: {
      id: IDs.organization,
      name: "Today Coffee",
      normalizedName: "today coffee",
      merchantSlug: "today",
      businessCategory: "Cafe",
      defaultLocale: "EN",
      timezone: "Asia/Baghdad",
      selectedPlan: "SCALE",
      onboardingState: "COMPLETE",
      onboardingCompletedAt: now,
    },
  });
  const secondOrganization = await prisma.organization.upsert({
    where: { id: IDs.secondOrganization },
    update: {},
    create: {
      id: IDs.secondOrganization,
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
  const memberships: Array<{
    userId: string;
    role: "OWNER" | "MANAGER" | "STAFF";
  }> = [
    { userId: IDs.owner, role: "OWNER" },
    { userId: IDs.manager, role: "MANAGER" },
    { userId: IDs.staffOne, role: "STAFF" },
    { userId: IDs.staffTwo, role: "STAFF" },
  ];
  for (const { userId, role } of memberships) {
    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId,
        },
      },
      update: { role, status: "ACTIVE" },
      create: {
        organizationId: organization.id,
        userId,
        role,
      },
    });
  }
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: secondOrganization.id,
        userId: IDs.owner,
      },
    },
    update: {},
    create: {
      organizationId: secondOrganization.id,
      userId: IDs.owner,
      role: "OWNER",
    },
  });
  for (const item of [
    { organizationId: organization.id, plan: "SCALE" as const },
    { organizationId: secondOrganization.id, plan: "GROWTH" as const },
  ]) {
    await prisma.organizationBillingProfile.upsert({
      where: { organizationId: item.organizationId },
      update: {
        selectedPlan: item.plan,
        subscriptionStatus: "ACTIVE",
      },
      create: {
        organizationId: item.organizationId,
        selectedPlan: item.plan,
        subscriptionStatus: "ACTIVE",
      },
    });
  }
  for (const item of [
    { id: organization.id, slug: organization.merchantSlug },
    { id: secondOrganization.id, slug: secondOrganization.merchantSlug },
  ]) {
    await prisma.organizationDomain.upsert({
      where: { hostname: `${item.slug}.waflo.app` },
      update: {},
      create: {
        organizationId: item.id,
        hostname: `${item.slug}.waflo.app`,
        type: "SUBDOMAIN",
        status: "ACTIVE",
        isPrimary: true,
      },
    });
  }
  const locationData = [
    {
      id: IDs.locationOne,
      organizationId: organization.id,
      name: "Today Coffee — Karrada",
      city: "Baghdad",
    },
    {
      id: IDs.locationTwo,
      organizationId: organization.id,
      name: "Today Coffee — Mansour",
      city: "Baghdad",
    },
    {
      id: IDs.secondLocation,
      organizationId: secondOrganization.id,
      name: "فرع المنصور",
      city: "بغداد",
    },
  ];
  for (const location of locationData) {
    await prisma.location.upsert({
      where: { id: location.id },
      update: { name: location.name },
      create: {
        ...location,
        timezone: "Asia/Baghdad",
      },
    });
  }
  return organization;
}

async function seedAssets() {
  const assets = [
    {
      id: IDs.filledAsset,
      category: "STAMP_FILLED" as const,
      filename: "w4-filled-stamp.svg",
      digest: "a".repeat(64),
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="42" fill="#E4572E"/><path d="M29 49l12 12 27-30" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/></svg>',
    },
    {
      id: IDs.emptyAsset,
      category: "STAMP_EMPTY" as const,
      filename: "w4-empty-stamp.svg",
      digest: "b".repeat(64),
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="#F7F4EE" stroke="#C8B8AE" stroke-width="6"/></svg>',
    },
  ];
  for (const asset of assets) {
    await prisma.merchantAsset.upsert({
      where: { id: asset.id },
      update: {},
      create: {
        id: asset.id,
        organizationId: IDs.organization,
        category: asset.category,
        source: "WAFLO_LIBRARY",
        originalObjectKey: `library/w4/${asset.filename}`,
        originalFilename: asset.filename,
        mimeType: "image/svg+xml",
        fileSize: Buffer.byteLength(asset.svg),
        width: 96,
        height: 96,
        sha256Digest: asset.digest,
        processingStatus: "READY",
        safeMetadata: { inlineSvg: asset.svg, deterministicSeed: true },
        createdByUserId: IDs.owner,
      },
    });
  }
}

interface ProgramSeed {
  id: string;
  versionId: string;
  slug: string;
  name: string;
  arabicName: string;
  goal: number;
  dailyCap: number | null;
  minimumPurchaseAmountMinor: number | null;
  minimumPurchaseCurrency: string | null;
  milestoneRewardId: string;
  finalRewardId: string;
}

async function seedProgram(input: ProgramSeed, now: Date) {
  await prisma.loyaltyProgram.upsert({
    where: { id: input.id },
    update: {
      internalName: input.name,
      status: "PUBLISHED",
      currentPublishedVersionId: input.versionId,
    },
    create: {
      id: input.id,
      organizationId: IDs.organization,
      internalName: input.name,
      publicSlug: input.slug,
      status: "DRAFT",
      createdByUserId: IDs.owner,
      latestVersionNumber: 1,
    },
  });
  const programVersion = await prisma.loyaltyProgramVersion.upsert({
    where: { id: input.versionId },
    update: {},
    create: {
      id: input.versionId,
      programId: input.id,
      organizationId: IDs.organization,
      versionNumber: 1,
      status: "DRAFT",
      editingMode: "PRO",
      revision: 1,
      createdByUserId: IDs.owner,
      validationFingerprint: digest({ input, type: "validation" }),
      renderFingerprint: digest({ input, type: "render" }),
      operationalTimezone: "Asia/Baghdad",
      staffOwnReversalWindowSeconds: 120,
      managerReversalWindowMinutes: 1440,
      managerOverrideAllowed: true,
    },
  });
  for (const translation of [
    {
      locale: "EN" as const,
      programName: input.name,
      shortDescription: `Earn stamps with ${input.name}.`,
      rewardSummary: `Complete ${input.goal} stamps for the final reward.`,
      terms: "Qualifying purchases only. Rewards have no cash value.",
      complete: "Your final reward is ready.",
      unlocked: "A reward is ready.",
    },
    {
      locale: "AR" as const,
      programName: input.arabicName,
      shortDescription: `اجمع الأختام مع ${input.arabicName}.`,
      rewardSummary: `أكمل ${input.goal} أختام للحصول على المكافأة النهائية.`,
      terms: "للمشتريات المؤهلة فقط. لا توجد قيمة نقدية للمكافآت.",
      complete: "مكافأتك النهائية جاهزة.",
      unlocked: "لديك مكافأة جاهزة.",
    },
  ]) {
    await prisma.programTranslation.upsert({
      where: {
        versionId_locale: {
          versionId: input.versionId,
          locale: translation.locale,
        },
      },
      update: {},
      create: {
        versionId: input.versionId,
        locale: translation.locale,
        programName: translation.programName,
        shortDescription: translation.shortDescription,
        rewardSummary: translation.rewardSummary,
        termsAndConditions: translation.terms,
        completionMessage: translation.complete,
        rewardUnlockedMessage: translation.unlocked,
      },
    });
  }
  await prisma.stampRule.upsert({
    where: { versionId: input.versionId },
    update: {},
    create: {
      versionId: input.versionId,
      requiredStampCount: input.goal,
      defaultStampsPerAction: 1,
      maximumStampsPerOperation: 5,
      maximumStampsPerCustomerPerDay: input.dailyCap,
      minimumPurchaseAmountMinor: input.minimumPurchaseAmountMinor,
      minimumPurchaseCurrency: input.minimumPurchaseCurrency,
      earningDescription: "One stamp for each qualifying visit.",
      resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
    },
  });
  const rewards = [
    {
      id: input.milestoneRewardId,
      threshold: Math.max(2, Math.floor(input.goal / 2)),
      internalName: "Milestone treat",
      max: 2,
      validity: 30,
      approval: true,
    },
    {
      id: input.finalRewardId,
      threshold: input.goal,
      internalName: "Final reward",
      max: 1,
      validity: null,
      approval: false,
    },
  ];
  for (const reward of rewards) {
    await prisma.rewardDefinition.upsert({
      where: { id: reward.id },
      update: {},
      create: {
        id: reward.id,
        versionId: input.versionId,
        thresholdStampCount: reward.threshold,
        rewardType: "FREE_ITEM",
        internalName: reward.internalName,
        sortOrder: reward.threshold,
        validityDurationDays: reward.validity,
        requiresManagerApproval: reward.approval,
        maximumRedemptionsPerEarned: reward.max,
      },
    });
    for (const locale of ["EN", "AR"] as const) {
      await prisma.rewardTranslation.upsert({
        where: { rewardId_locale: { rewardId: reward.id, locale } },
        update: {},
        create: {
          rewardId: reward.id,
          locale,
          name:
            locale === "AR"
              ? reward.threshold === input.goal
                ? "المكافأة النهائية"
                : "مكافأة مرحلية"
              : reward.internalName,
          description:
            locale === "AR"
              ? "اعرض العضوية للموظف للاسترداد."
              : "Show the membership to Staff for redemption.",
        },
      });
    }
  }
  const legacyProgramTranslations = await prisma.programTranslation.findMany({
    where: { versionId: input.versionId },
  });
  for (const [position, translation] of legacyProgramTranslations
    .toSorted((left, right) => left.locale.localeCompare(right.locale))
    .entries()) {
    const locale = translation.locale === "AR" ? "ar" : "en";
    const localeRow = await prisma.programVersionLocale.upsert({
      where: { versionId_locale: { versionId: input.versionId, locale } },
      update: {
        enabled: true,
        position,
        programName: translation.programName,
        shortDescription: translation.shortDescription,
        fullDescription: translation.fullDescription,
        rewardSummary: translation.rewardSummary,
        joinInstructions: translation.joinInstructions,
        termsAndConditions: translation.termsAndConditions,
        completionMessage: translation.completionMessage,
        rewardUnlockedMessage: translation.rewardUnlockedMessage,
        pausedMessage: translation.pausedMessage,
      },
      create: {
        versionId: input.versionId,
        locale,
        enabled: true,
        position,
        programName: translation.programName,
        shortDescription: translation.shortDescription,
        fullDescription: translation.fullDescription,
        rewardSummary: translation.rewardSummary,
        joinInstructions: translation.joinInstructions,
        termsAndConditions: translation.termsAndConditions,
        completionMessage: translation.completionMessage,
        rewardUnlockedMessage: translation.rewardUnlockedMessage,
        pausedMessage: translation.pausedMessage,
      },
    });
    for (const reward of rewards) {
      const legacyReward = await prisma.rewardTranslation.findUniqueOrThrow({
        where: {
          rewardId_locale: {
            rewardId: reward.id,
            locale: translation.locale,
          },
        },
      });
      await prisma.programLocaleRewardTranslation.upsert({
        where: {
          rewardId_programVersionLocaleId: {
            rewardId: reward.id,
            programVersionLocaleId: localeRow.id,
          },
        },
        update: {
          name: legacyReward.name,
          description: legacyReward.description,
          redemptionInstructions: legacyReward.redemptionInstructions,
        },
        create: {
          rewardId: reward.id,
          programVersionLocaleId: localeRow.id,
          name: legacyReward.name,
          description: legacyReward.description,
          redemptionInstructions: legacyReward.redemptionInstructions,
        },
      });
    }
  }
  for (const locationId of [IDs.locationOne, IDs.locationTwo]) {
    await prisma.programLocation.upsert({
      where: { versionId_locationId: { versionId: input.versionId, locationId } },
      update: {},
      create: {
        versionId: input.versionId,
        locationId,
        earningEnabled: true,
        redemptionEnabled: true,
      },
    });
  }
  await prisma.programVisualTheme.upsert({
    where: { versionId: input.versionId },
    update: {},
    create: {
      versionId: input.versionId,
      backgroundColor: "#F7F4EE",
      foregroundColor: "#241916",
      accentColor: "#E4572E",
      secondaryColor: "#E8D9D0",
      mutedColor: "#6B7280",
      filledStampAssetId: IDs.filledAsset,
      emptyStampAssetId: IDs.emptyAsset,
      layoutType: "GRID",
      layoutConfiguration: { columns: 4 },
      stampSize: 56,
      stampSpacing: 10,
      borderRadius: 18,
      customerWebVariant: "CARD",
    },
  });
  await prisma.programEnrollmentPolicy.upsert({
    where: { programVersionId: input.versionId },
    update: {},
    create: {
      organizationId: IDs.organization,
      programVersionId: input.versionId,
      emailCollectionMode: "OPTIONAL",
      primaryCustomerLocale: "EN",
      allowLocaleSelection: true,
      customerTermsRequired: true,
      transferWithoutEmailAllowed: true,
      enrollmentOpen: true,
    },
  });
  if (programVersion.status !== "PUBLISHED") {
    await prisma.loyaltyProgramVersion.update({
      where: { id: input.versionId },
      data: {
        status: "PUBLISHED",
        validatedAt: now,
        testReadyAt: now,
        publishedAt: now,
      },
    });
  }
  await prisma.loyaltyProgram.update({
    where: { id: input.id },
    data: {
      status: "PUBLISHED",
      currentPublishedVersionId: input.versionId,
      currentDraftVersionId: null,
      publishedAt: now,
    },
  });
  return { ...input, milestoneThreshold: rewards[0]?.threshold ?? 4 };
}

async function seedStaffDevices(now: Date) {
  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId: IDs.organization,
      userId: { in: [IDs.staffOne, IDs.staffTwo] },
    },
  });
  const staffOne = members.find((item) => item.userId === IDs.staffOne);
  const staffTwo = members.find((item) => item.userId === IDs.staffTwo);
  if (!staffOne || !staffTwo) throw new Error("Seed Staff members are missing.");
  for (const member of members) {
    for (const locationId of [IDs.locationOne, IDs.locationTwo]) {
      await prisma.staffLocationAssignment.upsert({
        where: {
          organizationMemberId_locationId: {
            organizationMemberId: member.id,
            locationId,
          },
        },
        update: { active: true },
        create: {
          organizationId: IDs.organization,
          organizationMemberId: member.id,
          locationId,
          earningAllowed: true,
          redemptionAllowed: true,
          assignedByUserId: IDs.owner,
        },
      });
    }
  }
  const activeDevice = await prisma.staffDevice.upsert({
    where: { id: "80000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "80000000-0000-4000-8000-000000000001",
      publicId: "81000000-0000-4000-8000-000000000001",
      organizationId: IDs.organization,
      organizationMemberId: staffOne.id,
      displayName: "W4 deterministic Test Client",
      platform: "TEST_CLIENT",
      installationId: "waflo-w4-test-client-installation-0001",
      publicKey: TEST_DEVICE_PUBLIC_KEY,
      status: "ACTIVE",
      trustLevel: "TEST_ONLY",
      appVersion: "w4-test-client/1.0",
      osVersion: "Node.js",
      model: "Deterministic API evidence adapter",
      pairedAt: now,
      lastSeenAt: now,
    },
  });
  await prisma.staffDeviceLocation.upsert({
    where: {
      staffDeviceId_locationId: {
        staffDeviceId: activeDevice.id,
        locationId: IDs.locationOne,
      },
    },
    update: { active: true },
    create: {
      staffDeviceId: activeDevice.id,
      locationId: IDs.locationOne,
      earningAllowed: true,
      redemptionAllowed: true,
    },
  });
  await prisma.staffDeviceSession.upsert({
    where: { id: "82000000-0000-4000-8000-000000000001" },
    update: {
      revokedAt: null,
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    },
    create: {
      id: "82000000-0000-4000-8000-000000000001",
      organizationId: IDs.organization,
      staffDeviceId: activeDevice.id,
      organizationMemberId: staffOne.id,
      locationId: IDs.locationOne,
      tokenHash: hashOpaqueDeviceToken(TEST_DEVICE_ACCESS_TOKEN, environment.DEVICE_SESSION_SECRET),
      refreshTokenHash: hashOpaqueDeviceToken(
        TEST_DEVICE_REFRESH_TOKEN,
        environment.DEVICE_SESSION_SECRET,
      ),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      appVersion: "w4-test-client/1.0",
      deviceMetadata: { testOnly: true, privateKeyStoredInDatabase: false },
    },
  });
  await prisma.staffDevice.upsert({
    where: { id: "80000000-0000-4000-8000-000000000002" },
    update: {},
    create: {
      id: "80000000-0000-4000-8000-000000000002",
      publicId: "81000000-0000-4000-8000-000000000002",
      organizationId: IDs.organization,
      organizationMemberId: staffTwo.id,
      displayName: "Revoked counter tablet",
      platform: "ANDROID",
      installationId: "waflo-revoked-device-installation-0002",
      publicKey: REVOKED_DEVICE_PUBLIC_KEY,
      status: "REVOKED",
      trustLevel: "REVOKED",
      appVersion: "1.0.0",
      pairedAt: new Date(now.getTime() - 7 * 86_400_000),
      revokedAt: new Date(now.getTime() - 86_400_000),
      revocationReason: "Deterministic revoked-device evidence",
    },
  });
  const pairingToken = "wfp1.development.pending-seed-pairing-token-do-not-use-in-production";
  await prisma.devicePairingSession.upsert({
    where: { id: "83000000-0000-4000-8000-000000000001" },
    update: {
      status: "PENDING",
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    },
    create: {
      id: "83000000-0000-4000-8000-000000000001",
      publicId: "84000000-0000-4000-8000-000000000001",
      organizationId: IDs.organization,
      intendedStaffMemberId: staffTwo.id,
      pairingTokenHash: hashPairingToken(pairingToken),
      requestedLocationAssignments: [
        {
          locationId: IDs.locationTwo,
          earningAllowed: true,
          redemptionAllowed: true,
        },
      ],
      deviceLabelSuggestion: "Hussein's counter device",
      createdByUserId: IDs.owner,
      status: "PENDING",
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    },
  });
  return { staffOne, staffTwo, activeDevice };
}

interface SeedMembership {
  id: string;
  customerId: string;
  publicMembershipId: string;
  targetStamps: number;
  redeemFinal: boolean;
  email: string;
  displayName: string;
}

async function seedCustomersAndMemberships(
  program: ProgramSeed & { milestoneThreshold: number },
  staff: Awaited<ReturnType<typeof seedStaffDevices>>,
  now: Date,
) {
  const fixtures: SeedMembership[] = [
    {
      id: "60000000-0000-4000-8000-000000000001",
      customerId: "50000000-0000-4000-8000-000000000001",
      publicMembershipId: "mem_W4ZeroMembership0001",
      targetStamps: 0,
      redeemFinal: false,
      email: "zero@example.com",
      displayName: "Noor Zero",
    },
    {
      id: "60000000-0000-4000-8000-000000000002",
      customerId: "50000000-0000-4000-8000-000000000002",
      publicMembershipId: "mem_W4PartialMembership02",
      targetStamps: 5,
      redeemFinal: false,
      email: "partial@example.com",
      displayName: "Ali Partial",
    },
    {
      id: "60000000-0000-4000-8000-000000000003",
      customerId: "50000000-0000-4000-8000-000000000003",
      publicMembershipId: "mem_W4MilestoneReady003",
      targetStamps: program.milestoneThreshold + 1,
      redeemFinal: false,
      email: "milestone@example.com",
      displayName: "Sara Milestone",
    },
    {
      id: "60000000-0000-4000-8000-000000000004",
      customerId: "50000000-0000-4000-8000-000000000004",
      publicMembershipId: "mem_W4FinalReady000004",
      targetStamps: program.goal,
      redeemFinal: false,
      email: "ready@example.com",
      displayName: "Maha Reward Ready",
    },
    {
      id: "60000000-0000-4000-8000-000000000005",
      customerId: "50000000-0000-4000-8000-000000000005",
      publicMembershipId: "mem_W4CompletedCycle005",
      targetStamps: program.goal,
      redeemFinal: true,
      email: "cycle@example.com",
      displayName: "Zaid Completed Cycle",
    },
  ];
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    if (!fixture) continue;
    await prisma.customer.upsert({
      where: { id: fixture.customerId },
      update: {},
      create: {
        id: fixture.customerId,
        organizationId: IDs.organization,
        displayName: fixture.displayName,
        preferredLocale: index % 2 === 0 ? "EN" : "AR",
      },
    });
    const contactId = `51000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const normalized = normalizeEmail(fixture.email);
    const encrypted = encryptCustomerValue(normalized, {
      organizationId: IDs.organization,
      recordId: contactId,
      purpose: "customer-email",
      keyring: customerKeyring,
    });
    await prisma.customerContact.upsert({
      where: { id: contactId },
      update: {},
      create: {
        id: contactId,
        organizationId: IDs.organization,
        customerId: fixture.customerId,
        type: "EMAIL",
        encryptedValue: encrypted.serialized,
        encryptionKeyVersion: encrypted.keyVersion,
        normalizedValueHash: hashNormalizedEmail(normalized, contactLookupKey),
        maskedDisplayValue: maskEmail(normalized),
        verificationStatus: "VERIFIED",
        verifiedAt: now,
        isPrimary: true,
      },
    });
    await prisma.membership.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        organizationId: IDs.organization,
        customerId: fixture.customerId,
        programId: program.id,
        enrollmentProgramVersionId: program.versionId,
        publicMembershipId: fixture.publicMembershipId,
      },
    });
    await prisma.membershipProgressProjection.upsert({
      where: { membershipId: fixture.id },
      update: {},
      create: {
        membershipId: fixture.id,
        organizationId: IDs.organization,
        currentCycleStampCount: 0,
        completedCycleCount: 0,
        currentCycleNumber: 1,
        rewardReady: false,
        projectionVersion: 0,
        lastLedgerSequence: 0,
      },
    });
    const publicCredentialId = `cred_W4Deterministic${String(index + 1).padStart(4, "0")}`;
    await prisma.membershipCredential.upsert({
      where: { publicCredentialId },
      update: {},
      create: {
        organizationId: IDs.organization,
        membershipId: fixture.id,
        credentialVersion: 1,
        publicCredentialId,
        secretVersion: membershipCredentialSecret.version,
        secretHash: membershipCredentialHash(publicCredentialId, 1, membershipCredentialSecret),
        status: "ACTIVE",
      },
    });
    if (
      fixture.targetStamps > 0 &&
      (await prisma.loyaltyLedgerEntry.count({ where: { membershipId: fixture.id } })) === 0
    ) {
      await seedMembershipLedger(
        fixture,
        program,
        staff,
        index,
        new Date(now.getTime() - (fixtures.length - index) * 3_600_000),
      );
    }
  }
}

async function seedMembershipLedger(
  fixture: SeedMembership,
  program: ProgramSeed & { milestoneThreshold: number },
  staff: Awaited<ReturnType<typeof seedStaffDevices>>,
  fixtureIndex: number,
  occurredAt: Date,
) {
  await prisma.$transaction(async (transaction) => {
    const membership = await transaction.membership.findUniqueOrThrow({
      where: { id: fixture.id },
      include: { progress: true },
    });
    if (!membership.progress) throw new Error("Seed projection missing.");
    let projection: ProjectionState = {
      currentCycleStampCount: membership.progress.currentCycleStampCount,
      completedCycleCount: membership.progress.completedCycleCount,
      rewardReady: membership.progress.rewardReady,
      projectionVersion: membership.progress.projectionVersion,
      lastSourceEventId: membership.progress.lastSourceEventId,
    };
    const issueCommandId = `70000000-0000-4000-8000-${String(fixtureIndex * 10 + 1).padStart(
      12,
      "0",
    )}`;
    await transaction.loyaltyOperationCommand.create({
      data: {
        id: issueCommandId,
        organizationId: IDs.organization,
        membershipId: membership.id,
        operationType: "ISSUE_STAMP",
        idempotencyKey: `seed-w4-issue-${membership.id}`,
        requestFingerprint: digest({ membershipId: membership.id, type: "ISSUE_STAMP" }),
        status: "PROCESSING",
        actorMemberId: staff.staffOne.id,
        actorDeviceId: staff.activeDevice.id,
        locationId: IDs.locationOne,
      },
    });
    const entryIds: string[] = [];
    const issue = await appendSeedEntry(transaction, {
      membership,
      projection,
      commandId: issueCommandId,
      eventId: `71000000-0000-4000-8000-${String(fixtureIndex * 10 + 1).padStart(12, "0")}`,
      eventType: "STAMP_ISSUED",
      stampDelta: fixture.targetStamps,
      occurredAt,
      staffMemberId: staff.staffOne.id,
      staffDeviceId: staff.activeDevice.id,
      locationId: IDs.locationOne,
      goal: program.goal,
      safeMetadata: { deterministicSeed: true },
    });
    projection = issue.projection;
    entryIds.push(issue.entryId);
    const entitlements: Array<{ id: string; final: boolean; rewardId: string }> = [];
    const thresholds = [
      {
        threshold: program.milestoneThreshold,
        final: false,
        rewardId: program.milestoneRewardId,
      },
      { threshold: program.goal, final: true, rewardId: program.finalRewardId },
    ].filter((item) => item.threshold <= fixture.targetStamps);
    for (let thresholdIndex = 0; thresholdIndex < thresholds.length; thresholdIndex += 1) {
      const threshold = thresholds[thresholdIndex];
      if (!threshold) continue;
      const entitlementId = `72000000-0000-4000-8000-${String(
        fixtureIndex * 10 + thresholdIndex + 1,
      ).padStart(12, "0")}`;
      const unlock = await appendSeedEntry(transaction, {
        membership,
        projection,
        commandId: issueCommandId,
        eventId: `71000000-0000-4000-8001-${String(fixtureIndex * 10 + thresholdIndex + 1).padStart(
          12,
          "0",
        )}`,
        eventType: threshold.final ? "FINAL_REWARD_UNLOCKED" : "MILESTONE_REWARD_UNLOCKED",
        stampDelta: 0,
        rewardEntitlementId: entitlementId,
        occurredAt: new Date(occurredAt.getTime() + (thresholdIndex + 1) * 1_000),
        staffMemberId: staff.staffOne.id,
        staffDeviceId: staff.activeDevice.id,
        locationId: IDs.locationOne,
        goal: program.goal,
        safeMetadata: {
          rewardDefinitionId: threshold.rewardId,
          threshold: threshold.threshold,
          deterministicSeed: true,
        },
      });
      projection = unlock.projection;
      entryIds.push(unlock.entryId);
      await transaction.rewardEntitlement.create({
        data: {
          id: entitlementId,
          organizationId: IDs.organization,
          membershipId: membership.id,
          programVersionId: program.versionId,
          rewardDefinitionId: threshold.rewardId,
          cycleNumber: 1,
          threshold: threshold.threshold,
          maximumRedemptionCount: threshold.final ? 1 : 2,
          unlockedByLedgerEntryId: unlock.entryId,
          unlockedAt: occurredAt,
          expiresAt: threshold.final ? null : new Date(occurredAt.getTime() + 30 * 86_400_000),
        },
      });
      entitlements.push({
        id: entitlementId,
        final: threshold.final,
        rewardId: threshold.rewardId,
      });
    }
    await persistSeedProjection(transaction, membership.id, projection);
    await transaction.loyaltyOperationCommand.update({
      where: { id: issueCommandId },
      data: {
        status: "COMPLETED",
        resultLedgerEntryIds: entryIds,
        resultProjectionVersion: projection.projectionVersion,
        resultPayload: {
          deterministicSeed: true,
          progress: projection.currentCycleStampCount,
          rewardReady: projection.rewardReady,
        },
        completedAt: occurredAt,
      },
    });
    if (fixture.redeemFinal) {
      const final = entitlements.find((item) => item.final);
      if (!final) throw new Error("Seed final entitlement missing.");
      const redeemCommandId = `70000000-0000-4000-8000-${String(fixtureIndex * 10 + 2).padStart(
        12,
        "0",
      )}`;
      await transaction.loyaltyOperationCommand.create({
        data: {
          id: redeemCommandId,
          organizationId: IDs.organization,
          membershipId: membership.id,
          operationType: "REDEEM_REWARD",
          idempotencyKey: `seed-w4-redeem-${membership.id}`,
          requestFingerprint: digest({
            membershipId: membership.id,
            type: "REDEEM_REWARD",
          }),
          status: "PROCESSING",
          actorMemberId: staff.staffOne.id,
          actorDeviceId: staff.activeDevice.id,
          locationId: IDs.locationOne,
        },
      });
      const redemptionId = `73000000-0000-4000-8000-${String(fixtureIndex + 1).padStart(12, "0")}`;
      await transaction.rewardRedemption.create({
        data: {
          id: redemptionId,
          organizationId: IDs.organization,
          membershipId: membership.id,
          rewardEntitlementId: final.id,
          rewardDefinitionId: final.rewardId,
          cycleNumber: 1,
          entitlementSequence: 1,
          locationId: IDs.locationOne,
          staffMemberId: staff.staffOne.id,
          staffDeviceId: staff.activeDevice.id,
          operationCommandId: redeemCommandId,
          redeemedAt: new Date(occurredAt.getTime() + 5_000),
          safeMetadata: { deterministicSeed: true },
        },
      });
      const redeemed = await appendSeedEntry(transaction, {
        membership,
        projection,
        commandId: redeemCommandId,
        eventId: `71000000-0000-4000-8002-${String(fixtureIndex + 1).padStart(12, "0")}`,
        eventType: "REWARD_REDEEMED",
        stampDelta: 0,
        rewardEntitlementId: final.id,
        rewardRedemptionId: redemptionId,
        occurredAt: new Date(occurredAt.getTime() + 5_000),
        staffMemberId: staff.staffOne.id,
        staffDeviceId: staff.activeDevice.id,
        locationId: IDs.locationOne,
        goal: program.goal,
        safeMetadata: { deterministicSeed: true },
      });
      projection = redeemed.projection;
      const reset = await appendSeedEntry(transaction, {
        membership,
        projection,
        commandId: redeemCommandId,
        eventId: `71000000-0000-4000-8003-${String(fixtureIndex + 1).padStart(12, "0")}`,
        eventType: "CYCLE_RESET",
        stampDelta: 0,
        rewardEntitlementId: final.id,
        rewardRedemptionId: redemptionId,
        occurredAt: new Date(occurredAt.getTime() + 6_000),
        staffMemberId: staff.staffOne.id,
        staffDeviceId: staff.activeDevice.id,
        locationId: IDs.locationOne,
        goal: program.goal,
        safeMetadata: { deterministicSeed: true },
      });
      projection = reset.projection;
      await transaction.rewardEntitlement.update({
        where: { id: final.id },
        data: {
          status: "REDEEMED",
          redemptionCount: 1,
          fullyRedeemedAt: new Date(occurredAt.getTime() + 5_000),
        },
      });
      await persistSeedProjection(transaction, membership.id, projection);
      await transaction.loyaltyOperationCommand.update({
        where: { id: redeemCommandId },
        data: {
          status: "COMPLETED",
          resultLedgerEntryIds: [redeemed.entryId, reset.entryId],
          resultProjectionVersion: projection.projectionVersion,
          resultPayload: { deterministicSeed: true, finalReward: true },
          completedAt: new Date(occurredAt.getTime() + 6_000),
        },
      });
    }
  });
}

async function appendSeedEntry(
  transaction: Prisma.TransactionClient,
  input: {
    membership: {
      id: string;
      organizationId: string;
      customerId: string;
      programId: string;
      enrollmentProgramVersionId: string;
    };
    projection: ProjectionState;
    commandId: string;
    eventId: string;
    eventType: LoyaltyLedgerEventType;
    stampDelta: number;
    rewardEntitlementId?: string;
    rewardRedemptionId?: string;
    occurredAt: Date;
    staffMemberId: string;
    staffDeviceId: string;
    locationId: string;
    goal: number;
    safeMetadata: Record<string, unknown>;
  },
) {
  const last = await transaction.loyaltyLedgerEntry.findFirst({
    where: { membershipId: input.membership.id },
    orderBy: { membershipSequence: "desc" },
  });
  const sequence = (last?.membershipSequence ?? 0) + 1;
  const localDate = operationalLocalDate(input.occurredAt, "Asia/Baghdad");
  const payload = {
    id: input.eventId,
    organizationId: input.membership.organizationId,
    membershipId: input.membership.id,
    customerId: input.membership.customerId,
    programId: input.membership.programId,
    programVersionId: input.membership.enrollmentProgramVersionId,
    locationId: input.locationId,
    staffOrganizationMemberId: input.staffMemberId,
    staffDeviceId: input.staffDeviceId,
    eventType: input.eventType,
    membershipSequence: sequence,
    cycleNumber: input.projection.completedCycleCount + 1,
    stampDelta: input.stampDelta,
    rewardEntitlementId: input.rewardEntitlementId ?? null,
    rewardRedemptionId: input.rewardRedemptionId ?? null,
    reversalOfEntryId: null,
    operationCommandId: input.commandId,
    purchaseAmountMinor: null,
    purchaseCurrency: null,
    merchantTransactionReference: null,
    operationalTimezone: "Asia/Baghdad",
    operationalLocalDate: localDate,
    occurredAt: input.occurredAt.toISOString(),
    safeMetadata: input.safeMetadata,
    previousEntryHash: last?.entryHash ?? LEDGER_GENESIS_HASH,
  } as const;
  const entryHash = calculateLedgerEntryHash(payload, environment.LEDGER_HASH_SECRET_V1);
  const projection = reduceProjectionEvent(
    input.projection,
    {
      id: input.eventId,
      eventType: input.eventType,
      membershipSequence: sequence,
      cycleNumber: input.projection.completedCycleCount + 1,
      stampDelta: input.stampDelta,
    },
    { requiredStampCount: input.goal },
  );
  await transaction.loyaltyLedgerEntry.create({
    data: {
      id: input.eventId,
      organizationId: input.membership.organizationId,
      membershipId: input.membership.id,
      customerId: input.membership.customerId,
      programId: input.membership.programId,
      programVersionId: input.membership.enrollmentProgramVersionId,
      locationId: input.locationId,
      staffOrganizationMemberId: input.staffMemberId,
      staffDeviceId: input.staffDeviceId,
      eventType: input.eventType,
      membershipSequence: sequence,
      cycleNumber: input.projection.completedCycleCount + 1,
      stampDelta: input.stampDelta,
      rewardEntitlementId: input.rewardEntitlementId ?? null,
      rewardRedemptionId: input.rewardRedemptionId ?? null,
      operationCommandId: input.commandId,
      operationalTimezone: "Asia/Baghdad",
      operationalLocalDate: new Date(`${localDate}T00:00:00.000Z`),
      occurredAt: input.occurredAt,
      safeMetadata: input.safeMetadata as Prisma.InputJsonValue,
      ledgerHashVersion: 1,
      previousEntryHash: payload.previousEntryHash,
      entryHash,
    },
  });
  return { entryId: input.eventId, projection };
}

async function persistSeedProjection(
  transaction: Prisma.TransactionClient,
  membershipId: string,
  projection: ProjectionState,
) {
  await transaction.membershipProgressProjection.update({
    where: { membershipId },
    data: {
      currentCycleStampCount: projection.currentCycleStampCount,
      completedCycleCount: projection.completedCycleCount,
      currentCycleNumber: projection.completedCycleCount + 1,
      rewardReady: projection.rewardReady,
      projectionVersion: projection.projectionVersion,
      lastLedgerSequence: projection.projectionVersion,
      lastSourceEventId: projection.lastSourceEventId,
      projectionFingerprint: projectionFingerprint(projection),
    },
  });
}

async function seedRiskAndCommands(staff: Awaited<ReturnType<typeof seedStaffDevices>>, now: Date) {
  const risks = [
    {
      id: "90000000-0000-4000-8000-000000000001",
      publicId: "91000000-0000-4000-8000-000000000001",
      ruleCode: "DAILY_CAP_OVERRIDE",
      severity: "MEDIUM" as const,
      score: 55,
      membershipId: "60000000-0000-4000-8000-000000000004",
    },
    {
      id: "90000000-0000-4000-8000-000000000002",
      publicId: "91000000-0000-4000-8000-000000000002",
      ruleCode: "UNUSUAL_REVERSAL_PATTERN",
      severity: "HIGH" as const,
      score: 82,
      membershipId: "60000000-0000-4000-8000-000000000003",
    },
  ];
  for (const risk of risks) {
    await prisma.operationalRiskSignal.upsert({
      where: { id: risk.id },
      update: {},
      create: {
        ...risk,
        organizationId: IDs.organization,
        programId: IDs.cookieProgram,
        staffMemberId: staff.staffOne.id,
        staffDeviceId: staff.activeDevice.id,
        locationId: IDs.locationOne,
        status: "OPEN",
        safeEvidence: {
          deterministicSeed: true,
          containsRawCredential: false,
        },
      },
    });
  }
  await prisma.managerApprovalChallenge.upsert({
    where: { id: "94000000-0000-4000-8000-000000000001" },
    update: {
      status: "PENDING",
      approvedByUserId: null,
      approvedAt: null,
      rejectedAt: null,
      consumedAt: null,
      expiresAt: new Date(now.getTime() + 5 * 60_000),
    },
    create: {
      id: "94000000-0000-4000-8000-000000000001",
      publicId: "95000000-0000-4000-8000-000000000001",
      organizationId: IDs.organization,
      membershipId: "60000000-0000-4000-8000-000000000004",
      rewardEntitlementId: "72000000-0000-4000-8000-000000000032",
      staffDeviceId: staff.activeDevice.id,
      locationId: IDs.locationOne,
      requestFingerprint: "a".repeat(64),
      requestedByMemberId: staff.staffOne.id,
      status: "PENDING",
      expiresAt: new Date(now.getTime() + 5 * 60_000),
    },
  });
  await prisma.managerApprovalChallenge.upsert({
    where: { id: "94000000-0000-4000-8000-000000000002" },
    update: {},
    create: {
      id: "94000000-0000-4000-8000-000000000002",
      publicId: "95000000-0000-4000-8000-000000000002",
      organizationId: IDs.organization,
      membershipId: "60000000-0000-4000-8000-000000000003",
      rewardEntitlementId: "72000000-0000-4000-8000-000000000021",
      staffDeviceId: staff.activeDevice.id,
      locationId: IDs.locationOne,
      requestFingerprint: "b".repeat(64),
      requestedByMemberId: staff.staffOne.id,
      approvedByUserId: IDs.owner,
      status: "APPROVED",
      expiresAt: new Date(now.getTime() + 5 * 60_000),
      approvedAt: now,
    },
  });
  await prisma.exportCommand.upsert({
    where: { id: "92000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "92000000-0000-4000-8000-000000000001",
      publicId: "93000000-0000-4000-8000-000000000001",
      organizationId: IDs.organization,
      requestedByUserId: IDs.owner,
      exportType: "MEMBERSHIP_SUMMARY",
      filters: {},
      filterFingerprint: digest({}),
      status: "PENDING",
      createdAt: new Date(now.getTime() - 60_000),
    },
  });
}

async function seed(): Promise<void> {
  if (environment.NODE_ENV === "production") {
    throw new Error("Development seed is disabled in production.");
  }
  const now = new Date();
  await seedUsersAndOrganization(now);
  await seedAssets();
  const cookie = await seedProgram(
    {
      id: IDs.cookieProgram,
      versionId: IDs.cookieVersion,
      slug: "cookie-card",
      name: "Cookie Card",
      arabicName: "بطاقة الكوكيز",
      goal: 8,
      dailyCap: null,
      minimumPurchaseAmountMinor: null,
      minimumPurchaseCurrency: null,
      milestoneRewardId: "c2000000-0000-4000-8000-000000000001",
      finalRewardId: "c2000000-0000-4000-8000-000000000002",
    },
    now,
  );
  await seedProgram(
    {
      id: IDs.coffeeProgram,
      versionId: IDs.coffeeVersion,
      slug: "coffee-daily",
      name: "Daily Coffee",
      arabicName: "قهوة يومية",
      goal: 8,
      dailyCap: 5,
      minimumPurchaseAmountMinor: null,
      minimumPurchaseCurrency: null,
      milestoneRewardId: "d2000000-0000-4000-8000-000000000001",
      finalRewardId: "d2000000-0000-4000-8000-000000000002",
    },
    now,
  );
  await seedProgram(
    {
      id: IDs.purchaseProgram,
      versionId: IDs.purchaseVersion,
      slug: "purchase-policy",
      name: "Qualifying Purchase",
      arabicName: "الشراء المؤهل",
      goal: 6,
      dailyCap: 6,
      minimumPurchaseAmountMinor: 10_000,
      minimumPurchaseCurrency: "IQD",
      milestoneRewardId: "e2000000-0000-4000-8000-000000000001",
      finalRewardId: "e2000000-0000-4000-8000-000000000002",
    },
    now,
  );
  const staff = await seedStaffDevices(now);
  await seedCustomersAndMemberships(cookie, staff, now);
  await seedRiskAndCommands(staff, now);
  await prisma.auditLog.createMany({
    data: [
      {
        organizationId: IDs.organization,
        actorUserId: IDs.owner,
        action: "organization.w4_seeded",
        targetType: "organization",
        targetId: IDs.organization,
        requestId: "seed_w4",
        metadata: {
          source: "deterministic_development_seed",
          testDeviceAccessToken: "documented-outside-database",
        },
      },
      {
        organizationId: IDs.secondOrganization,
        actorUserId: IDs.owner,
        action: "organization.seeded",
        targetType: "organization",
        targetId: IDs.secondOrganization,
        requestId: "seed_w1",
        metadata: { source: "development_seed" },
      },
    ],
    skipDuplicates: true,
  });
}

seed()
  .then(() => {
    process.stdout.write("Waflo W4 deterministic development data seeded.\n");
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

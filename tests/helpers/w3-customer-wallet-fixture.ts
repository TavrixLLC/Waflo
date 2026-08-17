import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../packages/database/src/index.js";

export interface W3CustomerWalletFixture {
  runId: string;
  ownerId: string;
  organizationId: string;
  merchantSlug: string;
  merchantHost: string;
  locationId: string;
  programId: string;
  programSlug: string;
  versionId: string;
  filledAssetId: string;
  emptyAssetId: string;
}

export const w3EnrollmentBase = {
  preferredLocale: "en",
  programTermsAccepted: true,
  wafloPrivacyAccepted: true,
  marketingEmailConsent: false,
  website: "",
} as const;

export async function createW3CustomerWalletFixture(
  prisma: PrismaClient,
  label = "repair",
): Promise<W3CustomerWalletFixture> {
  const runId = randomUUID().slice(0, 8);
  const merchantSlug = `w3-${label}-${runId}`.toLocaleLowerCase("en-US").slice(0, 40);
  const programSlug = `card-${runId}`.toLocaleLowerCase("en-US");
  const email = `owner-${label}-${runId}@w3.test`;
  const owner = await prisma.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: "W3 Repair Owner",
      passwordHash: "not-used",
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  const organization = await prisma.organization.create({
    data: {
      name: `W3 ${label} ${runId}`,
      normalizedName: `w3-${label}-${runId}`,
      merchantSlug,
      timezone: "UTC",
      selectedPlan: "GROWTH",
      onboardingState: "COMPLETE",
      onboardingCompletedAt: new Date(),
      members: { create: { userId: owner.id, role: "OWNER" } },
      billingProfile: {
        create: { selectedPlan: "GROWTH", subscriptionStatus: "ACTIVE" },
      },
    },
  });
  const location = await prisma.location.create({
    data: {
      organizationId: organization.id,
      name: "W3 Main",
      city: "Baghdad",
      timezone: "Asia/Baghdad",
      status: "ACTIVE",
    },
  });
  const filled = await prisma.merchantAsset.create({
    data: {
      organizationId: organization.id,
      category: "STAMP_FILLED",
      source: "WAFLO_LIBRARY",
      originalObjectKey: `test/${runId}/filled.svg`,
      originalFilename: "filled.svg",
      mimeType: "image/svg+xml",
      fileSize: 180,
      width: 256,
      height: 256,
      sha256Digest: "1".repeat(64),
      processingStatus: "READY",
      safeMetadata: {
        inlineSvg:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#AE3115" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>',
      },
      createdByUserId: owner.id,
    },
  });
  const empty = await prisma.merchantAsset.create({
    data: {
      organizationId: organization.id,
      category: "STAMP_EMPTY",
      source: "WAFLO_LIBRARY",
      originalObjectKey: `test/${runId}/empty.svg`,
      originalFilename: "empty.svg",
      mimeType: "image/svg+xml",
      fileSize: 190,
      width: 256,
      height: 256,
      sha256Digest: "2".repeat(64),
      processingStatus: "READY",
      safeMetadata: {
        inlineSvg:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#F7F4EE" stroke="#241916" stroke-width="7" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>',
      },
      createdByUserId: owner.id,
    },
  });
  const program = await prisma.loyaltyProgram.create({
    data: {
      organizationId: organization.id,
      internalName: "W3 Repair Card",
      publicSlug: programSlug,
      status: "DRAFT",
      createdByUserId: owner.id,
    },
  });
  const versionId = await createPublishedProgramVersion(prisma, {
    organizationId: organization.id,
    programId: program.id,
    ownerId: owner.id,
    locationId: location.id,
    filledAssetId: filled.id,
    emptyAssetId: empty.id,
    versionNumber: 1,
  });
  await prisma.loyaltyProgram.update({
    where: { id: program.id },
    data: {
      status: "PUBLISHED",
      currentPublishedVersionId: versionId,
      currentDraftVersionId: null,
      publishedAt: new Date(),
    },
  });
  return {
    runId,
    ownerId: owner.id,
    organizationId: organization.id,
    merchantSlug,
    merchantHost: `${merchantSlug}.lvh.me`,
    locationId: location.id,
    programId: program.id,
    programSlug,
    versionId,
    filledAssetId: filled.id,
    emptyAssetId: empty.id,
  };
}

export async function createPublishedProgramVersion(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    programId: string;
    ownerId: string;
    locationId: string;
    filledAssetId: string;
    emptyAssetId: string;
    versionNumber: number;
  },
): Promise<string> {
  const version = await prisma.loyaltyProgramVersion.create({
    data: {
      organizationId: input.organizationId,
      programId: input.programId,
      versionNumber: input.versionNumber,
      status: "DRAFT",
      createdByUserId: input.ownerId,
      validationFingerprint: String(input.versionNumber).repeat(64).slice(0, 64),
      renderFingerprint: "a".repeat(63) + String(input.versionNumber % 10),
      translations: {
        create: [
          {
            locale: "EN",
            programName: `W3 Repair Card v${input.versionNumber}`,
            shortDescription: "Collect eight selected-artwork stamps.",
            fullDescription: "A real pinned-version Wallet repair fixture.",
            rewardSummary: "A complimentary item.",
            joinInstructions: "Join in moments.",
            termsAndConditions: "Test program terms.",
            completionMessage: "Complete",
            rewardUnlockedMessage: "Reward ready",
            pausedMessage: "Temporarily paused",
          },
          {
            locale: "AR",
            programName: `بطاقة وفلو ${input.versionNumber}`,
            shortDescription: "اجمع ثمانية أختام.",
            fullDescription: "بطاقة اختبار مثبتة الإصدار.",
            rewardSummary: "مكافأة مجانية.",
            joinInstructions: "انضم خلال لحظات.",
            termsAndConditions: "شروط برنامج الاختبار.",
            completionMessage: "اكتمل",
            rewardUnlockedMessage: "المكافأة جاهزة",
            pausedMessage: "متوقف مؤقتًا",
          },
        ],
      },
      stampRule: {
        create: {
          requiredStampCount: 8,
          earningDescription: "One stamp per qualifying visit.",
        },
      },
      rewards: {
        create: {
          thresholdStampCount: 8,
          rewardType: "FREE_ITEM",
          internalName: "Complimentary item",
          sortOrder: 1,
          translations: {
            create: [
              { locale: "EN", name: "Complimentary item", description: "Choose one item." },
              { locale: "AR", name: "عنصر مجاني", description: "اختر عنصرًا واحدًا." },
            ],
          },
        },
      },
      locations: { create: { locationId: input.locationId } },
      visualTheme: {
        create: {
          backgroundColor: "#F7F4EE",
          foregroundColor: "#241916",
          accentColor: "#AE3115",
          secondaryColor: "#F3A712",
          mutedColor: "#76645F",
          filledStampAssetId: input.filledAssetId,
          emptyStampAssetId: input.emptyAssetId,
          layoutType: input.versionNumber % 2 === 0 ? "PATH" : "GRID",
          layoutConfiguration: { columns: 4, serpentine: true },
        },
      },
      enrollmentPolicy: {
        create: {
          organizationId: input.organizationId,
          emailCollectionMode: "OPTIONAL",
          primaryCustomerLocale: "EN",
          allowLocaleSelection: true,
          marketingConsentVisible: true,
          transferWithoutEmailAllowed: true,
          enrollmentOpen: true,
        },
      },
    },
  });
  await prisma.loyaltyProgramVersion.update({
    where: { id: version.id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });
  return version.id;
}

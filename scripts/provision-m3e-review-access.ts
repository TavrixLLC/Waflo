import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApiApplication } from "../apps/api/src/app.js";
import type { WafloRequest } from "../apps/api/src/common/request-context.js";
import { CustomerSecurityService } from "../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../apps/api/src/database/prisma.service.js";
import { ReviewAccessService } from "../apps/api/src/review-access/review-access.service.js";
import {
  REVIEW_FIXTURE_IDS,
  REVIEW_SCENARIOS,
} from "../apps/api/src/review-access/review-session.js";
import { createQrPng } from "../packages/qr-core/src/index.js";

if (!process.argv.includes("--confirm-review-tenant")) {
  throw new Error("Explicit --confirm-review-tenant acknowledgement is required.");
}
if (process.env.REVIEW_ACCESS_ENABLED !== "true") {
  throw new Error("REVIEW_ACCESS_ENABLED must be true before provisioning.");
}

const app = await createApiApplication({ logger: false });
const prisma = app.get(PrismaService);
const customerSecurity = app.get(CustomerSecurityService);
const review = app.get(ReviewAccessService);
const now = new Date();
const svgFilled =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="42" fill="#AE3115"/><path d="M31 51c9 8 26 8 34-7" fill="none" stroke="#FFF0EC" stroke-width="8" stroke-linecap="round"/></svg>';
const svgEmpty =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="#FFFFFF" stroke="#AE3115" stroke-width="6"/></svg>';

try {
  await prisma.client.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: REVIEW_FIXTURE_IDS.user },
      update: { status: "ACTIVE", interactiveLoginAllowed: false },
      create: {
        id: REVIEW_FIXTURE_IDS.user,
        displayName: "Waflo Review Staff",
        email: "review-fixture@invalid.waflo",
        normalizedEmail: "review-fixture@invalid.waflo",
        emailVerifiedAt: now,
        passwordHash: null,
        interactiveLoginAllowed: false,
        preferredLocale: "EN",
        status: "ACTIVE",
        termsVersion: "review-fixture",
        privacyVersion: "review-fixture",
        legalAcceptedAt: now,
      },
    });
    await tx.organization.upsert({
      where: { id: REVIEW_FIXTURE_IDS.organization },
      update: { name: "Waflo App Review Demo", status: "ACTIVE" },
      create: {
        id: REVIEW_FIXTURE_IDS.organization,
        name: "Waflo App Review Demo",
        normalizedName: "waflo app review demo",
        merchantSlug: process.env.REVIEW_TENANT_SLUG ?? "waflo-app-review",
        businessCategory: "Review fixture",
        defaultLocale: "EN",
        timezone: "Asia/Baghdad",
        status: "ACTIVE",
        selectedPlan: "SCALE",
        onboardingState: "COMPLETE",
        onboardingCompletedAt: now,
      },
    });
    await tx.organizationBillingProfile.upsert({
      where: { organizationId: REVIEW_FIXTURE_IDS.organization },
      update: { subscriptionStatus: "ACTIVE", stripeCustomerId: null },
      create: {
        organizationId: REVIEW_FIXTURE_IDS.organization,
        selectedPlan: "SCALE",
        subscriptionStatus: "ACTIVE",
      },
    });
    await tx.organizationMember.upsert({
      where: { id: REVIEW_FIXTURE_IDS.member },
      update: { status: "ACTIVE", role: "STAFF" },
      create: {
        id: REVIEW_FIXTURE_IDS.member,
        organizationId: REVIEW_FIXTURE_IDS.organization,
        userId: REVIEW_FIXTURE_IDS.user,
        role: "STAFF",
        status: "ACTIVE",
      },
    });
    await tx.location.upsert({
      where: { id: REVIEW_FIXTURE_IDS.location },
      update: { status: "ACTIVE", name: "Review Counter" },
      create: {
        id: REVIEW_FIXTURE_IDS.location,
        organizationId: REVIEW_FIXTURE_IDS.organization,
        name: "Review Counter",
        city: "Baghdad",
        countryCode: "IQ",
        timezone: "Asia/Baghdad",
        status: "ACTIVE",
      },
    });
    await tx.staffLocationAssignment.upsert({
      where: {
        organizationMemberId_locationId: {
          organizationMemberId: REVIEW_FIXTURE_IDS.member,
          locationId: REVIEW_FIXTURE_IDS.location,
        },
      },
      update: {
        active: true,
        earningAllowed: true,
        redemptionAllowed: true,
        revokedAt: null,
      },
      create: {
        organizationId: REVIEW_FIXTURE_IDS.organization,
        organizationMemberId: REVIEW_FIXTURE_IDS.member,
        locationId: REVIEW_FIXTURE_IDS.location,
        earningAllowed: true,
        redemptionAllowed: true,
        assignedByUserId: REVIEW_FIXTURE_IDS.user,
      },
    });
    for (const asset of [
      {
        id: REVIEW_FIXTURE_IDS.filledAsset,
        category: "STAMP_FILLED" as const,
        filename: "review-filled.svg",
        svg: svgFilled,
      },
      {
        id: REVIEW_FIXTURE_IDS.emptyAsset,
        category: "STAMP_EMPTY" as const,
        filename: "review-empty.svg",
        svg: svgEmpty,
      },
    ]) {
      await tx.merchantAsset.upsert({
        where: { id: asset.id },
        update: {},
        create: {
          id: asset.id,
          organizationId: REVIEW_FIXTURE_IDS.organization,
          category: asset.category,
          source: "WAFLO_LIBRARY",
          originalObjectKey: `review-only/${asset.filename}`,
          originalFilename: asset.filename,
          mimeType: "image/svg+xml",
          fileSize: Buffer.byteLength(asset.svg),
          width: 96,
          height: 96,
          sha256Digest: createHash("sha256").update(asset.svg).digest("hex"),
          processingStatus: "READY",
          safeMetadata: { inlineSvg: asset.svg, reviewFixture: true },
          createdByUserId: REVIEW_FIXTURE_IDS.user,
        },
      });
    }
    for (const program of [
      {
        id: REVIEW_FIXTURE_IDS.program,
        versionId: REVIEW_FIXTURE_IDS.programVersion,
        slug: "review-rewards",
        name: "Review Rewards",
        minimum: null,
        currency: null,
      },
      {
        id: REVIEW_FIXTURE_IDS.purchaseProgram,
        versionId: REVIEW_FIXTURE_IDS.purchaseProgramVersion,
        slug: "review-purchase",
        name: "Review Purchase Rewards",
        minimum: 5000,
        currency: "IQD",
      },
    ]) {
      await tx.loyaltyProgram.upsert({
        where: { id: program.id },
        update: { status: "PUBLISHED", currentPublishedVersionId: program.versionId },
        create: {
          id: program.id,
          organizationId: REVIEW_FIXTURE_IDS.organization,
          internalName: program.name,
          publicSlug: program.slug,
          status: "DRAFT",
          createdByUserId: REVIEW_FIXTURE_IDS.user,
        },
      });
      await tx.loyaltyProgramVersion.upsert({
        where: { id: program.versionId },
        update: { status: "PUBLISHED" },
        create: {
          id: program.versionId,
          programId: program.id,
          organizationId: REVIEW_FIXTURE_IDS.organization,
          versionNumber: 1,
          status: "PUBLISHED",
          editingMode: "PRO",
          createdByUserId: REVIEW_FIXTURE_IDS.user,
          operationalTimezone: "Asia/Baghdad",
          managerOverrideAllowed: false,
          publishedAt: now,
          validatedAt: now,
        },
      });
      for (const locale of ["EN", "AR"] as const) {
        await tx.programTranslation.upsert({
          where: { versionId_locale: { versionId: program.versionId, locale } },
          update: {},
          create: {
            versionId: program.versionId,
            locale,
            programName: locale === "AR" ? "مكافآت العرض" : program.name,
            shortDescription:
              locale === "AR" ? "بيانات خيالية لمراجعة التطبيق." : "Fictional app-review data.",
            rewardSummary: locale === "AR" ? "أكمل ٨ طوابع." : "Complete 8 stamps.",
            termsAndConditions: locale === "AR" ? "للعرض فقط." : "For review only.",
            completionMessage: locale === "AR" ? "المكافأة جاهزة." : "Reward ready.",
            rewardUnlockedMessage: locale === "AR" ? "المكافأة جاهزة." : "Reward ready.",
          },
        });
      }
      await tx.stampRule.upsert({
        where: { versionId: program.versionId },
        update: {},
        create: {
          versionId: program.versionId,
          requiredStampCount: 8,
          defaultStampsPerAction: 1,
          maximumStampsPerOperation: 5,
          minimumPurchaseAmountMinor: program.minimum,
          minimumPurchaseCurrency: program.currency,
          earningDescription: "One stamp per review action.",
          resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
        },
      });
      await tx.programLocation.upsert({
        where: {
          versionId_locationId: {
            versionId: program.versionId,
            locationId: REVIEW_FIXTURE_IDS.location,
          },
        },
        update: { earningEnabled: true, redemptionEnabled: true },
        create: {
          versionId: program.versionId,
          locationId: REVIEW_FIXTURE_IDS.location,
          earningEnabled: true,
          redemptionEnabled: true,
        },
      });
      await tx.programVisualTheme.upsert({
        where: { versionId: program.versionId },
        update: {},
        create: {
          versionId: program.versionId,
          backgroundColor: "#FFF0EC",
          foregroundColor: "#241916",
          accentColor: "#AE3115",
          secondaryColor: "#FF6B4A",
          mutedColor: "#76645F",
          filledStampAssetId: REVIEW_FIXTURE_IDS.filledAsset,
          emptyStampAssetId: REVIEW_FIXTURE_IDS.emptyAsset,
          layoutConfiguration: { columns: 4 },
        },
      });
      await tx.loyaltyProgram.update({
        where: { id: program.id },
        data: {
          status: "PUBLISHED",
          currentDraftVersionId: null,
          currentPublishedVersionId: program.versionId,
          publishedAt: now,
        },
      });
    }
    for (const reward of [
      {
        id: REVIEW_FIXTURE_IDS.milestoneReward,
        versionId: REVIEW_FIXTURE_IDS.programVersion,
        threshold: 5,
        approval: true,
      },
      {
        id: REVIEW_FIXTURE_IDS.finalReward,
        versionId: REVIEW_FIXTURE_IDS.programVersion,
        threshold: 8,
        approval: false,
      },
      {
        id: REVIEW_FIXTURE_IDS.purchaseFinalReward,
        versionId: REVIEW_FIXTURE_IDS.purchaseProgramVersion,
        threshold: 8,
        approval: false,
      },
    ]) {
      await tx.rewardDefinition.upsert({
        where: { id: reward.id },
        update: {},
        create: {
          id: reward.id,
          versionId: reward.versionId,
          thresholdStampCount: reward.threshold,
          rewardType: "FREE_ITEM",
          internalName: reward.approval ? "Manager review reward" : "Review final reward",
          sortOrder: reward.threshold,
          requiresManagerApproval: reward.approval,
        },
      });
    }
    for (const [index, scenario] of REVIEW_SCENARIOS.entries()) {
      await tx.customer.upsert({
        where: { id: scenario.customerId },
        update: { status: "ACTIVE" },
        create: {
          id: scenario.customerId,
          organizationId: REVIEW_FIXTURE_IDS.organization,
          displayName: `Demo Customer ${index + 1}`,
          preferredLocale: index % 2 === 0 ? "EN" : "AR",
          status: "ACTIVE",
        },
      });
      const programId =
        scenario.programVersionId === REVIEW_FIXTURE_IDS.purchaseProgramVersion
          ? REVIEW_FIXTURE_IDS.purchaseProgram
          : REVIEW_FIXTURE_IDS.program;
      await tx.membership.upsert({
        where: { id: scenario.membershipId },
        update: { status: "ACTIVE" },
        create: {
          id: scenario.membershipId,
          organizationId: REVIEW_FIXTURE_IDS.organization,
          customerId: scenario.customerId,
          programId,
          enrollmentProgramVersionId: scenario.programVersionId,
          publicMembershipId: scenario.membershipPublicId,
          status: "ACTIVE",
        },
      });
      await tx.membershipProgressProjection.upsert({
        where: { membershipId: scenario.membershipId },
        update: {},
        create: {
          membershipId: scenario.membershipId,
          organizationId: REVIEW_FIXTURE_IDS.organization,
        },
      });
      const credential = customerSecurity.deriveCredentialForProvisioning(
        scenario.credentialPublicId,
        1,
      );
      await tx.membershipCredential.upsert({
        where: { publicCredentialId: scenario.credentialPublicId },
        update: {
          status: scenario.id === "INVALID_QR" ? "REVOKED" : "ACTIVE",
        },
        create: {
          organizationId: REVIEW_FIXTURE_IDS.organization,
          membershipId: scenario.membershipId,
          credentialVersion: 1,
          publicCredentialId: scenario.credentialPublicId,
          secretVersion: credential.secretVersion,
          secretHash: credential.secretHash,
          status: scenario.id === "INVALID_QR" ? "REVOKED" : "ACTIVE",
          revokedAt: scenario.id === "INVALID_QR" ? now : null,
        },
      });
    }
    await tx.staffDevice.upsert({
      where: { id: REVIEW_FIXTURE_IDS.seedDevice },
      update: { status: "REVOKED" },
      create: {
        id: REVIEW_FIXTURE_IDS.seedDevice,
        organizationId: REVIEW_FIXTURE_IDS.organization,
        organizationMemberId: REVIEW_FIXTURE_IDS.member,
        displayName: "Review fixture seed agent",
        platform: "TEST_CLIENT",
        installationId: "review-fixture-seed-agent",
        publicKey: `review-fixture-seed-agent-${randomUUID()}`,
        status: "REVOKED",
        trustLevel: "FIXTURE_ONLY",
        appVersion: "0.0.0",
        revokedAt: now,
      },
    });
  });

  const context = {
    deviceId: REVIEW_FIXTURE_IDS.seedDevice,
    devicePublicId: REVIEW_FIXTURE_IDS.seedDevice,
    deviceSessionId: REVIEW_FIXTURE_IDS.seedDevice,
    organizationId: REVIEW_FIXTURE_IDS.organization,
    organizationMemberId: REVIEW_FIXTURE_IDS.member,
    locationId: REVIEW_FIXTURE_IDS.location,
    role: "STAFF" as const,
    platform: "TEST_CLIENT" as const,
    appVersion: "1.0.0",
    minimumSupportedAppVersion: "1.0.0",
    appVersionSupported: true as const,
    sessionMode: "REVIEW" as const,
    requestId: "review-provision",
  };
  const request = {
    id: "review-provision",
    requestId: "review-provision",
    headers: {},
    cookies: {},
    ip: "127.0.0.1",
  } as unknown as WafloRequest;
  await review.reset(context, { commandId: randomUUID() }, request);
  const outputArgument = process.argv.find((value) => value.startsWith("--qr-output-dir="));
  if (outputArgument) {
    const outputDirectory = resolve(outputArgument.slice("--qr-output-dir=".length));
    await mkdir(outputDirectory, { recursive: true });
    const credentials = await prisma.client.membershipCredential.findMany({
      where: {
        organizationId: REVIEW_FIXTURE_IDS.organization,
        publicCredentialId: { in: REVIEW_SCENARIOS.map((scenario) => scenario.credentialPublicId) },
      },
    });
    const names = new Map([
      ["CUSTOMER_NEW", "customer-new.png"],
      ["CUSTOMER_ACTIVE_5_OF_8", "customer-active-5-of-8.png"],
      ["CUSTOMER_REWARD_READY_8_OF_8", "customer-reward-ready-8-of-8.png"],
      ["INVALID_QR", "customer-invalid.png"],
    ]);
    for (const scenario of REVIEW_SCENARIOS) {
      const name = names.get(scenario.id);
      if (!name) continue;
      const credential = credentials.find(
        (candidate) => candidate.publicCredentialId === scenario.credentialPublicId,
      );
      if (!credential) throw new Error(`Missing review credential for ${scenario.id}.`);
      const payload = customerSecurity.payloadForCredential(credential);
      await writeFile(resolve(outputDirectory, name), await createQrPng(payload));
    }
  }
  process.stdout.write(`Review tenant provisioned with ${REVIEW_SCENARIOS.length} scenarios.\n`);
} finally {
  await app.close();
}

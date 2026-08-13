import { createHash, randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type {
  ReviewResetInput,
  ReviewScenarioId,
  ReviewScenarioSelectInput,
} from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import {
  calculateLedgerEntryHash,
  canonicalJson,
  LEDGER_GENESIS_HASH,
  type ProjectionState,
  reduceProjectionEvent,
} from "@waflo/loyalty-ledger";
import { operationalLocalDate } from "@waflo/loyalty-policy";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withOrderedInvariantLocks } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { CustomerSecurityService } from "../customer/customer-security.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { REVIEW_FIXTURE_IDS, REVIEW_SCENARIOS, reviewInvariantLockKeys } from "./review-session.js";

type StaffContext = NonNullable<WafloRequest["staffDeviceContext"]>;

@Injectable()
export class ReviewAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly customerSecurity: CustomerSecurityService,
    private readonly audit: AuditService,
  ) {}

  async scenarios(context: StaffContext) {
    this.requireReviewSession(context);
    const memberships = await this.prisma.client.membership.findMany({
      where: {
        organizationId: REVIEW_FIXTURE_IDS.organization,
        id: { in: REVIEW_SCENARIOS.map((scenario) => scenario.membershipId) },
      },
      include: { credentials: true, progress: true },
    });
    if (memberships.length !== REVIEW_SCENARIOS.length) {
      throw new AppError(
        "REVIEW_TENANT_UNAVAILABLE",
        "The review scenarios are temporarily unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      sessionMode: "REVIEW" as const,
      scenarios: REVIEW_SCENARIOS.map((scenario) => {
        const membership = memberships.find((item) => item.id === scenario.membershipId);
        const credential = membership?.credentials.find(
          (item) => item.publicCredentialId === scenario.credentialPublicId,
        );
        if (!membership || !credential || !membership.progress) {
          throw new AppError(
            "REVIEW_TENANT_UNAVAILABLE",
            "The review scenarios are temporarily unavailable.",
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        return {
          id: scenario.id,
          progress: membership.progress.currentCycleStampCount,
          goal: 8,
          rewardReady: membership.progress.rewardReady,
          qrPayload: this.customerSecurity.payloadForCredential(credential),
          credentialStatus: credential.status,
        };
      }),
    };
  }

  async selectScenario(
    context: StaffContext,
    input: ReviewScenarioSelectInput,
    request: WafloRequest,
  ) {
    this.requireReviewSession(context);
    const scenario = this.scenario(input.scenarioId);
    await withOrderedInvariantLocks(
      this.prisma.client,
      reviewInvariantLockKeys(),
      async (transaction) => {
        const replay = await transaction.auditLog.findFirst({
          where: {
            organizationId: REVIEW_FIXTURE_IDS.organization,
            action: "review.scenario_selected",
            targetId: input.commandId,
          },
          select: { metadata: true },
        });
        if (replay) {
          const replayedScenarioId =
            replay.metadata &&
            typeof replay.metadata === "object" &&
            !Array.isArray(replay.metadata) &&
            typeof replay.metadata.scenarioId === "string"
              ? replay.metadata.scenarioId
              : null;
          if (replayedScenarioId !== scenario.id) {
            throw new AppError(
              "OPERATION_IDEMPOTENCY_CONFLICT",
              "Command conflict.",
              HttpStatus.CONFLICT,
            );
          }
          return;
        }
        const profile = await transaction.organizationBillingProfile.findUnique({
          where: { organizationId: REVIEW_FIXTURE_IDS.organization },
        });
        if (!profile) {
          throw new AppError(
            "REVIEW_TENANT_UNAVAILABLE",
            "The review environment is temporarily unavailable.",
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        await transaction.organizationBillingProfile.update({
          where: { organizationId: REVIEW_FIXTURE_IDS.organization },
          data: {
            subscriptionStatus: scenario.id === "BILLING_BLOCKED" ? "SUSPENDED" : "ACTIVE",
            trialEnd: null,
          },
        });
        await this.restoreScenario(transaction, context, scenario, input.commandId);
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId: REVIEW_FIXTURE_IDS.organization,
            action: "review.scenario_selected",
            targetType: "review_scenario",
            targetId: input.commandId,
            locationId: REVIEW_FIXTURE_IDS.location,
            metadata: { scenarioId: scenario.id },
          },
          request,
        );
      },
    );
    const catalog = await this.scenarios(context);
    return catalog.scenarios.find((item) => item.id === scenario.id);
  }

  async reset(context: StaffContext, input: ReviewResetInput, request: WafloRequest) {
    this.requireReviewSession(context);
    return withOrderedInvariantLocks(
      this.prisma.client,
      reviewInvariantLockKeys(),
      async (transaction) => {
        const replay = await transaction.auditLog.findFirst({
          where: {
            organizationId: REVIEW_FIXTURE_IDS.organization,
            action: "review.fixtures_reset",
            targetId: input.commandId,
          },
          select: { id: true },
        });
        if (replay) {
          return {
            status: "RESET" as const,
            commandId: input.commandId,
            scenarioCount: REVIEW_SCENARIOS.length,
            replayed: true,
          };
        }
        const membershipIds = REVIEW_SCENARIOS.map((scenario) => scenario.membershipId);
        const processing = await transaction.loyaltyOperationCommand.count({
          where: { membershipId: { in: membershipIds }, status: "PROCESSING" },
        });
        if (processing > 0) {
          throw new AppError(
            "REVIEW_RESET_CONFLICT",
            "A review operation is still in progress.",
            HttpStatus.CONFLICT,
          );
        }
        await transaction.organizationBillingProfile.update({
          where: { organizationId: REVIEW_FIXTURE_IDS.organization },
          data: { subscriptionStatus: "ACTIVE", trialEnd: null },
        });
        await transaction.managerApprovalChallenge.deleteMany({
          where: { membershipId: { in: membershipIds } },
        });
        await transaction.rewardRedemption.deleteMany({
          where: { membershipId: { in: membershipIds } },
        });
        await transaction.rewardEntitlement.deleteMany({
          where: { membershipId: { in: membershipIds } },
        });
        await transaction.loyaltyLedgerEntry.deleteMany({
          where: { membershipId: { in: membershipIds } },
        });
        await transaction.loyaltyOperationCommand.deleteMany({
          where: { membershipId: { in: membershipIds } },
        });
        await transaction.operationalRiskSignal.deleteMany({
          where: {
            organizationId: REVIEW_FIXTURE_IDS.organization,
            membershipId: { in: membershipIds },
          },
        });
        await transaction.operationalDailyAggregate.deleteMany({
          where: { organizationId: REVIEW_FIXTURE_IDS.organization },
        });
        await transaction.membershipProgressProjection.updateMany({
          where: { membershipId: { in: membershipIds } },
          data: {
            currentCycleStampCount: 0,
            completedCycleCount: 0,
            currentCycleNumber: 1,
            rewardReady: false,
            projectionVersion: 0,
            lastLedgerSequence: 0,
            lastSourceEventId: null,
            projectionFingerprint: null,
          },
        });
        for (const scenario of REVIEW_SCENARIOS) {
          if (scenario.targetProgress > 0) {
            await this.seedProgress(transaction, context, scenario, input.commandId);
          }
        }
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId: REVIEW_FIXTURE_IDS.organization,
            action: "review.fixtures_reset",
            targetType: "review_fixture_set",
            targetId: input.commandId,
            locationId: REVIEW_FIXTURE_IDS.location,
            metadata: { scenarioCount: REVIEW_SCENARIOS.length },
          },
          request,
        );
        return {
          status: "RESET" as const,
          commandId: input.commandId,
          scenarioCount: REVIEW_SCENARIOS.length,
          replayed: false,
        };
      },
    );
  }

  private requireReviewSession(context: StaffContext): void {
    if (
      !this.environment.values.REVIEW_ACCESS_ENABLED ||
      context.sessionMode !== "REVIEW" ||
      context.organizationId !== REVIEW_FIXTURE_IDS.organization ||
      context.organizationMemberId !== REVIEW_FIXTURE_IDS.member ||
      context.locationId !== REVIEW_FIXTURE_IDS.location
    ) {
      throw new AppError(
        "REVIEW_SESSION_INVALID",
        "A valid Review Access session is required.",
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private scenario(id: ReviewScenarioId) {
    const scenario = REVIEW_SCENARIOS.find((item) => item.id === id);
    if (!scenario) {
      throw new AppError(
        "REVIEW_SCENARIO_INVALID",
        "The selected review scenario is not available.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return scenario;
  }

  private async restoreScenario(
    transaction: Prisma.TransactionClient,
    context: StaffContext,
    scenario: (typeof REVIEW_SCENARIOS)[number],
    commandId: string,
  ): Promise<void> {
    await transaction.managerApprovalChallenge.deleteMany({
      where: { membershipId: scenario.membershipId },
    });
    await transaction.rewardRedemption.deleteMany({
      where: { membershipId: scenario.membershipId },
    });
    await transaction.rewardEntitlement.deleteMany({
      where: { membershipId: scenario.membershipId },
    });
    await transaction.loyaltyLedgerEntry.deleteMany({
      where: { membershipId: scenario.membershipId },
    });
    await transaction.loyaltyOperationCommand.deleteMany({
      where: { membershipId: scenario.membershipId },
    });
    await transaction.operationalRiskSignal.deleteMany({
      where: {
        organizationId: REVIEW_FIXTURE_IDS.organization,
        membershipId: scenario.membershipId,
      },
    });
    await transaction.membershipProgressProjection.update({
      where: { membershipId: scenario.membershipId },
      data: {
        currentCycleStampCount: 0,
        completedCycleCount: 0,
        currentCycleNumber: 1,
        rewardReady: false,
        projectionVersion: 0,
        lastLedgerSequence: 0,
        lastSourceEventId: null,
        projectionFingerprint: null,
      },
    });
    if (scenario.targetProgress > 0) {
      await this.seedProgress(transaction, context, scenario, commandId);
    }
  }

  private async seedProgress(
    transaction: Prisma.TransactionClient,
    context: StaffContext,
    scenario: (typeof REVIEW_SCENARIOS)[number],
    resetCommandId: string,
  ) {
    const membership = await transaction.membership.findUnique({
      where: { id: scenario.membershipId },
      include: {
        progress: true,
        enrollmentProgramVersion: { include: { stampRule: true, rewards: true } },
      },
    });
    const rule = membership?.enrollmentProgramVersion.stampRule;
    if (!membership?.progress || !rule || rule.requiredStampCount !== 8) {
      throw new AppError(
        "REVIEW_TENANT_UNAVAILABLE",
        "The review fixtures are not valid.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const commandId = randomUUID();
    const occurredAt = new Date();
    await transaction.loyaltyOperationCommand.create({
      data: {
        id: commandId,
        organizationId: REVIEW_FIXTURE_IDS.organization,
        membershipId: membership.id,
        operationType: "ISSUE_STAMP",
        idempotencyKey: `review-reset:${resetCommandId}:${scenario.id}`,
        requestFingerprint: this.digest({ resetCommandId, scenarioId: scenario.id }),
        status: "PROCESSING",
        actorMemberId: context.organizationMemberId,
        actorDeviceId: context.deviceId,
        locationId: context.locationId,
      },
    });
    let projection: ProjectionState = {
      currentCycleStampCount: 0,
      completedCycleCount: 0,
      rewardReady: false,
      projectionVersion: 0,
      lastSourceEventId: null,
    };
    const ledgerIds: string[] = [];
    const issue = await this.appendEntry(transaction, {
      membership,
      projection,
      commandId,
      eventType: "STAMP_ISSUED",
      stampDelta: scenario.targetProgress,
      occurredAt,
      context,
      goal: rule.requiredStampCount,
      safeMetadata: { reviewFixture: true, scenarioId: scenario.id },
    });
    projection = issue.projection;
    ledgerIds.push(issue.id);
    const thresholds = membership.enrollmentProgramVersion.rewards
      .filter((reward) => reward.thresholdStampCount <= scenario.targetProgress)
      .sort((left, right) => left.thresholdStampCount - right.thresholdStampCount);
    for (const reward of thresholds) {
      const entitlementId = randomUUID();
      const unlock = await this.appendEntry(transaction, {
        membership,
        projection,
        commandId,
        eventType:
          reward.thresholdStampCount === rule.requiredStampCount
            ? "FINAL_REWARD_UNLOCKED"
            : "MILESTONE_REWARD_UNLOCKED",
        stampDelta: 0,
        rewardEntitlementId: entitlementId,
        occurredAt: new Date(occurredAt.getTime() + ledgerIds.length * 1_000),
        context,
        goal: rule.requiredStampCount,
        safeMetadata: {
          reviewFixture: true,
          scenarioId: scenario.id,
          rewardDefinitionId: reward.id,
          threshold: reward.thresholdStampCount,
        },
      });
      projection = unlock.projection;
      ledgerIds.push(unlock.id);
      await transaction.rewardEntitlement.create({
        data: {
          id: entitlementId,
          organizationId: membership.organizationId,
          membershipId: membership.id,
          programVersionId: membership.enrollmentProgramVersionId,
          rewardDefinitionId: reward.id,
          cycleNumber: 1,
          threshold: reward.thresholdStampCount,
          maximumRedemptionCount: reward.maximumRedemptionsPerEarned,
          unlockedByLedgerEntryId: unlock.id,
          unlockedAt: unlock.occurredAt,
          expiresAt: reward.validityDurationDays
            ? new Date(unlock.occurredAt.getTime() + reward.validityDurationDays * 86_400_000)
            : null,
        },
      });
    }
    await transaction.membershipProgressProjection.update({
      where: { membershipId: membership.id },
      data: {
        currentCycleStampCount: projection.currentCycleStampCount,
        completedCycleCount: projection.completedCycleCount,
        currentCycleNumber: projection.completedCycleCount + 1,
        rewardReady: projection.rewardReady,
        projectionVersion: projection.projectionVersion,
        lastLedgerSequence: projection.projectionVersion,
        lastSourceEventId: projection.lastSourceEventId,
        projectionFingerprint: this.digest(projection),
      },
    });
    await transaction.loyaltyOperationCommand.update({
      where: { id: commandId },
      data: {
        status: "COMPLETED",
        resultLedgerEntryIds: ledgerIds,
        resultProjectionVersion: projection.projectionVersion,
        resultPayload: {
          reviewFixture: true,
          progress: projection.currentCycleStampCount,
          rewardReady: projection.rewardReady,
        },
        completedAt: occurredAt,
      },
    });
  }

  private async appendEntry(
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
      eventType: "STAMP_ISSUED" | "MILESTONE_REWARD_UNLOCKED" | "FINAL_REWARD_UNLOCKED";
      stampDelta: number;
      rewardEntitlementId?: string;
      occurredAt: Date;
      context: StaffContext;
      goal: number;
      safeMetadata: Record<string, unknown>;
    },
  ) {
    const id = randomUUID();
    const sequence = input.projection.projectionVersion + 1;
    const localDate = operationalLocalDate(input.occurredAt, "Asia/Baghdad");
    const previous = await transaction.loyaltyLedgerEntry.findFirst({
      where: { membershipId: input.membership.id },
      orderBy: { membershipSequence: "desc" },
      select: { entryHash: true },
    });
    const payload = {
      id,
      organizationId: input.membership.organizationId,
      membershipId: input.membership.id,
      customerId: input.membership.customerId,
      programId: input.membership.programId,
      programVersionId: input.membership.enrollmentProgramVersionId,
      locationId: input.context.locationId,
      staffOrganizationMemberId: input.context.organizationMemberId,
      staffDeviceId: input.context.deviceId,
      eventType: input.eventType,
      membershipSequence: sequence,
      cycleNumber: 1,
      stampDelta: input.stampDelta,
      rewardEntitlementId: input.rewardEntitlementId ?? null,
      rewardRedemptionId: null,
      reversalOfEntryId: null,
      operationCommandId: input.commandId,
      purchaseAmountMinor: null,
      purchaseCurrency: null,
      merchantTransactionReference: null,
      operationalTimezone: "Asia/Baghdad",
      operationalLocalDate: localDate,
      occurredAt: input.occurredAt.toISOString(),
      safeMetadata: input.safeMetadata,
      previousEntryHash: previous?.entryHash ?? LEDGER_GENESIS_HASH,
    } as const;
    const projection = reduceProjectionEvent(
      input.projection,
      {
        id,
        eventType: input.eventType,
        membershipSequence: sequence,
        cycleNumber: 1,
        stampDelta: input.stampDelta,
      },
      { requiredStampCount: input.goal },
    );
    await transaction.loyaltyLedgerEntry.create({
      data: {
        id,
        organizationId: input.membership.organizationId,
        membershipId: input.membership.id,
        customerId: input.membership.customerId,
        programId: input.membership.programId,
        programVersionId: input.membership.enrollmentProgramVersionId,
        locationId: input.context.locationId,
        staffOrganizationMemberId: input.context.organizationMemberId,
        staffDeviceId: input.context.deviceId,
        eventType: input.eventType,
        membershipSequence: sequence,
        cycleNumber: 1,
        stampDelta: input.stampDelta,
        rewardEntitlementId: input.rewardEntitlementId ?? null,
        operationCommandId: input.commandId,
        operationalTimezone: "Asia/Baghdad",
        operationalLocalDate: new Date(`${localDate}T00:00:00.000Z`),
        occurredAt: input.occurredAt,
        safeMetadata: input.safeMetadata as Prisma.InputJsonValue,
        ledgerHashVersion: 1,
        previousEntryHash: payload.previousEntryHash,
        entryHash: calculateLedgerEntryHash(payload, this.environment.values.LEDGER_HASH_SECRET_V1),
      },
    });
    return { id, occurredAt: input.occurredAt, projection };
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  }
}

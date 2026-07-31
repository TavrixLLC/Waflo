import { createHash, randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { IssueStampInput, RedeemRewardInput, ReverseOperationInput } from "@waflo/contracts";
import {
  type LoyaltyLedgerEventType,
  type ProjectionState,
  calculateLedgerEntryHash,
  canonicalJson,
  crossedRewardThresholds,
  LEDGER_GENESIS_HASH,
  reduceProjectionEvent,
  rebuildProjection,
  validateReversal,
  verifyLedgerHashChain,
} from "@waflo/loyalty-ledger";
import {
  assertOperationalEligibility,
  assertRewardRedeemable,
  evaluateStampPolicy,
  grossPositiveDailyStampUnits,
  LoyaltyPolicyError,
  normalizeResetBehavior,
  operationalLocalDate,
} from "@waflo/loyalty-policy";
import {
  digestMerchantTransactionReference,
  evaluateRiskRules,
  riskDeduplicationKey,
} from "@waflo/operational-analytics";
import {
  type LoyaltyOperationType,
  type Prisma,
  queueWalletPassStateChange,
} from "@waflo/database";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withOrderedInvariantLocks } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { CustomerSecurityService } from "../customer/customer-security.service.js";
import { PrismaService } from "../database/prisma.service.js";

interface StaffOperationContext {
  readonly organizationId: string;
  readonly organizationMemberId: string;
  readonly role: "OWNER" | "MANAGER" | "STAFF";
  readonly locationId: string;
  readonly deviceId: string;
  readonly devicePublicId: string;
  readonly deviceSessionId: string;
  readonly platform: "IOS" | "ANDROID" | "TEST_CLIENT";
  readonly requestId: string;
}

interface LedgerAppendContext {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly customerId: string;
  readonly programId: string;
  readonly programVersionId: string;
  readonly locationId: string | null;
  readonly staffOrganizationMemberId: string | null;
  readonly staffDeviceId: string | null;
  readonly operationCommandId: string;
  readonly operationalTimezone: string;
  readonly occurredAt: Date;
  readonly purchaseAmountMinor?: number | null;
  readonly purchaseCurrency?: string | null;
  readonly merchantTransactionReference?: string | null;
  readonly merchantTransactionReferenceKeyVersion?: number | null;
  readonly merchantTransactionReferenceNormalizationVersion?: number | null;
}

interface AppendInput {
  readonly eventType: LoyaltyLedgerEventType;
  readonly stampDelta?: number;
  readonly rewardEntitlementId?: string | null;
  readonly rewardRedemptionId?: string | null;
  readonly reversalOfEntryId?: string | null;
  readonly safeMetadata?: Readonly<Record<string, unknown>>;
}

function operationFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function projectionFingerprint(value: ProjectionState): string {
  return operationFingerprint({
    currentCycleStampCount: value.currentCycleStampCount,
    completedCycleCount: value.completedCycleCount,
    rewardReady: value.rewardReady,
    projectionVersion: value.projectionVersion,
    lastSourceEventId: value.lastSourceEventId,
  });
}

function safeQrFingerprint(qrPayload: string): string {
  return createHash("sha256").update(qrPayload, "utf8").digest("hex");
}

function policyError(error: unknown): never {
  if (error instanceof LoyaltyPolicyError) {
    const conflictCodes = new Set([
      "FINAL_REWARD_PENDING_REDEMPTION",
      "REWARD_ALREADY_REDEEMED",
      "DAILY_STAMP_LIMIT_REACHED",
      "OPERATION_IDEMPOTENCY_CONFLICT",
    ]);
    const forbiddenCodes = new Set(["LOCATION_NOT_AUTHORIZED", "STAFF_ASSIGNMENT_REQUIRED"]);
    throw new AppError(
      error.code,
      error.message,
      conflictCodes.has(error.code)
        ? HttpStatus.CONFLICT
        : forbiddenCodes.has(error.code)
          ? HttpStatus.FORBIDDEN
          : HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw error;
}

@Injectable()
export class LoyaltyOperationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerSecurity: CustomerSecurityService,
    private readonly environment: EnvironmentService,
    private readonly audit: AuditService,
  ) {}

  async resolveMembership(context: StaffOperationContext, qrPayload: string) {
    const credential = await this.customerSecurity.verifyCredentialPayload(qrPayload);
    if (!credential || credential.organizationId !== context.organizationId) {
      throw new AppError(
        "MEMBERSHIP_CREDENTIAL_INVALID",
        "Membership credential is invalid.",
        HttpStatus.NOT_FOUND,
      );
    }
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: credential.membershipId },
      include: {
        customer: true,
        program: true,
        progress: true,
        enrollmentProgramVersion: {
          include: {
            stampRule: true,
            translations: true,
            rewards: { include: { translations: true }, orderBy: { thresholdStampCount: "asc" } },
            locations: { where: { locationId: context.locationId } },
          },
        },
        organization: { include: { billingProfile: true } },
      },
    });
    if (!membership?.progress || !membership.enrollmentProgramVersion.stampRule) {
      throw new AppError(
        "MEMBERSHIP_NOT_OPERATIONAL",
        "Membership is not operational.",
        HttpStatus.CONFLICT,
      );
    }
    const authorization = await this.locationAuthorization(context);
    const programLocation = membership.enrollmentProgramVersion.locations[0];
    try {
      assertOperationalEligibility(
        {
          organizationStatus: membership.organization.status,
          billingStatus:
            membership.organization.billingProfile?.subscriptionStatus ?? "PENDING_ACTIVATION",
          programStatus: membership.program.status,
          membershipStatus: membership.status,
          credentialStatus: credential.status,
          membershipProgramVersionId: membership.enrollmentProgramVersionId,
          resolvedProgramVersionId: membership.enrollmentProgramVersion.id,
          locationActive: authorization.locationActive,
          staffAssignmentActive: authorization.staffAssignmentActive,
          deviceAssignmentActive: authorization.deviceAssignmentActive,
          earningEnabled:
            Boolean(programLocation?.earningEnabled) &&
            authorization.staffEarningAllowed &&
            authorization.deviceEarningAllowed,
          redemptionEnabled:
            Boolean(programLocation?.redemptionEnabled) &&
            authorization.staffRedemptionAllowed &&
            authorization.deviceRedemptionAllowed,
        },
        "EARN",
      );
    } catch (error) {
      policyError(error);
    }
    const locale = membership.customer.preferredLocale;
    const translation =
      membership.enrollmentProgramVersion.translations.find(
        (candidate) => candidate.locale === locale,
      ) ?? membership.enrollmentProgramVersion.translations[0];
    return {
      membershipPublicId: membership.publicMembershipId,
      customerDisplayName: membership.customer.displayName,
      programName: translation?.programName ?? membership.program.internalName,
      progress: membership.progress.currentCycleStampCount,
      goal: membership.enrollmentProgramVersion.stampRule.requiredStampCount,
      rewardReady: membership.progress.rewardReady,
      completedCycles: membership.progress.completedCycleCount,
      membershipStatus: membership.status,
      locationEligibility: {
        earning: Boolean(programLocation?.earningEnabled) && authorization.deviceEarningAllowed,
        redemption:
          Boolean(programLocation?.redemptionEnabled) && authorization.deviceRedemptionAllowed,
      },
      availableRewards: await this.prisma.client.rewardEntitlement.findMany({
        where: {
          membershipId: membership.id,
          status: { in: ["AVAILABLE", "PARTIALLY_REDEEMED"] },
        },
        select: {
          publicId: true,
          threshold: true,
          status: true,
          redemptionCount: true,
          maximumRedemptionCount: true,
          expiresAt: true,
          rewardDefinitionId: true,
        },
        orderBy: { threshold: "asc" },
      }),
    };
  }

  async issueStamps(
    context: StaffOperationContext,
    commandId: string,
    input: IssueStampInput,
    request: WafloRequest,
  ) {
    const credential = await this.customerSecurity.verifyCredentialPayload(input.qrPayload);
    if (!credential || credential.organizationId !== context.organizationId) {
      throw new AppError(
        "MEMBERSHIP_CREDENTIAL_INVALID",
        "Membership credential is invalid.",
        HttpStatus.NOT_FOUND,
      );
    }
    const transactionReference = input.merchantTransactionReference
      ? digestMerchantTransactionReference({
          reference: input.merchantTransactionReference,
          key: this.environment.values.MERCHANT_TRANSACTION_REFERENCE_HMAC_KEY_V1,
          keyVersion: this.environment.values.MERCHANT_TRANSACTION_REFERENCE_ACTIVE_KEY_VERSION,
        })
      : null;
    const fingerprint = operationFingerprint({
      type: "ISSUE_STAMP",
      qr: safeQrFingerprint(input.qrPayload),
      amount: input.amount,
      purchaseAmountMinor: input.purchaseAmountMinor ?? null,
      purchaseCurrency: input.purchaseCurrency ?? null,
      merchantTransactionReferenceDigest: transactionReference?.digest ?? null,
      managerOverride: input.managerOverride ?? null,
    });
    const claim = await this.claimDurableCommand({
      organizationId: context.organizationId,
      programId: credential.membership.programId,
      membershipId: credential.membershipId,
      operationType: "ISSUE_STAMP",
      commandId,
      fingerprint,
      actorMemberId: context.organizationMemberId,
      actorDeviceId: context.deviceId,
      locationId: context.locationId,
    });
    if (claim.replayed) return claim.result;
    try {
      return await withOrderedInvariantLocks(
        this.prisma.client,
        [
          `organization:${context.organizationId}`,
          `program-lifecycle:${credential.membership.programId}`,
          `membership:${credential.membershipId}`,
          `operation:${context.organizationId}:${commandId}`,
          `device:${context.deviceId}`,
        ],
        async (transaction) => {
          const replay = await this.replayOrCreateCommand(transaction, {
            organizationId: context.organizationId,
            membershipId: credential.membershipId,
            operationType: "ISSUE_STAMP",
            commandId,
            fingerprint,
            context,
            leaseOwner: claim.leaseOwner,
          });
          if (replay.replayed) return replay.result;
          const membership = await this.operationalMembership(
            transaction,
            credential.membershipId,
            context,
            "EARN",
          );
          if (membership.activeCredential?.id !== credential.id) {
            throw new AppError(
              "MEMBERSHIP_CREDENTIAL_INVALID",
              "Membership credential is no longer active.",
              HttpStatus.CONFLICT,
            );
          }
          const stampRule = membership.enrollmentProgramVersion.stampRule;
          if (!stampRule || !membership.progress) {
            throw new AppError(
              "PROGRAM_NOT_OPERATIONAL",
              "Program stamp policy is unavailable.",
              HttpStatus.CONFLICT,
            );
          }
          const now = new Date();
          const localDate = operationalLocalDate(
            now,
            membership.enrollmentProgramVersion.operationalTimezone,
          );
          const dailyEntries = await transaction.loyaltyLedgerEntry.findMany({
            where: {
              membershipId: membership.id,
              programVersionId: membership.enrollmentProgramVersionId,
              operationalLocalDate: new Date(`${localDate}T00:00:00.000Z`),
              eventType: { in: ["STAMP_ISSUED", "MANUAL_STAMP_ADJUSTMENT"] },
              stampDelta: { gt: 0 },
            },
            select: { eventType: true, stampDelta: true, operationalLocalDate: true },
          });
          let decision: ReturnType<typeof evaluateStampPolicy>;
          try {
            decision = evaluateStampPolicy(
              {
                requiredStampCount: stampRule.requiredStampCount,
                maximumStampsPerOperation: stampRule.maximumStampsPerOperation,
                maximumStampsPerCustomerPerDay: stampRule.maximumStampsPerCustomerPerDay,
                minimumPurchaseAmountMinor: stampRule.minimumPurchaseAmountMinor,
                minimumPurchaseCurrency: stampRule.minimumPurchaseCurrency,
                operationalTimezone: membership.enrollmentProgramVersion.operationalTimezone,
                resetBehaviorAfterReward: normalizeResetBehavior(
                  stampRule.resetBehaviorAfterReward,
                ),
              },
              {
                requestedStamps: input.amount,
                currentCycleStampCount: membership.progress.currentCycleStampCount,
                rewardReady: membership.progress.rewardReady,
                grossPositiveStampsIssuedToday: grossPositiveDailyStampUnits(
                  dailyEntries.map((entry) => ({
                    eventType: entry.eventType,
                    stampDelta: entry.stampDelta,
                    operationalLocalDate: entry.operationalLocalDate.toISOString().slice(0, 10),
                  })),
                  localDate,
                ),
                purchaseAmountMinor: input.purchaseAmountMinor ?? null,
                purchaseCurrency: input.purchaseCurrency ?? null,
                managerOverride: input.managerOverride
                  ? {
                      dailyCap: input.managerOverride.dailyCap,
                      purchasePolicy: input.managerOverride.purchasePolicy,
                      reason: input.managerOverride.reason,
                      permitted: await this.managerOverrideValid(
                        transaction,
                        context,
                        input.managerOverride.approvalPublicId,
                        membership.id,
                      ),
                    }
                  : null,
              },
            );
          } catch (error) {
            policyError(error);
          }
          let projection = this.projectionState(membership.progress);
          const appendContext: LedgerAppendContext = {
            organizationId: membership.organizationId,
            membershipId: membership.id,
            customerId: membership.customerId,
            programId: membership.programId,
            programVersionId: membership.enrollmentProgramVersionId,
            locationId: context.locationId,
            staffOrganizationMemberId: context.organizationMemberId,
            staffDeviceId: context.deviceId,
            operationCommandId: replay.command.id,
            operationalTimezone: membership.enrollmentProgramVersion.operationalTimezone,
            occurredAt: now,
            purchaseAmountMinor: input.purchaseAmountMinor ?? null,
            purchaseCurrency: input.purchaseCurrency ?? null,
            merchantTransactionReference: transactionReference?.digest ?? null,
            merchantTransactionReferenceKeyVersion: transactionReference?.keyVersion ?? null,
            merchantTransactionReferenceNormalizationVersion:
              transactionReference?.normalizationVersion ?? null,
          };
          if (transactionReference) {
            const duplicate = await transaction.loyaltyLedgerEntry.findFirst({
              where: {
                organizationId: membership.organizationId,
                programId: membership.programId,
                locationId: context.locationId,
                merchantTransactionReference: transactionReference.digest,
                merchantTransactionReferenceKeyVersion: transactionReference.keyVersion,
                eventType: "STAMP_ISSUED",
                occurredAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
              },
              select: { id: true },
            });
            const risk = evaluateRiskRules({ duplicateTransactionReference: Boolean(duplicate) });
            await this.persistRiskDecisions(
              transaction,
              membership,
              context,
              replay.command.id,
              risk.signals,
            );
            if (risk.hardBlock) {
              throw new AppError(
                risk.errorCode ?? "RISK_HARD_BLOCK",
                "Duplicate transaction reference.",
                409,
              );
            }
          }
          await this.evaluateAndPersistOperationalRisk(
            transaction,
            membership,
            context,
            replay.command.id,
            "STAMP",
            {
              dailyCapOverride: decision.dailyCapOverridden,
              purchasePolicyOverride: decision.purchasePolicyOverridden,
            },
          );
          const entryIds: string[] = [];
          const issued = await this.appendEntry(transaction, appendContext, projection, {
            eventType: "STAMP_ISSUED",
            stampDelta: input.amount,
            safeMetadata: {
              dailyCapOverridden: decision.dailyCapOverridden,
              purchasePolicyOverridden: decision.purchasePolicyOverridden,
              clientObservedAt: input.clientObservedAt ?? null,
            },
          });
          projection = issued.projection;
          entryIds.push(issued.entry.id);

          const crossed = crossedRewardThresholds(
            membership.progress.currentCycleStampCount,
            decision.nextCycleStampCount,
            membership.enrollmentProgramVersion.rewards.map((reward) => ({
              rewardDefinitionId: reward.id,
              threshold: reward.thresholdStampCount,
              final: reward.thresholdStampCount === stampRule.requiredStampCount,
            })),
          );
          const entitlements: Array<{
            publicId: string;
            threshold: number;
            status: string;
            final: boolean;
          }> = [];
          for (const threshold of crossed) {
            const reward = membership.enrollmentProgramVersion.rewards.find(
              (candidate) => candidate.id === threshold.rewardDefinitionId,
            );
            if (!reward) continue;
            const entitlementId = randomUUID();
            const unlock = await this.appendEntry(transaction, appendContext, projection, {
              eventType: threshold.final ? "FINAL_REWARD_UNLOCKED" : "MILESTONE_REWARD_UNLOCKED",
              rewardEntitlementId: entitlementId,
              safeMetadata: {
                rewardDefinitionId: reward.id,
                threshold: reward.thresholdStampCount,
              },
            });
            projection = unlock.projection;
            entryIds.push(unlock.entry.id);
            const entitlement = await transaction.rewardEntitlement.create({
              data: {
                id: entitlementId,
                organizationId: membership.organizationId,
                membershipId: membership.id,
                programVersionId: membership.enrollmentProgramVersionId,
                rewardDefinitionId: reward.id,
                cycleNumber: membership.progress.currentCycleNumber,
                threshold: reward.thresholdStampCount,
                maximumRedemptionCount:
                  reward.thresholdStampCount === stampRule.requiredStampCount
                    ? 1
                    : reward.maximumRedemptionsPerEarned,
                unlockedByLedgerEntryId: unlock.entry.id,
                unlockedAt: now,
                expiresAt:
                  reward.thresholdStampCount === stampRule.requiredStampCount ||
                  reward.validityDurationDays === null
                    ? null
                    : new Date(now.getTime() + reward.validityDurationDays * 86_400_000),
              },
            });
            entitlements.push({
              publicId: entitlement.publicId,
              threshold: entitlement.threshold,
              status: entitlement.status,
              final: threshold.final,
            });
            await this.audit.recordInTransaction(
              transaction,
              {
                organizationId: membership.organizationId,
                action: "reward.unlocked",
                targetType: "reward_entitlement",
                targetId: entitlement.id,
                locationId: context.locationId,
                metadata: {
                  operationPublicId: replay.command.publicId,
                  threshold: entitlement.threshold,
                  final: threshold.final,
                },
              },
              request,
            );
          }
          await this.persistProjection(transaction, membership.id, projection);
          await this.queueWalletUpdates(
            transaction,
            membership.walletPassInstances.map((pass) => pass.id),
            `loyalty-operation:${replay.command.id}`,
            "STAMP_ISSUED",
            projection,
          );
          if (decision.dailyCapOverridden || decision.purchasePolicyOverridden) {
            await this.createRiskSignal(transaction, membership, context, replay.command.id, {
              ruleCode: decision.dailyCapOverridden
                ? "DAILY_CAP_OVERRIDE"
                : "PURCHASE_THRESHOLD_OVERRIDE",
              severity: "MEDIUM",
              score: 55,
              evidence: {
                dailyCapOverridden: decision.dailyCapOverridden,
                purchasePolicyOverridden: decision.purchasePolicyOverridden,
              },
            });
          }
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId: membership.organizationId,
              action: "ledger.stamp_issued",
              targetType: "membership",
              targetId: membership.id,
              locationId: context.locationId,
              metadata: {
                operationPublicId: replay.command.publicId,
                stamps: input.amount,
                projectionVersion: projection.projectionVersion,
              },
            },
            request,
          );
          const result = {
            operationPublicId: replay.command.publicId,
            replayed: false,
            progress: projection.currentCycleStampCount,
            goal: stampRule.requiredStampCount,
            rewardReady: projection.rewardReady,
            completedCycles: projection.completedCycleCount,
            projectionVersion: projection.projectionVersion,
            unlockedRewards: entitlements,
          };
          await transaction.loyaltyOperationCommand.update({
            where: { id: replay.command.id },
            data: {
              status: "COMPLETED",
              resultLedgerEntryIds: entryIds,
              resultProjectionVersion: projection.projectionVersion,
              resultPayload: result,
              completedAt: new Date(),
            },
          });
          return result;
        },
      );
    } catch (error) {
      await this.persistCommandFailure(
        context.organizationId,
        commandId,
        fingerprint,
        claim.leaseOwner,
        error,
      );
      throw error;
    }
  }

  async redeemReward(
    context: StaffOperationContext,
    commandId: string,
    input: RedeemRewardInput,
    request: WafloRequest,
  ) {
    const credential = await this.customerSecurity.verifyCredentialPayload(input.qrPayload);
    if (!credential || credential.organizationId !== context.organizationId) {
      throw new AppError(
        "MEMBERSHIP_CREDENTIAL_INVALID",
        "Membership credential is invalid.",
        HttpStatus.NOT_FOUND,
      );
    }
    const fingerprint = operationFingerprint({
      type: "REDEEM_REWARD",
      qr: safeQrFingerprint(input.qrPayload),
      entitlement: input.rewardEntitlementPublicId,
      approval: input.managerApprovalPublicId ?? null,
      note: input.note ?? null,
    });
    const claim = await this.claimDurableCommand({
      organizationId: context.organizationId,
      programId: credential.membership.programId,
      membershipId: credential.membershipId,
      operationType: "REDEEM_REWARD",
      commandId,
      fingerprint,
      actorMemberId: context.organizationMemberId,
      actorDeviceId: context.deviceId,
      locationId: context.locationId,
    });
    if (claim.replayed) return claim.result;
    try {
      return await withOrderedInvariantLocks(
        this.prisma.client,
        [
          `organization:${context.organizationId}`,
          `program-lifecycle:${credential.membership.programId}`,
          `membership:${credential.membershipId}`,
          `operation:${context.organizationId}:${commandId}`,
          `device:${context.deviceId}`,
        ],
        async (transaction) => {
          const commandState = await this.replayOrCreateCommand(transaction, {
            organizationId: context.organizationId,
            membershipId: credential.membershipId,
            operationType: "REDEEM_REWARD",
            commandId,
            fingerprint,
            context,
            leaseOwner: claim.leaseOwner,
          });
          if (commandState.replayed) return commandState.result;
          const membership = await this.operationalMembership(
            transaction,
            credential.membershipId,
            context,
            "REDEEM",
          );
          if (!membership.progress || !membership.enrollmentProgramVersion.stampRule) {
            throw new AppError("PROGRAM_NOT_OPERATIONAL", "Program policy is unavailable.", 409);
          }
          const entitlement = await transaction.rewardEntitlement.findFirst({
            where: {
              publicId: input.rewardEntitlementPublicId,
              organizationId: context.organizationId,
              membershipId: membership.id,
            },
          });
          if (!entitlement) {
            throw new AppError("REWARD_NOT_AVAILABLE", "Reward is not available.", 404);
          }
          const reward = membership.enrollmentProgramVersion.rewards.find(
            (candidate) => candidate.id === entitlement.rewardDefinitionId,
          );
          if (!reward) {
            throw new AppError("PROGRAM_VERSION_MISMATCH", "Reward version mismatch.", 409);
          }
          const approvalValid = reward.requiresManagerApproval
            ? await this.managerOverrideValid(
                transaction,
                context,
                input.managerApprovalPublicId ?? "",
                membership.id,
                entitlement.id,
                fingerprint,
              )
            : true;
          await this.evaluateAndPersistOperationalRisk(
            transaction,
            membership,
            context,
            commandState.command.id,
            "REDEEM",
          );
          try {
            assertRewardRedeemable(
              {
                entitlementStatus: entitlement.status,
                redemptionCount: entitlement.redemptionCount,
                maximumRedemptionCount: entitlement.maximumRedemptionCount,
                expiresAt: entitlement.expiresAt,
                requiresManagerApproval: reward.requiresManagerApproval,
                managerApprovalValid: approvalValid,
              },
              new Date(),
            );
          } catch (error) {
            policyError(error);
          }
          const now = new Date();
          const redemptionId = randomUUID();
          const redemption = await transaction.rewardRedemption.create({
            data: {
              id: redemptionId,
              organizationId: membership.organizationId,
              membershipId: membership.id,
              rewardEntitlementId: entitlement.id,
              rewardDefinitionId: entitlement.rewardDefinitionId,
              cycleNumber: entitlement.cycleNumber,
              entitlementSequence: entitlement.redemptionCount + 1,
              locationId: context.locationId,
              staffMemberId: context.organizationMemberId,
              staffDeviceId: context.deviceId,
              operationCommandId: commandState.command.id,
              redeemedAt: now,
              ...(input.note ? { safeMetadata: { note: input.note } } : {}),
            },
          });
          let projection = this.projectionState(membership.progress);
          const appendContext: LedgerAppendContext = {
            organizationId: membership.organizationId,
            membershipId: membership.id,
            customerId: membership.customerId,
            programId: membership.programId,
            programVersionId: membership.enrollmentProgramVersionId,
            locationId: context.locationId,
            staffOrganizationMemberId: context.organizationMemberId,
            staffDeviceId: context.deviceId,
            operationCommandId: commandState.command.id,
            operationalTimezone: membership.enrollmentProgramVersion.operationalTimezone,
            occurredAt: now,
          };
          const entryIds: string[] = [];
          const redeemed = await this.appendEntry(transaction, appendContext, projection, {
            eventType: "REWARD_REDEEMED",
            rewardEntitlementId: entitlement.id,
            rewardRedemptionId: redemption.id,
            safeMetadata: { rewardDefinitionId: reward.id, threshold: entitlement.threshold },
          });
          projection = redeemed.projection;
          entryIds.push(redeemed.entry.id);
          const final =
            entitlement.threshold ===
            membership.enrollmentProgramVersion.stampRule.requiredStampCount;
          if (final) {
            const reset = await this.appendEntry(transaction, appendContext, projection, {
              eventType: "CYCLE_RESET",
              rewardEntitlementId: entitlement.id,
              rewardRedemptionId: redemption.id,
              safeMetadata: { completedCycle: entitlement.cycleNumber },
            });
            projection = reset.projection;
            entryIds.push(reset.entry.id);
          }
          const nextRedemptionCount = entitlement.redemptionCount + 1;
          await transaction.rewardEntitlement.update({
            where: { id: entitlement.id },
            data: {
              redemptionCount: nextRedemptionCount,
              status:
                nextRedemptionCount >= entitlement.maximumRedemptionCount
                  ? "REDEEMED"
                  : "PARTIALLY_REDEEMED",
              fullyRedeemedAt:
                nextRedemptionCount >= entitlement.maximumRedemptionCount ? now : null,
            },
          });
          if (reward.requiresManagerApproval && input.managerApprovalPublicId) {
            await transaction.managerApprovalChallenge.updateMany({
              where: {
                publicId: input.managerApprovalPublicId,
                status: "APPROVED",
                consumedAt: null,
              },
              data: { status: "CONSUMED", consumedAt: now },
            });
          }
          await this.persistProjection(transaction, membership.id, projection);
          await this.queueWalletUpdates(
            transaction,
            membership.walletPassInstances.map((pass) => pass.id),
            `loyalty-operation:${commandState.command.id}`,
            final ? "FINAL_REWARD_REDEEMED" : "MILESTONE_REWARD_REDEEMED",
            projection,
          );
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId: membership.organizationId,
              action: "reward.redeemed",
              targetType: "reward_redemption",
              targetId: redemption.id,
              locationId: context.locationId,
              metadata: {
                operationPublicId: commandState.command.publicId,
                final,
                projectionVersion: projection.projectionVersion,
              },
            },
            request,
          );
          if (final) {
            await this.audit.recordInTransaction(
              transaction,
              {
                organizationId: membership.organizationId,
                action: "membership.cycle_reset",
                targetType: "membership",
                targetId: membership.id,
                locationId: context.locationId,
                metadata: {
                  completedCycles: projection.completedCycleCount,
                  projectionVersion: projection.projectionVersion,
                },
              },
              request,
            );
          }
          const result = {
            operationPublicId: commandState.command.publicId,
            replayed: false,
            redemptionPublicId: redemption.publicId,
            rewardStatus:
              nextRedemptionCount >= entitlement.maximumRedemptionCount
                ? ("REDEEMED" as const)
                : ("PARTIALLY_REDEEMED" as const),
            finalReward: final,
            progress: projection.currentCycleStampCount,
            goal: membership.enrollmentProgramVersion.stampRule.requiredStampCount,
            rewardReady: projection.rewardReady,
            completedCycles: projection.completedCycleCount,
            projectionVersion: projection.projectionVersion,
          };
          await transaction.loyaltyOperationCommand.update({
            where: { id: commandState.command.id },
            data: {
              status: "COMPLETED",
              resultLedgerEntryIds: entryIds,
              resultProjectionVersion: projection.projectionVersion,
              resultPayload: result,
              completedAt: now,
            },
          });
          return result;
        },
      );
    } catch (error) {
      await this.persistCommandFailure(
        context.organizationId,
        commandId,
        fingerprint,
        claim.leaseOwner,
        error,
      );
      throw error;
    }
  }

  async reverseOperation(
    context: StaffOperationContext,
    commandId: string,
    input: ReverseOperationInput,
    request: WafloRequest,
  ) {
    const original = await this.prisma.client.loyaltyOperationCommand.findFirst({
      where: { publicId: input.operationPublicId, organizationId: context.organizationId },
    });
    if (!original) throw new AppError("OPERATION_NOT_REVERSIBLE", "Operation not found.", 404);
    const originalMembership = await this.prisma.client.membership.findFirst({
      where: { id: original.membershipId, organizationId: context.organizationId },
      select: { programId: true },
    });
    if (!originalMembership) {
      throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership is unavailable.", 409);
    }
    const reversalOperationType: LoyaltyOperationType =
      original.operationType === "REDEEM_REWARD" ? "REVERSE_REDEMPTION" : "REVERSE_STAMP";
    const fingerprint = operationFingerprint({
      type: "REVERSE",
      original: input.operationPublicId,
      reason: input.reason ?? null,
    });
    const claim = await this.claimDurableCommand({
      organizationId: context.organizationId,
      programId: originalMembership.programId,
      membershipId: original.membershipId,
      operationType: reversalOperationType,
      commandId,
      fingerprint,
      actorMemberId: context.organizationMemberId,
      actorDeviceId: context.deviceId,
      locationId: context.locationId,
    });
    if (claim.replayed) return claim.result;
    try {
      return await withOrderedInvariantLocks(
        this.prisma.client,
        [
          `organization:${context.organizationId}`,
          `program-lifecycle:${originalMembership.programId}`,
          `membership:${original.membershipId}`,
          `operation:${context.organizationId}:${commandId}`,
          `device:${context.deviceId}`,
        ],
        async (transaction) => {
          const sourceEntries = await transaction.loyaltyLedgerEntry.findMany({
            where: { operationCommandId: original.id },
            orderBy: { membershipSequence: "asc" },
          });
          const source = sourceEntries.find((entry) =>
            ["STAMP_ISSUED", "REWARD_REDEEMED"].includes(entry.eventType),
          );
          if (!source) {
            throw new AppError("OPERATION_NOT_REVERSIBLE", "Operation is not reversible.", 409);
          }
          const later = await transaction.loyaltyLedgerEntry.findMany({
            where: {
              membershipId: original.membershipId,
              membershipSequence: { gt: source.membershipSequence },
              operationCommandId: { not: original.id },
            },
            select: { id: true, eventType: true },
          });
          const unlockedIds = sourceEntries
            .map((entry) => entry.rewardEntitlementId)
            .filter((id): id is string => Boolean(id));
          const redeemedEntitlement = await transaction.rewardEntitlement.findFirst({
            where: { id: { in: unlockedIds }, redemptionCount: { gt: 0 } },
          });
          const actorKind =
            context.role === "OWNER" || context.role === "MANAGER" ? "MANAGER" : "STAFF_OWN";
          const decision = validateReversal(
            {
              eventType: source.eventType,
              occurredAt: source.occurredAt,
              staffOrganizationMemberId: source.staffOrganizationMemberId,
              staffDeviceId: source.staffDeviceId,
              alreadyReversed: Boolean(
                await transaction.loyaltyLedgerEntry.findFirst({
                  where: { reversalOfEntryId: source.id },
                }),
              ),
              hasDependentEvents: later.length > 0,
              unlockedRewardRedeemed:
                source.eventType === "STAMP_ISSUED" && Boolean(redeemedEntitlement),
            },
            {
              now: new Date(),
              actorKind,
              actorStaffOrganizationMemberId: context.organizationMemberId,
              actorStaffDeviceId: context.deviceId,
              staffWindowSeconds: this.environment.values.STAFF_OWN_REVERSAL_WINDOW_SECONDS,
              managerWindowMinutes: this.environment.values.MANAGER_REVERSAL_WINDOW_MINUTES,
              ...(input.reason ? { reason: input.reason } : {}),
            },
          );
          if (!decision.allowed) {
            throw new AppError(decision.code, "Operation cannot be reversed.", HttpStatus.CONFLICT);
          }
          const commandState = await this.replayOrCreateCommand(transaction, {
            organizationId: context.organizationId,
            membershipId: original.membershipId,
            operationType: reversalOperationType,
            commandId,
            fingerprint,
            context,
            leaseOwner: claim.leaseOwner,
          });
          if (commandState.replayed) return commandState.result;
          const membership = await this.operationalMembership(
            transaction,
            original.membershipId,
            context,
            source.eventType === "STAMP_ISSUED" ? "EARN" : "REDEEM",
          );
          if (!membership?.progress || !membership.enrollmentProgramVersion.stampRule) {
            throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership is unavailable.", 409);
          }
          await this.evaluateAndPersistOperationalRisk(
            transaction,
            membership,
            context,
            commandState.command.id,
            "REVERSE",
          );
          let projection = this.projectionState(membership.progress);
          const now = new Date();
          const appendContext: LedgerAppendContext = {
            organizationId: membership.organizationId,
            membershipId: membership.id,
            customerId: membership.customerId,
            programId: membership.programId,
            programVersionId: membership.enrollmentProgramVersionId,
            locationId: context.locationId,
            staffOrganizationMemberId: context.organizationMemberId,
            staffDeviceId: context.deviceId,
            operationCommandId: commandState.command.id,
            operationalTimezone: membership.enrollmentProgramVersion.operationalTimezone,
            occurredAt: now,
          };
          const entryIds: string[] = [];
          if (source.eventType === "STAMP_ISSUED") {
            const reversed = await this.appendEntry(transaction, appendContext, projection, {
              eventType: "STAMP_REVERSED",
              stampDelta: -source.stampDelta,
              reversalOfEntryId: source.id,
              safeMetadata: { reason: input.reason ?? "staff-own reversal" },
            });
            projection = reversed.projection;
            entryIds.push(reversed.entry.id);
            if (unlockedIds.length > 0) {
              await transaction.rewardEntitlement.updateMany({
                where: { id: { in: unlockedIds }, redemptionCount: 0 },
                data: { status: "VOIDED", voidedAt: now },
              });
            }
          } else {
            const redemption = source.rewardRedemptionId
              ? await transaction.rewardRedemption.findUnique({
                  where: { id: source.rewardRedemptionId },
                })
              : null;
            if (redemption?.status !== "COMPLETED") {
              throw new AppError("OPERATION_NOT_REVERSIBLE", "Redemption is not reversible.", 409);
            }
            const reversed = await this.appendEntry(transaction, appendContext, projection, {
              eventType: "REWARD_REDEMPTION_REVERSED",
              rewardEntitlementId: redemption.rewardEntitlementId,
              rewardRedemptionId: redemption.id,
              reversalOfEntryId: source.id,
              safeMetadata: { reason: input.reason ?? "authorized reversal" },
            });
            projection = reversed.projection;
            entryIds.push(reversed.entry.id);
            const sourceReset = sourceEntries.find((entry) => entry.eventType === "CYCLE_RESET");
            if (sourceReset) {
              const resetReversed = await this.appendEntry(transaction, appendContext, projection, {
                eventType: "CYCLE_RESET_REVERSED",
                rewardEntitlementId: redemption.rewardEntitlementId,
                rewardRedemptionId: redemption.id,
                reversalOfEntryId: sourceReset.id,
                safeMetadata: { reason: input.reason ?? "authorized reversal" },
              });
              projection = resetReversed.projection;
              entryIds.push(resetReversed.entry.id);
            }
            const entitlement = await transaction.rewardEntitlement.findUniqueOrThrow({
              where: { id: redemption.rewardEntitlementId },
            });
            const nextCount = Math.max(0, entitlement.redemptionCount - 1);
            await transaction.rewardEntitlement.update({
              where: { id: entitlement.id },
              data: {
                redemptionCount: nextCount,
                status: nextCount === 0 ? "AVAILABLE" : "PARTIALLY_REDEEMED",
                fullyRedeemedAt: null,
              },
            });
            await transaction.rewardRedemption.update({
              where: { id: redemption.id },
              data: {
                status: "REVERSED",
                reversedAt: now,
                reversalLedgerEntryId: reversed.entry.id,
              },
            });
          }
          await this.persistProjection(transaction, membership.id, projection);
          await this.queueWalletUpdates(
            transaction,
            membership.walletPassInstances.map((pass) => pass.id),
            `loyalty-operation:${commandState.command.id}`,
            "OPERATION_REVERSED",
            projection,
          );
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId: membership.organizationId,
              action:
                source.eventType === "STAMP_ISSUED"
                  ? "ledger.stamp_reversed"
                  : "reward.redemption_reversed",
              targetType: "loyalty_operation",
              targetId: original.id,
              locationId: context.locationId,
              metadata: {
                reversalOperationPublicId: commandState.command.publicId,
                reason: input.reason ?? "staff-own reversal",
              },
            },
            request,
          );
          const result = {
            operationPublicId: commandState.command.publicId,
            reversedOperationPublicId: original.publicId,
            replayed: false,
            progress: projection.currentCycleStampCount,
            rewardReady: projection.rewardReady,
            completedCycles: projection.completedCycleCount,
            projectionVersion: projection.projectionVersion,
          };
          await transaction.loyaltyOperationCommand.update({
            where: { id: commandState.command.id },
            data: {
              status: "COMPLETED",
              resultLedgerEntryIds: entryIds,
              resultProjectionVersion: projection.projectionVersion,
              resultPayload: result,
              completedAt: now,
            },
          });
          return result;
        },
      );
    } catch (error) {
      await this.persistCommandFailure(
        context.organizationId,
        commandId,
        fingerprint,
        claim.leaseOwner,
        error,
      );
      throw error;
    }
  }

  async operationStatus(context: StaffOperationContext, publicId: string) {
    const command = await this.prisma.client.loyaltyOperationCommand.findFirst({
      where: { publicId, organizationId: context.organizationId },
      select: {
        publicId: true,
        operationType: true,
        status: true,
        resultProjectionVersion: true,
        resultPayload: true,
        safeFailureCode: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!command) throw new AppError("OPERATION_NOT_FOUND", "Operation not found.", 404);
    return command;
  }

  async verifyProjection(
    organizationId: string,
    membershipId: string,
  ): Promise<{
    valid: boolean;
    drift: boolean;
    ledgerSequence: number;
    expected: ProjectionState;
    actual: ProjectionState;
  }> {
    const membership = await this.loadMembership(this.prisma.client, membershipId);
    if (
      !membership ||
      membership.organizationId !== organizationId ||
      !membership.progress ||
      !membership.enrollmentProgramVersion.stampRule
    ) {
      throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership not found.", 404);
    }
    const entries = await this.prisma.client.loyaltyLedgerEntry.findMany({
      where: { membershipId },
      orderBy: { membershipSequence: "asc" },
    });
    verifyLedgerHashChain(
      entries.map((entry) => ({
        id: entry.id,
        organizationId: entry.organizationId,
        membershipId: entry.membershipId,
        customerId: entry.customerId,
        programId: entry.programId,
        programVersionId: entry.programVersionId,
        locationId: entry.locationId,
        staffOrganizationMemberId: entry.staffOrganizationMemberId,
        staffDeviceId: entry.staffDeviceId,
        eventType: entry.eventType,
        membershipSequence: entry.membershipSequence,
        cycleNumber: entry.cycleNumber,
        stampDelta: entry.stampDelta,
        rewardEntitlementId: entry.rewardEntitlementId,
        rewardRedemptionId: entry.rewardRedemptionId,
        reversalOfEntryId: entry.reversalOfEntryId,
        operationCommandId: entry.operationCommandId,
        purchaseAmountMinor: entry.purchaseAmountMinor,
        purchaseCurrency: entry.purchaseCurrency,
        merchantTransactionReference: entry.merchantTransactionReference,
        merchantTransactionReferenceKeyVersion: entry.merchantTransactionReferenceKeyVersion,
        merchantTransactionReferenceNormalizationVersion:
          entry.merchantTransactionReferenceNormalizationVersion,
        operationalTimezone: entry.operationalTimezone,
        operationalLocalDate: entry.operationalLocalDate.toISOString().slice(0, 10),
        occurredAt: entry.occurredAt.toISOString(),
        safeMetadata: entry.safeMetadata,
        ledgerHashVersion: 1,
        previousEntryHash: entry.previousEntryHash,
        entryHash: entry.entryHash,
      })),
      (version) =>
        version === this.environment.values.LEDGER_HASH_ACTIVE_VERSION
          ? this.environment.values.LEDGER_HASH_SECRET_V1
          : undefined,
    );
    const expected = rebuildProjection(
      entries.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        membershipSequence: entry.membershipSequence,
        cycleNumber: entry.cycleNumber,
        stampDelta: entry.stampDelta,
      })),
      {
        requiredStampCount: membership.enrollmentProgramVersion.stampRule.requiredStampCount,
      },
    );
    const actual = this.projectionState(membership.progress);
    return {
      valid: true,
      drift: projectionFingerprint(expected) !== projectionFingerprint(actual),
      ledgerSequence: entries.at(-1)?.membershipSequence ?? 0,
      expected,
      actual,
    };
  }

  async changeMembershipStatus(input: {
    organizationId: string;
    membershipId: string;
    actorUserId: string;
    actorMemberId: string;
    actorRole: "OWNER" | "MANAGER";
    locationId: string;
    commandId: string;
    action: "SUSPEND" | "RESTORE" | "REVOKE";
    reason: string;
    request: WafloRequest;
  }) {
    const initial = await this.prisma.client.membership.findFirst({
      where: { id: input.membershipId, organizationId: input.organizationId },
      select: { id: true, programId: true },
    });
    if (!initial) throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership not found.", 404);
    const operationType =
      input.action === "SUSPEND"
        ? "SUSPEND_MEMBERSHIP"
        : input.action === "RESTORE"
          ? "RESTORE_MEMBERSHIP"
          : "REVOKE_MEMBERSHIP";
    const eventType =
      input.action === "SUSPEND"
        ? "MEMBERSHIP_SUSPENDED"
        : input.action === "RESTORE"
          ? "MEMBERSHIP_RESTORED"
          : "MEMBERSHIP_REVOKED";
    const fingerprint = operationFingerprint({
      type: operationType,
      membershipId: input.membershipId,
      locationId: input.locationId,
      reason: input.reason,
    });
    const claim = await this.claimDurableCommand({
      organizationId: input.organizationId,
      programId: initial.programId,
      membershipId: input.membershipId,
      operationType,
      commandId: input.commandId,
      fingerprint,
      actorMemberId: input.actorMemberId,
      actorDeviceId: null,
      locationId: input.locationId,
    });
    if (claim.replayed) return claim.result;
    try {
      return await withOrderedInvariantLocks(
        this.prisma.client,
        [
          `organization:${input.organizationId}`,
          `program-lifecycle:${initial.programId}`,
          `membership:${input.membershipId}`,
          `operation:${input.organizationId}:${input.commandId}`,
        ],
        async (transaction) => {
          const membership = await this.loadMembership(transaction, input.membershipId);
          if (!membership?.progress || !membership.enrollmentProgramVersion.stampRule) {
            throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership is unavailable.", 409);
          }
          const location = await transaction.location.findFirst({
            where: {
              id: input.locationId,
              organizationId: input.organizationId,
              status: "ACTIVE",
            },
          });
          if (!location) {
            throw new AppError("LOCATION_NOT_AUTHORIZED", "Location is not active.", 403);
          }
          if (
            (input.action === "SUSPEND" && membership.status !== "ACTIVE") ||
            (input.action === "RESTORE" && membership.status !== "SUSPENDED") ||
            (input.action === "REVOKE" && membership.status === "REVOKED")
          ) {
            throw new AppError(
              "MEMBERSHIP_NOT_OPERATIONAL",
              "Membership status does not allow this action.",
              409,
            );
          }
          if (input.action === "RESTORE") {
            if (
              membership.customer.status !== "ACTIVE" ||
              membership.organization.status !== "ACTIVE" ||
              membership.program.status !== "PUBLISHED" ||
              !membership.credentials[0]
            ) {
              throw new AppError(
                "MEMBERSHIP_NOT_OPERATIONAL",
                "Membership cannot be restored under the current policy.",
                409,
              );
            }
          }
          const command = await this.loadClaimedCommand(transaction, {
            organizationId: input.organizationId,
            commandId: input.commandId,
            fingerprint,
            leaseOwner: claim.leaseOwner,
          });
          let projection = this.projectionState(membership.progress);
          const appended = await this.appendEntry(
            transaction,
            {
              organizationId: membership.organizationId,
              membershipId: membership.id,
              customerId: membership.customerId,
              programId: membership.programId,
              programVersionId: membership.enrollmentProgramVersionId,
              locationId: input.locationId,
              staffOrganizationMemberId: input.actorMemberId,
              staffDeviceId: null,
              operationCommandId: command.id,
              operationalTimezone: membership.enrollmentProgramVersion.operationalTimezone,
              occurredAt: new Date(),
            },
            projection,
            {
              eventType,
              safeMetadata: { reason: input.reason, actorRole: input.actorRole },
            },
          );
          projection = appended.projection;
          const now = new Date();
          await transaction.membership.update({
            where: { id: membership.id },
            data:
              input.action === "SUSPEND"
                ? { status: "SUSPENDED", suspendedAt: now }
                : input.action === "RESTORE"
                  ? { status: "ACTIVE", suspendedAt: null }
                  : { status: "REVOKED", revokedAt: now },
          });
          if (input.action === "REVOKE") {
            await transaction.membershipCredential.updateMany({
              where: { membershipId: membership.id, status: "ACTIVE" },
              data: { status: "REVOKED", revokedAt: now },
            });
            await transaction.membershipAccessSession.updateMany({
              where: { membershipId: membership.id, revokedAt: null },
              data: { revokedAt: now },
            });
          }
          await this.persistProjection(transaction, membership.id, projection);
          for (const pass of membership.walletPassInstances) {
            await queueWalletPassStateChange(transaction, {
              walletPassInstanceId: pass.id,
              commandType: input.action === "REVOKE" ? "INVALIDATE" : "UPDATE",
              reason: eventType,
              eventKey: `loyalty-operation:${command.id}`,
              safePayload: {
                membershipStatus:
                  input.action === "SUSPEND"
                    ? "SUSPENDED"
                    : input.action === "RESTORE"
                      ? "ACTIVE"
                      : "REVOKED",
                projectionVersion: projection.projectionVersion,
              },
            });
          }
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId: input.organizationId,
              actorUserId: input.actorUserId,
              action: `membership.${input.action.toLocaleLowerCase("en-US")}${
                input.action === "SUSPEND" ? "ed" : input.action === "RESTORE" ? "d" : "d"
              }`,
              targetType: "membership",
              targetId: membership.id,
              locationId: input.locationId,
              metadata: { reason: input.reason, operationPublicId: command.publicId },
            },
            input.request,
          );
          const result = {
            operationPublicId: command.publicId,
            status:
              input.action === "SUSPEND"
                ? ("SUSPENDED" as const)
                : input.action === "RESTORE"
                  ? ("ACTIVE" as const)
                  : ("REVOKED" as const),
            projectionVersion: projection.projectionVersion,
            replayed: false,
          };
          await transaction.loyaltyOperationCommand.update({
            where: { id: command.id },
            data: {
              status: "COMPLETED",
              resultLedgerEntryIds: [appended.entry.id],
              resultProjectionVersion: projection.projectionVersion,
              resultPayload: result,
              completedAt: now,
            },
          });
          return result;
        },
      );
    } catch (error) {
      await this.persistCommandFailure(
        input.organizationId,
        input.commandId,
        fingerprint,
        claim.leaseOwner,
        error,
      );
      throw error;
    }
  }

  async manualAdjustment(input: {
    organizationId: string;
    membershipId: string;
    actorUserId: string;
    actorMemberId: string;
    actorRole: "OWNER" | "MANAGER";
    locationId: string;
    commandId: string;
    stampDelta: number;
    reason: string;
    request: WafloRequest;
  }) {
    const initial = await this.prisma.client.membership.findFirst({
      where: { id: input.membershipId, organizationId: input.organizationId },
      select: { id: true, programId: true },
    });
    if (!initial) throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership not found.", 404);
    const fingerprint = operationFingerprint({
      type: "MANUAL_ADJUSTMENT",
      membershipId: input.membershipId,
      locationId: input.locationId,
      stampDelta: input.stampDelta,
      reason: input.reason,
    });
    const claim = await this.claimDurableCommand({
      organizationId: input.organizationId,
      programId: initial.programId,
      membershipId: input.membershipId,
      operationType: "MANUAL_ADJUSTMENT",
      commandId: input.commandId,
      fingerprint,
      actorMemberId: input.actorMemberId,
      actorDeviceId: null,
      locationId: input.locationId,
    });
    if (claim.replayed) return claim.result;
    try {
      return await withOrderedInvariantLocks(
        this.prisma.client,
        [
          `organization:${input.organizationId}`,
          `program-lifecycle:${initial.programId}`,
          `membership:${input.membershipId}`,
          `operation:${input.organizationId}:${input.commandId}`,
        ],
        async (transaction) => {
          const membership = await this.loadMembership(transaction, input.membershipId);
          if (
            !membership?.progress ||
            !membership.enrollmentProgramVersion.stampRule ||
            membership.status !== "ACTIVE"
          ) {
            throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership is unavailable.", 409);
          }
          if (membership.progress.rewardReady) {
            throw new AppError(
              "FINAL_REWARD_PENDING_REDEMPTION",
              "Manual adjustment cannot bypass a pending final reward.",
              409,
            );
          }
          const goal = membership.enrollmentProgramVersion.stampRule.requiredStampCount;
          const next = membership.progress.currentCycleStampCount + input.stampDelta;
          if (next < 0 || next > goal) {
            throw new AppError(
              "MANUAL_ADJUSTMENT_INVALID",
              "Manual adjustment would leave the valid stamp range.",
              422,
            );
          }
          if (input.stampDelta < 0) {
            const dependentEntitlement = await transaction.rewardEntitlement.findFirst({
              where: {
                membershipId: membership.id,
                cycleNumber: membership.progress.currentCycleNumber,
                threshold: { gt: next },
                status: { not: "VOIDED" },
              },
              select: { id: true },
            });
            if (dependentEntitlement) {
              throw new AppError(
                "REVERSAL_DEPENDENCY_BLOCKED",
                "Manual correction would invalidate an earned reward.",
                409,
              );
            }
          }
          const command = await this.loadClaimedCommand(transaction, {
            organizationId: input.organizationId,
            commandId: input.commandId,
            fingerprint,
            leaseOwner: claim.leaseOwner,
          });
          const appendContext = {
            organizationId: membership.organizationId,
            membershipId: membership.id,
            customerId: membership.customerId,
            programId: membership.programId,
            programVersionId: membership.enrollmentProgramVersionId,
            locationId: input.locationId,
            staffOrganizationMemberId: input.actorMemberId,
            staffDeviceId: null,
            operationCommandId: command.id,
            operationalTimezone: membership.enrollmentProgramVersion.operationalTimezone,
            occurredAt: new Date(),
          };
          const appended = await this.appendEntry(
            transaction,
            appendContext,
            this.projectionState(membership.progress),
            {
              eventType: "MANUAL_STAMP_ADJUSTMENT",
              stampDelta: input.stampDelta,
              safeMetadata: { reason: input.reason, actorRole: input.actorRole },
            },
          );
          let projection = appended.projection;
          const ledgerEntryIds = [appended.entry.id];
          const unlockedRewards: Array<{
            publicId: string;
            threshold: number;
            status: string;
            final: boolean;
          }> = [];
          if (input.stampDelta > 0) {
            const crossed = crossedRewardThresholds(
              membership.progress.currentCycleStampCount,
              next,
              membership.enrollmentProgramVersion.rewards.map((reward) => ({
                rewardDefinitionId: reward.id,
                threshold: reward.thresholdStampCount,
                final: reward.thresholdStampCount === goal,
              })),
            );
            for (const threshold of crossed) {
              const reward = membership.enrollmentProgramVersion.rewards.find(
                (candidate) => candidate.id === threshold.rewardDefinitionId,
              );
              if (!reward) continue;
              const entitlementId = randomUUID();
              const unlock = await this.appendEntry(transaction, appendContext, projection, {
                eventType: threshold.final ? "FINAL_REWARD_UNLOCKED" : "MILESTONE_REWARD_UNLOCKED",
                rewardEntitlementId: entitlementId,
                safeMetadata: {
                  rewardDefinitionId: reward.id,
                  threshold: reward.thresholdStampCount,
                  source: "MANUAL_ADJUSTMENT",
                },
              });
              projection = unlock.projection;
              ledgerEntryIds.push(unlock.entry.id);
              const entitlement = await transaction.rewardEntitlement.create({
                data: {
                  id: entitlementId,
                  organizationId: membership.organizationId,
                  membershipId: membership.id,
                  programVersionId: membership.enrollmentProgramVersionId,
                  rewardDefinitionId: reward.id,
                  cycleNumber: membership.progress.currentCycleNumber,
                  threshold: reward.thresholdStampCount,
                  maximumRedemptionCount: threshold.final ? 1 : reward.maximumRedemptionsPerEarned,
                  unlockedByLedgerEntryId: unlock.entry.id,
                  unlockedAt: appendContext.occurredAt,
                  expiresAt:
                    threshold.final || reward.validityDurationDays === null
                      ? null
                      : new Date(
                          appendContext.occurredAt.getTime() +
                            reward.validityDurationDays * 86_400_000,
                        ),
                },
              });
              unlockedRewards.push({
                publicId: entitlement.publicId,
                threshold: entitlement.threshold,
                status: entitlement.status,
                final: threshold.final,
              });
              await this.audit.recordInTransaction(
                transaction,
                {
                  organizationId: membership.organizationId,
                  actorUserId: input.actorUserId,
                  action: "reward.unlocked",
                  targetType: "reward_entitlement",
                  targetId: entitlement.id,
                  locationId: input.locationId,
                  metadata: {
                    operationPublicId: command.publicId,
                    threshold: entitlement.threshold,
                    final: threshold.final,
                    source: "MANUAL_ADJUSTMENT",
                  },
                },
                input.request,
              );
            }
          }
          await this.persistProjection(transaction, membership.id, projection);
          await this.queueWalletUpdates(
            transaction,
            membership.walletPassInstances.map((pass) => pass.id),
            `loyalty-operation:${command.id}`,
            "MANUAL_STAMP_ADJUSTMENT",
            projection,
          );
          await this.createRiskSignal(
            transaction,
            membership,
            {
              organizationId: input.organizationId,
              organizationMemberId: input.actorMemberId,
              role: input.actorRole,
              locationId: input.locationId,
              deviceId: "",
              devicePublicId: "",
              deviceSessionId: "",
              platform: "TEST_CLIENT",
              requestId: input.request.requestId,
            },
            command.id,
            {
              ruleCode: "MANUAL_ADJUSTMENT",
              severity: "HIGH",
              score: 75,
              evidence: { stampDelta: input.stampDelta, reason: input.reason },
            },
          );
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId: input.organizationId,
              actorUserId: input.actorUserId,
              action: "ledger.manual_adjustment",
              targetType: "membership",
              targetId: membership.id,
              locationId: input.locationId,
              metadata: {
                stampDelta: input.stampDelta,
                reason: input.reason,
                operationPublicId: command.publicId,
              },
            },
            input.request,
          );
          const result = {
            operationPublicId: command.publicId,
            progress: projection.currentCycleStampCount,
            goal,
            rewardReady: projection.rewardReady,
            projectionVersion: projection.projectionVersion,
            unlockedRewards,
            replayed: false,
          };
          await transaction.loyaltyOperationCommand.update({
            where: { id: command.id },
            data: {
              status: "COMPLETED",
              resultLedgerEntryIds: ledgerEntryIds,
              resultProjectionVersion: projection.projectionVersion,
              resultPayload: result,
              completedAt: new Date(),
            },
          });
          return result;
        },
      );
    } catch (error) {
      await this.persistCommandFailure(
        input.organizationId,
        input.commandId,
        fingerprint,
        claim.leaseOwner,
        error,
      );
      throw error;
    }
  }

  async rebuildProjection(input: {
    organizationId: string;
    membershipId: string;
    commandId: string;
    expectedProjectionVersion: number;
    actorUserId: string;
    actorRole: "OWNER" | "MANAGER";
    request: WafloRequest;
  }) {
    const initial = await this.prisma.client.membership.findFirst({
      where: { id: input.membershipId, organizationId: input.organizationId },
      select: { programId: true },
    });
    if (!initial) throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership not found.", 404);
    const fingerprint = operationFingerprint({
      membershipId: input.membershipId,
      expectedProjectionVersion: input.expectedProjectionVersion,
    });
    const leaseOwner = `projection-${randomUUID()}`;
    const claimed = await withOrderedInvariantLocks(
      this.prisma.client,
      [
        `organization:${input.organizationId}`,
        `program-lifecycle:${initial.programId}`,
        `membership:${input.membershipId}`,
        `projection-rebuild:${input.organizationId}:${input.commandId}`,
      ],
      async (transaction) => {
        const existing = await transaction.projectionRebuildCommand.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: input.organizationId,
              idempotencyKey: input.commandId,
            },
          },
        });
        if (existing) {
          if (
            existing.membershipId !== input.membershipId ||
            existing.requestFingerprint !== fingerprint
          ) {
            throw new AppError(
              "OPERATION_IDEMPOTENCY_CONFLICT",
              "This command ID was already used for another request.",
              409,
            );
          }
          if (existing.status === "COMPLETED" && existing.resultPayload) {
            return {
              replayed: true as const,
              result: {
                ...(existing.resultPayload as Record<string, Prisma.JsonValue>),
                replayed: true,
              },
            };
          }
          if (existing.status === "FAILED") {
            throw new AppError(
              existing.safeFailureCode ?? "PROJECTION_REBUILD_FAILED",
              "The original projection rebuild failed.",
              this.failureHttpStatus(existing.safeFailureCode),
            );
          }
          if (
            existing.status === "PROCESSING" &&
            existing.leaseExpiresAt &&
            existing.leaseExpiresAt > new Date()
          ) {
            throw new AppError("OPERATION_IN_PROGRESS", "Projection rebuild is processing.", 409);
          }
          await transaction.projectionRebuildCommand.update({
            where: { id: existing.id },
            data: {
              status: "PROCESSING",
              leaseOwner,
              leaseExpiresAt: new Date(Date.now() + 90_000),
              attemptCount: { increment: 1 },
              safeFailureCode: null,
            },
          });
          return { replayed: false as const, commandId: existing.id };
        }
        const created = await transaction.projectionRebuildCommand.create({
          data: {
            organizationId: input.organizationId,
            membershipId: input.membershipId,
            idempotencyKey: input.commandId,
            requestFingerprint: fingerprint,
            expectedProjectionVersion: input.expectedProjectionVersion,
            status: "PROCESSING",
            initiatedBy: input.actorRole,
            initiatedByUserId: input.actorUserId,
            leaseOwner,
            leaseExpiresAt: new Date(Date.now() + 90_000),
            attemptCount: 1,
          },
        });
        return { replayed: false as const, commandId: created.id };
      },
    );
    if (claimed.replayed) return claimed.result;
    try {
      return await withOrderedInvariantLocks(
        this.prisma.client,
        [
          `organization:${input.organizationId}`,
          `program-lifecycle:${initial.programId}`,
          `membership:${input.membershipId}`,
          `projection-rebuild:${input.organizationId}:${input.commandId}`,
        ],
        async (transaction) => {
          const command = await transaction.projectionRebuildCommand.findUniqueOrThrow({
            where: { id: claimed.commandId },
          });
          if (
            command.status !== "PROCESSING" ||
            command.leaseOwner !== leaseOwner ||
            command.requestFingerprint !== fingerprint
          ) {
            throw new AppError("OPERATION_CLAIM_LOST", "Projection rebuild claim was lost.", 409);
          }
          const membership = await this.loadMembership(transaction, input.membershipId);
          if (
            !membership ||
            membership.organizationId !== input.organizationId ||
            !membership.progress ||
            !membership.enrollmentProgramVersion.stampRule
          ) {
            throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership not found.", 404);
          }
          if (membership.progress.projectionVersion !== input.expectedProjectionVersion) {
            throw new AppError(
              "CONCURRENT_MODIFICATION_RETRY",
              "Projection changed before rebuild.",
              409,
            );
          }
          const entries = await transaction.loyaltyLedgerEntry.findMany({
            where: { membershipId: membership.id },
            orderBy: { membershipSequence: "asc" },
          });
          const expected = rebuildProjection(
            entries.map((entry) => ({
              id: entry.id,
              eventType: entry.eventType,
              membershipSequence: entry.membershipSequence,
              cycleNumber: entry.cycleNumber,
              stampDelta: entry.stampDelta,
            })),
            {
              requiredStampCount: membership.enrollmentProgramVersion.stampRule.requiredStampCount,
            },
          );
          const actual = this.projectionState(membership.progress);
          const beforeFingerprint = projectionFingerprint(actual);
          const afterFingerprint = projectionFingerprint(expected);
          const drift = beforeFingerprint !== afterFingerprint;
          if (drift) {
            await this.persistProjection(transaction, membership.id, expected);
            const windowStart = new Date();
            windowStart.setUTCHours(0, 0, 0, 0);
            const deduplicationKey = riskDeduplicationKey({
              ruleCode: "PROJECTION_DRIFT",
              organizationId: membership.organizationId,
              subjectId: membership.id,
              windowStart,
            });
            await transaction.operationalRiskSignal.upsert({
              where: {
                organizationId_deduplicationKey: {
                  organizationId: membership.organizationId,
                  deduplicationKey,
                },
              },
              create: {
                organizationId: membership.organizationId,
                programId: membership.programId,
                membershipId: membership.id,
                ruleCode: "PROJECTION_DRIFT",
                severity: "HIGH",
                score: 90,
                ruleVersion: "w4r1-v1",
                deduplicationKey,
                deduplicationWindowStart: windowStart,
                safeEvidence: { beforeFingerprint, afterFingerprint },
              },
              update: {},
            });
            await this.queueWalletUpdates(
              transaction,
              membership.walletPassInstances.map((pass) => pass.id),
              `projection-rebuild:${command.id}`,
              "PROJECTION_REBUILT",
              expected,
            );
          }
          const result = {
            commandPublicId: command.publicId,
            drift,
            repaired: drift,
            beforeFingerprint,
            afterFingerprint,
            projectionVersion: expected.projectionVersion,
            replayed: false,
          };
          await transaction.projectionRebuildCommand.update({
            where: { id: command.id },
            data: {
              status: "COMPLETED",
              detectedDrift: drift,
              beforeFingerprint,
              afterFingerprint,
              resultPayload: result,
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: new Date(),
            },
          });
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId: input.organizationId,
              actorUserId: input.actorUserId,
              action: drift ? "membership.projection_rebuilt" : "membership.projection_verified",
              targetType: "membership",
              targetId: membership.id,
              metadata: {
                drift,
                beforeFingerprint,
                afterFingerprint,
                commandPublicId: command.publicId,
              },
            },
            input.request,
          );
          return result;
        },
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "PROJECTION_REBUILD_FAILED";
      await this.prisma.client.$transaction(async (transaction) => {
        const failed = await transaction.projectionRebuildCommand.updateMany({
          where: {
            id: claimed.commandId,
            status: "PROCESSING",
            leaseOwner,
            requestFingerprint: fingerprint,
          },
          data: {
            status: "FAILED",
            safeFailureCode: code,
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: new Date(),
          },
        });
        if (failed.count === 1) {
          await transaction.auditLog.create({
            data: {
              organizationId: input.organizationId,
              actorUserId: input.actorUserId,
              action: "membership.projection_rebuild_failed",
              targetType: "projection_rebuild_command",
              targetId: claimed.commandId,
              requestId: input.request.requestId,
              metadata: { safeFailureCode: code },
            },
          });
        }
      });
      throw error;
    }
  }

  private async loadMembership(
    client: Prisma.TransactionClient | PrismaService["client"],
    membershipId: string,
  ) {
    return client.membership.findUnique({
      where: { id: membershipId },
      include: {
        customer: true,
        program: true,
        organization: { include: { billingProfile: true } },
        progress: true,
        credentials: {
          where: { status: "ACTIVE" },
          orderBy: { credentialVersion: "desc" },
          take: 1,
        },
        walletPassInstances: {
          where: { status: { notIn: ["INVALIDATED", "INVALIDATION_PENDING"] } },
          select: { id: true },
        },
        enrollmentProgramVersion: {
          include: {
            stampRule: true,
            rewards: true,
            locations: true,
          },
        },
      },
    });
  }

  private async operationalMembership(
    transaction: Prisma.TransactionClient,
    membershipId: string,
    context: StaffOperationContext,
    operation: "EARN" | "REDEEM",
  ) {
    const membership = await this.loadMembership(transaction, membershipId);
    if (!membership) {
      throw new AppError("MEMBERSHIP_NOT_OPERATIONAL", "Membership not found.", 404);
    }
    const authorization = await this.locationAuthorization(context, transaction);
    const programLocation = membership.enrollmentProgramVersion.locations.find(
      (candidate) => candidate.locationId === context.locationId,
    );
    try {
      assertOperationalEligibility(
        {
          organizationStatus: membership.organization.status,
          billingStatus:
            membership.organization.billingProfile?.subscriptionStatus ?? "PENDING_ACTIVATION",
          programStatus: membership.program.status,
          membershipStatus: membership.status,
          credentialStatus: membership.credentials[0]?.status ?? "MISSING",
          membershipProgramVersionId: membership.enrollmentProgramVersionId,
          resolvedProgramVersionId: membership.enrollmentProgramVersion.id,
          locationActive: authorization.locationActive,
          staffAssignmentActive: authorization.staffAssignmentActive,
          deviceAssignmentActive: authorization.deviceAssignmentActive,
          earningEnabled:
            Boolean(programLocation?.earningEnabled) &&
            authorization.staffEarningAllowed &&
            authorization.deviceEarningAllowed,
          redemptionEnabled:
            Boolean(programLocation?.redemptionEnabled) &&
            authorization.staffRedemptionAllowed &&
            authorization.deviceRedemptionAllowed,
        },
        operation,
      );
    } catch (error) {
      policyError(error);
    }
    return { ...membership, activeCredential: membership.credentials[0] ?? null };
  }

  private async locationAuthorization(
    context: StaffOperationContext,
    transaction?: Prisma.TransactionClient,
  ) {
    const client = transaction ?? this.prisma.client;
    const [location, staff, device, deviceIdentity] = await Promise.all([
      client.location.findFirst({
        where: {
          id: context.locationId,
          organizationId: context.organizationId,
          status: "ACTIVE",
        },
      }),
      client.staffLocationAssignment.findUnique({
        where: {
          organizationMemberId_locationId: {
            organizationMemberId: context.organizationMemberId,
            locationId: context.locationId,
          },
        },
      }),
      client.staffDeviceLocation.findUnique({
        where: {
          staffDeviceId_locationId: {
            staffDeviceId: context.deviceId,
            locationId: context.locationId,
          },
        },
      }),
      client.staffDevice.findUnique({
        where: { id: context.deviceId },
        select: { status: true },
      }),
    ]);
    return {
      locationActive: Boolean(location),
      staffAssignmentActive: Boolean(staff?.active),
      deviceAssignmentActive: Boolean(device?.active && deviceIdentity?.status === "ACTIVE"),
      staffEarningAllowed: Boolean(staff?.earningAllowed),
      staffRedemptionAllowed: Boolean(staff?.redemptionAllowed),
      deviceEarningAllowed: Boolean(device?.earningAllowed),
      deviceRedemptionAllowed: Boolean(device?.redemptionAllowed),
    };
  }

  private async replayOrCreateCommand(
    transaction: Prisma.TransactionClient,
    input: {
      organizationId: string;
      membershipId: string;
      operationType: LoyaltyOperationType;
      commandId: string;
      fingerprint: string;
      context: StaffOperationContext;
      leaseOwner: string;
    },
  ): Promise<
    | { replayed: true; result: Prisma.JsonValue; command: never }
    | {
        replayed: false;
        result?: never;
        command: Awaited<ReturnType<Prisma.TransactionClient["loyaltyOperationCommand"]["create"]>>;
      }
  > {
    const existing = await transaction.loyaltyOperationCommand.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.commandId,
        },
      },
    });
    if (existing) {
      if (
        existing.requestFingerprint !== input.fingerprint ||
        existing.membershipId !== input.membershipId ||
        existing.operationType !== input.operationType
      ) {
        throw new AppError(
          "OPERATION_IDEMPOTENCY_CONFLICT",
          "This command ID was already used for another request.",
          HttpStatus.CONFLICT,
        );
      }
      if (existing.status === "COMPLETED" && existing.resultPayload !== null) {
        return {
          replayed: true,
          result: {
            ...(existing.resultPayload as Record<string, Prisma.JsonValue>),
            replayed: true,
          },
          command: undefined as never,
        };
      }
      if (existing.status === "FAILED") {
        throw new AppError(
          existing.safeFailureCode ?? "OPERATION_FAILED",
          "The original operation failed.",
          HttpStatus.CONFLICT,
        );
      }
      if (existing.status === "PROCESSING" && existing.leaseOwner === input.leaseOwner) {
        return { replayed: false, command: existing };
      }
      throw new AppError("OPERATION_IN_PROGRESS", "The operation is still processing.", 409);
    }
    throw new AppError("OPERATION_CLAIM_MISSING", "Operation claim is unavailable.", 409);
  }

  private async claimDurableCommand(input: {
    organizationId: string;
    programId: string;
    membershipId: string;
    operationType: LoyaltyOperationType;
    commandId: string;
    fingerprint: string;
    actorMemberId: string | null;
    actorDeviceId: string | null;
    locationId: string | null;
  }): Promise<
    | { replayed: true; result: Prisma.JsonValue; leaseOwner: never }
    | { replayed: false; leaseOwner: string }
  > {
    const leaseOwner = `api-${randomUUID()}`;
    const claim = await withOrderedInvariantLocks(
      this.prisma.client,
      [
        `organization:${input.organizationId}`,
        `program-lifecycle:${input.programId}`,
        `membership:${input.membershipId}`,
        `operation:${input.organizationId}:${input.commandId}`,
      ],
      async (transaction) => {
        const existing = await transaction.loyaltyOperationCommand.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: input.organizationId,
              idempotencyKey: input.commandId,
            },
          },
        });
        if (existing) {
          if (
            existing.requestFingerprint !== input.fingerprint ||
            existing.membershipId !== input.membershipId ||
            existing.operationType !== input.operationType
          ) {
            throw new AppError(
              "OPERATION_IDEMPOTENCY_CONFLICT",
              "This command ID was already used for another request.",
              409,
            );
          }
          if (existing.status === "COMPLETED" && existing.resultPayload !== null) {
            return {
              replayed: true as const,
              result: {
                ...(existing.resultPayload as Record<string, Prisma.JsonValue>),
                replayed: true,
              },
              leaseOwner: undefined as never,
            };
          }
          if (existing.status === "FAILED") {
            throw new AppError(
              existing.safeFailureCode ?? "OPERATION_FAILED",
              "The original operation failed.",
              this.failureHttpStatus(existing.safeFailureCode),
            );
          }
          if (!existing.leaseExpiresAt || existing.leaseExpiresAt > new Date()) {
            return { waitForTerminal: true as const };
          }
          const reclaimed = await transaction.loyaltyOperationCommand.updateMany({
            where: {
              id: existing.id,
              status: "PROCESSING",
              leaseExpiresAt: { lte: new Date() },
            },
            data: {
              leaseOwner,
              leaseExpiresAt: new Date(Date.now() + 90_000),
              attemptCount: { increment: 1 },
            },
          });
          if (reclaimed.count !== 1) {
            throw new AppError("OPERATION_IN_PROGRESS", "The operation is still processing.", 409);
          }
          return { replayed: false as const, leaseOwner };
        }
        await transaction.loyaltyOperationCommand.create({
          data: {
            organizationId: input.organizationId,
            membershipId: input.membershipId,
            operationType: input.operationType,
            idempotencyKey: input.commandId,
            requestFingerprint: input.fingerprint,
            actorMemberId: input.actorMemberId,
            actorDeviceId: input.actorDeviceId,
            locationId: input.locationId,
            leaseOwner,
            leaseExpiresAt: new Date(Date.now() + 90_000),
            attemptCount: 1,
          },
        });
        return { replayed: false as const, leaseOwner };
      },
    );
    if ("waitForTerminal" in claim) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const terminal = await this.prisma.client.loyaltyOperationCommand.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: input.organizationId,
              idempotencyKey: input.commandId,
            },
          },
        });
        if (
          !terminal ||
          terminal.requestFingerprint !== input.fingerprint ||
          terminal.membershipId !== input.membershipId ||
          terminal.operationType !== input.operationType
        ) {
          throw new AppError(
            "OPERATION_IDEMPOTENCY_CONFLICT",
            "This command ID was already used for another request.",
            409,
          );
        }
        if (terminal.status === "COMPLETED" && terminal.resultPayload !== null) {
          return {
            replayed: true,
            result: {
              ...(terminal.resultPayload as Record<string, Prisma.JsonValue>),
              replayed: true,
            },
            leaseOwner: undefined as never,
          };
        }
        if (terminal.status === "FAILED") {
          throw new AppError(
            terminal.safeFailureCode ?? "OPERATION_FAILED",
            "The original operation failed.",
            this.failureHttpStatus(terminal.safeFailureCode),
          );
        }
        if (terminal.leaseExpiresAt && terminal.leaseExpiresAt <= new Date()) {
          return this.claimDurableCommand(input);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      }
      throw new AppError("OPERATION_IN_PROGRESS", "The operation is still processing.", 409);
    }
    return claim;
  }

  private async loadClaimedCommand(
    transaction: Prisma.TransactionClient,
    input: { organizationId: string; commandId: string; fingerprint: string; leaseOwner: string },
  ) {
    const command = await transaction.loyaltyOperationCommand.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.commandId,
        },
      },
    });
    if (
      !command ||
      command.requestFingerprint !== input.fingerprint ||
      command.status !== "PROCESSING" ||
      command.leaseOwner !== input.leaseOwner
    ) {
      throw new AppError("OPERATION_CLAIM_LOST", "Operation claim is unavailable.", 409);
    }
    return command;
  }

  private failureHttpStatus(code: string | null | undefined): number {
    if (["LOCATION_NOT_AUTHORIZED", "STAFF_ASSIGNMENT_REQUIRED"].includes(code ?? "")) return 403;
    if (["MEMBERSHIP_CREDENTIAL_INVALID", "REWARD_NOT_AVAILABLE"].includes(code ?? "")) return 404;
    if (
      [
        "PURCHASE_AMOUNT_REQUIRED",
        "PURCHASE_CURRENCY_MISMATCH",
        "PURCHASE_THRESHOLD_NOT_MET",
        "STAMP_AMOUNT_INVALID",
        "STAMP_OPERATION_LIMIT_EXCEEDED",
      ].includes(code ?? "")
    ) {
      return 422;
    }
    return 409;
  }

  private async persistCommandFailure(
    organizationId: string,
    commandId: string,
    fingerprint: string,
    leaseOwner: string,
    error: unknown,
  ) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "OPERATION_FAILED";
    await this.prisma.client.$transaction(async (transaction) => {
      const command = await transaction.loyaltyOperationCommand.findUnique({
        where: {
          organizationId_idempotencyKey: { organizationId, idempotencyKey: commandId },
        },
      });
      if (
        !command ||
        command.requestFingerprint !== fingerprint ||
        command.status !== "PROCESSING" ||
        command.leaseOwner !== leaseOwner
      ) {
        return;
      }
      await transaction.loyaltyOperationCommand.update({
        where: { id: command.id },
        data: {
          status: "FAILED",
          safeFailureCode: code,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
        },
      });
      const membership = await transaction.membership.findUnique({
        where: { id: command.membershipId },
        select: { programId: true },
      });
      const riskRule =
        code === "RISK_HARD_BLOCK"
          ? "DUPLICATE_TRANSACTION_REFERENCE"
          : code === "LOCATION_NOT_AUTHORIZED"
            ? "WRONG_LOCATION"
            : code === "OPERATION_BILLING_BLOCKED"
              ? "BILLING_BLOCKED_ATTEMPT"
              : code === "MEMBERSHIP_NOT_OPERATIONAL"
                ? "MEMBERSHIP_STATE_BLOCKED_ATTEMPT"
                : null;
      if (membership && riskRule) {
        const windowStart = new Date();
        windowStart.setUTCMinutes(0, 0, 0);
        const deduplicationKey = riskDeduplicationKey({
          ruleCode: riskRule,
          organizationId,
          subjectId: command.membershipId,
          windowStart,
        });
        await transaction.operationalRiskSignal.upsert({
          where: {
            organizationId_deduplicationKey: { organizationId, deduplicationKey },
          },
          create: {
            organizationId,
            programId: membership.programId,
            membershipId: command.membershipId,
            staffMemberId: command.actorMemberId,
            staffDeviceId: command.actorDeviceId,
            locationId: command.locationId,
            operationCommandId: command.id,
            ruleCode: riskRule,
            severity: "HIGH",
            score: 85,
            ruleVersion: "w4r1-v1",
            deduplicationKey,
            deduplicationWindowStart: windowStart,
            safeEvidence: { failureCode: code },
          },
          update: {},
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId,
          action: "operation.failed",
          targetType: "loyalty_operation",
          targetId: command.id,
          requestId: `operation:${command.publicId}`,
          metadata: { safeFailureCode: code, attemptCount: command.attemptCount },
        },
      });
    });
  }

  private projectionState(projection: {
    currentCycleStampCount: number;
    completedCycleCount: number;
    rewardReady: boolean;
    projectionVersion: number;
    lastSourceEventId: string | null;
  }): ProjectionState {
    return {
      currentCycleStampCount: projection.currentCycleStampCount,
      completedCycleCount: projection.completedCycleCount,
      rewardReady: projection.rewardReady,
      projectionVersion: projection.projectionVersion,
      lastSourceEventId: projection.lastSourceEventId,
    };
  }

  private async appendEntry(
    transaction: Prisma.TransactionClient,
    context: LedgerAppendContext,
    prior: ProjectionState,
    input: AppendInput,
  ) {
    const last = await transaction.loyaltyLedgerEntry.findFirst({
      where: { membershipId: context.membershipId },
      orderBy: { membershipSequence: "desc" },
    });
    const sequence = (last?.membershipSequence ?? 0) + 1;
    if (sequence !== prior.projectionVersion + 1) {
      throw new AppError(
        "PROJECTION_DRIFT_DETECTED",
        "Membership projection does not match the ledger.",
        HttpStatus.CONFLICT,
      );
    }
    const id = randomUUID();
    const localDate = operationalLocalDate(context.occurredAt, context.operationalTimezone);
    const payload = {
      id,
      organizationId: context.organizationId,
      membershipId: context.membershipId,
      customerId: context.customerId,
      programId: context.programId,
      programVersionId: context.programVersionId,
      locationId: context.locationId,
      staffOrganizationMemberId: context.staffOrganizationMemberId,
      staffDeviceId: context.staffDeviceId,
      eventType: input.eventType,
      membershipSequence: sequence,
      cycleNumber: prior.completedCycleCount + 1,
      stampDelta: input.stampDelta ?? 0,
      rewardEntitlementId: input.rewardEntitlementId ?? null,
      rewardRedemptionId: input.rewardRedemptionId ?? null,
      reversalOfEntryId: input.reversalOfEntryId ?? null,
      operationCommandId: context.operationCommandId,
      purchaseAmountMinor: context.purchaseAmountMinor ?? null,
      purchaseCurrency: context.purchaseCurrency ?? null,
      merchantTransactionReference: context.merchantTransactionReference ?? null,
      merchantTransactionReferenceKeyVersion:
        context.merchantTransactionReferenceKeyVersion ?? null,
      merchantTransactionReferenceNormalizationVersion:
        context.merchantTransactionReferenceNormalizationVersion ?? null,
      operationalTimezone: context.operationalTimezone,
      operationalLocalDate: localDate,
      occurredAt: context.occurredAt.toISOString(),
      safeMetadata: input.safeMetadata ?? null,
      previousEntryHash: last?.entryHash ?? LEDGER_GENESIS_HASH,
    } as const;
    const entryHash = calculateLedgerEntryHash(
      payload,
      this.environment.values.LEDGER_HASH_SECRET_V1,
    );
    const projection = reduceProjectionEvent(
      prior,
      {
        id,
        eventType: input.eventType,
        membershipSequence: sequence,
        cycleNumber: prior.completedCycleCount + 1,
        stampDelta: input.stampDelta ?? 0,
      },
      {
        requiredStampCount: await this.requiredStampCount(transaction, context.programVersionId),
      },
    );
    const entry = await transaction.loyaltyLedgerEntry.create({
      data: {
        id,
        organizationId: context.organizationId,
        membershipId: context.membershipId,
        customerId: context.customerId,
        programId: context.programId,
        programVersionId: context.programVersionId,
        locationId: context.locationId,
        staffOrganizationMemberId: context.staffOrganizationMemberId,
        staffDeviceId: context.staffDeviceId,
        eventType: input.eventType,
        membershipSequence: sequence,
        cycleNumber: prior.completedCycleCount + 1,
        stampDelta: input.stampDelta ?? 0,
        rewardEntitlementId: input.rewardEntitlementId ?? null,
        rewardRedemptionId: input.rewardRedemptionId ?? null,
        reversalOfEntryId: input.reversalOfEntryId ?? null,
        operationCommandId: context.operationCommandId,
        purchaseAmountMinor: context.purchaseAmountMinor ?? null,
        purchaseCurrency: context.purchaseCurrency ?? null,
        merchantTransactionReference: context.merchantTransactionReference ?? null,
        merchantTransactionReferenceKeyVersion:
          context.merchantTransactionReferenceKeyVersion ?? null,
        merchantTransactionReferenceNormalizationVersion:
          context.merchantTransactionReferenceNormalizationVersion ?? null,
        operationalTimezone: context.operationalTimezone,
        operationalLocalDate: new Date(`${localDate}T00:00:00.000Z`),
        occurredAt: context.occurredAt,
        ...(input.safeMetadata
          ? { safeMetadata: input.safeMetadata as Prisma.InputJsonValue }
          : {}),
        ledgerHashVersion: 1,
        previousEntryHash: payload.previousEntryHash,
        entryHash,
      },
    });
    return { entry, projection };
  }

  private async requiredStampCount(
    transaction: Prisma.TransactionClient,
    programVersionId: string,
  ): Promise<number> {
    const rule = await transaction.stampRule.findUnique({
      where: { versionId: programVersionId },
      select: { requiredStampCount: true },
    });
    if (!rule) throw new AppError("PROGRAM_NOT_OPERATIONAL", "Stamp policy missing.", 409);
    return rule.requiredStampCount;
  }

  private async persistProjection(
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

  private async queueWalletUpdates(
    transaction: Prisma.TransactionClient,
    walletPassInstanceIds: readonly string[],
    eventKey: string,
    reason: string,
    projection: ProjectionState,
  ) {
    for (const walletPassInstanceId of walletPassInstanceIds) {
      await queueWalletPassStateChange(transaction, {
        walletPassInstanceId,
        commandType: "UPDATE",
        reason,
        eventKey,
        safePayload: {
          projectionVersion: projection.projectionVersion,
          currentCycleStampCount: projection.currentCycleStampCount,
          completedCycleCount: projection.completedCycleCount,
          rewardReady: projection.rewardReady,
        },
      });
    }
  }

  private async managerOverrideValid(
    transaction: Prisma.TransactionClient,
    context: StaffOperationContext,
    approvalPublicId: string,
    membershipId: string,
    entitlementId?: string,
    requestFingerprint?: string,
  ): Promise<boolean> {
    if (!approvalPublicId) return false;
    const consumedAt = new Date();
    const approval = await transaction.managerApprovalChallenge.updateMany({
      where: {
        publicId: approvalPublicId,
        organizationId: context.organizationId,
        membershipId,
        ...(context.deviceId ? { staffDeviceId: context.deviceId } : {}),
        locationId: context.locationId,
        status: "APPROVED",
        consumedAt: null,
        expiresAt: { gt: new Date() },
        ...(entitlementId ? { rewardEntitlementId: entitlementId } : {}),
        ...(requestFingerprint ? { requestFingerprint } : {}),
      },
      data: { status: "CONSUMED", consumedAt },
    });
    if (approval.count !== 1) return false;
    await transaction.auditLog.create({
      data: {
        organizationId: context.organizationId,
        action: "operation.manager_approval_consumed",
        targetType: "manager_approval",
        targetId: approvalPublicId,
        locationId: context.locationId,
        requestId: context.requestId,
        metadata: { membershipId, entitlementId: entitlementId ?? null },
      },
    });
    return true;
  }

  private async persistRiskDecisions(
    transaction: Prisma.TransactionClient,
    membership: Awaited<ReturnType<LoyaltyOperationService["loadMembership"]>> & object,
    context: StaffOperationContext,
    operationCommandId: string,
    signals: ReturnType<typeof evaluateRiskRules>["signals"],
  ) {
    if (!membership) return;
    const windowStart = new Date();
    windowStart.setUTCMinutes(0, 0, 0);
    for (const signal of signals) {
      const deduplicationKey = riskDeduplicationKey({
        ruleCode: signal.ruleCode,
        organizationId: membership.organizationId,
        subjectId: membership.id,
        windowStart,
      });
      await transaction.operationalRiskSignal.upsert({
        where: {
          organizationId_deduplicationKey: {
            organizationId: membership.organizationId,
            deduplicationKey,
          },
        },
        create: {
          organizationId: membership.organizationId,
          programId: membership.programId,
          membershipId: membership.id,
          staffMemberId: context.organizationMemberId,
          ...(context.deviceId ? { staffDeviceId: context.deviceId } : {}),
          locationId: context.locationId,
          operationCommandId,
          ruleCode: signal.ruleCode,
          severity: signal.severity,
          score: signal.score,
          ruleVersion: signal.ruleVersion,
          deduplicationKey,
          deduplicationWindowStart: windowStart,
          safeEvidence: signal.safeEvidence as Prisma.InputJsonValue,
        },
        update: {},
      });
    }
  }

  private async evaluateAndPersistOperationalRisk(
    transaction: Prisma.TransactionClient,
    membership: Awaited<ReturnType<LoyaltyOperationService["loadMembership"]>> & object,
    context: StaffOperationContext,
    operationCommandId: string,
    operationType: "STAMP" | "REDEEM" | "REVERSE" | "OTHER",
    overrides: { dailyCapOverride?: boolean; purchasePolicyOverride?: boolean } = {},
  ) {
    if (!membership) return;
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    const minuteAgo = new Date(now.getTime() - 60_000);
    const [
      deviceOperations,
      staffOperations,
      touched,
      repeated,
      lastStamp,
      reversals,
      total,
      approvals,
    ] = await Promise.all([
      context.deviceId
        ? transaction.loyaltyOperationCommand.count({
            where: { actorDeviceId: context.deviceId, createdAt: { gte: minuteAgo } },
          })
        : 0,
      transaction.loyaltyOperationCommand.count({
        where: { actorMemberId: context.organizationMemberId, createdAt: { gte: hourAgo } },
      }),
      transaction.loyaltyOperationCommand.findMany({
        where: { actorMemberId: context.organizationMemberId, createdAt: { gte: hourAgo } },
        distinct: ["membershipId"],
        select: { membershipId: true },
        take: 100,
      }),
      transaction.loyaltyOperationCommand.count({
        where: { membershipId: membership.id, createdAt: { gte: minuteAgo } },
      }),
      transaction.loyaltyLedgerEntry.findFirst({
        where: { membershipId: membership.id, eventType: "STAMP_ISSUED" },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      }),
      transaction.loyaltyOperationCommand.count({
        where: {
          actorMemberId: context.organizationMemberId,
          operationType: { in: ["REVERSE_STAMP", "REVERSE_REDEMPTION"] },
          createdAt: { gte: hourAgo },
        },
      }),
      transaction.loyaltyOperationCommand.count({
        where: { actorMemberId: context.organizationMemberId, createdAt: { gte: hourAgo } },
      }),
      transaction.managerApprovalChallenge.count({
        where: {
          requestedByMemberId: context.organizationMemberId,
          consumedAt: { gte: hourAgo },
        },
      }),
    ]);
    const decision = evaluateRiskRules({
      deviceOperationsLastMinute: deviceOperations,
      deviceOperationLimit: this.environment.values.OPERATION_RATE_LIMIT_PER_DEVICE_MINUTE,
      staffOperationsLastHour: staffOperations,
      staffOperationLimit: this.environment.values.OPERATION_RATE_LIMIT_PER_STAFF_HOUR,
      membershipsTouchedLastHour: touched.length,
      sameMembershipOperationsLastMinute: repeated,
      secondsSinceLastStamp: lastStamp
        ? Math.max(0, (now.getTime() - lastStamp.occurredAt.getTime()) / 1_000)
        : null,
      operationType,
      reversalRate: total === 0 ? 0 : reversals / total,
      managerOverridesLastHour: approvals,
      dailyCapOverride: overrides.dailyCapOverride ?? false,
      purchasePolicyOverride: overrides.purchasePolicyOverride ?? false,
    });
    await this.persistRiskDecisions(
      transaction,
      membership,
      context,
      operationCommandId,
      decision.signals,
    );
  }

  private async createRiskSignal(
    transaction: Prisma.TransactionClient,
    membership: Awaited<ReturnType<LoyaltyOperationService["loadMembership"]>> & object,
    context: StaffOperationContext,
    operationCommandId: string,
    input: {
      ruleCode: string;
      severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      score: number;
      evidence: Readonly<Record<string, unknown>>;
    },
  ) {
    if (!membership) return;
    const windowStart = new Date();
    windowStart.setUTCMinutes(0, 0, 0);
    const deduplicationKey = riskDeduplicationKey({
      ruleCode: input.ruleCode,
      organizationId: membership.organizationId,
      subjectId: membership.id,
      windowStart,
    });
    await transaction.operationalRiskSignal.upsert({
      where: {
        organizationId_deduplicationKey: {
          organizationId: membership.organizationId,
          deduplicationKey,
        },
      },
      create: {
        organizationId: membership.organizationId,
        programId: membership.programId,
        membershipId: membership.id,
        staffMemberId: context.organizationMemberId,
        ...(context.deviceId ? { staffDeviceId: context.deviceId } : {}),
        locationId: context.locationId,
        operationCommandId,
        ruleCode: input.ruleCode,
        severity: input.severity,
        score: input.score,
        ruleVersion: "w4r1-v1",
        deduplicationKey,
        deduplicationWindowStart: windowStart,
        safeEvidence: input.evidence as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
}

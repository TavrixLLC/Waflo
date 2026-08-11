import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { type Environment, parseEnvironment, parseVersionedSecretEntries } from "@waflo/config";
import { type BillingStatus, type PlanCode } from "@waflo/contracts";
import { createCustomerDataKeyring, decryptCustomerValue } from "@waflo/customer-security";
import {
  createPrismaClient,
  type Prisma,
  type PrismaClient,
  queueWalletPassStateChange,
} from "@waflo/database";
import {
  createAppleClientSecret,
  createExternalAuthTokenKeyring,
  decryptExternalAuthToken,
  type ExternalAuthTokenKeyring,
  resolveApplePrivateKey,
} from "@waflo/external-auth-security";
import {
  calculateLedgerEntryHash,
  canonicalJson,
  LEDGER_GENESIS_HASH,
  type ProjectionState,
  rebuildProjection,
  reduceProjectionEvent,
  verifyLedgerHashChain,
} from "@waflo/loyalty-ledger";
import { operationalLocalDate } from "@waflo/loyalty-policy";
import {
  createCsv,
  type OperationalExportType,
  operationalDateBucket,
} from "@waflo/operational-analytics";
import Stripe from "stripe";

const LEASE_SECONDS = 90;

function stripeStatus(status: Stripe.Subscription.Status): BillingStatus {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "paused") return "suspended";
  return "canceled";
}

function dbBillingStatus(status: BillingStatus) {
  return status.toUpperCase() as
    | "PENDING_ACTIVATION"
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "GRACE_PERIOD"
    | "SUSPENDED"
    | "CANCELED";
}

function dbPlanCode(plan: PlanCode) {
  return plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE";
}

function log(event: string, metadata: Record<string, unknown> = {}) {
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      service: "waflo-operational-worker",
      environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "development",
      release: process.env.RELEASE_SHA ?? "unknown",
      instance: process.env.SERVICE_INSTANCE_ID ?? process.env.HOSTNAME ?? "local",
      event,
      ...metadata,
    })}\n`,
  );
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function encryptPrivateObject(plaintext: Buffer, objectKey: string, secret: string): Buffer {
  const key = createHash("sha256").update(secret, "utf8").digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`waflo-private-object:${objectKey}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.from(
    [
      "wpo1",
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join("."),
    "utf8",
  );
}

function asFilters(value: Prisma.JsonValue): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => ["string", "number", "boolean"].includes(typeof item) || item === null,
    ),
  ) as Record<string, string | number | boolean | null>;
}

function aggregateKey(input: {
  organizationId: string;
  programId: string;
  programVersionId: string | null;
  locationId: string | null;
  staffMemberId: string | null;
  localDate: string;
  timezone: string;
}) {
  return [
    input.organizationId,
    input.programId,
    input.programVersionId ?? "-",
    input.locationId ?? "-",
    input.staffMemberId ?? "-",
    input.localDate,
    input.timezone,
  ].join(":");
}

function projectionFingerprint(projection: ProjectionState): string {
  return fingerprint({
    currentCycleStampCount: projection.currentCycleStampCount,
    completedCycleCount: projection.completedCycleCount,
    rewardReady: projection.rewardReady,
    projectionVersion: projection.projectionVersion,
    lastSourceEventId: projection.lastSourceEventId,
  });
}

interface AnalyticsContributionInput {
  readonly sourceKind: "ENROLLMENT" | "LEDGER" | "RISK";
  readonly sourceId: string;
  readonly organizationId: string;
  readonly programId: string;
  readonly programVersionId: string | null;
  readonly membershipId: string | null;
  readonly locationId: string | null;
  readonly staffMemberId: string | null;
  readonly localDate: string;
  readonly timezone: string;
  readonly occurredAt: Date;
  readonly factType: string;
  readonly value: number;
  readonly sourceSequence: number;
  readonly metrics: {
    readonly enrollments?: number;
    readonly activeMemberships?: number;
    readonly stampUnitsIssued?: number;
    readonly stampOperations?: number;
    readonly reversals?: number;
    readonly rewardsUnlocked?: number;
    readonly rewardsRedeemed?: number;
    readonly redemptionReversals?: number;
    readonly uniqueActiveMembers?: number;
    readonly completedCycles?: number;
    readonly riskSignals?: number;
    readonly overrides?: number;
    readonly walletAdoptions?: number;
  };
}

export class OperationalWorker {
  private readonly workerId = `operations-${randomUUID()}`;
  private readonly objectStorage: S3Client;
  private readonly customerKeyring;
  private readonly externalAuthTokenKeyring: ExternalAuthTokenKeyring | null;
  private readonly stripe: Stripe | null;
  private stopping = false;
  providerFetch: typeof fetch = fetch;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly environment: Environment,
  ) {
    this.objectStorage = new S3Client({
      endpoint: environment.OBJECT_STORAGE_ENDPOINT,
      region: environment.OBJECT_STORAGE_REGION,
      forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: environment.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
    });
    this.customerKeyring = createCustomerDataKeyring(
      environment.CUSTOMER_DATA_ACTIVE_KEY_VERSION,
      parseVersionedSecretEntries(
        environment.CUSTOMER_DATA_ENCRYPTION_KEYS_JSON,
        environment.CUSTOMER_DATA_ENCRYPTION_KEY_V1,
      ),
    );
    this.externalAuthTokenKeyring =
      environment.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEYS_JSON ||
      environment.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEY_V1
        ? createExternalAuthTokenKeyring(
            environment.EXTERNAL_AUTH_TOKEN_ACTIVE_KEY_VERSION,
            parseVersionedSecretEntries(
              environment.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEYS_JSON,
              environment.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEY_V1 ?? "",
            ),
          )
        : null;
    this.stripe = environment.STRIPE_SECRET_KEY
      ? new Stripe(environment.STRIPE_SECRET_KEY, {
          appInfo: { name: "Waflo Operational Worker", version: "1.0.0" },
        })
      : null;
  }

  async readiness() {
    await this.prisma.$queryRaw`SELECT 1`;
    const now = new Date();
    await this.prisma.workerHeartbeat.upsert({
      where: {
        workerCode_instanceId: {
          workerCode: "OPERATIONAL_WORKER",
          instanceId: this.workerId,
        },
      },
      create: {
        workerCode: "OPERATIONAL_WORKER",
        instanceId: this.workerId,
        startedAt: now,
        lastLoopAt: now,
      },
      update: {
        startedAt: now,
        lastLoopAt: now,
        stoppingAt: null,
        safeFailureCode: null,
      },
    });
    return { status: "ready" as const };
  }

  async stop() {
    this.stopping = true;
    await this.prisma.workerHeartbeat.updateMany({
      where: { workerCode: "OPERATIONAL_WORKER", instanceId: this.workerId },
      data: { stoppingAt: new Date() },
    });
  }

  close() {
    this.objectStorage.destroy();
  }

  async run() {
    await this.readiness();
    log("ready");
    while (!this.stopping) {
      try {
        const result = await this.runOnce();
        if (Object.values(result).some((value) => value > 0)) log("batch_processed", result);
        await this.recordHeartbeat(true);
      } catch {
        await this.recordHeartbeat(false, "LOOP_FAILED").catch(() => undefined);
        log("loop_failed", { safeFailureCode: "LOOP_FAILED" });
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
    }
  }

  async runOnce() {
    return {
      rewardsExpired: await this.expireRewards(),
      analyticsRows: await this.processIncrementalAnalytics(),
      exportsProcessed: (await this.processOneExport()) ? 1 : 0,
      privacyRequestsProcessed: (await this.processOnePrivacyRequest()) ? 1 : 0,
      appleRevocationsProcessed: (await this.processOneAppleTokenRevocation()) ? 1 : 0,
      stripeSubscriptionsReconciled: await this.reconcileStripeSubscriptions(),
      integrityFindings: await this.sampleProjectionIntegrity(),
      cleanupItems: await this.cleanupExpiredState(),
    };
  }

  async processOneAppleTokenRevocation(): Promise<boolean> {
    const now = new Date();
    const candidate = await this.prisma.appleTokenRevocationJob.findFirst({
      where: {
        tokenEncrypted: { not: null },
        nextAttemptAt: { lte: now },
        OR: [{ status: "PENDING" }, { status: "PROCESSING", leaseExpiresAt: { lt: now } }],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return false;
    const leaseExpiresAt = new Date(now.getTime() + LEASE_SECONDS * 1_000);
    const claimed = await this.prisma.appleTokenRevocationJob.updateMany({
      where: {
        id: candidate.id,
        tokenEncrypted: { not: null },
        nextAttemptAt: { lte: now },
        OR: [{ status: "PENDING" }, { status: "PROCESSING", leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: this.workerId,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return false;
    const job = await this.prisma.appleTokenRevocationJob.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    try {
      const privateKey = resolveApplePrivateKey(
        this.environment.APPLE_SIGNIN_PRIVATE_KEY,
        this.environment.APPLE_SIGNIN_PRIVATE_KEY_BASE64,
      );
      if (
        !this.externalAuthTokenKeyring ||
        !privateKey ||
        !this.environment.APPLE_SIGNIN_CLIENT_ID ||
        !this.environment.APPLE_SIGNIN_TEAM_ID ||
        !this.environment.APPLE_SIGNIN_KEY_ID ||
        !job.tokenEncrypted
      ) {
        throw new Error("APPLE_REVOCATION_CONFIG_UNAVAILABLE");
      }
      if (Number(job.tokenEncrypted.split(".")[1]) !== job.tokenKeyVersion) {
        throw new Error("APPLE_REVOCATION_KEY_VERSION_MISMATCH");
      }
      const token = decryptExternalAuthToken(job.tokenEncrypted, {
        contextId: job.encryptionContextId,
        purpose: job.tokenType === "REFRESH_TOKEN" ? "apple-refresh-token" : "apple-access-token",
        keyring: this.externalAuthTokenKeyring,
      });
      const clientSecret = await createAppleClientSecret({
        privateKey,
        teamId: this.environment.APPLE_SIGNIN_TEAM_ID,
        keyId: this.environment.APPLE_SIGNIN_KEY_ID,
        clientId: this.environment.APPLE_SIGNIN_CLIENT_ID,
      });
      const response = await this.providerFetch("https://appleid.apple.com/auth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.environment.APPLE_SIGNIN_CLIENT_ID,
          client_secret: clientSecret,
          token,
          token_type_hint: job.tokenType === "REFRESH_TOKEN" ? "refresh_token" : "access_token",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("APPLE_REVOCATION_PROVIDER_REJECTED");
      await this.prisma.appleTokenRevocationJob.updateMany({
        where: { id: job.id, status: "PROCESSING", leaseOwner: this.workerId },
        data: {
          status: "COMPLETED",
          tokenEncrypted: null,
          tokenClearedAt: new Date(),
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastFailureCode: null,
        },
      });
      return true;
    } catch {
      const exhausted = job.attemptCount >= 8;
      await this.prisma.appleTokenRevocationJob.updateMany({
        where: { id: job.id, status: "PROCESSING", leaseOwner: this.workerId },
        data: exhausted
          ? {
              status: "DEAD_LETTER",
              tokenEncrypted: null,
              tokenClearedAt: new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: "APPLE_REVOCATION_RETRY_EXHAUSTED",
            }
          : {
              status: "PENDING",
              nextAttemptAt: new Date(
                Date.now() + Math.min(2 ** job.attemptCount * 30_000, 6 * 60 * 60 * 1_000),
              ),
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: "APPLE_REVOCATION_RETRY_SCHEDULED",
            },
      });
      return true;
    }
  }

  async reconcileStripeSubscriptions(): Promise<number> {
    if (!this.stripe) return 0;
    const now = new Date();
    const dueBefore = new Date(
      now.getTime() - this.environment.STRIPE_RECONCILIATION_INTERVAL_MINUTES * 60 * 1000,
    );
    const candidates = await this.prisma.subscription.findMany({
      where: {
        organization: { status: "ACTIVE" },
        OR: [{ lastProviderSyncAt: null }, { lastProviderSyncAt: { lte: dueBefore } }],
        AND: [
          {
            OR: [
              { reconciliationLeaseExpiresAt: null },
              { reconciliationLeaseExpiresAt: { lte: now } },
            ],
          },
        ],
      },
      orderBy: [{ lastProviderSyncAt: "asc" }, { createdAt: "asc" }],
      take: this.environment.STRIPE_RECONCILIATION_BATCH_SIZE,
    });
    let reconciled = 0;
    for (const candidate of candidates) {
      const leaseExpiresAt = new Date(Date.now() + LEASE_SECONDS * 1000);
      const claim = await this.prisma.subscription.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { reconciliationLeaseExpiresAt: null },
            { reconciliationLeaseExpiresAt: { lte: new Date() } },
          ],
        },
        data: {
          reconciliationLeaseOwner: this.workerId,
          reconciliationLeaseExpiresAt: leaseExpiresAt,
          reconciliationAttemptCount: { increment: 1 },
          reconciliationFailureCode: null,
        },
      });
      if (claim.count !== 1) continue;
      try {
        const canonical = await this.stripe.subscriptions.retrieve(candidate.stripeSubscriptionId, {
          expand: ["items.data.price"],
        });
        await this.applyStripeReconciliation(candidate.id, canonical, leaseExpiresAt);
        reconciled += 1;
      } catch (error) {
        const missing =
          (error instanceof Stripe.errors.StripeInvalidRequestError &&
            error.code === "resource_missing") ||
          (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "resource_missing");
        if (missing) {
          await this.applyMissingStripeSubscription(candidate.id, leaseExpiresAt);
          reconciled += 1;
        } else {
          const retryAt = new Date(
            Date.now() +
              Math.min(30, Math.max(5, candidate.reconciliationAttemptCount + 1) * 5) * 60 * 1000,
          );
          await this.prisma.$transaction(async (transaction) => {
            await transaction.subscription.updateMany({
              where: {
                id: candidate.id,
                reconciliationLeaseOwner: this.workerId,
                reconciliationLeaseExpiresAt: leaseExpiresAt,
              },
              data: {
                reconciliationLeaseOwner: null,
                reconciliationLeaseExpiresAt: retryAt,
                reconciliationFailureCode: "PROVIDER_RETRIEVAL_FAILED",
              },
            });
            await transaction.auditLog.create({
              data: {
                organizationId: candidate.organizationId,
                action: "stripe.scheduled_reconciliation_failed",
                targetType: "subscription",
                targetId: candidate.stripeSubscriptionId,
                requestId: `stripe-reconcile:${candidate.id}`,
                metadata: { safeFailureCode: "PROVIDER_RETRIEVAL_FAILED", retryAt },
              },
            });
          });
        }
      }
    }
    return reconciled;
  }

  private async applyStripeReconciliation(
    subscriptionId: string,
    canonical: Stripe.Subscription,
    leaseExpiresAt: Date,
  ) {
    const price = canonical.items.data[0]?.price;
    const plan = this.planForStripePrice(price?.id);
    const customerId =
      typeof canonical.customer === "string" ? canonical.customer : canonical.customer.id;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1::int AS locked
        FROM pg_advisory_xact_lock(hashtextextended(${`stripe-subscription:${canonical.id}`}, 0))
      `;
      const local = await transaction.subscription.findFirstOrThrow({
        where: {
          id: subscriptionId,
          reconciliationLeaseOwner: this.workerId,
          reconciliationLeaseExpiresAt: leaseExpiresAt,
        },
      });
      const profile = await transaction.organizationBillingProfile.findUniqueOrThrow({
        where: { organizationId: local.organizationId },
      });
      if (
        canonical.id !== local.stripeSubscriptionId ||
        canonical.metadata.organizationId !== local.organizationId ||
        !profile.stripeCustomerId ||
        profile.stripeCustomerId !== customerId
      ) {
        throw new Error("STRIPE_RECONCILIATION_OWNERSHIP_MISMATCH");
      }
      const status = dbBillingStatus(stripeStatus(canonical.status));
      await transaction.subscription.update({
        where: { id: local.id },
        data: {
          stripePriceId: price?.id ?? local.stripePriceId,
          planCode: dbPlanCode(plan),
          status,
          currentPeriodStart: canonical.items.data[0]?.current_period_start
            ? new Date(canonical.items.data[0].current_period_start * 1000)
            : null,
          currentPeriodEnd: canonical.items.data[0]?.current_period_end
            ? new Date(canonical.items.data[0].current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: canonical.cancel_at_period_end,
          canceledAt: canonical.canceled_at ? new Date(canonical.canceled_at * 1000) : null,
          lastProviderSyncAt: new Date(),
          reconciliationLeaseOwner: null,
          reconciliationLeaseExpiresAt: null,
          reconciliationFailureCode: null,
        },
      });
      await transaction.organizationBillingProfile.update({
        where: { organizationId: local.organizationId },
        data: { subscriptionStatus: status, selectedPlan: dbPlanCode(plan) },
      });
      await transaction.organization.update({
        where: { id: local.organizationId },
        data: { selectedPlan: dbPlanCode(plan) },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: local.organizationId,
          action: "stripe.scheduled_reconciled",
          targetType: "subscription",
          targetId: canonical.id,
          requestId: `stripe-reconcile:${local.id}`,
          metadata: { canonicalProviderState: true },
        },
      });
    });
  }

  private async applyMissingStripeSubscription(subscriptionId: string, leaseExpiresAt: Date) {
    await this.prisma.$transaction(async (transaction) => {
      const local = await transaction.subscription.findFirstOrThrow({
        where: {
          id: subscriptionId,
          reconciliationLeaseOwner: this.workerId,
          reconciliationLeaseExpiresAt: leaseExpiresAt,
        },
      });
      await transaction.subscription.update({
        where: { id: local.id },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
          lastProviderSyncAt: new Date(),
          reconciliationLeaseOwner: null,
          reconciliationLeaseExpiresAt: null,
          reconciliationFailureCode: null,
        },
      });
      await transaction.organizationBillingProfile.update({
        where: { organizationId: local.organizationId },
        data: { subscriptionStatus: "CANCELED" },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: local.organizationId,
          action: "stripe.scheduled_reconciliation_missing_subscription",
          targetType: "subscription",
          targetId: local.stripeSubscriptionId,
          requestId: `stripe-reconcile:${local.id}`,
        },
      });
    });
  }

  private planForStripePrice(priceId: string | undefined): PlanCode {
    if (priceId === this.environment.STRIPE_STARTER_MONTHLY_PRICE_ID) return "starter";
    if (priceId === this.environment.STRIPE_GROWTH_MONTHLY_PRICE_ID) return "growth";
    if (priceId === this.environment.STRIPE_SCALE_MONTHLY_PRICE_ID) return "scale";
    throw new Error("STRIPE_PRICE_UNKNOWN");
  }

  private async recordHeartbeat(success: boolean, safeFailureCode?: string) {
    const now = new Date();
    const [backlogCount, oldest] = await Promise.all([
      this.prisma.customerPrivacyRequest.count({
        where: { status: { in: ["PENDING", "FAILED"] } },
      }),
      this.prisma.customerPrivacyRequest.findFirst({
        where: { status: { in: ["PENDING", "FAILED"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    await this.prisma.workerHeartbeat.updateMany({
      where: { workerCode: "OPERATIONAL_WORKER", instanceId: this.workerId },
      data: {
        lastLoopAt: now,
        ...(success
          ? { lastSuccessAt: now, safeFailureCode: null }
          : { lastFailureAt: now, safeFailureCode: safeFailureCode ?? "LOOP_FAILED" }),
        backlogCount,
        oldestBacklogAt: oldest?.createdAt ?? null,
      },
    });
  }

  async expireRewards() {
    const now = new Date();
    const candidates = await this.prisma.rewardEntitlement.findMany({
      where: {
        status: { in: ["AVAILABLE", "PARTIALLY_REDEEMED"] },
        expiresAt: { lte: now },
      },
      include: {
        membership: { select: { programId: true } },
      },
      take: this.environment.REWARD_EXPIRY_BATCH_SIZE,
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    });
    if (candidates.length > 0) {
      await this.prisma.rewardExpiryCommand.createMany({
        data: candidates.map((entitlement) => ({
          organizationId: entitlement.organizationId,
          programId: entitlement.membership.programId,
          entitlementId: entitlement.id,
          membershipId: entitlement.membershipId,
          idempotencyKey: `reward-expiry:${entitlement.id}`,
          nextAttemptAt: now,
          requestFingerprint: fingerprint({
            entitlementId: entitlement.id,
            membershipId: entitlement.membershipId,
            expiresAt: entitlement.expiresAt?.toISOString() ?? null,
          }),
        })),
        skipDuplicates: true,
      });
    }
    const commands = await this.prisma.rewardExpiryCommand.findMany({
      where: {
        nextAttemptAt: { lte: now },
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      take: this.environment.REWARD_EXPIRY_BATCH_SIZE,
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    });
    let expired = 0;
    for (const command of commands) {
      const claimed = await this.prisma.rewardExpiryCommand.updateMany({
        where: {
          id: command.id,
          OR: [
            { status: { in: ["PENDING", "FAILED"] } },
            { status: "PROCESSING", leaseExpiresAt: { lt: now } },
          ],
        },
        data: {
          status: "PROCESSING",
          leaseOwner: this.workerId,
          leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1_000),
          attemptCount: { increment: 1 },
          safeFailureCode: null,
        },
      });
      if (claimed.count !== 1) continue;
      try {
        expired += await this.executeRewardExpiry(command.id);
      } catch {
        const attempts = command.attemptCount + 1;
        const deadLetter = attempts >= 5;
        await this.prisma.$transaction(async (transaction) => {
          await transaction.rewardExpiryCommand.update({
            where: { id: command.id },
            data: {
              status: deadLetter ? "DEAD_LETTER" : "FAILED",
              safeFailureCode: "REWARD_EXPIRY_FAILED",
              leaseOwner: null,
              leaseExpiresAt: null,
              nextAttemptAt: new Date(Date.now() + Math.min(attempts * 30_000, 300_000)),
            },
          });
          await transaction.auditLog.create({
            data: {
              organizationId: command.organizationId,
              action: deadLetter ? "worker.dead_letter" : "reward.expiry_failed",
              targetType: "reward_expiry_command",
              targetId: command.id,
              requestId: `reward-expiry:${command.publicId}`,
              metadata: { safeFailureCode: "REWARD_EXPIRY_FAILED", attemptCount: attempts },
            },
          });
        });
        log("reward_expiry_failed", {
          commandPublicId: command.publicId,
          safeFailureCode: "REWARD_EXPIRY_FAILED",
        });
      }
    }
    return expired;
  }

  async processIncrementalAnalytics() {
    let processed = 0;
    for (const sourceKind of ["ENROLLMENT", "LEDGER", "RISK"] as const) {
      processed += await this.processAnalyticsSource(sourceKind);
    }
    if (await this.processOneAnalyticsJob()) processed += 1;
    return processed;
  }

  private async executeRewardExpiry(commandId: string): Promise<number> {
    const seed = await this.prisma.rewardExpiryCommand.findUniqueOrThrow({
      where: { id: commandId },
    });
    return this.prisma.$transaction(
      async (transaction) => {
        for (const key of [
          `organization:${seed.organizationId}`,
          `program-lifecycle:${seed.programId}`,
          `membership:${seed.membershipId}`,
          `reward-expiry:${seed.id}`,
        ]) {
          await transaction.$queryRaw`
            SELECT 1::int AS locked
            FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))
          `;
        }
        const command = await transaction.rewardExpiryCommand.findUniqueOrThrow({
          where: { id: seed.id },
        });
        if (command.status !== "PROCESSING" || command.leaseOwner !== this.workerId) return 0;
        const entitlement = await transaction.rewardEntitlement.findUniqueOrThrow({
          where: { id: command.entitlementId },
          include: {
            rewardDefinition: { select: { thresholdStampCount: true } },
            membership: {
              include: {
                progress: true,
                enrollmentProgramVersion: {
                  select: {
                    operationalTimezone: true,
                    stampRule: { select: { requiredStampCount: true } },
                  },
                },
                walletPassInstances: {
                  where: { status: { notIn: ["INVALIDATED", "INVALIDATION_PENDING"] } },
                  select: { id: true },
                },
              },
            },
          },
        });
        const goal = entitlement.membership.enrollmentProgramVersion.stampRule?.requiredStampCount;
        if (!goal || !entitlement.membership.progress)
          throw new Error("MEMBERSHIP_PROJECTION_MISSING");
        const finalReward = entitlement.rewardDefinition.thresholdStampCount >= goal;
        if (finalReward) {
          await this.createWorkerRiskSignal(transaction, {
            organizationId: command.organizationId,
            programId: command.programId,
            membershipId: command.membershipId,
            ruleCode: "FINAL_REWARD_EXPIRY_BLOCKED",
            severity: "HIGH",
            score: 85,
            safeEvidence: { entitlementPublicId: entitlement.publicId },
          });
          await transaction.rewardExpiryCommand.update({
            where: { id: command.id },
            data: {
              status: "COMPLETED",
              safeFailureCode: "FINAL_REWARD_NON_EXPIRING",
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: new Date(),
            },
          });
          return 0;
        }
        if (
          !["AVAILABLE", "PARTIALLY_REDEEMED"].includes(entitlement.status) ||
          !entitlement.expiresAt ||
          entitlement.expiresAt > new Date()
        ) {
          await transaction.rewardExpiryCommand.update({
            where: { id: command.id },
            data: {
              status: "COMPLETED",
              safeFailureCode: "NO_LONGER_ELIGIBLE",
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: new Date(),
            },
          });
          return 0;
        }
        const operationCommand = await transaction.loyaltyOperationCommand.upsert({
          where: {
            organizationId_idempotencyKey: {
              organizationId: command.organizationId,
              idempotencyKey: command.idempotencyKey,
            },
          },
          create: {
            organizationId: command.organizationId,
            membershipId: command.membershipId,
            operationType: "EXPIRE_REWARD",
            idempotencyKey: command.idempotencyKey,
            requestFingerprint: command.requestFingerprint,
            leaseOwner: this.workerId,
            leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1_000),
            attemptCount: 1,
          },
          update: {},
        });
        if (operationCommand.requestFingerprint !== command.requestFingerprint) {
          throw new Error("OPERATION_IDEMPOTENCY_CONFLICT");
        }
        if (operationCommand.status === "COMPLETED") {
          await transaction.rewardExpiryCommand.update({
            where: { id: command.id },
            data: {
              status: "COMPLETED",
              operationCommandId: operationCommand.id,
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: operationCommand.completedAt ?? new Date(),
            },
          });
          return 0;
        }
        const prior = this.projectionState(entitlement.membership.progress);
        const appended = await this.appendWorkerLedgerEntry(transaction, {
          membership: entitlement.membership,
          operationCommandId: operationCommand.id,
          eventType: "REWARD_EXPIRED",
          rewardEntitlementId: entitlement.id,
          occurredAt: new Date(),
          safeMetadata: { expiryCommandPublicId: command.publicId },
        });
        const transitioned = await transaction.rewardEntitlement.updateMany({
          where: { id: entitlement.id, status: { in: ["AVAILABLE", "PARTIALLY_REDEEMED"] } },
          data: { status: "EXPIRED" },
        });
        if (transitioned.count !== 1) throw new Error("REWARD_EXPIRY_TRANSITION_LOST");
        await this.persistWorkerProjection(transaction, command.membershipId, appended.projection);
        for (const pass of entitlement.membership.walletPassInstances) {
          await queueWalletPassStateChange(transaction, {
            walletPassInstanceId: pass.id,
            commandType: "UPDATE",
            reason: "REWARD_EXPIRED",
            eventKey: `reward-expiry:${command.id}`,
            safePayload: {
              entitlementPublicId: entitlement.publicId,
              projectionVersion: appended.projection.projectionVersion,
            },
          });
        }
        const completedAt = new Date();
        await transaction.loyaltyOperationCommand.update({
          where: { id: operationCommand.id },
          data: {
            status: "COMPLETED",
            resultLedgerEntryIds: [appended.entry.id],
            resultProjectionVersion: appended.projection.projectionVersion,
            resultPayload: {
              entitlementPublicId: entitlement.publicId,
              status: "EXPIRED",
              priorProjectionVersion: prior.projectionVersion,
              projectionVersion: appended.projection.projectionVersion,
            },
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt,
          },
        });
        await transaction.rewardExpiryCommand.update({
          where: { id: command.id },
          data: {
            status: "COMPLETED",
            operationCommandId: operationCommand.id,
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt,
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: command.organizationId,
            action: "reward.expired",
            targetType: "reward_entitlement",
            targetId: entitlement.id,
            requestId: `reward-expiry:${command.publicId}`,
            metadata: {
              expiryCommandPublicId: command.publicId,
              operationPublicId: operationCommand.publicId,
              projectionVersion: appended.projection.projectionVersion,
            },
          },
        });
        return 1;
      },
      { isolationLevel: "ReadCommitted" },
    );
  }

  private async processAnalyticsSource(
    sourceKind: "ENROLLMENT" | "LEDGER" | "RISK",
  ): Promise<number> {
    const checkpoint = await this.prisma.operationalAnalyticsCheckpoint.upsert({
      where: { sourceKind },
      create: { sourceKind },
      update: {},
    });
    const now = new Date();
    const claimed = await this.prisma.operationalAnalyticsCheckpoint.updateMany({
      where: {
        id: checkpoint.id,
        nextAttemptAt: { lte: now },
        OR: [
          { status: { in: ["PENDING", "COMPLETED", "FAILED"] } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1_000),
        attemptCount: { increment: 1 },
        safeFailureCode: null,
      },
    });
    if (claimed.count !== 1) return 0;
    try {
      const contributions = await this.loadAnalyticsBatch(sourceKind, checkpoint);
      for (const contribution of contributions) {
        await this.applyAnalyticsContribution(contribution);
      }
      const last = contributions.at(-1);
      await this.prisma.operationalAnalyticsCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
          status: "COMPLETED",
          attemptCount: 0,
          cursorOccurredAt: last?.occurredAt ?? checkpoint.cursorOccurredAt,
          cursorSourceId: last?.sourceId ?? checkpoint.cursorSourceId,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + (contributions.length ? 0 : 5_000)),
          completedAt: new Date(),
        },
      });
      return contributions.length;
    } catch {
      const attemptCount = checkpoint.attemptCount + 1;
      await this.prisma.operationalAnalyticsCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
          status: attemptCount >= 8 ? "DEAD_LETTER" : "FAILED",
          safeFailureCode: "ANALYTICS_INCREMENT_FAILED",
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + Math.min(attemptCount * 30_000, 300_000)),
        },
      });
      log("analytics_increment_failed", {
        sourceKind,
        safeFailureCode: "ANALYTICS_INCREMENT_FAILED",
      });
      return 0;
    }
  }

  private async loadAnalyticsBatch(
    sourceKind: "ENROLLMENT" | "LEDGER" | "RISK",
    checkpoint: { cursorOccurredAt: Date | null; cursorSourceId: string | null },
  ): Promise<AnalyticsContributionInput[]> {
    if (sourceKind === "ENROLLMENT") {
      const rows = await this.prisma.membership.findMany({
        where: checkpoint.cursorOccurredAt
          ? {
              OR: [
                { enrolledAt: { gt: checkpoint.cursorOccurredAt } },
                {
                  enrolledAt: checkpoint.cursorOccurredAt,
                  id: { gt: checkpoint.cursorSourceId ?? "00000000-0000-0000-0000-000000000000" },
                },
              ],
            }
          : {},
        include: {
          enrollmentProgramVersion: { select: { operationalTimezone: true } },
          walletPassInstances: { select: { id: true }, take: 1 },
        },
        orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
        take: this.environment.ANALYTICS_BATCH_SIZE,
      });
      return rows.map((row) => {
        const timezone = row.enrollmentProgramVersion.operationalTimezone;
        return {
          sourceKind,
          sourceId: row.id,
          organizationId: row.organizationId,
          programId: row.programId,
          programVersionId: row.enrollmentProgramVersionId,
          membershipId: row.id,
          locationId: null,
          staffMemberId: null,
          localDate: operationalDateBucket(row.enrolledAt, timezone),
          timezone,
          occurredAt: row.enrolledAt,
          factType: "MEMBERSHIP_ENROLLED",
          value: 1,
          sourceSequence: 0,
          metrics: {
            enrollments: 1,
            activeMemberships: row.status === "ACTIVE" ? 1 : 0,
            walletAdoptions: row.walletPassInstances.length > 0 ? 1 : 0,
          },
        };
      });
    }
    if (sourceKind === "LEDGER") {
      const rows = await this.prisma.loyaltyLedgerEntry.findMany({
        where: checkpoint.cursorOccurredAt
          ? {
              OR: [
                { recordedAt: { gt: checkpoint.cursorOccurredAt } },
                {
                  recordedAt: checkpoint.cursorOccurredAt,
                  id: { gt: checkpoint.cursorSourceId ?? "00000000-0000-0000-0000-000000000000" },
                },
              ],
            }
          : {},
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        take: this.environment.ANALYTICS_BATCH_SIZE,
      });
      return rows.map((row) => ({
        sourceKind,
        sourceId: row.id,
        organizationId: row.organizationId,
        programId: row.programId,
        programVersionId: row.programVersionId,
        membershipId: row.membershipId,
        locationId: row.locationId,
        staffMemberId: row.staffOrganizationMemberId,
        localDate: row.operationalLocalDate.toISOString().slice(0, 10),
        timezone: row.operationalTimezone,
        occurredAt: row.recordedAt,
        factType: row.eventType,
        value: row.eventType === "STAMP_ISSUED" ? row.stampDelta : 1,
        sourceSequence: row.membershipSequence,
        metrics: this.ledgerAnalyticsMetrics(row.eventType, row.stampDelta, row.safeMetadata),
      }));
    }
    const rows = await this.prisma.operationalRiskSignal.findMany({
      where: {
        programId: { not: null },
        ...(checkpoint.cursorOccurredAt
          ? {
              OR: [
                { createdAt: { gt: checkpoint.cursorOccurredAt } },
                {
                  createdAt: checkpoint.cursorOccurredAt,
                  id: { gt: checkpoint.cursorSourceId ?? "00000000-0000-0000-0000-000000000000" },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: this.environment.ANALYTICS_BATCH_SIZE,
    });
    const membershipIds = rows.flatMap((row) => (row.membershipId ? [row.membershipId] : []));
    const memberships = await this.prisma.membership.findMany({
      where: { id: { in: membershipIds } },
      include: { enrollmentProgramVersion: { select: { operationalTimezone: true } } },
    });
    const membershipById = new Map(memberships.map((item) => [item.id, item]));
    return rows.flatMap((row) => {
      if (!row.programId) return [];
      const membership = row.membershipId ? membershipById.get(row.membershipId) : undefined;
      const timezone = membership?.enrollmentProgramVersion.operationalTimezone ?? "Asia/Baghdad";
      return [
        {
          sourceKind,
          sourceId: row.id,
          organizationId: row.organizationId,
          programId: row.programId,
          programVersionId: membership?.enrollmentProgramVersionId ?? null,
          membershipId: row.membershipId,
          locationId: row.locationId,
          staffMemberId: row.staffMemberId,
          localDate: operationalDateBucket(row.createdAt, timezone),
          timezone,
          occurredAt: row.createdAt,
          factType: "RISK_SIGNAL_CREATED",
          value: row.score,
          sourceSequence: 0,
          metrics: { riskSignals: 1 },
        },
      ];
    });
  }

  private ledgerAnalyticsMetrics(
    eventType: string,
    stampDelta: number,
    safeMetadata: Prisma.JsonValue,
  ): AnalyticsContributionInput["metrics"] {
    const override =
      safeMetadata && typeof safeMetadata === "object" && !Array.isArray(safeMetadata)
        ? Boolean(safeMetadata.dailyCapOverridden || safeMetadata.purchasePolicyOverridden)
        : false;
    switch (eventType) {
      case "STAMP_ISSUED":
        return { stampUnitsIssued: stampDelta, stampOperations: 1, overrides: override ? 1 : 0 };
      case "STAMP_REVERSED":
        return { reversals: 1 };
      case "MILESTONE_REWARD_UNLOCKED":
      case "FINAL_REWARD_UNLOCKED":
        return { rewardsUnlocked: 1 };
      case "REWARD_REDEEMED":
        return { rewardsRedeemed: 1 };
      case "REWARD_REDEMPTION_REVERSED":
        return { redemptionReversals: 1 };
      case "CYCLE_RESET":
        return { completedCycles: 1 };
      default:
        return {};
    }
  }

  private async applyAnalyticsContribution(input: AnalyticsContributionInput): Promise<void> {
    const key = aggregateKey(input);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1::int AS locked
        FROM pg_advisory_xact_lock(hashtextextended(${`analytics-rebuild:${input.organizationId}`}, 0))
      `;
      const existing = await transaction.operationalAnalyticsContribution.findUnique({
        where: { sourceKind_sourceId: { sourceKind: input.sourceKind, sourceId: input.sourceId } },
      });
      if (existing) return;
      let uniqueActiveMembers = input.metrics.uniqueActiveMembers ?? 0;
      if (input.sourceKind === "LEDGER" && input.membershipId) {
        const priorActivity = await transaction.operationalAnalyticsFact.findFirst({
          where: {
            organizationId: input.organizationId,
            programId: input.programId,
            programVersionId: input.programVersionId,
            membershipId: input.membershipId,
            locationId: input.locationId,
            staffMemberId: input.staffMemberId,
            localDate: new Date(`${input.localDate}T00:00:00.000Z`),
            sourceKind: "LEDGER",
            factType: { in: ["STAMP_ISSUED", "REWARD_REDEEMED"] },
          },
          select: { id: true },
        });
        if (!priorActivity && ["STAMP_ISSUED", "REWARD_REDEEMED"].includes(input.factType)) {
          uniqueActiveMembers = 1;
        }
      }
      const metrics = { ...input.metrics, uniqueActiveMembers };
      await transaction.operationalAnalyticsContribution.create({
        data: {
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          organizationId: input.organizationId,
          aggregateKey: key,
          metrics: metrics as Prisma.InputJsonValue,
          occurredAt: input.occurredAt,
        },
      });
      await transaction.operationalAnalyticsFact.create({
        data: {
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          organizationId: input.organizationId,
          programId: input.programId,
          programVersionId: input.programVersionId,
          membershipId: input.membershipId,
          locationId: input.locationId,
          staffMemberId: input.staffMemberId,
          factType: input.factType,
          value: input.value,
          localDate: new Date(`${input.localDate}T00:00:00.000Z`),
          timezone: input.timezone,
          occurredAt: input.occurredAt,
        },
      });
      await transaction.operationalDailyAggregate.upsert({
        where: { aggregateKey: key },
        create: {
          aggregateKey: key,
          organizationId: input.organizationId,
          programId: input.programId,
          programVersionId: input.programVersionId,
          locationId: input.locationId,
          staffMemberId: input.staffMemberId,
          localDate: new Date(`${input.localDate}T00:00:00.000Z`),
          timezone: input.timezone,
          sourceSequence: input.sourceSequence,
          ...metrics,
        },
        update: {
          enrollments: { increment: metrics.enrollments ?? 0 },
          activeMemberships: { increment: metrics.activeMemberships ?? 0 },
          stampUnitsIssued: { increment: metrics.stampUnitsIssued ?? 0 },
          stampOperations: { increment: metrics.stampOperations ?? 0 },
          reversals: { increment: metrics.reversals ?? 0 },
          rewardsUnlocked: { increment: metrics.rewardsUnlocked ?? 0 },
          rewardsRedeemed: { increment: metrics.rewardsRedeemed ?? 0 },
          redemptionReversals: { increment: metrics.redemptionReversals ?? 0 },
          uniqueActiveMembers: { increment: uniqueActiveMembers },
          completedCycles: { increment: metrics.completedCycles ?? 0 },
          riskSignals: { increment: metrics.riskSignals ?? 0 },
          overrides: { increment: metrics.overrides ?? 0 },
          walletAdoptions: { increment: metrics.walletAdoptions ?? 0 },
        },
      });
    });
  }

  private async processOneAnalyticsJob(): Promise<boolean> {
    const now = new Date();
    const candidate = await this.prisma.operationalAnalyticsJob.findFirst({
      where: {
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return false;
    const claimed = await this.prisma.operationalAnalyticsJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1_000),
        attemptCount: { increment: 1 },
        safeFailureCode: null,
      },
    });
    if (claimed.count !== 1) return false;
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT 1::int AS locked
          FROM pg_advisory_xact_lock(hashtextextended(${`analytics-rebuild:${candidate.organizationId}`}, 0))
        `;
        const facts = await transaction.operationalAnalyticsFact.findMany({
          where: {
            organizationId: candidate.organizationId,
            localDate: { gte: candidate.fromDate, lte: candidate.toDate },
          },
          select: { id: true, sourceKind: true, sourceId: true },
          orderBy: [{ localDate: "asc" }, { id: "asc" }],
          take: this.environment.ANALYTICS_BATCH_SIZE,
        });
        if (facts.length > 0) {
          await transaction.operationalAnalyticsContribution.deleteMany({
            where: {
              OR: facts.map((fact) => ({ sourceKind: fact.sourceKind, sourceId: fact.sourceId })),
            },
          });
          await transaction.operationalAnalyticsFact.deleteMany({
            where: { id: { in: facts.map((fact) => fact.id) } },
          });
          await transaction.operationalAnalyticsJob.update({
            where: { id: candidate.id },
            data: {
              status: "PENDING",
              attemptCount: 0,
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
          return;
        }
        await transaction.operationalDailyAggregate.deleteMany({
          where: {
            organizationId: candidate.organizationId,
            localDate: { gte: candidate.fromDate, lte: candidate.toDate },
          },
        });
        await transaction.operationalAnalyticsCheckpoint.updateMany({
          where: { sourceKind: { in: ["ENROLLMENT", "LEDGER", "RISK"] } },
          data: {
            status: "PENDING",
            cursorOccurredAt: new Date(candidate.fromDate.getTime() - 2 * 86_400_000),
            cursorSourceId: null,
            nextAttemptAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await transaction.operationalAnalyticsJob.update({
          where: { id: candidate.id },
          data: {
            status: "COMPLETED",
            attemptCount: 0,
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: new Date(),
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: candidate.organizationId,
            action: "analytics.rebuild_completed",
            targetType: "operational_analytics_job",
            targetId: candidate.id,
            requestId: `analytics-job:${candidate.publicId}`,
            metadata: {
              jobType: candidate.jobType,
              fromDate: candidate.fromDate.toISOString().slice(0, 10),
              toDate: candidate.toDate.toISOString().slice(0, 10),
              clearedFactsInFinalBatch: facts.length,
            },
          },
        });
      });
    } catch {
      const attemptCount = candidate.attemptCount + 1;
      const deadLetter = attemptCount >= 5;
      await this.prisma.$transaction(async (transaction) => {
        await transaction.operationalAnalyticsJob.update({
          where: { id: candidate.id },
          data: {
            status: deadLetter ? "DEAD_LETTER" : "FAILED",
            safeFailureCode: "ANALYTICS_REBUILD_FAILED",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: candidate.organizationId,
            action: deadLetter ? "worker.dead_letter" : "analytics.rebuild_failed",
            targetType: "operational_analytics_job",
            targetId: candidate.id,
            requestId: `analytics-job:${candidate.publicId}`,
            metadata: { safeFailureCode: "ANALYTICS_REBUILD_FAILED", attemptCount },
          },
        });
      });
      log("analytics_rebuild_failed", {
        jobPublicId: candidate.publicId,
        safeFailureCode: "ANALYTICS_REBUILD_FAILED",
      });
    }
    return true;
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

  private async appendWorkerLedgerEntry(
    transaction: Prisma.TransactionClient,
    input: {
      membership: {
        id: string;
        organizationId: string;
        customerId: string;
        programId: string;
        enrollmentProgramVersionId: string;
        progress: {
          currentCycleStampCount: number;
          completedCycleCount: number;
          rewardReady: boolean;
          projectionVersion: number;
          lastSourceEventId: string | null;
        } | null;
        enrollmentProgramVersion: {
          operationalTimezone: string;
          stampRule: { requiredStampCount: number } | null;
        };
      };
      operationCommandId: string;
      eventType: "REWARD_EXPIRED";
      rewardEntitlementId: string;
      occurredAt: Date;
      safeMetadata: Record<string, unknown>;
    },
  ) {
    const progress = input.membership.progress;
    const rule = input.membership.enrollmentProgramVersion.stampRule;
    if (!progress || !rule) throw new Error("MEMBERSHIP_PROJECTION_MISSING");
    const last = await transaction.loyaltyLedgerEntry.findFirst({
      where: { membershipId: input.membership.id },
      orderBy: { membershipSequence: "desc" },
    });
    const sequence = (last?.membershipSequence ?? 0) + 1;
    if (sequence !== progress.projectionVersion + 1) throw new Error("PROJECTION_DRIFT_DETECTED");
    const id = randomUUID();
    const localDate = operationalLocalDate(
      input.occurredAt,
      input.membership.enrollmentProgramVersion.operationalTimezone,
    );
    const payload = {
      id,
      organizationId: input.membership.organizationId,
      membershipId: input.membership.id,
      customerId: input.membership.customerId,
      programId: input.membership.programId,
      programVersionId: input.membership.enrollmentProgramVersionId,
      locationId: null,
      staffOrganizationMemberId: null,
      staffDeviceId: null,
      eventType: input.eventType,
      membershipSequence: sequence,
      cycleNumber: progress.completedCycleCount + 1,
      stampDelta: 0,
      rewardEntitlementId: input.rewardEntitlementId,
      rewardRedemptionId: null,
      reversalOfEntryId: null,
      operationCommandId: input.operationCommandId,
      purchaseAmountMinor: null,
      purchaseCurrency: null,
      merchantTransactionReference: null,
      merchantTransactionReferenceKeyVersion: null,
      merchantTransactionReferenceNormalizationVersion: null,
      operationalTimezone: input.membership.enrollmentProgramVersion.operationalTimezone,
      operationalLocalDate: localDate,
      occurredAt: input.occurredAt.toISOString(),
      safeMetadata: input.safeMetadata,
      previousEntryHash: last?.entryHash ?? LEDGER_GENESIS_HASH,
    } as const;
    const entryHash = calculateLedgerEntryHash(payload, this.environment.LEDGER_HASH_SECRET_V1);
    const projection = reduceProjectionEvent(
      this.projectionState(progress),
      {
        id,
        eventType: input.eventType,
        membershipSequence: sequence,
        cycleNumber: progress.completedCycleCount + 1,
        stampDelta: 0,
      },
      { requiredStampCount: rule.requiredStampCount },
    );
    const entry = await transaction.loyaltyLedgerEntry.create({
      data: {
        id,
        organizationId: input.membership.organizationId,
        membershipId: input.membership.id,
        customerId: input.membership.customerId,
        programId: input.membership.programId,
        programVersionId: input.membership.enrollmentProgramVersionId,
        eventType: input.eventType,
        membershipSequence: sequence,
        cycleNumber: progress.completedCycleCount + 1,
        rewardEntitlementId: input.rewardEntitlementId,
        operationCommandId: input.operationCommandId,
        operationalTimezone: input.membership.enrollmentProgramVersion.operationalTimezone,
        operationalLocalDate: new Date(`${localDate}T00:00:00.000Z`),
        occurredAt: input.occurredAt,
        safeMetadata: input.safeMetadata as Prisma.InputJsonValue,
        ledgerHashVersion: 1,
        previousEntryHash: payload.previousEntryHash,
        entryHash,
      },
    });
    return { entry, projection };
  }

  private async persistWorkerProjection(
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

  private async createWorkerRiskSignal(
    transaction: Prisma.TransactionClient,
    input: {
      organizationId: string;
      programId: string;
      membershipId: string;
      ruleCode: string;
      severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      score: number;
      safeEvidence: Record<string, unknown>;
    },
  ) {
    const windowStart = new Date();
    windowStart.setUTCMinutes(0, 0, 0);
    const deduplicationKey = fingerprint({
      ruleCode: input.ruleCode,
      membershipId: input.membershipId,
      windowStart: windowStart.toISOString(),
    });
    const existing = await transaction.operationalRiskSignal.findUnique({
      where: {
        organizationId_deduplicationKey: {
          organizationId: input.organizationId,
          deduplicationKey,
        },
      },
    });
    if (existing) return existing;
    return transaction.operationalRiskSignal.create({
      data: {
        ...input,
        ruleVersion: "w4r1-v1",
        deduplicationKey,
        deduplicationWindowStart: windowStart,
        safeEvidence: input.safeEvidence as Prisma.InputJsonValue,
      },
    });
  }

  async processOneExport() {
    const now = new Date();
    const candidate = await this.prisma.exportCommand.findFirst({
      where: {
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return false;
    const claimed = await this.prisma.exportCommand.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1_000),
        retryCount: { increment: 1 },
        safeFailureCode: null,
      },
    });
    if (claimed.count !== 1) return false;
    try {
      const rows = await this.exportRows(
        candidate.organizationId,
        candidate.exportType,
        asFilters(candidate.filters),
      );
      if (rows.length > this.environment.EXPORT_MAX_ROWS) {
        throw new Error("EXPORT_ROW_LIMIT_EXCEEDED");
      }
      const content = createCsv(candidate.exportType, rows);
      const objectKey = `private/exports/${candidate.organizationId}/${candidate.publicId}.csv`;
      const encryptedContent = encryptPrivateObject(
        Buffer.from(content, "utf8"),
        objectKey,
        this.environment.OBJECT_STORAGE_SIGNING_SECRET,
      );
      await this.objectStorage.send(
        new PutObjectCommand({
          Bucket: this.environment.OBJECT_STORAGE_BUCKET,
          Key: objectKey,
          Body: encryptedContent,
          ContentType: "application/octet-stream",
          Metadata: {
            exportType: candidate.exportType,
            filterFingerprint: candidate.filterFingerprint,
            encryption: "wpo1-aes-256-gcm",
          },
        }),
      );
      await this.prisma.$transaction(async (transaction) => {
        await transaction.exportCommand.update({
          where: { id: candidate.id },
          data: {
            status: "COMPLETED",
            objectKey,
            rowCount: rows.length,
            completedAt: new Date(),
            expiresAt: new Date(Date.now() + this.environment.EXPORT_TTL_HOURS * 60 * 60_000),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: candidate.organizationId,
            actorUserId: candidate.requestedByUserId,
            action: "export.completed",
            targetType: "export_command",
            targetId: candidate.id,
            requestId: `export-worker:${candidate.publicId}`,
            metadata: { exportType: candidate.exportType, rowCount: rows.length },
          },
        });
      });
    } catch (error) {
      log("export_failed", {
        exportPublicId: candidate.publicId,
        failure:
          error instanceof Error && error.message === "EXPORT_ROW_LIMIT_EXCEEDED"
            ? error.message
            : "EXPORT_BUILD_FAILED",
        safeFailureCode: "EXPORT_BUILD_FAILED",
      });
      const safeFailureCode =
        error instanceof Error && error.message === "EXPORT_ROW_LIMIT_EXCEEDED"
          ? error.message
          : "EXPORT_BUILD_FAILED";
      const deadLetter =
        safeFailureCode === "EXPORT_ROW_LIMIT_EXCEEDED" || candidate.retryCount + 1 >= 5;
      await this.prisma.$transaction(async (transaction) => {
        await transaction.exportCommand.update({
          where: { id: candidate.id },
          data: {
            status: deadLetter ? "DEAD_LETTER" : "FAILED",
            safeFailureCode,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: candidate.organizationId,
            actorUserId: candidate.requestedByUserId,
            action: deadLetter ? "worker.dead_letter" : "export.failed",
            targetType: "export_command",
            targetId: candidate.id,
            requestId: `export-worker:${candidate.publicId}`,
            metadata: { exportType: candidate.exportType, safeFailureCode },
          },
        });
      });
    }
    return true;
  }

  private async exportRows(
    organizationId: string,
    exportType: OperationalExportType,
    filters: Record<string, string | number | boolean | null>,
  ): Promise<Array<Record<string, unknown>>> {
    const take = this.environment.EXPORT_MAX_ROWS + 1;
    const programId = typeof filters.programId === "string" ? filters.programId : undefined;
    const locationId = typeof filters.locationId === "string" ? filters.locationId : undefined;
    switch (exportType) {
      case "MEMBERSHIP_SUMMARY": {
        const rows = await this.prisma.membership.findMany({
          where: { organizationId, ...(programId ? { programId } : {}) },
          include: {
            customer: {
              select: {
                displayName: true,
                contacts: {
                  where: { type: "EMAIL", isPrimary: true, archivedAt: null },
                  select: { maskedDisplayValue: true },
                },
              },
            },
            program: { select: { internalName: true } },
            enrollmentProgramVersion: {
              select: {
                versionNumber: true,
                stampRule: { select: { requiredStampCount: true } },
              },
            },
            progress: true,
          },
          take,
          orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
        });
        return rows.map((item) => ({
          membership_public_id: item.publicMembershipId,
          customer_display_name: item.customer.displayName,
          masked_contact: item.customer.contacts[0]?.maskedDisplayValue ?? "",
          program_name: item.program.internalName,
          program_version: item.enrollmentProgramVersion.versionNumber,
          membership_status: item.status,
          current_stamps: item.progress?.currentCycleStampCount ?? 0,
          goal: item.enrollmentProgramVersion.stampRule?.requiredStampCount ?? 0,
          completed_cycles: item.progress?.completedCycleCount ?? 0,
        }));
      }
      case "LEDGER_OPERATIONS": {
        const rows = await this.prisma.loyaltyLedgerEntry.findMany({
          where: {
            organizationId,
            ...(programId ? { programId } : {}),
            ...(locationId ? { locationId } : {}),
          },
          include: { operationCommand: { select: { publicId: true } } },
          take,
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        });
        const [memberships, locations, members] = await Promise.all([
          this.prisma.membership.findMany({
            where: { id: { in: [...new Set(rows.map((item) => item.membershipId))] } },
            select: { id: true, publicMembershipId: true },
          }),
          this.prisma.location.findMany({
            where: {
              id: { in: rows.flatMap((item) => (item.locationId ? [item.locationId] : [])) },
            },
            select: { id: true, name: true },
          }),
          this.prisma.organizationMember.findMany({
            where: {
              id: {
                in: rows.flatMap((item) =>
                  item.staffOrganizationMemberId ? [item.staffOrganizationMemberId] : [],
                ),
              },
            },
            select: { id: true, user: { select: { displayName: true } } },
          }),
        ]);
        const membershipMap = new Map(
          memberships.map((item) => [item.id, item.publicMembershipId]),
        );
        const locationMap = new Map(locations.map((item) => [item.id, item.name]));
        const staffMap = new Map(members.map((item) => [item.id, item.user.displayName]));
        return rows.map((item) => ({
          operation_public_id: item.operationCommand.publicId,
          membership_public_id: membershipMap.get(item.membershipId) ?? "",
          event_type: item.eventType,
          stamp_delta: item.stampDelta,
          cycle_number: item.cycleNumber,
          sequence: item.membershipSequence,
          location_name: item.locationId ? (locationMap.get(item.locationId) ?? "") : "",
          staff_display_name: item.staffOrganizationMemberId
            ? (staffMap.get(item.staffOrganizationMemberId) ?? "")
            : "",
          occurred_at: item.occurredAt,
        }));
      }
      case "REWARD_REDEMPTIONS": {
        const rows = await this.prisma.rewardRedemption.findMany({
          where: {
            organizationId,
            ...(locationId ? { locationId } : {}),
            ...(programId ? { rewardDefinition: { version: { programId } } } : {}),
          },
          include: {
            rewardDefinition: { select: { internalName: true } },
          },
          take,
          orderBy: [{ redeemedAt: "asc" }, { id: "asc" }],
        });
        const [memberships, locations] = await Promise.all([
          this.prisma.membership.findMany({
            where: { id: { in: [...new Set(rows.map((item) => item.membershipId))] } },
            select: { id: true, publicMembershipId: true },
          }),
          this.prisma.location.findMany({
            where: { id: { in: [...new Set(rows.map((item) => item.locationId))] } },
            select: { id: true, name: true },
          }),
        ]);
        const membershipMap = new Map(
          memberships.map((item) => [item.id, item.publicMembershipId]),
        );
        const locationMap = new Map(locations.map((item) => [item.id, item.name]));
        return rows.map((item) => ({
          redemption_public_id: item.publicId,
          membership_public_id: membershipMap.get(item.membershipId) ?? "",
          reward_name: item.rewardDefinition.internalName,
          cycle_number: item.cycleNumber,
          status: item.status,
          location_name: locationMap.get(item.locationId) ?? "",
          redeemed_at: item.redeemedAt,
        }));
      }
      case "LOCATION_PERFORMANCE":
      case "STAFF_PERFORMANCE":
      case "AGGREGATE_ANALYTICS": {
        const rows = await this.prisma.operationalDailyAggregate.findMany({
          where: {
            organizationId,
            ...(programId ? { programId } : {}),
            ...(locationId ? { locationId } : {}),
          },
          take,
          orderBy: [{ localDate: "asc" }, { id: "asc" }],
        });
        const [programs, locations, members] = await Promise.all([
          this.prisma.loyaltyProgram.findMany({
            where: { id: { in: [...new Set(rows.map((item) => item.programId))] } },
            select: { id: true, internalName: true },
          }),
          this.prisma.location.findMany({
            where: {
              id: { in: rows.flatMap((item) => (item.locationId ? [item.locationId] : [])) },
            },
            select: { id: true, name: true },
          }),
          this.prisma.organizationMember.findMany({
            where: {
              id: {
                in: rows.flatMap((item) => (item.staffMemberId ? [item.staffMemberId] : [])),
              },
            },
            select: { id: true, user: { select: { displayName: true } } },
          }),
        ]);
        const programMap = new Map(programs.map((item) => [item.id, item.internalName]));
        const locationMap = new Map(locations.map((item) => [item.id, item.name]));
        const staffMap = new Map(members.map((item) => [item.id, item.user.displayName]));
        if (exportType === "LOCATION_PERFORMANCE") {
          return rows.map((item) => ({
            location_name: item.locationId ? (locationMap.get(item.locationId) ?? "") : "",
            local_date: item.localDate,
            stamp_units: item.stampUnitsIssued,
            stamp_operations: item.stampOperations,
            rewards_redeemed: item.rewardsRedeemed,
            completed_cycles: item.completedCycles,
            risk_signals: item.riskSignals,
          }));
        }
        if (exportType === "STAFF_PERFORMANCE") {
          return rows.map((item) => ({
            staff_display_name: item.staffMemberId ? (staffMap.get(item.staffMemberId) ?? "") : "",
            local_date: item.localDate,
            stamp_units: item.stampUnitsIssued,
            stamp_operations: item.stampOperations,
            rewards_redeemed: item.rewardsRedeemed,
            reversals: item.reversals,
            risk_signals: item.riskSignals,
          }));
        }
        return rows.map((item) => ({
          local_date: item.localDate,
          program_name: programMap.get(item.programId) ?? "",
          location_name: item.locationId ? (locationMap.get(item.locationId) ?? "") : "",
          enrollments: item.enrollments,
          active_memberships: item.activeMemberships,
          stamp_units: item.stampUnitsIssued,
          rewards_unlocked: item.rewardsUnlocked,
          rewards_redeemed: item.rewardsRedeemed,
          completed_cycles: item.completedCycles,
        }));
      }
      case "RISK_SIGNALS": {
        const rows = await this.prisma.operationalRiskSignal.findMany({
          where: {
            organizationId,
            ...(programId ? { programId } : {}),
            ...(locationId ? { locationId } : {}),
          },
          take,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        return rows.map((item) => ({
          signal_public_id: item.publicId,
          rule_code: item.ruleCode,
          severity: item.severity,
          status: item.status,
          score: item.score,
          created_at: item.createdAt,
          resolved_at: item.resolvedAt,
        }));
      }
    }
  }

  async processOnePrivacyRequest() {
    const now = new Date();
    const candidate = await this.prisma.customerPrivacyRequest.findFirst({
      where: {
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return false;
    const claimed = await this.prisma.customerPrivacyRequest.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        failureCode: null,
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1_000),
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return false;
    try {
      if (candidate.requestType === "EXPORT") {
        await this.buildPrivacyExport(candidate);
      } else {
        await this.eraseCustomer(candidate);
      }
    } catch {
      const attemptCount = candidate.attemptCount + 1;
      const deadLetter = attemptCount >= 5;
      await this.prisma.$transaction(async (transaction) => {
        await transaction.customerPrivacyRequest.update({
          where: { id: candidate.id },
          data: {
            status: deadLetter ? "DEAD_LETTER" : "FAILED",
            failureCode: "PRIVACY_PROCESSING_FAILED",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: candidate.organizationId,
            actorUserId: candidate.requestedByUserId,
            action: deadLetter ? "worker.dead_letter" : "customer.privacy_processing_failed",
            targetType: "customer_privacy_request",
            targetId: candidate.id,
            requestId: `privacy-worker:${candidate.publicId}`,
            metadata: { safeFailureCode: "PRIVACY_PROCESSING_FAILED", attemptCount },
          },
        });
      });
      log("privacy_processing_failed", {
        requestPublicId: candidate.publicId,
        safeFailureCode: "PRIVACY_PROCESSING_FAILED",
      });
    }
    return true;
  }

  private async buildPrivacyExport(
    request: Prisma.CustomerPrivacyRequestGetPayload<Record<string, never>>,
  ) {
    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { id: request.customerId, organizationId: request.organizationId },
      include: {
        contacts: true,
        consents: true,
        memberships: {
          include: {
            progress: true,
            program: { select: { internalName: true } },
            rewardEntitlements: { include: { redemptions: true } },
          },
        },
      },
    });
    const ledger = await this.prisma.loyaltyLedgerEntry.findMany({
      where: { customerId: customer.id, organizationId: customer.organizationId },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: {
        publicId: true,
        membershipId: true,
        eventType: true,
        membershipSequence: true,
        cycleNumber: true,
        stampDelta: true,
        occurredAt: true,
        operationalLocalDate: true,
      },
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      customer: {
        id: customer.id,
        displayName: customer.displayName,
        preferredLocale: customer.preferredLocale,
        status: customer.status,
        createdAt: customer.createdAt,
        contacts: customer.contacts.map((contact) => ({
          type: contact.type,
          value: decryptCustomerValue(contact.encryptedValue, {
            organizationId: contact.organizationId,
            recordId: contact.id,
            purpose: "customer-email",
            keyring: this.customerKeyring,
          }),
          verificationStatus: contact.verificationStatus,
        })),
        consents: customer.consents,
        memberships: customer.memberships,
      },
      ledger,
    };
    const objectKey = `private/privacy/${request.organizationId}/${request.publicId}.json`;
    const encryptedContent = encryptPrivateObject(
      Buffer.from(JSON.stringify(payload), "utf8"),
      objectKey,
      this.environment.OBJECT_STORAGE_SIGNING_SECRET,
    );
    await this.objectStorage.send(
      new PutObjectCommand({
        Bucket: this.environment.OBJECT_STORAGE_BUCKET,
        Key: objectKey,
        Body: encryptedContent,
        ContentType: "application/octet-stream",
        Metadata: { encryption: "wpo1-aes-256-gcm", contentType: "application/json" },
      }),
    );
    await this.prisma.$transaction(async (transaction) => {
      await transaction.customerPrivacyRequest.update({
        where: { id: request.id },
        data: {
          status: "COMPLETED",
          objectKey,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + this.environment.EXPORT_TTL_HOURS * 60 * 60 * 1_000),
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: request.organizationId,
          actorUserId: request.requestedByUserId,
          action: "customer.privacy_export_completed",
          targetType: "customer_privacy_request",
          targetId: request.id,
          requestId: `privacy-worker:${request.publicId}`,
          metadata: { encryptedObject: true },
        },
      });
    });
  }

  private async eraseCustomer(
    request: Prisma.CustomerPrivacyRequestGetPayload<Record<string, never>>,
  ) {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1::int AS locked
        FROM pg_advisory_xact_lock(hashtextextended(${`organization:${request.organizationId}`}, 0))
      `;
      const lockScope = await transaction.membership.findMany({
        where: { customerId: request.customerId, organizationId: request.organizationId },
        select: { id: true, programId: true },
        orderBy: { id: "asc" },
      });
      const programIds = [...new Set(lockScope.map((item) => item.programId))].sort();
      for (const programId of programIds) {
        await transaction.$queryRaw`
          SELECT 1::int AS locked
          FROM pg_advisory_xact_lock(hashtextextended(${`program-lifecycle:${programId}`}, 0))
        `;
      }
      for (const membership of lockScope) {
        await transaction.$queryRaw`
          SELECT 1::int AS locked
          FROM pg_advisory_xact_lock(hashtextextended(${`membership:${membership.id}`}, 0))
        `;
      }
      await transaction.$queryRaw`
        SELECT 1::int AS locked
        FROM pg_advisory_xact_lock(hashtextextended(${`privacy-erasure:${request.id}`}, 0))
      `;
      const customer = await transaction.customer.findFirstOrThrow({
        where: { id: request.customerId, organizationId: request.organizationId },
        include: {
          contacts: true,
          memberships: {
            include: {
              progress: true,
              enrollmentProgramVersion: {
                select: {
                  operationalTimezone: true,
                  stampRule: { select: { requiredStampCount: true } },
                },
              },
              walletPassInstances: { select: { id: true } },
            },
          },
        },
      });
      for (const membership of customer.memberships) {
        if (!membership.progress) continue;
        if (membership.status !== "REVOKED") {
          await this.appendPrivacyRevocation(transaction, membership, request.id, now);
        }
        for (const pass of membership.walletPassInstances) {
          await queueWalletPassStateChange(transaction, {
            walletPassInstanceId: pass.id,
            commandType: "INVALIDATE",
            reason: "CUSTOMER_ERASURE",
            eventKey: `privacy-erasure:${request.id}:${membership.id}`,
            safePayload: { privacyRequestPublicId: request.publicId },
          });
        }
      }
      const membershipIds = customer.memberships.map((item) => item.id);
      await transaction.membershipAccessSession.updateMany({
        where: { membershipId: { in: membershipIds }, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.membershipCredential.updateMany({
        where: { membershipId: { in: membershipIds }, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      });
      const passIds = customer.memberships.flatMap((item) =>
        item.walletPassInstances.map((pass) => pass.id),
      );
      await transaction.applePassRegistration.updateMany({
        where: { walletPassInstanceId: { in: passIds }, unregisteredAt: null },
        data: {
          pushTokenEncrypted: "erased",
          encryptionKeyVersion: 1,
          unregisteredAt: now,
        },
      });
      await transaction.publicWalletAsset.updateMany({
        where: { membershipId: { in: membershipIds }, revokedAt: null },
        data: { revokedAt: now },
      });
      for (const contact of customer.contacts) {
        const eraseNonce = randomUUID();
        await transaction.customerContact.update({
          where: { id: contact.id },
          data: {
            encryptedValue: `erased:${eraseNonce}`,
            normalizedValueHash: createHash("sha256")
              .update(`erased:${contact.id}:${eraseNonce}`)
              .digest("hex"),
            maskedDisplayValue: "[erased]",
            verificationStatus: "UNVERIFIED",
            verifiedAt: null,
            archivedAt: now,
          },
        });
      }
      await transaction.customerConsent.updateMany({
        where: { customerId: customer.id, revokedAt: null },
        data: { granted: false, revokedAt: now },
      });
      await transaction.customer.update({
        where: { id: customer.id },
        data: {
          displayName: `Erased customer ${fingerprint(customer.id).slice(0, 10)}`,
          status: "ARCHIVED",
          archivedAt: now,
        },
      });
      await transaction.customerPrivacyRequest.update({
        where: { id: request.id },
        data: {
          status: "COMPLETED",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: now,
          outcomeDisposition: "ANONYMIZED",
          retentionNoticeCode: "FINANCIAL_AND_AUDIT_HISTORY_RETAINED",
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: request.organizationId,
          actorUserId: request.requestedByUserId,
          action: "customer.erasure_completed",
          targetType: "customer",
          targetId: customer.id,
          requestId: `privacy-worker:${request.publicId}`,
          metadata: {
            privacyRequestPublicId: request.publicId,
            retainedLedgerHistory: true,
          },
        },
      });
    });
  }

  private async appendPrivacyRevocation(
    transaction: Prisma.TransactionClient,
    membership: Prisma.MembershipGetPayload<{
      include: {
        progress: true;
        enrollmentProgramVersion: {
          select: {
            operationalTimezone: true;
            stampRule: { select: { requiredStampCount: true } };
          };
        };
        walletPassInstances: { select: { id: true } };
      };
    }>,
    privacyRequestId: string,
    occurredAt: Date,
  ) {
    if (!membership.progress || !membership.enrollmentProgramVersion.stampRule) {
      throw new Error("MEMBERSHIP_PROJECTION_MISSING");
    }
    const commandKey = `privacy-erasure:${privacyRequestId}:${membership.id}`;
    const command = await transaction.loyaltyOperationCommand.upsert({
      where: {
        organizationId_idempotencyKey: {
          organizationId: membership.organizationId,
          idempotencyKey: commandKey,
        },
      },
      create: {
        organizationId: membership.organizationId,
        membershipId: membership.id,
        operationType: "REVOKE_MEMBERSHIP",
        idempotencyKey: commandKey,
        requestFingerprint: fingerprint({ commandKey }),
        status: "PROCESSING",
      },
      update: {},
    });
    if (command.status === "COMPLETED") return;
    const last = await transaction.loyaltyLedgerEntry.findFirst({
      where: { membershipId: membership.id },
      orderBy: { membershipSequence: "desc" },
    });
    const prior: ProjectionState = {
      currentCycleStampCount: membership.progress.currentCycleStampCount,
      completedCycleCount: membership.progress.completedCycleCount,
      rewardReady: membership.progress.rewardReady,
      projectionVersion: membership.progress.projectionVersion,
      lastSourceEventId: membership.progress.lastSourceEventId,
    };
    const sequence = (last?.membershipSequence ?? 0) + 1;
    if (sequence !== prior.projectionVersion + 1) {
      throw new Error("PROJECTION_DRIFT_DETECTED");
    }
    const id = randomUUID();
    const timezone = membership.enrollmentProgramVersion.operationalTimezone;
    const localDate = operationalLocalDate(occurredAt, timezone);
    const payload = {
      id,
      organizationId: membership.organizationId,
      membershipId: membership.id,
      customerId: membership.customerId,
      programId: membership.programId,
      programVersionId: membership.enrollmentProgramVersionId,
      locationId: null,
      staffOrganizationMemberId: null,
      staffDeviceId: null,
      eventType: "MEMBERSHIP_REVOKED" as const,
      membershipSequence: sequence,
      cycleNumber: prior.completedCycleCount + 1,
      stampDelta: 0,
      rewardEntitlementId: null,
      rewardRedemptionId: null,
      reversalOfEntryId: null,
      operationCommandId: command.id,
      purchaseAmountMinor: null,
      purchaseCurrency: null,
      merchantTransactionReference: null,
      merchantTransactionReferenceKeyVersion: null,
      merchantTransactionReferenceNormalizationVersion: null,
      operationalTimezone: timezone,
      operationalLocalDate: localDate,
      occurredAt: occurredAt.toISOString(),
      safeMetadata: {
        reason: "CUSTOMER_ERASURE",
        privacyRequestId,
      },
      previousEntryHash: last?.entryHash ?? LEDGER_GENESIS_HASH,
    };
    const entryHash = calculateLedgerEntryHash(payload, this.environment.LEDGER_HASH_SECRET_V1);
    const projection = reduceProjectionEvent(
      prior,
      {
        id,
        eventType: "MEMBERSHIP_REVOKED",
        membershipSequence: sequence,
        cycleNumber: prior.completedCycleCount + 1,
        stampDelta: 0,
      },
      {
        requiredStampCount: membership.enrollmentProgramVersion.stampRule.requiredStampCount,
      },
    );
    await transaction.loyaltyLedgerEntry.create({
      data: {
        ...payload,
        operationalLocalDate: new Date(`${localDate}T00:00:00.000Z`),
        occurredAt,
        ledgerHashVersion: 1,
        entryHash,
      },
    });
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
        projectionFingerprint: projectionFingerprint(projection),
      },
    });
    await transaction.membership.update({
      where: { id: membership.id },
      data: { status: "REVOKED", revokedAt: occurredAt, suspendedAt: null },
    });
    await transaction.loyaltyOperationCommand.update({
      where: { id: command.id },
      data: {
        status: "COMPLETED",
        resultLedgerEntryIds: [id],
        resultProjectionVersion: projection.projectionVersion,
        resultPayload: { status: "REVOKED", privacyErasure: true },
        completedAt: occurredAt,
      },
    });
  }

  async sampleProjectionIntegrity() {
    const memberships = await this.prisma.membership.findMany({
      where: { progress: { isNot: null } },
      include: {
        progress: true,
        enrollmentProgramVersion: {
          select: { stampRule: { select: { requiredStampCount: true } } },
        },
      },
      orderBy: { updatedAt: "asc" },
      take: this.environment.PROJECTION_INTEGRITY_SAMPLE_SIZE,
    });
    let findings = 0;
    for (const membership of memberships) {
      if (!membership.progress || !membership.enrollmentProgramVersion.stampRule) continue;
      const entries = await this.prisma.loyaltyLedgerEntry.findMany({
        where: { membershipId: membership.id },
        orderBy: { membershipSequence: "asc" },
      });
      try {
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
            version === this.environment.LEDGER_HASH_ACTIVE_VERSION
              ? this.environment.LEDGER_HASH_SECRET_V1
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
        const actual: ProjectionState = {
          currentCycleStampCount: membership.progress.currentCycleStampCount,
          completedCycleCount: membership.progress.completedCycleCount,
          rewardReady: membership.progress.rewardReady,
          projectionVersion: membership.progress.projectionVersion,
          lastSourceEventId: membership.progress.lastSourceEventId,
        };
        if (projectionFingerprint(expected) !== projectionFingerprint(actual)) {
          findings += 1;
          await this.ensureRiskSignal({
            organizationId: membership.organizationId,
            programId: membership.programId,
            membershipId: membership.id,
            ruleCode: "PROJECTION_DRIFT",
            severity: "HIGH",
            score: 90,
            safeEvidence: {
              expectedFingerprint: projectionFingerprint(expected),
              actualFingerprint: projectionFingerprint(actual),
            },
          });
        }
      } catch {
        findings += 1;
        await this.ensureRiskSignal({
          organizationId: membership.organizationId,
          programId: membership.programId,
          membershipId: membership.id,
          ruleCode: "LEDGER_INTEGRITY_FAILURE",
          severity: "CRITICAL",
          score: 100,
          safeEvidence: { lastSequence: entries.at(-1)?.membershipSequence ?? 0 },
        });
      }
    }
    return findings;
  }

  private async ensureRiskSignal(input: {
    organizationId: string;
    programId: string;
    membershipId: string;
    ruleCode: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    score: number;
    safeEvidence: Record<string, unknown>;
  }) {
    return this.prisma.$transaction(async (transaction) => {
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);
      const deduplicationKey = fingerprint({
        ruleCode: input.ruleCode,
        membershipId: input.membershipId,
        windowStart: windowStart.toISOString(),
      });
      const existing = await transaction.operationalRiskSignal.findUnique({
        where: {
          organizationId_deduplicationKey: {
            organizationId: input.organizationId,
            deduplicationKey,
          },
        },
      });
      if (existing) return existing;
      const signal = await transaction.operationalRiskSignal.create({
        data: {
          ...input,
          ruleVersion: "w4r1-v1",
          deduplicationKey,
          deduplicationWindowStart: windowStart,
          safeEvidence: input.safeEvidence as Prisma.InputJsonValue,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: input.organizationId,
          action: "integrity.finding",
          targetType: "operational_risk_signal",
          targetId: signal.id,
          requestId: `integrity-worker:${signal.publicId}`,
          metadata: { ruleCode: input.ruleCode, severity: input.severity },
        },
      });
      return signal;
    });
  }

  async cleanupExpiredState() {
    const now = new Date();
    const batch = this.environment.CLEANUP_BATCH_SIZE;
    const retentionCutoff = new Date(
      now.getTime() - this.environment.SECURITY_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const pairings = await this.prisma.devicePairingSession.findMany({
      where: { status: { in: ["PENDING", "CLAIMED"] }, expiresAt: { lte: now } },
      select: { id: true },
      take: batch,
    });
    const approvals = await this.prisma.managerApprovalChallenge.findMany({
      where: { status: { in: ["PENDING", "APPROVED"] }, expiresAt: { lte: now } },
      select: { id: true },
      take: batch,
    });
    const nonces = await this.prisma.deviceRequestNonce.findMany({
      where: { expiresAt: { lte: now } },
      select: { staffDeviceId: true, nonce: true },
      take: batch,
    });
    const invitations = await this.prisma.organizationInvitation.findMany({
      where: { status: "PENDING", expiresAt: { lte: now } },
      select: { id: true },
      take: batch,
    });
    const sessions = await this.prisma.session.findMany({
      where: {
        OR: [{ expiresAt: { lte: retentionCutoff } }, { revokedAt: { lte: retentionCutoff } }],
      },
      select: { id: true },
      take: batch,
    });
    const verificationTokens = await this.prisma.emailVerificationToken.findMany({
      where: {
        OR: [{ expiresAt: { lte: retentionCutoff } }, { consumedAt: { lte: retentionCutoff } }],
      },
      select: { id: true },
      take: batch,
    });
    const resetTokens = await this.prisma.passwordResetToken.findMany({
      where: {
        OR: [{ expiresAt: { lte: retentionCutoff } }, { consumedAt: { lte: retentionCutoff } }],
      },
      select: { id: true },
      take: batch,
    });
    const oauthFlows = await this.prisma.oAuthAuthorizationRequest.findMany({
      where: {
        OR: [{ expiresAt: { lte: retentionCutoff } }, { consumedAt: { lte: retentionCutoff } }],
      },
      select: { id: true },
      take: batch,
    });
    const appleRevocationJobs = await this.prisma.appleTokenRevocationJob.findMany({
      where: {
        status: { in: ["COMPLETED", "DEAD_LETTER"] },
        tokenEncrypted: null,
        updatedAt: { lte: retentionCutoff },
      },
      select: { id: true },
      take: batch,
    });
    const appleNotifications = await this.prisma.appleServerNotification.findMany({
      where: { receivedAt: { lte: retentionCutoff } },
      select: { id: true },
      take: batch,
    });
    const exports = await this.prisma.exportCommand.findMany({
      where: { status: "COMPLETED", expiresAt: { lte: now } },
      select: { id: true, objectKey: true },
      take: batch,
    });
    const privacyExports = await this.prisma.customerPrivacyRequest.findMany({
      where: { requestType: "EXPORT", status: "COMPLETED", expiresAt: { lte: now } },
      select: { id: true, objectKey: true },
      take: batch,
    });
    const mutationCounts = await this.prisma.$transaction(async (transaction) => {
      const pairingResult = await transaction.devicePairingSession.updateMany({
        where: {
          id: { in: pairings.map((item) => item.id) },
          status: { in: ["PENDING", "CLAIMED"] },
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });
      const approvalResult = await transaction.managerApprovalChallenge.updateMany({
        where: {
          id: { in: approvals.map((item) => item.id) },
          status: { in: ["PENDING", "APPROVED"] },
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });
      const nonceResult = await transaction.deviceRequestNonce.deleteMany({
        where: {
          OR: nonces.map((item) => ({ staffDeviceId: item.staffDeviceId, nonce: item.nonce })),
        },
      });
      const invitationResult = await transaction.organizationInvitation.updateMany({
        where: {
          id: { in: invitations.map((item) => item.id) },
          status: "PENDING",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });
      const sessionResult = await transaction.session.deleteMany({
        where: { id: { in: sessions.map((item) => item.id) } },
      });
      const verificationResult = await transaction.emailVerificationToken.deleteMany({
        where: { id: { in: verificationTokens.map((item) => item.id) } },
      });
      const resetResult = await transaction.passwordResetToken.deleteMany({
        where: { id: { in: resetTokens.map((item) => item.id) } },
      });
      const oauthResult = await transaction.oAuthAuthorizationRequest.deleteMany({
        where: { id: { in: oauthFlows.map((item) => item.id) } },
      });
      const appleRevocationResult = await transaction.appleTokenRevocationJob.deleteMany({
        where: { id: { in: appleRevocationJobs.map((item) => item.id) } },
      });
      const appleNotificationResult = await transaction.appleServerNotification.deleteMany({
        where: { id: { in: appleNotifications.map((item) => item.id) } },
      });
      return (
        pairingResult.count +
        approvalResult.count +
        nonceResult.count +
        invitationResult.count +
        sessionResult.count +
        verificationResult.count +
        resetResult.count +
        oauthResult.count +
        appleRevocationResult.count +
        appleNotificationResult.count
      );
    });
    let cleanedObjects = 0;
    for (const item of [...exports, ...privacyExports]) {
      let deleted = !item.objectKey;
      if (item.objectKey) {
        deleted = await this.objectStorage
          .send(
            new DeleteObjectCommand({
              Bucket: this.environment.OBJECT_STORAGE_BUCKET,
              Key: item.objectKey,
            }),
          )
          .then(() => true)
          .catch(() => false);
      }
      // Keep the authoritative reference when storage deletion fails so a later
      // worker pass can retry instead of silently orphaning encrypted data.
      if (!deleted) {
        log("cleanup_object_delete_failed", {
          targetId: item.id,
          safeFailureCode: "OBJECT_DELETE_FAILED",
        });
        continue;
      }
      if (exports.some((exportItem) => exportItem.id === item.id)) {
        await this.prisma.exportCommand.update({
          where: { id: item.id },
          data: { status: "EXPIRED", objectKey: null },
        });
      } else {
        await this.prisma.customerPrivacyRequest.update({
          where: { id: item.id },
          data: { status: "EXPIRED", objectKey: null },
        });
      }
      cleanedObjects += 1;
    }
    return mutationCounts + cleanedObjects;
  }
}

async function main() {
  const environment = parseEnvironment(process.env);
  const prisma = createPrismaClient(environment.DATABASE_URL, {
    max: environment.DATABASE_POOL_MAX,
    connectionTimeoutMillis: environment.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: environment.DATABASE_POOL_IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: environment.DATABASE_POOL_MAX_LIFETIME_SECONDS,
  });
  const worker = new OperationalWorker(prisma, environment);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void worker.stop();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  if (process.argv.includes("--once")) {
    log("one_shot_completed", await worker.runOnce());
    await prisma.$disconnect();
    worker.close();
    return;
  }
  try {
    await worker.run();
  } finally {
    await prisma.$disconnect();
    worker.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch(() => {
    process.stderr.write("Operational worker failed.\n");
    process.exitCode = 1;
  });
}

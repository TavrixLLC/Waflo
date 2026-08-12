import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { connect as connectHttp2 } from "node:http2";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { type Environment, parseEnvironment, parseVersionedSecretEntries } from "@waflo/config";
import {
  createCustomerDataKeyring,
  decodeSecret,
  decryptCustomerValue,
  deriveAppleAuthenticationToken,
  deriveMembershipCredentialSecret,
} from "@waflo/customer-security";
import {
  createPrismaClient,
  lockApplePassUpdateSequence,
  type Prisma,
  type PrismaClient,
  type PublicWalletAsset,
  queueWalletPassStateChange,
  type WalletCommand,
} from "@waflo/database";
import { formatMembershipQrPayload } from "@waflo/qr-core";
import {
  type PublishedMembershipStampRenderInput,
  publishedMembershipStampVisualDigest,
  renderPublishedMembershipStampSvg,
  type StampArtwork,
} from "@waflo/stamp-engine";
import {
  type ApplePassSigner,
  AppleWalletProvider,
  Pkcs7ApplePassSigner,
  TestApplePassSigner,
} from "@waflo/wallet-apple";
import {
  APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
  normalizeWalletProviderError,
  resolveWalletNearbyText,
  type WalletMembershipInput,
  type WalletProgramInput,
  type WalletProvider,
  type WalletProviderCode,
  type WalletUpdateReason,
} from "@waflo/wallet-core";
import { type GoogleServiceAccount, GoogleWalletProvider } from "@waflo/wallet-google";
import { Redis } from "ioredis";
import sharp from "sharp";
import { classifyApplePushResponse } from "./apple-push.js";

const OPERATIONAL_QUEUE_KEY = "waflo:wallet:commands:operational";
const PROMOTIONAL_QUEUE_KEY = "waflo:wallet:commands:promotional";
const SIGNAL_TTL_SECONDS = 180;
const LEASE_SECONDS = 90;

function workerLog(event: string, metadata: Record<string, unknown> = {}) {
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      service: "waflo-wallet-worker",
      environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "development",
      release: process.env.RELEASE_SHA ?? "unknown",
      instance: process.env.SERVICE_INSTANCE_ID ?? process.env.HOSTNAME ?? "local",
      event,
      ...metadata,
    })}\n`,
  );
}

function isS3PreconditionFailure(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "$metadata" in error &&
      error.$metadata &&
      typeof error.$metadata === "object" &&
      "httpStatusCode" in error.$metadata &&
      error.$metadata.httpStatusCode === 412,
  );
}

const passInclude = {
  walletProgramBinding: true,
  membershipCredential: true,
  membership: {
    include: {
      organization: {
        include: {
          walletNearbyConfiguration: {
            include: {
              locations: { include: { location: true }, orderBy: { sortOrder: "asc" as const } },
            },
          },
        },
      },
      customer: true,
      program: { include: { walletNearbyProgramCopy: true } },
      progress: true,
      enrollmentProgramVersion: {
        include: {
          translations: true,
          stampRule: true,
          locations: { select: { locationId: true } },
          visualTheme: {
            include: {
              filledStampAsset: { include: { variants: true } },
              emptyStampAsset: { include: { variants: true } },
            },
          },
        },
      },
    },
  },
} as const;

type PassRecord = Prisma.WalletPassInstanceGetPayload<{ include: typeof passInclude }>;

function bytesFromSource(value: string): Buffer {
  if (existsSync(value)) return readFileSync(value);
  return Buffer.from(value, "base64");
}

function textFromSource(value: string): string {
  if (existsSync(value)) return readFileSync(value, "utf8");
  return Buffer.from(value, "base64").toString("utf8");
}

function serviceAccount(value: string | undefined): GoogleServiceAccount | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(textFromSource(value)) as Partial<GoogleServiceAccount>;
    if (!parsed.client_email || !parsed.private_key?.includes("PRIVATE KEY")) {
      return undefined;
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      ...(parsed.token_uri ? { token_uri: parsed.token_uri } : {}),
    };
  } catch {
    return undefined;
  }
}

function providers(environment: Environment): ReadonlyMap<WalletProviderCode, WalletProvider> {
  let signer: ApplePassSigner | undefined;
  if (environment.APPLE_WALLET_MODE === "TEST_ADAPTER") {
    signer = new TestApplePassSigner();
  } else if (
    environment.APPLE_WALLET_MODE === "REAL" &&
    environment.APPLE_PASS_CERTIFICATE_PATH_OR_BASE64 &&
    environment.APPLE_PASS_CERTIFICATE_PASSWORD &&
    environment.APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64
  ) {
    try {
      signer = new Pkcs7ApplePassSigner(
        bytesFromSource(environment.APPLE_PASS_CERTIFICATE_PATH_OR_BASE64),
        environment.APPLE_PASS_CERTIFICATE_PASSWORD,
        textFromSource(environment.APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64),
      );
    } catch {
      signer = undefined;
    }
  }
  const appleReady =
    environment.APPLE_WALLET_MODE === "TEST_ADAPTER" ||
    (environment.APPLE_WALLET_MODE === "REAL" &&
      Boolean(
        signer &&
          environment.APPLE_PASS_TYPE_IDENTIFIER &&
          environment.APPLE_TEAM_IDENTIFIER &&
          environment.APPLE_PASS_WEB_SERVICE_URL,
      ));
  const appleMode = appleReady ? environment.APPLE_WALLET_MODE : "DISABLED";
  const appleSecrets = parseVersionedSecretEntries(
    environment.APPLE_PASS_AUTH_SECRETS_JSON,
    environment.APPLE_PASS_AUTH_SECRET_V1,
  );
  const activeAppleSecret = appleSecrets[environment.APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION];
  if (!activeAppleSecret)
    throw new Error("Active Apple pass authentication secret is unavailable.");
  const appleSecret = {
    version: environment.APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION,
    secret: decodeSecret(activeAppleSecret),
  };
  const apple = new AppleWalletProvider({
    mode: appleMode,
    ...(appleMode === "DISABLED"
      ? {}
      : {
          configuration: {
            passTypeIdentifier:
              environment.APPLE_PASS_TYPE_IDENTIFIER ?? "pass.app.waflo.test-adapter",
            teamIdentifier: environment.APPLE_TEAM_IDENTIFIER ?? "WAFLOTEST",
            organizationName: environment.APPLE_ORGANIZATION_NAME,
            webServiceUrl:
              environment.APPLE_PASS_WEB_SERVICE_URL ||
              `${environment.API_PUBLIC_URL.replace(/\/+$/, "")}/v1/apple-wallet`,
          },
        }),
    ...(signer ? { signer } : {}),
    authenticationToken: (input) =>
      deriveAppleAuthenticationToken(
        input.walletPassInstanceId,
        input.providerIdentity,
        appleSecret,
      ),
    passDownloadUrl: `${environment.API_PUBLIC_URL.replace(/\/+$/, "")}/v1/customer/wallet/apple/pass`,
  });
  const account = serviceAccount(environment.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_PATH_OR_BASE64);
  const issuerId =
    environment.GOOGLE_WALLET_ISSUER_ID ??
    (environment.GOOGLE_WALLET_MODE === "TEST_ADAPTER" ? "test-issuer" : undefined);
  const googleReady =
    environment.GOOGLE_WALLET_MODE === "TEST_ADAPTER" ||
    (environment.GOOGLE_WALLET_MODE === "REAL" &&
      Boolean(issuerId && account && environment.GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL));
  const google = new GoogleWalletProvider({
    mode: googleReady ? environment.GOOGLE_WALLET_MODE : "DISABLED",
    ...(issuerId ? { issuerId } : {}),
    ...(account ? { serviceAccount: account } : {}),
    allowedOrigins: environment.GOOGLE_WALLET_ALLOWED_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    testActionBaseUrl: `${environment.CUSTOMER_WEB_URL.replace(/\/+$/, "")}/wallet-test/google`,
  });
  return new Map<WalletProviderCode, WalletProvider>([
    ["APPLE", apple],
    ["GOOGLE", google],
  ]);
}

function credentialPayload(pass: PassRecord, environment: Environment): string {
  const configured = parseVersionedSecretEntries(
    environment.MEMBERSHIP_CREDENTIAL_SECRETS_JSON,
    environment.MEMBERSHIP_CREDENTIAL_SECRET_V1,
  );
  const secret = configured[pass.membershipCredential.secretVersion];
  if (!secret) throw new Error("Membership credential secret version is unavailable.");
  const versionedSecret = {
    version: pass.membershipCredential.secretVersion,
    secret: decodeSecret(secret),
  };
  return formatMembershipQrPayload({
    publicCredentialId: pass.membershipCredential.publicCredentialId,
    secretVersion: pass.membershipCredential.secretVersion,
    secret: deriveMembershipCredentialSecret(
      pass.membershipCredential.publicCredentialId,
      pass.membershipCredential.credentialVersion,
      versionedSecret,
    ),
  });
}

function mapPass(
  pass: PassRecord,
  environment: Environment,
  stampRenderInput: PublishedMembershipStampRenderInput,
  progressAssetUrl?: string,
): WalletMembershipInput {
  const membership = pass.membership;
  const version = membership.enrollmentProgramVersion;
  const locale = membership.customer.preferredLocale === "AR" ? "ar" : "en";
  const translation =
    version.translations.find((item) => item.locale === (locale === "ar" ? "AR" : "EN")) ??
    version.translations.find((item) => item.locale === "EN") ??
    version.translations[0];
  return {
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    programId: membership.programId,
    programVersionId: version.id,
    programName: translation?.programName ?? membership.program.internalName,
    description: translation?.shortDescription ?? "",
    rewardSummary: translation?.rewardSummary ?? "",
    backgroundColor: version.visualTheme?.backgroundColor ?? "#F7F4EE",
    foregroundColor: version.visualTheme?.foregroundColor ?? "#241916",
    configurationFingerprint:
      pass.walletProgramBinding?.configurationFingerprint ??
      version.renderFingerprint ??
      createHash("sha256").update(version.id).digest("hex"),
    locale,
    nearbyRelevance: nearbyRelevance({
      enabled: membership.organization.walletNearbyConfiguration?.enabled ?? false,
      locations: membership.organization.walletNearbyConfiguration?.locations ?? [],
      allowedLocationIds: new Set(version.locations.map((item) => item.locationId)),
      templateCode: version.baseTemplateCode,
      businessCategory: membership.organization.businessCategory,
      merchantName: membership.organization.name,
      locale,
      customText:
        locale === "ar"
          ? membership.program.walletNearbyProgramCopy?.appleCustomTextAr
          : membership.program.walletNearbyProgramCopy?.appleCustomTextEn,
    }),
    ...(progressAssetUrl ? { publicAssetBaseUrl: progressAssetUrl } : {}),
    walletPassInstanceId: pass.id,
    providerIdentity: pass.providerIdentity,
    publicMembershipId: membership.publicMembershipId,
    displayName: membership.customer.displayName,
    credentialPayload: credentialPayload(pass, environment),
    currentStampCount: membership.progress?.currentCycleStampCount ?? 0,
    requiredStampCount: version.stampRule?.requiredStampCount ?? 8,
    rewardReady: membership.progress?.rewardReady ?? false,
    membershipStatus: membership.status,
    programStatus: membership.program.status,
    transferred: pass.membershipCredential.status === "TRANSFERRED",
    stampRenderInput,
  };
}

function mapProgram(
  binding: Prisma.WalletProgramBindingGetPayload<{
    include: {
      organization: {
        include: {
          walletNearbyConfiguration: {
            include: {
              locations: { include: { location: true }; orderBy: { sortOrder: "asc" } };
            };
          };
        };
      };
      program: { include: { walletNearbyProgramCopy: true } };
      programVersion: {
        include: {
          translations: true;
          visualTheme: true;
          locations: { select: { locationId: true } };
        };
      };
    };
  }>,
  programLogoUrl?: string,
): WalletProgramInput {
  const locale = binding.organization.defaultLocale === "AR" ? "ar" : "en";
  const translation =
    binding.programVersion.translations.find(
      (item) => item.locale === (locale === "ar" ? "AR" : "EN"),
    ) ??
    binding.programVersion.translations.find((item) => item.locale === "EN") ??
    binding.programVersion.translations[0];
  return {
    organizationId: binding.organizationId,
    organizationName: binding.organization.name,
    programId: binding.programId,
    programVersionId: binding.programVersionId,
    programName: translation?.programName ?? binding.program.internalName,
    description: translation?.shortDescription ?? "",
    rewardSummary: translation?.rewardSummary ?? "",
    backgroundColor: binding.programVersion.visualTheme?.backgroundColor ?? "#F7F4EE",
    foregroundColor: binding.programVersion.visualTheme?.foregroundColor ?? "#241916",
    configurationFingerprint: binding.configurationFingerprint,
    locale,
    nearbyRelevance: nearbyRelevance({
      enabled: binding.organization.walletNearbyConfiguration?.enabled ?? false,
      locations: binding.organization.walletNearbyConfiguration?.locations ?? [],
      allowedLocationIds: new Set(binding.programVersion.locations.map((item) => item.locationId)),
      templateCode: binding.programVersion.baseTemplateCode,
      businessCategory: binding.organization.businessCategory,
      merchantName: binding.organization.name,
      locale,
      customText:
        locale === "ar"
          ? binding.program.walletNearbyProgramCopy?.appleCustomTextAr
          : binding.program.walletNearbyProgramCopy?.appleCustomTextEn,
    }),
    ...(programLogoUrl ? { programLogoUrl } : {}),
  };
}

function nearbyRelevance(input: {
  enabled: boolean;
  allowedLocationIds: ReadonlySet<string>;
  locations: ReadonlyArray<{
    location: {
      id: string;
      name: string;
      status: "ACTIVE" | "ARCHIVED";
      latitude: unknown;
      longitude: unknown;
    };
  }>;
  templateCode?: string | null | undefined;
  businessCategory?: string | null | undefined;
  merchantName: string;
  locale: "en" | "ar";
  customText?: string | null | undefined;
}) {
  const locations = input.locations
    .filter(
      ({ location }) =>
        input.allowedLocationIds.has(location.id) &&
        location.status === "ACTIVE" &&
        location.latitude !== null &&
        location.longitude !== null,
    )
    .slice(0, 10)
    .map(({ location }) => ({
      locationId: location.id,
      displayName: location.name,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      relevantText: resolveWalletNearbyText({
        templateCode: input.templateCode,
        businessCategory: input.businessCategory,
        merchantName: input.merchantName,
        locationName: location.name,
        locale: input.locale,
        customText: input.customText,
      }).text,
    }));
  return {
    enabled: input.enabled && locations.length > 0,
    desiredAppleMaxDistanceMeters: APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
    locations,
  };
}

export class WalletWorker {
  private readonly workerId = `wallet-${randomUUID()}`;
  private readonly providerMap: ReadonlyMap<WalletProviderCode, WalletProvider>;
  private readonly customerKeyring;
  private readonly objectStorage: S3Client;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly environment: Environment,
    providerOverrides?: ReadonlyMap<WalletProviderCode, WalletProvider>,
  ) {
    this.providerMap = providerOverrides ?? providers(environment);
    this.customerKeyring = createCustomerDataKeyring(
      environment.CUSTOMER_DATA_ACTIVE_KEY_VERSION,
      parseVersionedSecretEntries(
        environment.CUSTOMER_DATA_ENCRYPTION_KEYS_JSON,
        environment.CUSTOMER_DATA_ENCRYPTION_KEY_V1,
      ),
    );
    this.objectStorage = new S3Client({
      endpoint: environment.OBJECT_STORAGE_ENDPOINT,
      region: environment.OBJECT_STORAGE_REGION,
      forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: environment.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
    });
  }

  async readiness() {
    await Promise.all([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
      this.objectStorageReady(),
    ]);
    const providerHealth = await Promise.all(
      [...this.providerMap.values()].map((provider) => provider.healthCheck()),
    );
    const now = new Date();
    await this.prisma.workerHeartbeat.upsert({
      where: {
        workerCode_instanceId: {
          workerCode: "WALLET_WORKER",
          instanceId: this.workerId,
        },
      },
      create: {
        workerCode: "WALLET_WORKER",
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
    return { status: "ready" as const, providerHealth };
  }

  async dispatch(limit = 100) {
    const eligible: Prisma.WalletCommandWhereInput = {
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } },
        { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } },
      ],
    };
    const operational = await this.prisma.walletCommand.findMany({
      where: {
        ...eligible,
        commandType: { not: "SEND_PROMOTION" },
      },
      select: { id: true, commandType: true },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
    const promotional =
      operational.length < limit
        ? await this.prisma.walletCommand.findMany({
            where: { ...eligible, commandType: "SEND_PROMOTION" },
            select: { id: true, commandType: true },
            orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
            take: limit - operational.length,
          })
        : [];
    const commands = [...operational, ...promotional];
    let queued = 0;
    for (const command of commands) {
      const signal = `waflo:wallet:queued:${command.id}`;
      const reserved = await this.redis.set(signal, "1", "EX", SIGNAL_TTL_SECONDS, "NX");
      if (reserved !== "OK") continue;
      await this.redis.lpush(
        command.commandType === "SEND_PROMOTION" ? PROMOTIONAL_QUEUE_KEY : OPERATIONAL_QUEUE_KEY,
        command.id,
      );
      queued += 1;
    }
    return queued;
  }

  async run() {
    const ready = await this.readiness();
    workerLog("ready", {
      providers: ready.providerHealth.map((provider) => ({
        provider: provider.provider,
        mode: provider.mode,
        status: provider.status,
      })),
    });
    const consumers = Array.from(
      { length: this.environment.WALLET_WORKER_CONCURRENCY },
      (_, index) => this.consume(index),
    );
    const dispatcher = this.dispatchLoop();
    await Promise.all([...consumers, dispatcher]);
  }

  async stop() {
    this.stopping = true;
    await this.prisma.workerHeartbeat.updateMany({
      where: { workerCode: "WALLET_WORKER", instanceId: this.workerId },
      data: { stoppingAt: new Date() },
    });
  }

  close() {
    this.objectStorage.destroy();
  }

  async processCommandById(commandId: string, slot = 0): Promise<boolean> {
    const command = await this.claim(commandId, slot);
    if (!command) return false;
    await this.execute(command);
    return true;
  }

  private async dispatchLoop() {
    while (!this.stopping) {
      try {
        const campaign = await this.processOneWalletCampaign();
        if (campaign) workerLog("wallet_campaign_batch_processed", campaign);
        const synced = await this.processOneProgramSyncJob();
        if (synced) workerLog("program_wallet_sync_batch_processed", synced);
        const queued = await this.dispatch();
        if (queued > 0) workerLog("commands_queued", { count: queued });
        await this.recordHeartbeat(true);
      } catch {
        await this.recordHeartbeat(false, "DISPATCH_LOOP_FAILED").catch(() => undefined);
        workerLog("dispatch_loop_failed", { safeFailureCode: "DISPATCH_LOOP_FAILED" });
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  private async recordHeartbeat(success: boolean, safeFailureCode?: string) {
    const now = new Date();
    const [backlogCount, oldest] = await Promise.all([
      this.prisma.walletCommand.count({
        where: { status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
      }),
      this.prisma.walletCommand.findFirst({
        where: { status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    await this.prisma.workerHeartbeat.updateMany({
      where: { workerCode: "WALLET_WORKER", instanceId: this.workerId },
      data: {
        lastLoopAt: now,
        ...(success
          ? { lastSuccessAt: now, safeFailureCode: null }
          : { lastFailureAt: now, safeFailureCode: safeFailureCode ?? "WALLET_LOOP_FAILED" }),
        backlogCount,
        oldestBacklogAt: oldest?.createdAt ?? null,
      },
    });
  }

  async processOneProgramSyncJob(jobId?: string): Promise<Record<string, unknown> | null> {
    const now = new Date();
    const candidate = await this.prisma.programWalletSyncJob.findFirst({
      where: {
        ...(jobId ? { id: jobId } : {}),
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return null;
    const claimed = await this.prisma.programWalletSyncJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1_000),
      },
    });
    if (claimed.count !== 1) return null;
    const job = await this.prisma.programWalletSyncJob.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    try {
      if (job.reason === "NEARBY_RELEVANCE_CHANGED") {
        const bindings = await this.prisma.walletProgramBinding.findMany({
          where: {
            organizationId: job.organizationId,
            programId: job.programId,
            provider: "GOOGLE",
            status: { not: "DISABLED" },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const membership = await this.prisma.membership.findFirst({
          where: { organizationId: job.organizationId, programId: job.programId },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        if (membership) {
          for (const binding of bindings) {
            const idempotencyKey = `wallet:google:nearby-template:${job.id}:${binding.id}`;
            await this.prisma.walletCommand.upsert({
              where: { idempotencyKey },
              create: {
                organizationId: job.organizationId,
                membershipId: membership.id,
                provider: "GOOGLE",
                commandType: "ENSURE_TEMPLATE",
                idempotencyKey,
                payloadFingerprint: createHash("sha256").update(idempotencyKey).digest("hex"),
                safePayload: { bindingId: binding.id, reason: "NEARBY_RELEVANCE_CHANGED" },
              },
              update: {},
            });
          }
        }
      }
      const passes = await this.prisma.walletPassInstance.findMany({
        where: {
          organizationId: job.organizationId,
          membership: { programId: job.programId },
          ...(job.action === "reconcile"
            ? {}
            : { membershipCredential: { status: "ACTIVE" as const } }),
          ...(job.cursorCreatedAt && job.cursorPassInstanceId
            ? {
                OR: [
                  { createdAt: { gt: job.cursorCreatedAt } },
                  {
                    createdAt: job.cursorCreatedAt,
                    id: { gt: job.cursorPassInstanceId },
                  },
                ],
              }
            : {}),
          ...(job.action === "restore" || job.action === "reconcile"
            ? {}
            : { status: { not: "INVALIDATED" as const } }),
        },
        select: { id: true, provider: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: job.batchSize,
      });
      if (passes.length === 0) {
        await this.prisma.$transaction([
          this.prisma.programWalletSyncJob.update({
            where: { id: job.id },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
              safeErrorCode: null,
            },
          }),
          this.prisma.auditLog.create({
            data: {
              organizationId: job.organizationId,
              action: "program.wallet_sync_job_completed",
              targetType: "program_wallet_sync_job",
              targetId: job.id,
              requestId: "wallet-worker",
              metadata: { programId: job.programId, processedCount: job.processedCount },
            },
          }),
        ]);
        return { jobId: job.id, processed: 0, completed: true };
      }
      let newlyQueued = 0;
      const lastPass = passes.at(-1);
      if (!lastPass) throw new Error("Program Wallet sync page unexpectedly became empty.");
      await this.prisma.$transaction(
        async (transaction) => {
          if (passes.some((pass) => pass.provider === "APPLE")) {
            await lockApplePassUpdateSequence(transaction);
          }
          for (const pass of passes) {
            const queued = await queueWalletPassStateChange(transaction, {
              walletPassInstanceId: pass.id,
              commandType:
                job.commandType === "INVALIDATE"
                  ? "INVALIDATE"
                  : job.commandType === "RECONCILE"
                    ? "RECONCILE"
                    : "UPDATE",
              reason: job.reason,
              eventKey: `program-sync:${job.id}`,
              safePayload: { programSyncJobId: job.id, programAction: job.action },
            });
            if (!queued.replayed) newlyQueued += 1;
          }
          await transaction.programWalletSyncJob.update({
            where: { id: job.id },
            data: {
              status: "PENDING",
              cursorPassInstanceId: lastPass.id,
              cursorCreatedAt: lastPass.createdAt,
              processedCount: { increment: newlyQueued },
              leaseOwner: null,
              leaseExpiresAt: null,
              nextAttemptAt: new Date(),
              safeErrorCode: null,
            },
          });
        },
        { timeout: 60_000 },
      );
      return {
        jobId: job.id,
        scanned: passes.length,
        processed: newlyQueued,
        completed: false,
      };
    } catch {
      const dead = job.attemptCount >= this.environment.WALLET_COMMAND_MAX_ATTEMPTS;
      await this.prisma.$transaction([
        this.prisma.programWalletSyncJob.update({
          where: { id: job.id },
          data: {
            status: dead ? "DEAD_LETTER" : "FAILED",
            safeErrorCode: "PROGRAM_WALLET_SYNC_FAILED",
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(Date.now() + Math.min(3_600, 2 ** job.attemptCount) * 1_000),
            ...(dead ? { completedAt: new Date() } : {}),
          },
        }),
        ...(dead
          ? [
              this.prisma.auditLog.create({
                data: {
                  organizationId: job.organizationId,
                  action: "program.wallet_sync_job_dead_lettered",
                  targetType: "program_wallet_sync_job",
                  targetId: job.id,
                  requestId: "wallet-worker",
                  metadata: { programId: job.programId, attemptCount: job.attemptCount },
                },
              }),
            ]
          : []),
      ]);
      return { jobId: job.id, processed: 0, failed: true, deadLetter: dead };
    }
  }

  async processOneWalletCampaign(campaignId?: string): Promise<Record<string, unknown> | null> {
    const now = new Date();
    const candidate = await this.prisma.walletEngagementCampaign.findFirst({
      where: {
        ...(campaignId ? { id: campaignId } : {}),
        scheduledAt: { lte: now },
        OR: [
          { status: "PENDING", nextAttemptAt: { lte: now } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return null;
    const claimed = await this.prisma.walletEngagementCampaign.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: "PENDING", nextAttemptAt: { lte: now } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_SECONDS * 1_000),
      },
    });
    if (claimed.count !== 1) return null;
    const campaign = await this.prisma.walletEngagementCampaign.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    try {
      const providerCodes = Array.isArray(campaign.intendedProviders)
        ? campaign.intendedProviders.filter(
            (value): value is "APPLE" | "GOOGLE" => value === "APPLE" || value === "GOOGLE",
          )
        : [];
      const passes = await this.prisma.walletPassInstance.findMany({
        where: {
          organizationId: campaign.organizationId,
          provider: { in: providerCodes },
          status: { in: ["ISSUED", "ACTIVE"] },
          membershipCredential: { status: "ACTIVE" },
          membership: {
            programId: campaign.programId,
            status: "ACTIVE",
            customer: { status: "ACTIVE" },
            consents: {
              some: { consentType: "WALLET_PROMOTIONS", granted: true },
            },
          },
          ...(campaign.cursorPassInstanceId ? { id: { gt: campaign.cursorPassInstanceId } } : {}),
        },
        select: { id: true, membershipId: true, provider: true },
        orderBy: { id: "asc" },
        take: 250,
      });
      let queued = 0;
      let skipped = 0;
      for (const pass of passes) {
        const deliveryId = randomUUID();
        const providerMessageId = `wfl_${campaign.id.replaceAll("-", "")}_${pass.id.replaceAll("-", "")}`;
        const outcome = await this.prisma.$transaction(async (transaction) => {
          const lockKey = `wallet-promotion-rate:${pass.membershipId}:${pass.provider}`;
          await transaction.$queryRaw<Array<{ locked: string }>>`
            SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "locked"
          `;
          const consent = await transaction.customerConsent.findFirst({
            where: { membershipId: pass.membershipId, consentType: "WALLET_PROMOTIONS" },
            orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
          });
          const consentActive = consent?.granted === true && consent.revokedAt === null;
          const [lastDay, lastWeek] = consentActive
            ? await Promise.all([
                transaction.walletCampaignDelivery.count({
                  where: {
                    membershipId: pass.membershipId,
                    provider: pass.provider,
                    OR: [
                      {
                        status: "SUCCEEDED",
                        logicalSentAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1_000) },
                      },
                      {
                        status: "QUEUED",
                        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1_000) },
                      },
                    ],
                  },
                }),
                transaction.walletCampaignDelivery.count({
                  where: {
                    membershipId: pass.membershipId,
                    provider: pass.provider,
                    OR: [
                      {
                        status: "SUCCEEDED",
                        logicalSentAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000) },
                      },
                      {
                        status: "QUEUED",
                        createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000) },
                      },
                    ],
                  },
                }),
              ])
            : [0, 0];
          const safeSkipCode = !consentActive
            ? "CONSENT_REVOKED"
            : lastDay >= 2
              ? "WAFLO_PASS_LIMIT_24H"
              : lastWeek >= 5
                ? "WAFLO_PASS_LIMIT_7D"
                : null;
          const delivery = await transaction.walletCampaignDelivery.upsert({
            where: {
              campaignId_walletPassInstanceId: {
                campaignId: campaign.id,
                walletPassInstanceId: pass.id,
              },
            },
            create: {
              id: deliveryId,
              organizationId: campaign.organizationId,
              campaignId: campaign.id,
              membershipId: pass.membershipId,
              walletPassInstanceId: pass.id,
              provider: pass.provider,
              providerMessageId,
              status: safeSkipCode ? "SKIPPED" : "QUEUED",
              safeSkipCode,
              ...(safeSkipCode ? { completedAt: now } : {}),
            },
            update: {},
          });
          if (!safeSkipCode && delivery.status === "QUEUED") {
            const idempotencyKey = `wallet:${pass.provider.toLocaleLowerCase("en-US")}:promotion:${delivery.id}`;
            await transaction.walletCommand.upsert({
              where: { idempotencyKey },
              create: {
                organizationId: campaign.organizationId,
                membershipId: pass.membershipId,
                walletPassInstanceId: pass.id,
                provider: pass.provider,
                commandType: "SEND_PROMOTION",
                idempotencyKey,
                payloadFingerprint: campaign.contentFingerprint,
                safePayload: { campaignId: campaign.id, campaignDeliveryId: delivery.id },
                campaignDeliveryId: delivery.id,
              },
              update: {},
            });
          }
          return { createdNew: delivery.id === deliveryId, skipped: Boolean(safeSkipCode) };
        });
        if (outcome.createdNew) {
          if (outcome.skipped) skipped += 1;
          else queued += 1;
        }
      }
      const last = passes.at(-1);
      const finished = passes.length < 250;
      await this.prisma.walletEngagementCampaign.update({
        where: { id: campaign.id },
        data: {
          queuedCount: { increment: queued },
          skippedCount: { increment: skipped },
          cursorPassInstanceId: last?.id ?? campaign.cursorPassInstanceId,
          leaseOwner: null,
          leaseExpiresAt: null,
          ...(finished
            ? {
                status: queued + campaign.queuedCount > 0 ? "DISPATCHED" : "COMPLETED",
                dispatchedAt: now,
                ...(queued + campaign.queuedCount > 0 ? {} : { completedAt: now }),
              }
            : { status: "PENDING", nextAttemptAt: now }),
        },
      });
      if (finished) {
        await this.prisma.auditLog.create({
          data: {
            organizationId: campaign.organizationId,
            actorUserId: campaign.createdByUserId,
            action: "wallet.campaign_dispatched",
            targetType: "wallet_engagement_campaign",
            targetId: campaign.id,
            requestId: "wallet-worker",
            metadata: {
              queued: queued + campaign.queuedCount,
              skipped: skipped + campaign.skippedCount,
            },
          },
        });
      }
      return { campaignId: campaign.id, queued, skipped, finished };
    } catch {
      const dead = campaign.attemptCount >= this.environment.WALLET_COMMAND_MAX_ATTEMPTS;
      await this.prisma.walletEngagementCampaign.update({
        where: { id: campaign.id },
        data: dead
          ? {
              status: "FAILED",
              safeFailureCode: "TARGET_RESOLUTION_FAILED",
              completedAt: new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
            }
          : {
              status: "PENDING",
              safeFailureCode: "TARGET_RESOLUTION_FAILED",
              nextAttemptAt: new Date(Date.now() + 60_000),
              leaseOwner: null,
              leaseExpiresAt: null,
            },
      });
      return { campaignId: campaign.id, failed: true, dead };
    }
  }

  async popNextQueuedCommand(): Promise<string | null> {
    return (
      (await this.redis.rpop(OPERATIONAL_QUEUE_KEY)) ??
      (await this.redis.rpop(PROMOTIONAL_QUEUE_KEY))
    );
  }

  private async consume(slot: number) {
    while (!this.stopping) {
      // A blocking BRPOP monopolizes a Redis connection. Consumers share the
      // worker connection with the dispatcher, so use a short non-blocking
      // poll to keep queue publication and health checks responsive.
      const commandId = await this.popNextQueuedCommand();
      if (!commandId) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      await this.redis.del(`waflo:wallet:queued:${commandId}`);
      const command = await this.claim(commandId, slot);
      if (!command) continue;
      await this.execute(command);
    }
  }

  private async claim(commandId: string, slot: number): Promise<WalletCommand | null> {
    const now = new Date();
    const claimed = await this.prisma.walletCommand.updateMany({
      where: {
        id: commandId,
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: `${this.workerId}:${slot}`,
        leaseExpiresAt: new Date(now.getTime() + LEASE_SECONDS * 1_000),
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.walletCommand.findUnique({ where: { id: commandId } });
  }

  private async execute(command: WalletCommand) {
    const provider = this.providerMap.get(command.provider);
    if (!provider || provider.mode === "DISABLED") {
      await this.fail(command, normalizeWalletProviderError(new Error("Provider disabled.")));
      return;
    }
    try {
      let providerRequestId: string | undefined;
      if (command.commandType === "ENSURE_TEMPLATE") {
        const payload = command.safePayload as { bindingId?: string } | null;
        const binding = payload?.bindingId
          ? await this.prisma.walletProgramBinding.findUnique({
              where: { id: payload.bindingId },
              include: {
                organization: {
                  include: {
                    walletNearbyConfiguration: {
                      include: {
                        locations: {
                          include: { location: true },
                          orderBy: { sortOrder: "asc" },
                        },
                      },
                    },
                  },
                },
                program: { include: { walletNearbyProgramCopy: true } },
                programVersion: {
                  include: {
                    translations: true,
                    visualTheme: true,
                    locations: { select: { locationId: true } },
                  },
                },
              },
            })
          : null;
        if (!binding) throw new Error("Wallet program binding is unavailable.");
        const programLogoUrl =
          binding.provider === "GOOGLE" ? await this.ensureGoogleProgramLogo(binding) : undefined;
        const result = await provider.ensureProgramTemplate(mapProgram(binding, programLogoUrl));
        providerRequestId = result.providerRequestId;
        await this.prisma.walletProgramBinding.update({
          where: { id: binding.id },
          data: {
            providerTemplateId: result.providerTemplateId,
            status: "READY",
            providerState: { state: result.state, mode: provider.mode },
            lastSyncedAt: new Date(),
          },
        });
      } else if (command.commandType === "APPLE_PUSH") {
        if (!command.walletPassInstanceId) throw new Error("Apple push has no pass instance.");
        await this.sendApplePush(command.walletPassInstanceId, provider.mode);
      } else if (command.commandType === "SEND_PROMOTION") {
        providerRequestId = await this.executePromotionalMessage(command, provider);
      } else {
        if (!command.walletPassInstanceId) throw new Error("Wallet pass command has no instance.");
        const pass = await this.prisma.walletPassInstance.findUnique({
          where: { id: command.walletPassInstanceId },
          include: passInclude,
        });
        if (!pass) throw new Error("Wallet pass instance is unavailable.");
        const stampRenderInput = await this.stampRenderInput(
          pass,
          pass.provider === "GOOGLE" ? "GOOGLE_WALLET" : "APPLE_WALLET",
        );
        const progressAssetUrl =
          pass.provider === "GOOGLE"
            ? await this.ensureGoogleProgressAsset(pass, stampRenderInput)
            : undefined;
        const input = mapPass(pass, this.environment, stampRenderInput, progressAssetUrl);
        if (command.commandType === "ISSUE") {
          if (pass.membershipCredential.status !== "ACTIVE") {
            await this.deadLetter(command, "CREDENTIAL_NOT_ACTIVE");
            return;
          }
          const result = await provider.issueMembershipPass(input);
          providerRequestId = result.providerRequestId;
          await this.prisma.walletPassInstance.updateMany({
            where: {
              id: pass.id,
              membershipCredential: { status: "ACTIVE" },
              status: { not: "INVALIDATION_PENDING" },
            },
            data: {
              status: result.state,
              providerState: (result.safeMetadata
                ? { ...result.safeMetadata }
                : { mode: provider.mode }) as Prisma.InputJsonValue,
              lastProviderSyncAt: new Date(),
              lastProviderErrorCode: null,
              lastRenderedProjectionVersion: pass.membership.progress?.projectionVersion ?? 0,
            },
          });
        } else if (command.commandType === "UPDATE") {
          const result = await provider.updateMembershipPass(
            input,
            this.reason(command, "RECONCILIATION"),
          );
          providerRequestId = result.providerRequestId;
          await this.prisma.walletPassInstance.updateMany({
            where: {
              id: pass.id,
              membershipCredential: { status: "ACTIVE" },
              status: { not: "INVALIDATION_PENDING" },
            },
            data: {
              status: "ACTIVE",
              lastProviderSyncAt: new Date(),
              lastProviderErrorCode: null,
              lastRenderedProjectionVersion: pass.membership.progress?.projectionVersion ?? 0,
            },
          });
          if (pass.provider === "APPLE") await this.queueApplePush(pass, command);
        } else if (command.commandType === "INVALIDATE") {
          const result = await provider.invalidateMembershipPass(
            input,
            this.reason(command, "MEMBERSHIP_TRANSFERRED"),
          );
          providerRequestId = result.providerRequestId;
          await this.prisma.walletPassInstance.update({
            where: { id: pass.id },
            data: {
              status: "INVALIDATED",
              invalidatedAt: new Date(),
              lastProviderSyncAt: new Date(),
              lastProviderErrorCode: null,
            },
          });
          if (pass.provider === "APPLE") await this.queueApplePush(pass, command);
        } else if (command.commandType === "RECONCILE") {
          const result = await provider.reconcileMembershipPass(input);
          providerRequestId = result.providerRequestId;
          await this.prisma.walletPassInstance.updateMany({
            where: {
              id: pass.id,
              ...(input.transferred
                ? {}
                : {
                    membershipCredential: { status: "ACTIVE" as const },
                    status: { not: "INVALIDATION_PENDING" as const },
                  }),
            },
            data: {
              status: input.transferred ? "INVALIDATED" : "ACTIVE",
              lastProviderSyncAt: new Date(),
              lastProviderErrorCode: null,
            },
          });
        }
      }
      await this.prisma.walletCommand.update({
        where: { id: command.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          safeErrorCode: null,
          ...(providerRequestId ? { providerRequestId } : {}),
        },
      });
      if (command.commandType === "SEND_PROMOTION" && command.campaignDeliveryId) {
        const delivery = await this.prisma.walletCampaignDelivery.findUnique({
          where: { id: command.campaignDeliveryId },
          select: { campaignId: true },
        });
        if (delivery) await this.refreshCampaignAggregation(delivery.campaignId);
      }
      workerLog("command_completed", {
        commandId: command.id,
        provider: command.provider,
        commandType: command.commandType,
      });
    } catch (error) {
      workerLog("command_failed", {
        commandId: command.id,
        provider: command.provider,
        commandType: command.commandType,
      });
      if (error instanceof Error && error.message.includes("stamp artwork digest mismatch")) {
        await this.deadLetter(command, "RENDER_ASSET_DIGEST_MISMATCH");
        return;
      }
      if (
        error instanceof Error &&
        (error.message.includes("stamp artwork is unavailable") ||
          error.message.includes("stamp artwork has no processed variant"))
      ) {
        await this.deadLetter(command, "RENDER_ASSET_MISSING");
        return;
      }
      await this.fail(command, normalizeWalletProviderError(error));
    }
  }

  private async fail(
    command: WalletCommand,
    error: ReturnType<typeof normalizeWalletProviderError>,
  ) {
    const dead =
      !error.options.retryable ||
      command.attemptCount >= this.environment.WALLET_COMMAND_MAX_ATTEMPTS;
    if (dead) {
      await this.deadLetter(command, error.category, error.options.providerRequestId);
      return;
    }
    const delaySeconds =
      error.category === "RATE_LIMITED"
        ? 6 * 60 * 60
        : Math.min(3_600, 5 * 2 ** Math.max(0, command.attemptCount - 1));
    await this.prisma.$transaction([
      this.prisma.walletCommand.update({
        where: { id: command.id },
        data: {
          status: "FAILED",
          safeErrorCode: error.category,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + delaySeconds * 1_000),
          ...(error.options.providerRequestId
            ? { providerRequestId: error.options.providerRequestId }
            : {}),
        },
      }),
      ...(command.walletPassInstanceId && command.commandType !== "SEND_PROMOTION"
        ? [
            this.prisma.walletPassInstance.update({
              where: { id: command.walletPassInstanceId },
              data: { status: "ERROR", lastProviderErrorCode: error.category },
            }),
          ]
        : []),
      ...(command.campaignDeliveryId
        ? [
            this.prisma.walletCampaignDelivery.update({
              where: { id: command.campaignDeliveryId },
              data: {
                safeFailureCode: error.category,
                ...(error.options.providerRequestId
                  ? { providerRequestId: error.options.providerRequestId }
                  : {}),
              },
            }),
          ]
        : []),
    ]);
  }

  private async deadLetter(
    command: WalletCommand,
    safeErrorCode: string,
    providerRequestId?: string,
  ) {
    await this.prisma.$transaction([
      this.prisma.walletCommand.update({
        where: { id: command.id },
        data: {
          status: "DEAD_LETTER",
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          safeErrorCode,
          ...(providerRequestId ? { providerRequestId } : {}),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: command.organizationId,
          action:
            safeErrorCode === "RENDER_ASSET_DIGEST_MISMATCH" ||
            safeErrorCode === "RENDER_ASSET_MISSING"
              ? "wallet.render_asset_rejected"
              : "wallet.command_dead_lettered",
          targetType: "wallet_command",
          targetId: command.id,
          requestId: "wallet-worker",
          metadata: {
            provider: command.provider,
            commandType: command.commandType,
            safeErrorCode,
          },
        },
      }),
      ...(command.campaignDeliveryId
        ? [
            this.prisma.walletCampaignDelivery.update({
              where: { id: command.campaignDeliveryId },
              data: {
                status: "FAILED",
                safeFailureCode: safeErrorCode,
                completedAt: new Date(),
                ...(providerRequestId ? { providerRequestId } : {}),
              },
            }),
          ]
        : []),
    ]);
    if (command.campaignDeliveryId) {
      const delivery = await this.prisma.walletCampaignDelivery.findUnique({
        where: { id: command.campaignDeliveryId },
        select: { campaignId: true },
      });
      if (delivery) await this.refreshCampaignAggregation(delivery.campaignId);
    }
  }

  private async executePromotionalMessage(
    command: WalletCommand,
    provider: WalletProvider,
  ): Promise<string | undefined> {
    if (!command.campaignDeliveryId || !command.walletPassInstanceId) {
      throw new Error("Promotional Wallet command is missing its delivery identity.");
    }
    const delivery = await this.prisma.walletCampaignDelivery.findUnique({
      where: { id: command.campaignDeliveryId },
      include: { campaign: true, walletPassInstance: true },
    });
    if (!delivery || delivery.walletPassInstanceId !== command.walletPassInstanceId) {
      throw new Error("Promotional Wallet delivery is unavailable.");
    }
    if (delivery.status !== "QUEUED") return delivery.providerRequestId ?? undefined;
    const consent = await this.prisma.customerConsent.findFirst({
      where: { membershipId: delivery.membershipId, consentType: "WALLET_PROMOTIONS" },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    });
    const consentActive = consent?.granted === true && consent.revokedAt === null;
    const now = new Date();
    const [lastDay, lastWeek] = consentActive
      ? await Promise.all([
          this.prisma.walletCampaignDelivery.count({
            where: {
              id: { not: delivery.id },
              membershipId: delivery.membershipId,
              provider: delivery.provider,
              status: "SUCCEEDED",
              logicalSentAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1_000) },
            },
          }),
          this.prisma.walletCampaignDelivery.count({
            where: {
              id: { not: delivery.id },
              membershipId: delivery.membershipId,
              provider: delivery.provider,
              status: "SUCCEEDED",
              logicalSentAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000) },
            },
          }),
        ])
      : [0, 0];
    const safeSkipCode = !consentActive
      ? "CONSENT_REVOKED"
      : lastDay >= 2
        ? "WAFLO_PASS_LIMIT_24H"
        : lastWeek >= 5
          ? "WAFLO_PASS_LIMIT_7D"
          : delivery.campaign.status === "CANCELED"
            ? "CAMPAIGN_CANCELED"
            : null;
    if (safeSkipCode) {
      await this.prisma.walletCampaignDelivery.update({
        where: { id: delivery.id },
        data: { status: "SKIPPED", safeSkipCode, completedAt: now },
      });
      return undefined;
    }
    if (!provider.sendPromotionalMessage) {
      throw new Error("This Wallet provider has no approved promotional message adapter.");
    }
    const obsoleteDeliveries = await this.prisma.walletCampaignDelivery.findMany({
      where: {
        walletPassInstanceId: delivery.walletPassInstanceId,
        status: "SUCCEEDED",
        campaign: { status: "CANCELED" },
      },
      select: { providerMessageId: true },
      orderBy: { createdAt: "asc" },
    });
    const result = await provider.sendPromotionalMessage(
      { providerIdentity: delivery.walletPassInstance.providerIdentity },
      {
        messageId: delivery.providerMessageId,
        locale: delivery.campaign.locale === "AR" ? "ar" : "en",
        title: delivery.campaign.title,
        body: delivery.campaign.body,
        ...(delivery.campaign.destinationUrl
          ? { destinationUrl: delivery.campaign.destinationUrl }
          : {}),
        obsoleteMessageIds: obsoleteDeliveries.map((item) => item.providerMessageId),
      },
    );
    if (result.state === "NO_ACTIVE_WALLET_HOLDER") {
      await this.prisma.walletCampaignDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "SKIPPED",
          safeSkipCode: "NO_ACTIVE_WALLET_HOLDER",
          completedAt: now,
          ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
        },
      });
      return result.providerRequestId;
    }
    await this.prisma.walletCampaignDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SUCCEEDED",
        logicalSentAt: now,
        completedAt: now,
        safeFailureCode: null,
        ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
      },
    });
    return result.providerRequestId;
  }

  private async refreshCampaignAggregation(campaignId: string) {
    const [campaign, counts] = await Promise.all([
      this.prisma.walletEngagementCampaign.findUnique({
        where: { id: campaignId },
        select: { status: true, dispatchedAt: true },
      }),
      Promise.all(
        (["QUEUED", "SUCCEEDED", "SKIPPED", "FAILED"] as const).map((status) =>
          this.prisma.walletCampaignDelivery.count({ where: { campaignId, status } }),
        ),
      ),
    ]);
    if (!campaign) return;
    const queued = counts[0] ?? 0;
    const succeeded = counts[1] ?? 0;
    const skipped = counts[2] ?? 0;
    const failed = counts[3] ?? 0;
    const terminal = campaign.dispatchedAt !== null && queued === 0;
    const status = !campaign.dispatchedAt
      ? campaign.status
      : !terminal
        ? "DISPATCHED"
        : failed > 0 && succeeded > 0
          ? "PARTIAL_FAILURE"
          : failed > 0
            ? "FAILED"
            : "COMPLETED";
    await this.prisma.walletEngagementCampaign.updateMany({
      where: { id: campaignId, status: { not: "CANCELED" } },
      data: {
        queuedCount: queued,
        succeededCount: succeeded,
        skippedCount: skipped,
        failedCount: failed,
        status,
        ...(terminal ? { completedAt: new Date() } : {}),
      },
    });
  }

  private reason(command: WalletCommand, fallback: WalletUpdateReason): WalletUpdateReason {
    const payload = command.safePayload as { reason?: WalletUpdateReason } | null;
    return payload?.reason ?? fallback;
  }

  private async queueApplePush(pass: PassRecord, source: WalletCommand) {
    if (pass.appleUpdateSequence === null) {
      throw new Error("Apple pass is missing its global update sequence.");
    }
    const sequence = pass.appleUpdateSequence.toString();
    const idempotencyKey = `wallet:apple:push:${pass.id}:s${sequence}`;
    await this.prisma.walletCommand.upsert({
      where: { idempotencyKey },
      create: {
        organizationId: pass.organizationId,
        membershipId: pass.membershipId,
        walletPassInstanceId: pass.id,
        provider: "APPLE",
        commandType: "APPLE_PUSH",
        idempotencyKey,
        payloadFingerprint: createHash("sha256")
          .update(`${idempotencyKey}:${source.id}`)
          .digest("hex"),
        safePayload: {
          appleUpdateSequence: sequence,
          sourceCommandType: source.commandType,
        },
      },
      update: {},
    });
  }

  private async sendApplePush(
    walletPassInstanceId: string,
    mode: "DISABLED" | "TEST_ADAPTER" | "REAL",
  ) {
    const registrations = await this.prisma.applePassRegistration.findMany({
      where: { walletPassInstanceId, unregisteredAt: null },
      include: { walletPassInstance: true },
    });
    if (mode === "TEST_ADAPTER" || registrations.length === 0) return;
    if (
      mode !== "REAL" ||
      !this.environment.APPLE_PASS_CERTIFICATE_PATH_OR_BASE64 ||
      !this.environment.APPLE_PASS_CERTIFICATE_PASSWORD ||
      !this.environment.APPLE_PASS_TYPE_IDENTIFIER
    ) {
      throw new Error("APNs pass certificate configuration is unavailable.");
    }
    const authority =
      this.environment.APPLE_APNS_ENVIRONMENT === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
    const client = connectHttp2(authority, {
      pfx: bytesFromSource(this.environment.APPLE_PASS_CERTIFICATE_PATH_OR_BASE64),
      passphrase: this.environment.APPLE_PASS_CERTIFICATE_PASSWORD,
    });
    try {
      for (const registration of registrations) {
        const token = decryptCustomerValue(registration.pushTokenEncrypted, {
          organizationId: registration.walletPassInstance.organizationId,
          recordId: registration.id,
          purpose: "apple-push-token",
          keyring: this.customerKeyring,
        });
        const response = await new Promise<{ status: number; reason?: string }>(
          (resolve, reject) => {
            const push = client.request({
              ":method": "POST",
              ":path": `/3/device/${encodeURIComponent(token)}`,
              "apns-topic": this.environment.APPLE_PASS_TYPE_IDENTIFIER as string,
              "apns-push-type": "background",
              "apns-priority": "5",
              "content-type": "application/json",
            });
            let responseStatus = 0;
            const responseBody: Buffer[] = [];
            push.on("response", (headers) => {
              responseStatus = Number(headers[":status"] ?? 0);
            });
            push.on("data", (chunk: Buffer | string) => {
              responseBody.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            push.on("error", reject);
            push.on("end", () => {
              let reason: string | undefined;
              try {
                const body = JSON.parse(Buffer.concat(responseBody).toString("utf8")) as {
                  reason?: unknown;
                };
                if (typeof body.reason === "string") reason = body.reason;
              } catch {
                // Successful APNs responses have no body; malformed error bodies stay redacted.
              }
              resolve({ status: responseStatus, ...(reason ? { reason } : {}) });
            });
            push.end("{}");
          },
        );
        const disposition = classifyApplePushResponse(response.status, response.reason);
        if (disposition === "INVALID_TOKEN") {
          await this.prisma.applePassRegistration.update({
            where: { id: registration.id },
            data: { unregisteredAt: new Date() },
          });
          continue;
        }
        if (disposition !== "SUCCESS") {
          const error = new Error("APNs rejected the Wallet update.") as Error & {
            status?: number;
          };
          error.status = disposition === "RETRY" ? response.status || 503 : response.status || 400;
          throw error;
        }
      }
    } finally {
      client.close();
    }
  }

  private async ensureGoogleProgressAsset(
    pass: PassRecord,
    stampRenderInput: PublishedMembershipStampRenderInput,
  ): Promise<string> {
    const visualDigest = publishedMembershipStampVisualDigest(stampRenderInput);
    const assetType = `GOOGLE_PROGRESS_${visualDigest}`;
    const cached = await this.prisma.publicWalletAsset.findFirst({
      where: { organizationId: pass.organizationId, assetType, revokedAt: null },
    });
    const base =
      this.environment.GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL ||
      this.environment.WALLET_PUBLIC_BASE_URL;
    if (cached) {
      return `${base.replace(/\/+$/, "")}/${cached.publicToken}`;
    }
    const rendered = renderPublishedMembershipStampSvg(stampRenderInput);
    const width = 1_032;
    const height = 336;
    const bytes = await sharp(Buffer.from(rendered.svg, "utf8"))
      .resize(width, height, {
        fit: "contain",
        background: stampRenderInput.visualTheme.backgroundColor,
      })
      .png()
      .toBuffer();
    const contentDigest = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `wallet-public/${pass.organizationId}/${contentDigest}.png`;
    const publicToken = `wpa_${createHmac(
      "sha256",
      decodeSecret(this.environment.CUSTOMER_SESSION_SECRET),
    )
      .update(`${pass.organizationId}:${assetType}:${contentDigest}`)
      .digest("base64url")}`;
    try {
      await this.objectStorage.send(
        new PutObjectCommand({
          Bucket: this.environment.OBJECT_STORAGE_BUCKET,
          Key: objectKey,
          Body: bytes,
          ContentType: "image/png",
          CacheControl: "public, max-age=31536000, immutable",
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (!isS3PreconditionFailure(error)) {
        throw error;
      }
    }
    let asset: PublicWalletAsset | null;
    try {
      asset = await this.prisma.publicWalletAsset.upsert({
        where: {
          organizationId_contentDigest_assetType: {
            organizationId: pass.organizationId,
            contentDigest,
            assetType,
          },
        },
        create: {
          organizationId: pass.organizationId,
          programVersionId: pass.membership.enrollmentProgramVersionId,
          membershipId: pass.membershipId,
          assetType,
          contentDigest,
          objectKey,
          publicToken,
          mimeType: "image/png",
          width,
          height,
        },
        update: {},
      });
    } catch (error) {
      asset = await this.prisma.publicWalletAsset.findUnique({
        where: {
          organizationId_contentDigest_assetType: {
            organizationId: pass.organizationId,
            contentDigest,
            assetType,
          },
        },
      });
      if (!asset) throw error;
    }
    return `${base.replace(/\/+$/, "")}/${asset.publicToken}`;
  }

  private async ensureGoogleProgramLogo(
    binding: Prisma.WalletProgramBindingGetPayload<{
      include: {
        organization: {
          include: {
            walletNearbyConfiguration: {
              include: {
                locations: { include: { location: true }; orderBy: { sortOrder: "asc" } };
              };
            };
          };
        };
        program: { include: { walletNearbyProgramCopy: true } };
        programVersion: {
          include: {
            translations: true;
            visualTheme: true;
            locations: { select: { locationId: true } };
          };
        };
      };
    }>,
  ): Promise<string> {
    const background = binding.programVersion.visualTheme?.accentColor ?? "#E4572E";
    const foreground = binding.programVersion.visualTheme?.backgroundColor ?? "#F7F4EE";
    const width = 660;
    const height = 660;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 660 660"><rect width="660" height="660" rx="132" fill="${background}"/><path d="M126 178l106 304 98-184 98 184 106-304" fill="none" stroke="${foreground}" stroke-width="62" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const bytes = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
    const contentDigest = createHash("sha256").update(bytes).digest("hex");
    const assetType = `GOOGLE_PROGRAM_LOGO_${binding.configurationFingerprint.slice(0, 24)}`;
    const objectKey = `wallet-public/${binding.organizationId}/${contentDigest}.png`;
    const publicToken = `wpa_${createHmac(
      "sha256",
      decodeSecret(this.environment.CUSTOMER_SESSION_SECRET),
    )
      .update(`${binding.organizationId}:${assetType}:${contentDigest}`)
      .digest("base64url")}`;
    try {
      await this.objectStorage.send(
        new PutObjectCommand({
          Bucket: this.environment.OBJECT_STORAGE_BUCKET,
          Key: objectKey,
          Body: bytes,
          ContentType: "image/png",
          CacheControl: "public, max-age=31536000, immutable",
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (!isS3PreconditionFailure(error)) {
        throw error;
      }
    }
    let asset: PublicWalletAsset | null;
    try {
      asset = await this.prisma.publicWalletAsset.upsert({
        where: {
          organizationId_contentDigest_assetType: {
            organizationId: binding.organizationId,
            contentDigest,
            assetType,
          },
        },
        create: {
          organizationId: binding.organizationId,
          programVersionId: binding.programVersionId,
          assetType,
          contentDigest,
          objectKey,
          publicToken,
          mimeType: "image/png",
          width,
          height,
        },
        update: {},
      });
    } catch (error) {
      asset = await this.prisma.publicWalletAsset.findUnique({
        where: {
          organizationId_contentDigest_assetType: {
            organizationId: binding.organizationId,
            contentDigest,
            assetType,
          },
        },
      });
      if (!asset) throw error;
    }
    const base =
      this.environment.GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL ||
      this.environment.WALLET_PUBLIC_BASE_URL;
    return `${base.replace(/\/+$/, "")}/${asset.publicToken}`;
  }

  private async stampRenderInput(
    pass: PassRecord,
    outputProfile: "APPLE_WALLET" | "GOOGLE_WALLET",
  ): Promise<PublishedMembershipStampRenderInput> {
    const version = pass.membership.enrollmentProgramVersion;
    const theme = version.visualTheme;
    if (!theme) throw new Error("Published Wallet stamp artwork is unavailable.");
    const [filledArtwork, emptyArtwork] = await Promise.all([
      this.loadStampArtwork(theme.filledStampAsset),
      this.loadStampArtwork(theme.emptyStampAsset),
    ]);
    const digest = (asset: typeof theme.filledStampAsset) =>
      asset.variants.find((item) => item.variantCode === "STAMP_256")?.digest ??
      asset.variants.find((item) => item.variantCode === "ORIGINAL_SAFE")?.digest ??
      asset.sha256Digest;
    const requiredStampCount = version.stampRule?.requiredStampCount ?? 8;
    const currentStampCount = pass.membership.progress?.currentCycleStampCount ?? 0;
    const rawLayout =
      theme.layoutConfiguration &&
      typeof theme.layoutConfiguration === "object" &&
      !Array.isArray(theme.layoutConfiguration)
        ? theme.layoutConfiguration
        : {};
    const layoutConfiguration = {
      ...("columns" in rawLayout && typeof rawLayout.columns === "number"
        ? { columns: rawLayout.columns }
        : {}),
      ...("maxPerRow" in rawLayout && typeof rawLayout.maxPerRow === "number"
        ? { maxPerRow: rawLayout.maxPerRow }
        : {}),
      ...("serpentine" in rawLayout && typeof rawLayout.serpentine === "boolean"
        ? { serpentine: rawLayout.serpentine }
        : {}),
      ...("startAngle" in rawLayout && typeof rawLayout.startAngle === "number"
        ? { startAngle: rawLayout.startAngle }
        : {}),
    };
    return {
      organizationId: pass.organizationId,
      programId: pass.membership.programId,
      programVersionId: version.id,
      membershipId: pass.membershipId,
      rendererSchemaVersion: "waflo-stamp-render-v1",
      locale: pass.membership.customer.preferredLocale === "AR" ? "ar" : "en",
      requiredStampCount,
      currentStampCount,
      rewardReady: pass.membership.progress?.rewardReady ?? false,
      layoutType: theme.layoutType,
      ...(Object.keys(layoutConfiguration).length > 0 ? { layoutConfiguration } : {}),
      visualTheme: {
        filledColor: theme.accentColor,
        emptyColor: theme.secondaryColor,
        accentColor: theme.accentColor,
        backgroundColor: theme.backgroundColor,
        foregroundColor: theme.foregroundColor,
        stampSize: theme.stampSize,
        spacing: theme.stampSpacing,
      },
      filledArtwork,
      emptyArtwork,
      assetDigests: {
        filled: digest(theme.filledStampAsset),
        empty: digest(theme.emptyStampAsset),
      },
      outputProfile,
    };
  }

  private async loadStampArtwork(
    asset: PassRecord["membership"]["enrollmentProgramVersion"]["visualTheme"] extends infer Theme
      ? Theme extends { filledStampAsset: infer Asset }
        ? Asset
        : never
      : never,
  ): Promise<StampArtwork> {
    const metadata = asset.safeMetadata;
    if (
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      "inlineSvg" in metadata &&
      typeof metadata.inlineSvg === "string"
    ) {
      return { kind: "svg", content: metadata.inlineSvg, trusted: true };
    }
    const variant =
      asset.variants.find((item) => item.variantCode === "STAMP_256") ??
      asset.variants.find((item) => item.variantCode === "ORIGINAL_SAFE");
    if (!variant?.mimeType.startsWith("image/")) {
      throw new Error("Published Wallet stamp artwork has no processed variant.");
    }
    const result = await this.objectStorage.send(
      new GetObjectCommand({
        Bucket: this.environment.OBJECT_STORAGE_BUCKET,
        Key: variant.objectKey,
      }),
    );
    if (!result.Body) throw new Error("Published Wallet stamp artwork is unavailable.");
    const bytes = Buffer.from(await result.Body.transformToByteArray());
    if (createHash("sha256").update(bytes).digest("hex") !== variant.digest) {
      throw new Error("Published Wallet stamp artwork digest mismatch.");
    }
    const mimeType = variant.mimeType as StampArtwork extends {
      kind: "data-uri";
      mimeType: infer Mime;
    }
      ? Mime
      : never;
    return {
      kind: "data-uri",
      value: `data:${mimeType};base64,${bytes.toString("base64")}`,
      mimeType,
      trusted: true,
    };
  }

  private async objectStorageReady() {
    await this.objectStorage.send(
      new HeadBucketCommand({ Bucket: this.environment.OBJECT_STORAGE_BUCKET }),
      { requestTimeout: 5_000 },
    );
  }
}

async function main() {
  const environment = parseEnvironment(process.env);
  if (!environment.REDIS_URL) throw new Error("REDIS_URL is required for the Wallet worker.");
  const prisma = createPrismaClient(environment.DATABASE_URL, {
    max: environment.DATABASE_POOL_MAX,
    connectionTimeoutMillis: environment.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: environment.DATABASE_POOL_IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: environment.DATABASE_POOL_MAX_LIFETIME_SECONDS,
  });
  const redis = new Redis(environment.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const worker = new WalletWorker(prisma, redis, environment);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void worker.stop();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  try {
    await worker.run();
  } finally {
    await redis.quit().catch(() => redis.disconnect());
    await prisma.$disconnect();
    worker.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch(() => {
    process.stderr.write("Wallet worker failed.\n");
    process.exitCode = 1;
  });
}

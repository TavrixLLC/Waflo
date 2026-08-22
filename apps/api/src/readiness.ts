import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { cadencePrice } from "@waflo/billing";
import { parseEnvironment } from "@waflo/config";
import type { BillingCadence, PlanCode } from "@waflo/contracts";
import { Redis } from "ioredis";
import Stripe from "stripe";
import { createApiApplication } from "./app.js";
import { ExternalAuthService } from "./auth/external-auth.service.js";
import { CustomerSecurityService } from "./customer/customer-security.service.js";
import { PrismaService } from "./database/prisma.service.js";
import { NotificationService } from "./notifications/notification.service.js";
import { evaluateReleaseReadiness, type ReleaseReadinessResult } from "./readiness-policy.js";
import { WalletProviderRegistry } from "./wallet/wallet-provider.registry.js";

type ComponentResult = ReleaseReadinessResult;

async function checked(operation: () => Promise<void>): Promise<ComponentResult> {
  try {
    await operation();
    return { status: "READY" };
  } catch {
    return { status: "UNREACHABLE" };
  }
}

async function main() {
  let environment: ReturnType<typeof parseEnvironment>;
  try {
    environment = parseEnvironment(process.env);
  } catch {
    process.stdout.write(`${JSON.stringify({ CONFIG: { status: "INVALID_CONFIG" } }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const app = await createApiApplication({ logger: false });
  const prisma = app.get(PrismaService);
  const notifications = app.get(NotificationService);
  const externalAuth = app.get(ExternalAuthService);
  const wallets = app.get(WalletProviderRegistry);
  const security = app.get(CustomerSecurityService);
  const redis = environment.REDIS_URL
    ? new Redis(environment.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
    : null;
  const storage = new S3Client({
    endpoint: environment.OBJECT_STORAGE_ENDPOINT,
    region: environment.OBJECT_STORAGE_REGION,
    forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: environment.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    },
  });
  const now = Date.now();
  const workerStatus = async (workerCode: "OPERATIONAL_WORKER" | "WALLET_WORKER") => {
    const heartbeats = await prisma.client.workerHeartbeat.findMany({
      where: { workerCode },
      orderBy: { lastLoopAt: "desc" },
    });
    if (heartbeats.length === 0) return { status: "NOT_CONFIGURED" as const };
    const instances = heartbeats.map((heartbeat) => {
      const stale =
        now - heartbeat.lastLoopAt.getTime() > environment.WORKER_DEGRADED_AFTER_SECONDS * 1000;
      return {
        instanceId: heartbeat.instanceId,
        status: stale || heartbeat.safeFailureCode || heartbeat.stoppingAt ? "DEGRADED" : "READY",
        lastLoopAt: heartbeat.lastLoopAt.toISOString(),
        lastSuccessAt: heartbeat.lastSuccessAt?.toISOString() ?? null,
        safeFailureCode: heartbeat.safeFailureCode,
        backlogCount: heartbeat.backlogCount,
        oldestBacklogAt: heartbeat.oldestBacklogAt?.toISOString() ?? null,
      };
    });
    return {
      status: instances.some((instance) => instance.status === "READY")
        ? ("READY" as const)
        : ("DEGRADED" as const),
      metadata: {
        instances,
      },
    };
  };
  const authCapabilities = externalAuth.publicCapabilities();
  const walletStatus = async (provider: "GOOGLE" | "APPLE") => {
    const mode =
      provider === "GOOGLE" ? environment.GOOGLE_WALLET_MODE : environment.APPLE_WALLET_MODE;
    const safeConfiguration =
      provider === "GOOGLE"
        ? { mode, publishingMode: environment.GOOGLE_WALLET_PUBLISHING_MODE }
        : { mode, apnsEnvironment: environment.APPLE_APNS_ENVIRONMENT };
    if (mode === "DISABLED") {
      return { status: "DISABLED" as const, metadata: safeConfiguration };
    }
    if (!wallets.isConfigured(provider)) {
      return { status: "CONFIG_MISSING" as const, metadata: safeConfiguration };
    }
    try {
      const health = await wallets.get(provider).healthCheck();
      return {
        status:
          health.status === "HEALTHY"
            ? ("READY" as const)
            : health.status === "EXTERNALLY_UNCERTIFIED"
              ? ("CONFIG_READY" as const)
              : ("PROVIDER_ERROR" as const),
        metadata: {
          ...safeConfiguration,
          providerStatus: health.status,
          externallyCertified: health.externallyCertified ?? false,
          demo: health.demo,
        },
      };
    } catch {
      return { status: "PROVIDER_ERROR" as const, metadata: safeConfiguration };
    }
  };
  const stripeConfiguration = [
    environment.STRIPE_SECRET_KEY,
    environment.STRIPE_PUBLISHABLE_KEY,
    environment.STRIPE_WEBHOOK_SECRET,
    environment.STRIPE_STARTER_MONTHLY_PRICE_ID,
    environment.STRIPE_GROWTH_MONTHLY_PRICE_ID,
    environment.STRIPE_SCALE_MONTHLY_PRICE_ID,
    environment.STRIPE_STARTER_QUARTERLY_PRICE_ID,
    environment.STRIPE_GROWTH_QUARTERLY_PRICE_ID,
    environment.STRIPE_SCALE_QUARTERLY_PRICE_ID,
    environment.STRIPE_STARTER_YEARLY_PRICE_ID,
    environment.STRIPE_GROWTH_YEARLY_PRICE_ID,
    environment.STRIPE_SCALE_YEARLY_PRICE_ID,
  ];
  const stripePrices: ReadonlyArray<{
    plan: PlanCode;
    cadence: BillingCadence;
    id: string | undefined;
  }> = [
    { plan: "starter", cadence: "monthly", id: environment.STRIPE_STARTER_MONTHLY_PRICE_ID },
    { plan: "growth", cadence: "monthly", id: environment.STRIPE_GROWTH_MONTHLY_PRICE_ID },
    { plan: "scale", cadence: "monthly", id: environment.STRIPE_SCALE_MONTHLY_PRICE_ID },
    {
      plan: "starter",
      cadence: "quarterly",
      id: environment.STRIPE_STARTER_QUARTERLY_PRICE_ID,
    },
    {
      plan: "growth",
      cadence: "quarterly",
      id: environment.STRIPE_GROWTH_QUARTERLY_PRICE_ID,
    },
    {
      plan: "scale",
      cadence: "quarterly",
      id: environment.STRIPE_SCALE_QUARTERLY_PRICE_ID,
    },
    { plan: "starter", cadence: "yearly", id: environment.STRIPE_STARTER_YEARLY_PRICE_ID },
    { plan: "growth", cadence: "yearly", id: environment.STRIPE_GROWTH_YEARLY_PRICE_ID },
    { plan: "scale", cadence: "yearly", id: environment.STRIPE_SCALE_YEARLY_PRICE_ID },
  ];
  const stripeStatus = async (): Promise<ComponentResult> => {
    if (!stripeConfiguration.some(Boolean)) return { status: "DISABLED" };
    if (!stripeConfiguration.every(Boolean)) return { status: "CONFIG_MISSING" };
    try {
      const stripe = new Stripe(environment.STRIPE_SECRET_KEY as string);
      await stripe.balance.retrieve();
      for (const configured of stripePrices) {
        if (!configured.id) return { status: "CONFIG_MISSING" };
        const price = await stripe.prices.retrieve(configured.id);
        const expectedAmount = Math.round(
          cadencePrice(configured.plan, configured.cadence).billedAmountUsd * 100,
        );
        const expectedInterval = configured.cadence === "yearly" ? "year" : "month";
        const expectedIntervalCount = configured.cadence === "quarterly" ? 3 : 1;
        if (
          !price.active ||
          price.type !== "recurring" ||
          price.unit_amount !== expectedAmount ||
          price.currency.toLocaleLowerCase("en-US") !== "usd" ||
          price.recurring?.interval !== expectedInterval ||
          price.recurring.interval_count !== expectedIntervalCount
        ) {
          return {
            status: "INVALID_CONFIG",
            metadata: {
              mode: environment.DEPLOYMENT_ENVIRONMENT === "production" ? "LIVE" : "TEST",
              invalidCatalogEntry: `${configured.plan}:${configured.cadence}`,
            },
          };
        }
      }
      return {
        status: "READY",
        metadata: {
          mode: environment.DEPLOYMENT_ENVIRONMENT === "production" ? "LIVE" : "TEST",
        },
      };
    } catch {
      return {
        status: "PROVIDER_ERROR",
        metadata: {
          mode: environment.DEPLOYMENT_ENVIRONMENT === "production" ? "LIVE" : "TEST",
        },
      };
    }
  };
  const result: Record<string, ComponentResult> = {
    DATABASE: await checked(async () => void (await prisma.client.$queryRaw`SELECT 1`)),
    REDIS: redis
      ? await checked(async () => {
          await redis.connect();
          await redis.ping();
        })
      : { status: "NOT_CONFIGURED" },
    OBJECT_STORAGE: await checked(async () => {
      const key = `readiness/${randomUUID()}.txt`;
      const expected = Buffer.from("waflo-readiness", "utf8");
      await storage.send(new HeadBucketCommand({ Bucket: environment.OBJECT_STORAGE_BUCKET }));
      try {
        await storage.send(
          new PutObjectCommand({
            Bucket: environment.OBJECT_STORAGE_BUCKET,
            Key: key,
            Body: expected,
            ContentType: "text/plain",
          }),
        );
        const result = await storage.send(
          new GetObjectCommand({ Bucket: environment.OBJECT_STORAGE_BUCKET, Key: key }),
        );
        if (!result.Body) throw new Error("Object storage returned an empty readiness object.");
        const received = Buffer.from(await result.Body.transformToByteArray());
        if (!received.equals(expected)) throw new Error("Object storage readiness data mismatch.");
      } finally {
        await storage
          .send(new DeleteObjectCommand({ Bucket: environment.OBJECT_STORAGE_BUCKET, Key: key }))
          .catch(() => undefined);
      }
    }),
    SMTP:
      notifications.configurationStatus() === "READY"
        ? await checked(() => notifications.verifyProvider())
        : { status: "NOT_CONFIGURED" },
    GOOGLE_SIGNIN: authCapabilities.googleSignInAvailable
      ? await checked(() => externalAuth.verifyProviderReachability("google"))
      : { status: "NOT_CONFIGURED" },
    APPLE_SIGNIN: authCapabilities.appleSignInAvailable
      ? await checked(() => externalAuth.verifyProviderReachability("apple"))
      : { status: "NOT_CONFIGURED" },
    GOOGLE_WALLET: await walletStatus("GOOGLE"),
    APPLE_WALLET: await walletStatus("APPLE"),
    STRIPE: await stripeStatus(),
    OPERATIONAL_WORKER: await workerStatus("OPERATIONAL_WORKER"),
    WALLET_WORKER: await workerStatus("WALLET_WORKER"),
    KEY_ROTATION_CONFIG: { status: "READY", metadata: security.keyVersionSummary() },
  };
  const releaseGate = evaluateReleaseReadiness(result, environment.DEPLOYMENT_ENVIRONMENT);
  result.RELEASE_GATE = {
    status: releaseGate.blockers.length === 0 ? "READY" : "DEGRADED",
    metadata: {
      environment: environment.DEPLOYMENT_ENVIRONMENT,
      blockers: releaseGate.blockers,
      warnings: releaseGate.warnings,
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (releaseGate.blockers.length > 0) process.exitCode = 1;
  await redis?.quit().catch(() => undefined);
  storage.destroy();
  await app.close();
}

void main().catch(() => {
  process.stdout.write(`${JSON.stringify({ READINESS: { status: "UNREACHABLE" } }, null, 2)}\n`);
  process.exitCode = 1;
});

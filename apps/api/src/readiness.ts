import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { parseEnvironment } from "@waflo/config";
import { Redis } from "ioredis";
import Stripe from "stripe";
import { createApiApplication } from "./app.js";
import { ExternalAuthService } from "./auth/external-auth.service.js";
import { CustomerSecurityService } from "./customer/customer-security.service.js";
import { PrismaService } from "./database/prisma.service.js";
import { NotificationService } from "./notifications/notification.service.js";
import { WalletProviderRegistry } from "./wallet/wallet-provider.registry.js";

type ReadinessStatus = "READY" | "NOT_CONFIGURED" | "UNREACHABLE" | "INVALID_CONFIG" | "DEGRADED";

interface ComponentResult {
  status: ReadinessStatus;
  metadata?: Record<string, unknown>;
}

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
    const heartbeat = await prisma.client.workerHeartbeat.findUnique({ where: { workerCode } });
    if (!heartbeat) return { status: "NOT_CONFIGURED" as const };
    const stale =
      now - heartbeat.lastLoopAt.getTime() > environment.WORKER_DEGRADED_AFTER_SECONDS * 1000;
    return {
      status: stale || heartbeat.safeFailureCode ? ("DEGRADED" as const) : ("READY" as const),
      metadata: {
        lastLoopAt: heartbeat.lastLoopAt.toISOString(),
        lastSuccessAt: heartbeat.lastSuccessAt?.toISOString() ?? null,
        safeFailureCode: heartbeat.safeFailureCode,
        backlogCount: heartbeat.backlogCount,
        oldestBacklogAt: heartbeat.oldestBacklogAt?.toISOString() ?? null,
      },
    };
  };
  const authCapabilities = externalAuth.publicCapabilities();
  const walletCapabilities = wallets.publicCapabilities();
  const walletStatus = async (provider: "GOOGLE" | "APPLE") => {
    if (!wallets.isConfigured(provider)) return { status: "NOT_CONFIGURED" as const };
    try {
      const health = await wallets.get(provider).healthCheck();
      return {
        status:
          health.status === "HEALTHY"
            ? ("READY" as const)
            : health.status === "API_UNAVAILABLE" || health.status === "PROVIDER_UNAVAILABLE"
              ? ("UNREACHABLE" as const)
              : ("DEGRADED" as const),
        metadata: {
          providerStatus: health.status,
          externallyCertified: health.externallyCertified ?? false,
          demo: health.demo,
        },
      };
    } catch {
      return { status: "UNREACHABLE" as const };
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
      await storage.send(new HeadBucketCommand({ Bucket: environment.OBJECT_STORAGE_BUCKET }));
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
    GOOGLE_WALLET: walletCapabilities.googleWalletAvailable
      ? await walletStatus("GOOGLE")
      : { status: "NOT_CONFIGURED" },
    APPLE_WALLET: walletCapabilities.appleWalletAvailable
      ? await walletStatus("APPLE")
      : { status: "NOT_CONFIGURED" },
    STRIPE: environment.STRIPE_SECRET_KEY
      ? await checked(async () => {
          const stripe = new Stripe(environment.STRIPE_SECRET_KEY as string);
          await stripe.balance.retrieve();
        })
      : { status: "NOT_CONFIGURED" },
    OPERATIONAL_WORKER: await workerStatus("OPERATIONAL_WORKER"),
    WALLET_WORKER: await workerStatus("WALLET_WORKER"),
    KEY_ROTATION_CONFIG: { status: "READY", metadata: security.keyVersionSummary() },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (Object.values(result).some((item) => item.status !== "READY")) process.exitCode = 1;
  await redis?.quit().catch(() => undefined);
  storage.destroy();
  await app.close();
}

void main().catch(() => {
  process.stdout.write(`${JSON.stringify({ READINESS: { status: "UNREACHABLE" } }, null, 2)}\n`);
  process.exitCode = 1;
});

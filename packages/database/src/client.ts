import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

let client: PrismaClient | undefined;

export interface DatabasePoolOptions {
  readonly max?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
  readonly maxLifetimeSeconds?: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function databasePoolOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DatabasePoolOptions {
  return {
    max: positiveInteger(environment.DATABASE_POOL_MAX, 10),
    connectionTimeoutMillis: positiveInteger(
      environment.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      10_000,
    ),
    idleTimeoutMillis: positiveInteger(environment.DATABASE_POOL_IDLE_TIMEOUT_MS, 30_000),
    maxLifetimeSeconds: positiveInteger(environment.DATABASE_POOL_MAX_LIFETIME_SECONDS, 1_800),
  };
}

export function createPrismaClient(
  databaseUrl = process.env.DATABASE_URL,
  pool: DatabasePoolOptions = databasePoolOptionsFromEnvironment(),
): PrismaClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create the Prisma client.");
  }
  const adapter = new PrismaPg({ connectionString: databaseUrl, ...pool });
  return new PrismaClient({ adapter });
}

export function getPrismaClient(): PrismaClient {
  client ??= createPrismaClient();
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

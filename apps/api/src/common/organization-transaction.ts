import { HttpStatus } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@waflo/database";
import { AppError } from "./app-error.js";

const MAX_SERIALIZATION_ATTEMPTS = 4;

function isRetryableSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return (
    code === "P2034" ||
    code === "40001" ||
    message.includes("could not serialize access") ||
    message.includes("deadlock detected")
  );
}

export async function withInvariantLock<T>(
  client: PrismaClient,
  lockKey: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(
        async (transaction) => {
          // One transaction-scoped advisory lock serializes every capacity and
          // single-use or capacity invariant sharing the same domain key.
          await transaction.$queryRaw`
            SELECT 1::int AS locked
            FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
          `;
          return operation(transaction);
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (!isRetryableSerializationFailure(error)) throw error;
      if (attempt === MAX_SERIALIZATION_ATTEMPTS) {
        throw new AppError(
          "CONCURRENT_MODIFICATION_RETRY",
          "The organization changed at the same time. Please retry.",
          HttpStatus.CONFLICT,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 15));
    }
  }
  throw new AppError(
    "CONCURRENT_MODIFICATION_RETRY",
    "The organization changed at the same time. Please retry.",
    HttpStatus.CONFLICT,
  );
}

export function withOrganizationInvariantLock<T>(
  client: PrismaClient,
  organizationId: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withInvariantLock(client, `organization:${organizationId}`, operation);
}

import { HttpStatus } from "@nestjs/common";
import { verifyPassword } from "@waflo/auth";
import type { PrismaClient } from "@waflo/database";
import { AppError } from "../common/app-error.js";

const RECENT_EXTERNAL_AUTHENTICATION_MS = 5 * 60 * 1000;

export async function requireSensitiveReauthentication(
  client: PrismaClient,
  input: {
    userId: string;
    sessionId: string;
    currentPassword?: string | undefined;
    message: string;
  },
) {
  const user = await client.user.findUniqueOrThrow({ where: { id: input.userId } });
  const recentExternalSession = !user.passwordHash
    ? await client.session.findFirst({
        where: {
          id: input.sessionId,
          userId: input.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          createdAt: { gt: new Date(Date.now() - RECENT_EXTERNAL_AUTHENTICATION_MS) },
        },
        select: { id: true },
      })
    : null;

  const verified = user.passwordHash
    ? Boolean(input.currentPassword) &&
      (await verifyPassword(user.passwordHash, input.currentPassword ?? ""))
    : Boolean(recentExternalSession);

  if (!verified) {
    throw new AppError("REAUTHENTICATION_REQUIRED", input.message, HttpStatus.FORBIDDEN);
  }

  return user;
}

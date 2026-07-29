import { createHash } from "node:crypto";
import type { Prisma, WalletCommandType } from "./generated/prisma/client.js";

const stateChangingCommands = ["UPDATE", "INVALIDATE", "RECONCILE"] as const;
type StateChangingWalletCommand = (typeof stateChangingCommands)[number];

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export async function queueWalletPassStateChange(
  transaction: Prisma.TransactionClient,
  input: {
    walletPassInstanceId: string;
    commandType: StateChangingWalletCommand;
    reason: string;
    eventKey: string;
    safePayload?: Readonly<Record<string, unknown>>;
  },
) {
  await transaction.$queryRaw`
    SELECT 1::int AS locked
    FROM pg_advisory_xact_lock(
      hashtextextended(${`wallet-pass-state:${input.walletPassInstanceId}`}, 0)
    )
  `;
  const pass = await transaction.walletPassInstance.findUniqueOrThrow({
    where: { id: input.walletPassInstanceId },
    select: {
      id: true,
      organizationId: true,
      membershipId: true,
      provider: true,
      updateTag: true,
    },
  });
  const idempotencyKey = [
    "wallet",
    pass.provider.toLocaleLowerCase("en-US"),
    input.commandType.toLocaleLowerCase("en-US"),
    pass.id,
    input.eventKey,
  ].join(":");
  const existing = await transaction.walletCommand.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    await transaction.auditLog.create({
      data: {
        organizationId: pass.organizationId,
        action: "wallet.command_replayed",
        targetType: "wallet_command",
        targetId: existing.id,
        requestId: "wallet-orchestrator",
        metadata: {
          walletPassInstanceId: pass.id,
          commandType: input.commandType,
          eventKey: input.eventKey,
        },
      },
    });
    return { command: existing, replayed: true, updateTag: pass.updateTag };
  }

  const nextUpdateTag = pass.provider === "APPLE" ? pass.updateTag + 1 : pass.updateTag;
  await transaction.walletPassInstance.update({
    where: { id: pass.id },
    data: {
      status: input.commandType === "INVALIDATE" ? "INVALIDATION_PENDING" : "UPDATE_PENDING",
      ...(pass.provider === "APPLE" ? { updateTag: nextUpdateTag } : {}),
    },
  });
  const command = await transaction.walletCommand.create({
    data: {
      organizationId: pass.organizationId,
      membershipId: pass.membershipId,
      walletPassInstanceId: pass.id,
      provider: pass.provider,
      commandType: input.commandType as WalletCommandType,
      idempotencyKey,
      payloadFingerprint: fingerprint({
        passId: pass.id,
        commandType: input.commandType,
        reason: input.reason,
        eventKey: input.eventKey,
        updateTag: nextUpdateTag,
      }),
      safePayload: {
        reason: input.reason,
        updateTag: nextUpdateTag,
        ...(input.safePayload ?? {}),
      } as Prisma.InputJsonValue,
    },
  });
  await transaction.auditLog.create({
    data: {
      organizationId: pass.organizationId,
      action: "wallet.pass_state_change_queued",
      targetType: "wallet_pass_instance",
      targetId: pass.id,
      requestId: "wallet-orchestrator",
      metadata: {
        walletCommandId: command.id,
        commandType: input.commandType,
        reason: input.reason,
        updateTag: nextUpdateTag,
      },
    },
  });
  return { command, replayed: false, updateTag: nextUpdateTag };
}

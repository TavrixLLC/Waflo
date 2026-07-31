import { createHash } from "node:crypto";
import type { Prisma, WalletCommandType } from "./generated/prisma/client.js";

const stateChangingCommands = ["UPDATE", "INVALIDATE", "RECONCILE"] as const;
type StateChangingWalletCommand = (typeof stateChangingCommands)[number];

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export async function lockApplePassUpdateSequence(transaction: Prisma.TransactionClient) {
  await transaction.$queryRaw`
    SELECT 1::int AS locked
    FROM pg_advisory_xact_lock(hashtextextended('apple-pass-update-sequence', 0))
  `;
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
  const candidate = await transaction.walletPassInstance.findUniqueOrThrow({
    where: { id: input.walletPassInstanceId },
    select: { provider: true },
  });
  // The global Apple lock is intentionally acquired before the per-pass lock.
  // Holding it until commit makes sequence allocation order equal commit order,
  // preventing a later committed update from carrying an earlier sequence.
  if (candidate.provider === "APPLE") {
    await lockApplePassUpdateSequence(transaction);
  }
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
      appleUpdateSequence: true,
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
    return {
      command: existing,
      replayed: true,
      updateTag: pass.updateTag,
      appleUpdateSequence: pass.appleUpdateSequence,
    };
  }

  const nextUpdateTag = pass.provider === "APPLE" ? pass.updateTag + 1 : pass.updateTag;
  let nextAppleUpdateSequence: bigint | null = null;
  if (pass.provider === "APPLE") {
    const allocated = (
      await transaction.$queryRaw<Array<{ sequence: bigint }>>`
        SELECT nextval('apple_pass_update_sequence')::bigint AS sequence
      `
    )[0]?.sequence;
    if (allocated === undefined) {
      throw new Error("Apple update sequence allocation failed.");
    }
    nextAppleUpdateSequence = allocated;
  }
  await transaction.walletPassInstance.update({
    where: { id: pass.id },
    data: {
      status: input.commandType === "INVALIDATE" ? "INVALIDATION_PENDING" : "UPDATE_PENDING",
      ...(pass.provider === "APPLE"
        ? {
            updateTag: nextUpdateTag,
            appleUpdateSequence: nextAppleUpdateSequence,
          }
        : {}),
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
        appleUpdateSequence: nextAppleUpdateSequence?.toString() ?? null,
      }),
      safePayload: {
        reason: input.reason,
        updateTag: nextUpdateTag,
        ...(nextAppleUpdateSequence !== null
          ? { appleUpdateSequence: nextAppleUpdateSequence.toString() }
          : {}),
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
        ...(nextAppleUpdateSequence !== null
          ? { appleUpdateSequence: nextAppleUpdateSequence.toString() }
          : {}),
      },
    },
  });
  return {
    command,
    replayed: false,
    updateTag: nextUpdateTag,
    appleUpdateSequence: nextAppleUpdateSequence,
  };
}

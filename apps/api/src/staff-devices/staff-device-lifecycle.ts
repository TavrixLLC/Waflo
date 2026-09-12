import type { Prisma } from "@waflo/database";

export async function revokeStaffAccessForMembership(
  transaction: Prisma.TransactionClient,
  organizationMemberId: string,
  now: Date,
) {
  const devices = await transaction.staffDevice.findMany({
    where: { organizationMemberId },
    select: { id: true },
  });
  const deviceIds = devices.map((device) => device.id);
  const [sessions, pairings, approvals] = await Promise.all([
    transaction.staffDeviceSession.updateMany({
      where: { organizationMemberId, revokedAt: null },
      data: { revokedAt: now },
    }),
    transaction.devicePairingSession.updateMany({
      where: {
        intendedStaffMemberId: organizationMemberId,
        status: { in: ["PENDING", "CLAIMED"] },
      },
      data: { status: "CANCELED" },
    }),
    transaction.managerApprovalChallenge.updateMany({
      where: {
        requestedByMemberId: organizationMemberId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: { status: "EXPIRED" },
    }),
  ]);
  return {
    sessionsRevoked: sessions.count,
    pairingsCanceled: pairings.count,
    approvalsExpired: approvals.count,
    deviceIds,
  };
}

export async function revokeStaffAccessForUser(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const memberships = await transaction.organizationMember.findMany({
    where: { userId },
    select: { id: true },
  });
  const outcomes = [];
  for (const membership of memberships) {
    outcomes.push(await revokeStaffAccessForMembership(transaction, membership.id, now));
  }
  return outcomes.reduce(
    (total, outcome) => ({
      sessionsRevoked: total.sessionsRevoked + outcome.sessionsRevoked,
      pairingsCanceled: total.pairingsCanceled + outcome.pairingsCanceled,
      approvalsExpired: total.approvalsExpired + outcome.approvalsExpired,
    }),
    { sessionsRevoked: 0, pairingsCanceled: 0, approvalsExpired: 0 },
  );
}

export async function revokeStaffAccessForLocation(
  transaction: Prisma.TransactionClient,
  organizationMemberId: string,
  locationId: string,
  now: Date,
) {
  const [sessions, approvals] = await Promise.all([
    transaction.staffDeviceSession.updateMany({
      where: { organizationMemberId, locationId, revokedAt: null },
      data: { revokedAt: now },
    }),
    transaction.managerApprovalChallenge.updateMany({
      where: {
        requestedByMemberId: organizationMemberId,
        locationId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: { status: "EXPIRED" },
    }),
  ]);
  const pairings = await transaction.devicePairingSession.updateMany({
    where: { intendedStaffMemberId: organizationMemberId, status: { in: ["PENDING", "CLAIMED"] } },
    data: { status: "CANCELED" },
  });
  return {
    sessionsRevoked: sessions.count,
    pairingsCanceled: pairings.count,
    approvalsExpired: approvals.count,
  };
}

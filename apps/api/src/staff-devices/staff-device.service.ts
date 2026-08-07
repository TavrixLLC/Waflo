import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type {
  CreateDevicePairingSessionInput,
  DevicePairingClaimInput,
  DevicePairingCompleteInput,
} from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import { createQrSvg } from "@waflo/qr-core";
import {
  assertStaffMobileAppVersion,
  createOpaqueDeviceSessionToken,
  createPairingToken,
  hashOpaqueDeviceToken,
  hashPairingToken,
  normalizeEd25519PublicKey,
  parsePairingToken,
  verifyEd25519Message,
} from "@waflo/staff-device-security";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withOrderedInvariantLocks } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

const PAIRING_CHALLENGE_VERSION = "waflo-pair-challenge-v1";

function pairingChallenge(
  secret: string,
  input: { publicId: string; installationId: string; publicKey: string },
): string {
  return createHmac("sha256", secret)
    .update(
      `${PAIRING_CHALLENGE_VERSION}\n${input.publicId}\n${input.installationId}\n${input.publicKey}`,
      "utf8",
    )
    .digest("base64url");
}

function pairingMessage(publicId: string, challenge: string, installationId: string): string {
  return `${PAIRING_CHALLENGE_VERSION}\n${publicId}\n${challenge}\n${installationId}`;
}

function safePairingLocations(value: Prisma.JsonValue): Array<{
  locationId: string;
  earningAllowed: boolean;
  redemptionAllowed: boolean;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !("locationId" in entry) ||
      typeof entry.locationId !== "string"
    ) {
      return [];
    }
    return [
      {
        locationId: entry.locationId,
        earningAllowed: entry.earningAllowed === true,
        redemptionAllowed: entry.redemptionAllowed === true,
      },
    ];
  });
}

@Injectable()
export class StaffDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly environment: EnvironmentService,
  ) {}

  async list(userId: string, organizationId: string, cursor?: string, limit = 30) {
    await this.tenant.requireMembership(userId, organizationId, "devices.view");
    const devices = await this.prisma.client.staffDevice.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(limit, 1), 100) + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        sessions: {
          where: { revokedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, locationId: true, expiresAt: true, lastActiveAt: true },
        },
      },
    });
    const page = devices.slice(0, limit);
    const memberIds = [...new Set(page.map((device) => device.organizationMemberId))];
    const [members, locations] = await Promise.all([
      this.prisma.client.organizationMember.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, role: true, status: true, user: { select: { displayName: true } } },
      }),
      this.prisma.client.staffDeviceLocation.findMany({
        where: { staffDeviceId: { in: page.map((device) => device.id) }, active: true },
      }),
    ]);
    const memberById = new Map(members.map((member) => [member.id, member]));
    return {
      items: page.map((device) => ({
        publicId: device.publicId,
        displayName: device.displayName,
        platform: device.platform,
        status: device.status,
        trustLevel: device.trustLevel,
        appVersion: device.appVersion,
        osVersion: device.osVersion,
        model: device.model,
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
        revokedAt: device.revokedAt,
        staff: memberById.get(device.organizationMemberId) ?? null,
        locations: locations
          .filter((location) => location.staffDeviceId === device.id)
          .map(({ locationId, earningAllowed, redemptionAllowed }) => ({
            locationId,
            earningAllowed,
            redemptionAllowed,
          })),
        session: device.sessions[0] ?? null,
      })),
      nextCursor: devices.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async createPairing(
    userId: string,
    organizationId: string,
    input: CreateDevicePairingSessionInput,
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(userId, organizationId, "devices.pair");
    const intended = await this.prisma.client.organizationMember.findFirst({
      where: { id: input.staffMemberId, organizationId, status: "ACTIVE" },
      include: { user: { select: { displayName: true } } },
    });
    if (!intended || (actor.role === "MANAGER" && intended.role !== "STAFF")) {
      throw new AppError(
        "DEVICE_PAIRING_INVALID",
        "The selected Staff member cannot be paired.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const uniqueLocationIds = [...new Set(input.locations.map((location) => location.locationId))];
    if (uniqueLocationIds.length !== input.locations.length) {
      throw new AppError(
        "DEVICE_PAIRING_INVALID",
        "Each pairing Location must be unique.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const assignments = await this.prisma.client.staffLocationAssignment.findMany({
      where: {
        organizationId,
        organizationMemberId: intended.id,
        locationId: { in: uniqueLocationIds },
        active: true,
      },
    });
    const requestedAllowed = input.locations.every((location) => {
      const assignment = assignments.find(
        (candidate) => candidate.locationId === location.locationId,
      );
      return Boolean(
        assignment &&
          (!location.earningAllowed || assignment.earningAllowed) &&
          (!location.redemptionAllowed || assignment.redemptionAllowed),
      );
    });
    if (!requestedAllowed) {
      throw new AppError(
        "LOCATION_NOT_AUTHORIZED",
        "Pairing Locations must be active Staff assignments.",
        HttpStatus.FORBIDDEN,
      );
    }
    const publicId = randomUUID();
    const pairing = createPairingToken({
      publicId,
      environmentId: this.environment.values.NODE_ENV,
    });
    const expiresInMinutes = Math.min(
      input.expiresInMinutes,
      this.environment.values.DEVICE_PAIRING_TTL_MINUTES,
    );
    const created = await this.prisma.client.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        const active = await transaction.devicePairingSession.findFirst({
          where: {
            intendedStaffMemberId: intended.id,
            status: { in: ["PENDING", "CLAIMED"] },
            expiresAt: { gt: new Date() },
          },
        });
        if (active) {
          throw new AppError(
            "DEVICE_PAIRING_ALREADY_ACTIVE",
            "This Staff member already has an active pairing session.",
            HttpStatus.CONFLICT,
          );
        }
        await transaction.devicePairingSession.updateMany({
          where: {
            intendedStaffMemberId: intended.id,
            status: { in: ["PENDING", "CLAIMED"] },
            expiresAt: { lte: new Date() },
          },
          data: { status: "EXPIRED" },
        });
        const session = await transaction.devicePairingSession.create({
          data: {
            publicId,
            organizationId,
            intendedStaffMemberId: intended.id,
            pairingTokenHash: pairing.tokenHash,
            requestedLocationAssignments: input.locations,
            deviceLabelSuggestion:
              input.deviceLabelSuggestion ?? `${intended.user.displayName}'s device`,
            createdByUserId: userId,
            expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "device.pairing_created",
            targetType: "device_pairing_session",
            targetId: session.id,
            metadata: {
              intendedStaffMemberId: intended.id,
              locationCount: input.locations.length,
              expiresInMinutes,
            },
          },
          request,
        );
        return session;
      },
    );
    return {
      publicId: created.publicId,
      status: created.status,
      expiresAt: created.expiresAt,
      staffDisplayName: intended.user.displayName,
      pairingQrSvg: await createQrSvg(pairing.token, {
        width: 360,
        margin: 3,
        errorCorrectionLevel: "Q",
      }),
      accessibleLabel: `Pair Staff device for ${intended.user.displayName}. Expires in ${expiresInMinutes} minutes.`,
    };
  }

  async getPairing(userId: string, organizationId: string, publicId: string) {
    await this.tenant.requireMembership(userId, organizationId, "devices.view");
    return this.prisma.client.devicePairingSession.findFirstOrThrow({
      where: { publicId, organizationId },
      select: {
        publicId: true,
        status: true,
        expiresAt: true,
        claimedAt: true,
        completedAt: true,
        deviceLabelSuggestion: true,
        requestedLocationAssignments: true,
      },
    });
  }

  async cancelPairing(
    userId: string,
    organizationId: string,
    publicId: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "devices.pair");
    const session = await this.prisma.client.devicePairingSession.findFirst({
      where: { publicId, organizationId },
    });
    if (!session) throw new AppError("DEVICE_PAIRING_INVALID", "Pairing not found.", 404);
    const status = await withOrderedInvariantLocks(
      this.prisma.client,
      [`pairing:${publicId}`],
      async (transaction) => {
        const canceled = await transaction.devicePairingSession.updateMany({
          where: { id: session.id, status: { in: ["PENDING", "CLAIMED"] } },
          data: { status: "CANCELED" },
        });
        if (canceled.count !== 1) {
          const current = await transaction.devicePairingSession.findUniqueOrThrow({
            where: { id: session.id },
            select: { status: true },
          });
          return current.status;
        }
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "device.pairing_canceled",
            targetType: "device_pairing_session",
            targetId: session.id,
          },
          request,
        );
        return "CANCELED" as const;
      },
    );
    return { status };
  }

  async claim(input: DevicePairingClaimInput) {
    let parsed: ReturnType<typeof parsePairingToken>;
    try {
      parsed = parsePairingToken(input.pairingToken);
    } catch {
      throw new AppError(
        "DEVICE_PAIRING_INVALID",
        "Pairing token is invalid.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (parsed.environmentId !== this.environment.values.NODE_ENV) {
      throw new AppError(
        "DEVICE_PAIRING_INVALID",
        "Pairing token is for another environment.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      input.platform === "TEST_CLIENT" &&
      (this.environment.values.NODE_ENV === "production" ||
        !this.environment.values.TEST_STAFF_CLIENT_ENABLED)
    ) {
      throw new AppError(
        "STAFF_DEVICE_NOT_ACTIVE",
        "The development Staff Test Client is disabled.",
        HttpStatus.FORBIDDEN,
      );
    }
    try {
      assertStaffMobileAppVersion({
        platform: input.platform,
        appVersion: input.appVersion,
        minimumVersion: this.environment.values.STAFF_MOBILE_MINIMUM_APP_VERSION,
      });
    } catch (error) {
      throw new AppError(
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "STAFF_APP_VERSION_UNSUPPORTED",
        "This Staff mobile app version is not supported.",
        426,
      );
    }
    const publicKey = normalizeEd25519PublicKey(input.publicKey);
    return withOrderedInvariantLocks(
      this.prisma.client,
      [`pairing:${parsed.publicId}`],
      async (transaction) => {
        const session = await transaction.devicePairingSession.findFirst({
          where: {
            publicId: parsed.publicId,
            pairingTokenHash: hashPairingToken(input.pairingToken),
          },
        });
        if (!session) {
          throw new AppError("DEVICE_PAIRING_INVALID", "Pairing token is invalid.", 422);
        }
        if (session.status !== "PENDING") {
          throw new AppError(
            "DEVICE_PAIRING_ALREADY_USED",
            "Pairing token has already been used.",
            HttpStatus.CONFLICT,
          );
        }
        if (session.expiresAt <= new Date()) {
          await transaction.devicePairingSession.updateMany({
            where: { id: session.id, status: "PENDING" },
            data: { status: "EXPIRED" },
          });
          throw new AppError(
            "DEVICE_PAIRING_EXPIRED",
            "Pairing token has expired.",
            HttpStatus.GONE,
          );
        }
        const duplicate = await transaction.staffDevice.findFirst({
          where: { OR: [{ installationId: input.installationId }, { publicKey }] },
        });
        if (duplicate) {
          throw new AppError(
            "DEVICE_PAIRING_ALREADY_USED",
            "This device installation is already paired.",
            HttpStatus.CONFLICT,
          );
        }
        const challenge = pairingChallenge(this.environment.values.DEVICE_SESSION_SECRET, {
          publicId: session.publicId,
          installationId: input.installationId,
          publicKey,
        });
        const challengeExpiresAt = new Date(Date.now() + 2 * 60_000);
        const claimed = await transaction.devicePairingSession.updateMany({
          where: { id: session.id, status: "PENDING" },
          data: {
            status: "CLAIMED",
            claimedAt: new Date(),
            challengeHash: createHash("sha256").update(challenge).digest("hex"),
            challengeExpiresAt,
            claimedInstallationId: input.installationId,
            claimedPublicKey: publicKey,
            claimedMetadata: {
              platform: input.platform,
              appVersion: input.appVersion,
              osVersion: input.osVersion ?? null,
              model: input.model ?? null,
            },
          },
        });
        if (claimed.count !== 1) {
          throw new AppError(
            "DEVICE_PAIRING_ALREADY_USED",
            "Pairing token has already been used.",
            409,
          );
        }
        await this.audit.recordInTransaction(transaction, {
          organizationId: session.organizationId,
          action: "device.pairing_claimed",
          targetType: "device_pairing_session",
          targetId: session.id,
          metadata: { platform: input.platform, appVersion: input.appVersion },
        });
        return {
          pairingPublicId: session.publicId,
          challenge,
          challengeExpiresAt,
          signatureAlgorithm: "Ed25519",
          message: pairingMessage(session.publicId, challenge, input.installationId),
        };
      },
    );
  }

  async challenge(publicId: string) {
    const session = await this.prisma.client.devicePairingSession.findUnique({
      where: { publicId },
    });
    if (
      session?.status !== "CLAIMED" ||
      !session.claimedInstallationId ||
      !session.claimedPublicKey ||
      !session.challengeExpiresAt ||
      session.challengeExpiresAt <= new Date()
    ) {
      throw new AppError(
        "DEVICE_PAIRING_EXPIRED",
        "Pairing challenge is unavailable.",
        HttpStatus.GONE,
      );
    }
    const challenge = pairingChallenge(this.environment.values.DEVICE_SESSION_SECRET, {
      publicId: session.publicId,
      installationId: session.claimedInstallationId,
      publicKey: session.claimedPublicKey,
    });
    if (createHash("sha256").update(challenge).digest("hex") !== session.challengeHash) {
      throw new AppError(
        "DEVICE_PAIRING_INVALID",
        "Pairing challenge is invalid.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return {
      pairingPublicId: session.publicId,
      challenge,
      challengeExpiresAt: session.challengeExpiresAt,
      message: pairingMessage(session.publicId, challenge, session.claimedInstallationId),
    };
  }

  async complete(input: DevicePairingCompleteInput) {
    const token = createOpaqueDeviceSessionToken(this.environment.values.DEVICE_SESSION_SECRET);
    const refreshToken = randomBytes(48).toString("base64url");
    return withOrderedInvariantLocks(
      this.prisma.client,
      [`pairing:${input.pairingPublicId}`],
      async (transaction) => {
        const session = await transaction.devicePairingSession.findUnique({
          where: { publicId: input.pairingPublicId },
        });
        if (
          session?.status !== "CLAIMED" ||
          !session.claimedInstallationId ||
          !session.claimedPublicKey ||
          !session.challengeExpiresAt ||
          session.challengeExpiresAt <= new Date() ||
          session.expiresAt <= new Date()
        ) {
          throw new AppError(
            "DEVICE_PAIRING_EXPIRED",
            "Pairing challenge has expired.",
            HttpStatus.GONE,
          );
        }
        const intendedStaffMember = await transaction.organizationMember.findUnique({
          where: { id: session.intendedStaffMemberId },
        });
        if (
          !intendedStaffMember ||
          intendedStaffMember.organizationId !== session.organizationId ||
          intendedStaffMember.status !== "ACTIVE"
        ) {
          throw new AppError(
            "STAFF_ASSIGNMENT_REQUIRED",
            "The intended Staff member is not active.",
            HttpStatus.FORBIDDEN,
          );
        }
        const expectedChallenge = pairingChallenge(this.environment.values.DEVICE_SESSION_SECRET, {
          publicId: session.publicId,
          installationId: session.claimedInstallationId,
          publicKey: session.claimedPublicKey,
        });
        if (
          input.challenge !== expectedChallenge ||
          createHash("sha256").update(input.challenge).digest("hex") !== session.challengeHash
        ) {
          throw new AppError(
            "DEVICE_PAIRING_INVALID",
            "Pairing challenge is invalid.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        verifyEd25519Message({
          publicKey: session.claimedPublicKey,
          message: pairingMessage(session.publicId, input.challenge, session.claimedInstallationId),
          signature: input.signature,
        });
        const metadata =
          session.claimedMetadata &&
          typeof session.claimedMetadata === "object" &&
          !Array.isArray(session.claimedMetadata)
            ? session.claimedMetadata
            : {};
        const locations = safePairingLocations(session.requestedLocationAssignments);
        const authoritativeLocation = locations[0];
        if (!authoritativeLocation) {
          throw new AppError(
            "STAFF_ASSIGNMENT_REQUIRED",
            "Pairing has no active Location assignment.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const device = await transaction.staffDevice.create({
          data: {
            organizationId: session.organizationId,
            organizationMemberId: session.intendedStaffMemberId,
            displayName: input.displayName ?? session.deviceLabelSuggestion ?? "Waflo Staff device",
            platform:
              metadata.platform === "IOS" ||
              metadata.platform === "ANDROID" ||
              metadata.platform === "TEST_CLIENT"
                ? metadata.platform
                : "ANDROID",
            installationId: session.claimedInstallationId,
            publicKey: session.claimedPublicKey,
            status: "ACTIVE",
            appVersion: typeof metadata.appVersion === "string" ? metadata.appVersion : "unknown",
            osVersion: typeof metadata.osVersion === "string" ? metadata.osVersion : null,
            model: typeof metadata.model === "string" ? metadata.model : null,
            pairedAt: new Date(),
            lastSeenAt: new Date(),
          },
        });
        await transaction.staffDeviceLocation.createMany({
          data: locations.map((location) => ({
            staffDeviceId: device.id,
            locationId: location.locationId,
            earningAllowed: location.earningAllowed,
            redemptionAllowed: location.redemptionAllowed,
          })),
        });
        const deviceSession = await transaction.staffDeviceSession.create({
          data: {
            organizationId: session.organizationId,
            staffDeviceId: device.id,
            organizationMemberId: session.intendedStaffMemberId,
            locationId: authoritativeLocation.locationId,
            tokenHash: token.tokenHash,
            refreshTokenHash: hashOpaqueDeviceToken(
              `refresh:${refreshToken}`,
              this.environment.values.DEVICE_SESSION_SECRET,
            ),
            expiresAt: new Date(
              Date.now() + this.environment.values.DEVICE_SESSION_TTL_DAYS * 86_400_000,
            ),
            appVersion: device.appVersion,
            deviceMetadata: { pairedThrough: session.publicId },
          },
        });
        await transaction.devicePairingSession.update({
          where: { id: session.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        await this.audit.recordInTransaction(transaction, {
          organizationId: session.organizationId,
          action: "device.paired",
          targetType: "staff_device",
          targetId: device.id,
          locationId: authoritativeLocation.locationId,
          metadata: {
            staffMemberId: session.intendedStaffMemberId,
            platform: device.platform,
            locationCount: locations.length,
          },
        });
        return {
          device: {
            publicId: device.publicId,
            displayName: device.displayName,
            platform: device.platform,
            status: device.status,
          },
          session: {
            id: deviceSession.id,
            token: token.token,
            refreshToken,
            expiresAt: deviceSession.expiresAt,
          },
          context: {
            organizationId: session.organizationId,
            role: intendedStaffMember.role,
            locationId: authoritativeLocation.locationId,
          },
        };
      },
    );
  }

  async revoke(
    userId: string,
    organizationId: string,
    publicId: string,
    reason: string,
    compromised: boolean,
    request: WafloRequest,
  ) {
    const actor = await this.tenant.requireMembership(userId, organizationId, "devices.revoke");
    const device = await this.prisma.client.staffDevice.findFirst({
      where: { publicId, organizationId },
    });
    if (!device) throw new AppError("STAFF_DEVICE_NOT_FOUND", "Staff device not found.", 404);
    const target = await this.prisma.client.organizationMember.findUnique({
      where: { id: device.organizationMemberId },
    });
    if (actor.role === "MANAGER" && target?.role !== "STAFF") {
      throw new AppError(
        "PERMISSION_DENIED",
        "Managers can revoke Staff devices only.",
        HttpStatus.FORBIDDEN,
      );
    }
    await withOrderedInvariantLocks(
      this.prisma.client,
      [`organization:${organizationId}`, `device:${device.id}`],
      async (transaction) => {
        await transaction.staffDevice.update({
          where: { id: device.id },
          data: {
            status: compromised ? "COMPROMISED" : "REVOKED",
            revokedAt: new Date(),
            revocationReason: reason.trim().slice(0, 240),
          },
        });
        await transaction.staffDeviceSession.updateMany({
          where: { staffDeviceId: device.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: compromised ? "device.compromised" : "device.revoked",
            targetType: "staff_device",
            targetId: device.id,
            metadata: { reason: reason.trim().slice(0, 240) },
          },
          request,
        );
      },
    );
    return { status: compromised ? ("COMPROMISED" as const) : ("REVOKED" as const) };
  }

  async refreshSession(sessionId: string, rawRefreshToken: string) {
    const expectedHash = hashOpaqueDeviceToken(
      `refresh:${rawRefreshToken}`,
      this.environment.values.DEVICE_SESSION_SECRET,
    );
    const access = createOpaqueDeviceSessionToken(this.environment.values.DEVICE_SESSION_SECRET);
    const refreshToken = randomBytes(48).toString("base64url");
    const rotated = await withOrderedInvariantLocks(
      this.prisma.client,
      [`device-session:${sessionId}`],
      async (transaction) => {
        const session = await transaction.staffDeviceSession.findUnique({
          where: { id: sessionId },
          include: { staffDevice: true, organizationMember: true },
        });
        if (
          !session ||
          session.refreshTokenHash !== expectedHash ||
          session.revokedAt ||
          session.expiresAt <= new Date() ||
          session.staffDevice.status !== "ACTIVE" ||
          session.organizationMember.status !== "ACTIVE"
        ) {
          throw new AppError(
            "STAFF_DEVICE_NOT_ACTIVE",
            "Staff device session cannot be refreshed.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        const revoked = await transaction.staffDeviceSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
            refreshTokenHash: expectedHash,
          },
          data: { revokedAt: new Date(), refreshTokenHash: null },
        });
        if (revoked.count !== 1) {
          throw new AppError(
            "STAFF_DEVICE_NOT_ACTIVE",
            "Staff device session cannot be refreshed.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        const created = await transaction.staffDeviceSession.create({
          data: {
            organizationId: session.organizationId,
            staffDeviceId: session.staffDeviceId,
            organizationMemberId: session.organizationMemberId,
            locationId: session.locationId,
            tokenHash: access.tokenHash,
            refreshTokenHash: hashOpaqueDeviceToken(
              `refresh:${refreshToken}`,
              this.environment.values.DEVICE_SESSION_SECRET,
            ),
            expiresAt: new Date(
              Date.now() + this.environment.values.DEVICE_SESSION_TTL_DAYS * 86_400_000,
            ),
            rotationSource: session.id,
            appVersion: session.appVersion,
            ...(session.deviceMetadata !== null
              ? { deviceMetadata: session.deviceMetadata as Prisma.InputJsonValue }
              : {}),
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: session.organizationId,
            action: "device.session_rotated",
            targetType: "staff_device_session",
            targetId: created.id,
            requestId: "staff-device",
            metadata: { staffDeviceId: session.staffDeviceId, rotationSource: session.id },
          },
        });
        return created;
      },
    );
    return {
      session: {
        id: rotated.id,
        token: access.token,
        refreshToken,
        expiresAt: rotated.expiresAt,
      },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.client.staffDeviceSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

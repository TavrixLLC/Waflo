import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type {
  CreateDevicePairingSessionInput,
  DevicePairingClaimInput,
  DevicePairingCompleteInput,
  ReviewAccessAuthorizeInput,
  StaffLocationAssignmentUpsertInput,
} from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import { hasPermission } from "@waflo/permissions";
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
import {
  isExactActiveReviewDevice,
  isReviewWindowActive,
  REVIEW_FIXTURE_IDS,
  reviewSessionMetadata,
  sessionModeFromMetadata,
} from "../review-access/review-session.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { TenantService } from "../tenancy/tenant.service.js";
import {
  revokeStaffAccessForLocation,
  revokeStaffAccessForMembership,
} from "./staff-device-lifecycle.js";

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
    private readonly limiter: RateLimitService,
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

  async listLocationAssignments(userId: string, organizationId: string, memberId: string) {
    const actor = await this.tenant.requireMembership(userId, organizationId, "devices.view");
    const target = await this.prisma.client.organizationMember.findFirst({
      where: { id: memberId, organizationId },
      select: {
        id: true,
        role: true,
        status: true,
        user: { select: { displayName: true, status: true } },
      },
    });
    if (!target || (actor.role === "MANAGER" && target.role !== "STAFF")) {
      throw new AppError("STAFF_MEMBER_NOT_FOUND", "Staff member not found.", HttpStatus.NOT_FOUND);
    }
    const assignments = await this.prisma.client.staffLocationAssignment.findMany({
      where: { organizationId, organizationMemberId: memberId },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    });
    const locations = await this.prisma.client.location.findMany({
      where: { id: { in: assignments.map((assignment) => assignment.locationId) }, organizationId },
      select: { id: true, name: true, status: true },
    });
    const locationById = new Map(locations.map((location) => [location.id, location]));
    return {
      staffMember: target,
      items: assignments.map((assignment) => ({
        locationId: assignment.locationId,
        location: locationById.get(assignment.locationId) ?? null,
        earningAllowed: assignment.earningAllowed,
        redemptionAllowed: assignment.redemptionAllowed,
        active: assignment.active,
        createdAt: assignment.createdAt,
        revokedAt: assignment.revokedAt,
      })),
    };
  }

  async putLocationAssignment(
    userId: string,
    organizationId: string,
    memberId: string,
    locationId: string,
    input: StaffLocationAssignmentUpsertInput,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "devices.pair");
    const outcome = await withOrderedInvariantLocks(
      this.prisma.client,
      [`organization:${organizationId}`, `staff-assignment:${memberId}:${locationId}`],
      async (transaction) => {
        const [actor, target, location, existing] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
            include: { user: { select: { status: true } } },
          }),
          transaction.organizationMember.findFirst({
            where: { id: memberId, organizationId, status: "ACTIVE" },
            include: { user: { select: { status: true, displayName: true } } },
          }),
          transaction.location.findFirst({
            where: { id: locationId, organizationId, status: "ACTIVE" },
            select: { id: true, name: true },
          }),
          transaction.staffLocationAssignment.findUnique({
            where: {
              organizationMemberId_locationId: {
                organizationMemberId: memberId,
                locationId,
              },
            },
          }),
        ]);
        if (
          actor?.status !== "ACTIVE" ||
          actor.user.status !== "ACTIVE" ||
          !hasPermission(actor.role, "devices.pair")
        ) {
          throw new AppError(
            "PERMISSION_DENIED",
            "Your role does not allow Staff assignment changes.",
            HttpStatus.FORBIDDEN,
          );
        }
        if (
          target?.user.status !== "ACTIVE" ||
          (actor.role === "MANAGER" && target.role !== "STAFF")
        ) {
          throw new AppError(
            "STAFF_MEMBER_NOT_ASSIGNABLE",
            "The selected active Staff member cannot be assigned.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        if (!location) {
          throw new AppError(
            "STAFF_LOCATION_INVALID",
            "Select an active Location from this organization.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const changed =
          !existing?.active ||
          existing.earningAllowed !== input.earningAllowed ||
          existing.redemptionAllowed !== input.redemptionAllowed;
        const assignment = changed
          ? await transaction.staffLocationAssignment.upsert({
              where: {
                organizationMemberId_locationId: {
                  organizationMemberId: memberId,
                  locationId,
                },
              },
              create: {
                organizationId,
                organizationMemberId: memberId,
                locationId,
                earningAllowed: input.earningAllowed,
                redemptionAllowed: input.redemptionAllowed,
                assignedByUserId: userId,
              },
              update: {
                organizationId,
                earningAllowed: input.earningAllowed,
                redemptionAllowed: input.redemptionAllowed,
                active: true,
                assignedByUserId: userId,
                revokedAt: null,
              },
            })
          : existing;
        if (changed && (!input.earningAllowed || !input.redemptionAllowed)) {
          const devices = await transaction.staffDevice.findMany({
            where: { organizationMemberId: memberId },
            select: { id: true },
          });
          await transaction.staffDeviceLocation.updateMany({
            where: {
              staffDeviceId: { in: devices.map((device) => device.id) },
              locationId,
              active: true,
            },
            data: {
              ...(!input.earningAllowed ? { earningAllowed: false } : {}),
              ...(!input.redemptionAllowed ? { redemptionAllowed: false } : {}),
            },
          });
        }
        if (changed) {
          await transaction.devicePairingSession.updateMany({
            where: { intendedStaffMemberId: memberId, status: { in: ["PENDING", "CLAIMED"] } },
            data: { status: "CANCELED" },
          });
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              actorUserId: userId,
              action: existing?.active
                ? "staff.location_assignment_updated"
                : "staff.location_assignment_provisioned",
              targetType: "staff_location_assignment",
              targetId: `${memberId}:${locationId}`,
              locationId,
              metadata: {
                staffMemberId: memberId,
                earningAllowed: input.earningAllowed,
                redemptionAllowed: input.redemptionAllowed,
              },
            },
            request,
          );
        }
        return { assignment, changed, staffDisplayName: target.user.displayName, location };
      },
    );
    return {
      organizationId,
      staffMemberId: memberId,
      staffDisplayName: outcome.staffDisplayName,
      locationId,
      locationName: outcome.location.name,
      earningAllowed: outcome.assignment.earningAllowed,
      redemptionAllowed: outcome.assignment.redemptionAllowed,
      active: outcome.assignment.active,
      createdAt: outcome.assignment.createdAt,
      revokedAt: outcome.assignment.revokedAt,
      changed: outcome.changed,
    };
  }

  async revokeLocationAssignment(
    userId: string,
    organizationId: string,
    memberId: string,
    locationId: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "devices.pair");
    return withOrderedInvariantLocks(
      this.prisma.client,
      [`organization:${organizationId}`, `staff-assignment:${memberId}:${locationId}`],
      async (transaction) => {
        const [actor, target, assignment] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
            include: { user: { select: { status: true } } },
          }),
          transaction.organizationMember.findFirst({
            where: { id: memberId, organizationId },
          }),
          transaction.staffLocationAssignment.findUnique({
            where: {
              organizationMemberId_locationId: {
                organizationMemberId: memberId,
                locationId,
              },
            },
          }),
        ]);
        if (
          actor?.status !== "ACTIVE" ||
          actor.user.status !== "ACTIVE" ||
          !hasPermission(actor.role, "devices.pair")
        ) {
          throw new AppError(
            "PERMISSION_DENIED",
            "Your role does not allow Staff assignment changes.",
            HttpStatus.FORBIDDEN,
          );
        }
        if (!target) {
          throw new AppError("STAFF_MEMBER_NOT_FOUND", "Staff member not found.", 404);
        }
        if (actor.role === "MANAGER" && target.role !== "STAFF") {
          throw new AppError(
            "PERMISSION_DENIED",
            "Managers can revoke Staff assignments only.",
            HttpStatus.FORBIDDEN,
          );
        }
        if (!assignment || assignment.organizationId !== organizationId) {
          throw new AppError(
            "STAFF_LOCATION_ASSIGNMENT_NOT_FOUND",
            "Staff Location assignment not found.",
            HttpStatus.NOT_FOUND,
          );
        }
        if (!assignment.active) {
          return {
            organizationId,
            staffMemberId: memberId,
            locationId,
            status: "REVOKED" as const,
            revokedAt: assignment.revokedAt,
            changed: false,
          };
        }
        const now = new Date();
        const updated = await transaction.staffLocationAssignment.update({
          where: {
            organizationMemberId_locationId: {
              organizationMemberId: memberId,
              locationId,
            },
          },
          data: { active: false, revokedAt: now },
        });
        const lifecycle = await revokeStaffAccessForLocation(
          transaction,
          memberId,
          locationId,
          now,
        );
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "staff.location_assignment_revoked",
            targetType: "staff_location_assignment",
            targetId: `${memberId}:${locationId}`,
            locationId,
            metadata: { staffMemberId: memberId, ...lifecycle },
          },
          request,
        );
        return {
          organizationId,
          staffMemberId: memberId,
          locationId,
          status: "REVOKED" as const,
          revokedAt: updated.revokedAt,
          changed: true,
        };
      },
    );
  }

  async createPairing(
    userId: string,
    organizationId: string,
    input: CreateDevicePairingSessionInput,
    request: WafloRequest,
  ) {
    const pairingOrganization = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
      select: { merchantSlug: true },
    });
    if (pairingOrganization?.merchantSlug === this.environment.values.REVIEW_TENANT_SLUG) {
      throw new AppError(
        "REVIEW_SESSION_INVALID",
        "The review environment uses Review Access.",
        HttpStatus.FORBIDDEN,
      );
    }
    const actor = await this.tenant.requireMembership(userId, organizationId, "devices.pair");
    const intended = await this.prisma.client.organizationMember.findFirst({
      where: { id: input.staffMemberId, organizationId, status: "ACTIVE" },
      include: { user: { select: { displayName: true, status: true } } },
    });
    if (
      intended?.user.status !== "ACTIVE" ||
      (actor.role === "MANAGER" && intended.role !== "STAFF")
    ) {
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
    const activeLocationCount = await this.prisma.client.location.count({
      where: { id: { in: uniqueLocationIds }, organizationId, status: "ACTIVE" },
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
    if (!requestedAllowed || activeLocationCount !== uniqueLocationIds.length) {
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
    const created = await withOrderedInvariantLocks(
      this.prisma.client,
      [`organization:${organizationId}`, `pairing-member:${intended.id}`],
      async (transaction: Prisma.TransactionClient) => {
        const [currentActor, currentIntended, currentAssignments, currentLocationCount] =
          await Promise.all([
            transaction.organizationMember.findUnique({
              where: { organizationId_userId: { organizationId, userId } },
              include: { user: { select: { status: true } } },
            }),
            transaction.organizationMember.findUnique({
              where: { id: intended.id },
              include: { user: { select: { status: true } } },
            }),
            transaction.staffLocationAssignment.findMany({
              where: {
                organizationId,
                organizationMemberId: intended.id,
                locationId: { in: uniqueLocationIds },
                active: true,
              },
            }),
            transaction.location.count({
              where: { id: { in: uniqueLocationIds }, organizationId, status: "ACTIVE" },
            }),
          ]);
        if (
          currentActor?.status !== "ACTIVE" ||
          currentActor.user.status !== "ACTIVE" ||
          !hasPermission(currentActor.role, "devices.pair")
        ) {
          throw new AppError("PERMISSION_DENIED", "Pairing permission is no longer active.", 403);
        }
        const stillAllowed = input.locations.every((location) => {
          const assignment = currentAssignments.find(
            (candidate) => candidate.locationId === location.locationId,
          );
          return Boolean(
            assignment &&
              (!location.earningAllowed || assignment.earningAllowed) &&
              (!location.redemptionAllowed || assignment.redemptionAllowed),
          );
        });
        if (
          currentIntended?.organizationId !== organizationId ||
          currentIntended.status !== "ACTIVE" ||
          (currentActor.role === "MANAGER" && currentIntended.role !== "STAFF") ||
          currentIntended.user.status !== "ACTIVE" ||
          !stillAllowed ||
          currentLocationCount !== uniqueLocationIds.length
        ) {
          throw new AppError(
            "STAFF_ASSIGNMENT_REQUIRED",
            "Pairing requires an active Staff identity and active Location assignments.",
            HttpStatus.FORBIDDEN,
          );
        }
        const now = new Date();
        const revokedAccess = await revokeStaffAccessForMembership(transaction, intended.id, now);
        const revokedDevices = await transaction.staffDevice.updateMany({
          where: { organizationMemberId: intended.id, status: { in: ["PENDING", "ACTIVE"] } },
          data: {
            status: "REVOKED",
            revokedAt: now,
            revocationReason: "A new Staff sign-in QR was generated.",
          },
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
              priorPairingsCanceled: revokedAccess.pairingsCanceled,
              priorSessionsRevoked: revokedAccess.sessionsRevoked,
              priorDevicesRevoked: revokedDevices.count,
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
        const requestedLocations = safePairingLocations(session.requestedLocationAssignments);
        const requestedLocationIds = requestedLocations.map((location) => location.locationId);
        const [intendedMember, activeLocations, liveAssignments] = await Promise.all([
          transaction.organizationMember.findUnique({
            where: { id: session.intendedStaffMemberId },
            include: { user: { select: { status: true } } },
          }),
          transaction.location.count({
            where: {
              id: { in: requestedLocationIds },
              organizationId: session.organizationId,
              status: "ACTIVE",
            },
          }),
          transaction.staffLocationAssignment.findMany({
            where: {
              organizationId: session.organizationId,
              organizationMemberId: session.intendedStaffMemberId,
              locationId: { in: requestedLocationIds },
              active: true,
            },
          }),
        ]);
        const assignmentAllowed = requestedLocations.every((requested) => {
          const assignment = liveAssignments.find(
            (candidate) => candidate.locationId === requested.locationId,
          );
          return Boolean(
            assignment &&
              (!requested.earningAllowed || assignment.earningAllowed) &&
              (!requested.redemptionAllowed || assignment.redemptionAllowed),
          );
        });
        if (
          requestedLocations.length === 0 ||
          activeLocations !== requestedLocations.length ||
          intendedMember?.organizationId !== session.organizationId ||
          intendedMember.status !== "ACTIVE" ||
          intendedMember.user.status !== "ACTIVE" ||
          !assignmentAllowed
        ) {
          throw new AppError(
            "STAFF_ASSIGNMENT_REQUIRED",
            "Pairing requires an active Staff identity and active Location assignments.",
            HttpStatus.FORBIDDEN,
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

  async createReviewPairing(input: ReviewAccessAuthorizeInput, request: WafloRequest) {
    const normalizedCode = input.reviewAccessCode.toUpperCase();
    const suppliedHash = createHmac("sha256", this.environment.values.DEVICE_SESSION_SECRET)
      .update(`waflo-review-access-v1\n${normalizedCode}`, "utf8")
      .digest("hex");
    const sourceHash = createHash("sha256")
      .update(request.ip || "unknown", "utf8")
      .digest("hex");
    const attemptAllowed = await this.limiter.consume(
      `review-access:${sourceHash}`,
      this.environment.values.REVIEW_ACCESS_ATTEMPT_LIMIT,
      this.environment.values.REVIEW_ACCESS_ATTEMPT_WINDOW_SECONDS,
    );
    if (!attemptAllowed) {
      await this.audit.security(
        {
          eventType: "review.authorization_failed",
          severity: "MEDIUM",
          metadata: { category: "RATE_LIMITED", platform: input.platform },
        },
        request,
      );
      throw new AppError(
        "REVIEW_ACCESS_RATE_LIMITED",
        "Review Access cannot be checked again yet.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.environment.values.REVIEW_ACCESS_ENABLED) {
      await this.audit.security(
        {
          eventType: "review.authorization_failed",
          metadata: { category: "REVOKED", platform: input.platform },
        },
        request,
      );
      throw new AppError(
        "REVIEW_ACCESS_REVOKED",
        "Review Access is not available.",
        HttpStatus.FORBIDDEN,
      );
    }
    const expectedHash = this.environment.values.REVIEW_ACCESS_CODE_HASH;
    const credentialMatches =
      expectedHash.length === 64 &&
      timingSafeEqual(Buffer.from(suppliedHash, "hex"), Buffer.from(expectedHash, "hex"));
    if (!credentialMatches) {
      await this.audit.security(
        {
          eventType: "review.authorization_failed",
          severity: "MEDIUM",
          metadata: { category: "INVALID", platform: input.platform },
        },
        request,
      );
      throw new AppError(
        "REVIEW_ACCESS_INVALID",
        "The Review Access code is not valid.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const expiresAt = new Date(this.environment.values.REVIEW_ACCESS_EXPIRES_AT);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
      await this.audit.security(
        {
          eventType: "review.authorization_failed",
          metadata: { category: "EXPIRED", platform: input.platform },
        },
        request,
      );
      throw new AppError(
        "REVIEW_ACCESS_EXPIRED",
        "The Review Access window has ended.",
        HttpStatus.GONE,
      );
    }
    if (input.platform === "TEST_CLIENT" && this.environment.values.NODE_ENV === "production") {
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
    const [organization, member, location, assignment] = await Promise.all([
      this.prisma.client.organization.findFirst({
        where: {
          id: REVIEW_FIXTURE_IDS.organization,
          merchantSlug: this.environment.values.REVIEW_TENANT_SLUG,
          status: "ACTIVE",
        },
      }),
      this.prisma.client.organizationMember.findFirst({
        where: {
          id: REVIEW_FIXTURE_IDS.member,
          organizationId: REVIEW_FIXTURE_IDS.organization,
          status: "ACTIVE",
          user: { status: "ACTIVE", interactiveLoginAllowed: false },
        },
      }),
      this.prisma.client.location.findFirst({
        where: {
          id: REVIEW_FIXTURE_IDS.location,
          organizationId: REVIEW_FIXTURE_IDS.organization,
          status: "ACTIVE",
        },
      }),
      this.prisma.client.staffLocationAssignment.findFirst({
        where: {
          organizationId: REVIEW_FIXTURE_IDS.organization,
          organizationMemberId: REVIEW_FIXTURE_IDS.member,
          locationId: REVIEW_FIXTURE_IDS.location,
          active: true,
          earningAllowed: true,
          redemptionAllowed: true,
        },
      }),
    ]);
    if (!organization || !member || !location || !assignment) {
      throw new AppError(
        "REVIEW_TENANT_UNAVAILABLE",
        "The review environment is temporarily unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const publicId = randomUUID();
    const challenge = pairingChallenge(this.environment.values.DEVICE_SESSION_SECRET, {
      publicId,
      installationId: input.installationId,
      publicKey,
    });
    const challengeExpiresAt = new Date(Date.now() + 2 * 60_000);
    return withOrderedInvariantLocks(
      this.prisma.client,
      [`review-pairing:${input.installationId}`, `pairing-member:${member.id}`],
      async (transaction) => {
        const duplicate = await transaction.staffDevice.findFirst({
          where: { OR: [{ installationId: input.installationId }, { publicKey }] },
        });
        if (
          duplicate &&
          !isExactActiveReviewDevice(duplicate, {
            installationId: input.installationId,
            publicKey,
          })
        ) {
          throw new AppError(
            "DEVICE_PAIRING_ALREADY_USED",
            "This device installation is already paired.",
            HttpStatus.CONFLICT,
          );
        }
        const session = await transaction.devicePairingSession.create({
          data: {
            publicId,
            organizationId: organization.id,
            intendedStaffMemberId: member.id,
            pairingTokenHash: createHash("sha256").update(randomBytes(48)).digest("hex"),
            requestedLocationAssignments: [
              { locationId: location.id, earningAllowed: true, redemptionAllowed: true },
            ],
            deviceLabelSuggestion: "Waflo review device",
            createdByUserId: REVIEW_FIXTURE_IDS.user,
            status: "CLAIMED",
            expiresAt: new Date(
              Date.now() + this.environment.values.DEVICE_PAIRING_TTL_MINUTES * 60_000,
            ),
            claimedAt: new Date(),
            challengeHash: createHash("sha256").update(challenge).digest("hex"),
            challengeExpiresAt,
            claimedInstallationId: input.installationId,
            claimedPublicKey: publicKey,
            claimedMetadata: reviewSessionMetadata({
              platform: input.platform,
              appVersion: input.appVersion,
              osVersion: input.osVersion ?? null,
              model: input.model ?? null,
            }),
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId: organization.id,
            action: "review.device_authorized",
            targetType: "device_pairing_session",
            targetId: session.id,
            metadata: { platform: input.platform, appVersion: input.appVersion },
          },
          request,
        );
        return {
          pairingPublicId: session.publicId,
          challenge,
          challengeExpiresAt,
          signatureAlgorithm: "Ed25519" as const,
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
    const preflight = await this.prisma.client.devicePairingSession.findUnique({
      where: { publicId: input.pairingPublicId },
      select: { intendedStaffMemberId: true },
    });
    if (!preflight) {
      throw new AppError(
        "DEVICE_PAIRING_EXPIRED",
        "Pairing challenge has expired.",
        HttpStatus.GONE,
      );
    }
    const token = createOpaqueDeviceSessionToken(this.environment.values.DEVICE_SESSION_SECRET);
    const refreshToken = randomBytes(48).toString("base64url");
    return withOrderedInvariantLocks(
      this.prisma.client,
      [`pairing-member:${preflight.intendedStaffMemberId}`, `pairing:${input.pairingPublicId}`],
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
          include: { user: { select: { status: true } } },
        });
        if (
          !intendedStaffMember ||
          intendedStaffMember.organizationId !== session.organizationId ||
          intendedStaffMember.status !== "ACTIVE" ||
          intendedStaffMember.user.status !== "ACTIVE"
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
        const sessionMode = sessionModeFromMetadata(session.claimedMetadata);
        const reviewBindingValid =
          session.organizationId === REVIEW_FIXTURE_IDS.organization &&
          session.intendedStaffMemberId === REVIEW_FIXTURE_IDS.member;
        if (
          (sessionMode === "REVIEW" &&
            (!reviewBindingValid ||
              !isReviewWindowActive(
                this.environment.values.REVIEW_ACCESS_ENABLED,
                this.environment.values.REVIEW_ACCESS_EXPIRES_AT,
              ))) ||
          (sessionMode === "NORMAL" && reviewBindingValid)
        ) {
          throw new AppError(
            "REVIEW_SESSION_INVALID",
            "The Review Access session is not valid.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        const locations = safePairingLocations(session.requestedLocationAssignments);
        const authoritativeLocation = locations[0];
        if (!authoritativeLocation) {
          throw new AppError(
            "STAFF_ASSIGNMENT_REQUIRED",
            "Pairing has no active Location assignment.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const locationIds = locations.map((location) => location.locationId);
        const [activeLocationCount, assignments] = await Promise.all([
          transaction.location.count({
            where: {
              id: { in: locationIds },
              organizationId: session.organizationId,
              status: "ACTIVE",
            },
          }),
          transaction.staffLocationAssignment.findMany({
            where: {
              organizationId: session.organizationId,
              organizationMemberId: session.intendedStaffMemberId,
              locationId: { in: locationIds },
              active: true,
            },
          }),
        ]);
        const assignmentAllowed = locations.every((requested) => {
          const assignment = assignments.find(
            (candidate) => candidate.locationId === requested.locationId,
          );
          return Boolean(
            assignment &&
              (!requested.earningAllowed || assignment.earningAllowed) &&
              (!requested.redemptionAllowed || assignment.redemptionAllowed),
          );
        });
        if (activeLocationCount !== locations.length || !assignmentAllowed) {
          throw new AppError(
            "STAFF_ASSIGNMENT_REQUIRED",
            "Pairing requires active Location assignments.",
            HttpStatus.FORBIDDEN,
          );
        }
        const existingDevice = await transaction.staffDevice.findUnique({
          where: { installationId: session.claimedInstallationId },
        });
        if (
          existingDevice &&
          (existingDevice.organizationId !== session.organizationId ||
            existingDevice.organizationMemberId !== session.intendedStaffMemberId)
        ) {
          throw new AppError(
            "DEVICE_PAIRING_INVALID",
            "This installation is already bound to another Staff identity.",
            HttpStatus.CONFLICT,
          );
        }
        const deviceData = {
          organizationId: session.organizationId,
          organizationMemberId: session.intendedStaffMemberId,
          displayName: input.displayName ?? session.deviceLabelSuggestion ?? "Waflo Staff device",
          platform:
            metadata.platform === "IOS" ||
            metadata.platform === "ANDROID" ||
            metadata.platform === "TEST_CLIENT"
              ? metadata.platform
              : ("ANDROID" as const),
          publicKey: session.claimedPublicKey,
          trustLevel: sessionMode === "REVIEW" ? "REVIEW" : "PAIRED",
          status: "ACTIVE" as const,
          appVersion: typeof metadata.appVersion === "string" ? metadata.appVersion : "unknown",
          osVersion: typeof metadata.osVersion === "string" ? metadata.osVersion : null,
          model: typeof metadata.model === "string" ? metadata.model : null,
          pairedAt: new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
          revocationReason: null,
        } satisfies Prisma.StaffDeviceUncheckedUpdateInput;
        const device = existingDevice
          ? await transaction.staffDevice.update({
              where: { id: existingDevice.id },
              data: deviceData,
            })
          : await transaction.staffDevice.create({
              data: {
                ...deviceData,
                installationId: session.claimedInstallationId,
              },
            });
        if (existingDevice) {
          await transaction.staffDeviceLocation.deleteMany({ where: { staffDeviceId: device.id } });
        }
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
            deviceMetadata:
              sessionMode === "REVIEW"
                ? reviewSessionMetadata({ pairedThrough: session.publicId })
                : { pairedThrough: session.publicId, sessionMode: "NORMAL" },
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
            sessionMode,
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
        await transaction.managerApprovalChallenge.updateMany({
          where: {
            staffDeviceId: device.id,
            status: { in: ["PENDING", "APPROVED"] },
          },
          data: { status: "EXPIRED" },
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
          include: {
            staffDevice: true,
            organizationMember: { include: { user: { select: { status: true } } } },
          },
        });
        if (!session || session.refreshTokenHash !== expectedHash) {
          throw new AppError(
            "STAFF_DEVICE_NOT_ACTIVE",
            "Staff device session cannot be refreshed.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        const [location, staffAssignment, deviceAssignment] = await Promise.all([
          transaction.location.findFirst({
            where: {
              id: session.locationId,
              organizationId: session.organizationId,
              status: "ACTIVE",
            },
            select: { id: true },
          }),
          transaction.staffLocationAssignment.findFirst({
            where: {
              organizationId: session.organizationId,
              organizationMemberId: session.organizationMemberId,
              locationId: session.locationId,
              active: true,
            },
            select: { locationId: true },
          }),
          transaction.staffDeviceLocation.findFirst({
            where: {
              staffDeviceId: session.staffDeviceId,
              locationId: session.locationId,
              active: true,
            },
            select: { locationId: true },
          }),
        ]);
        if (session.organizationMember.user.status !== "ACTIVE") {
          throw new AppError(
            "STAFF_USER_DEACTIVATED",
            "The Staff identity is deactivated.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        if (session.organizationMember.status !== "ACTIVE") {
          throw new AppError(
            "STAFF_MEMBERSHIP_INACTIVE",
            "The Staff organization membership is inactive.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        if (session.staffDevice.status !== "ACTIVE") {
          throw new AppError(
            "STAFF_DEVICE_REVOKED",
            "The Staff device has been revoked.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        if (!location || !staffAssignment || !deviceAssignment) {
          throw new AppError(
            "STAFF_LOCATION_ASSIGNMENT_INVALID",
            "The Staff Location assignment is no longer active.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        if (session.revokedAt || session.expiresAt <= new Date()) {
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

import { createHash, randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { TransferRequestInput } from "@waflo/contracts";
import { canonicalCustomerUrl, decodeQrImage } from "@waflo/qr-core";
import { googleLoyaltyObjectId } from "@waflo/wallet-google";
import { walletCommandIdempotencyKey } from "@waflo/wallet-core";
import { lockApplePassUpdateSequence, queueWalletPassStateChange } from "@waflo/database";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import {
  withInvariantLock,
  withProgramLifecycleInvariantLock,
} from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { HostResolutionService } from "../public/host-resolution.service.js";
import { CustomerSecurityService } from "./customer-security.service.js";

const activeProgramStates = new Set(["PUBLISHED", "PAUSED"]);

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function transferActionUrl(
  baseUrl: string,
  merchantSlug: string,
  transferPublicId: string,
  token: string,
) {
  const url = new URL(
    canonicalCustomerUrl({
      customerBaseUrl: baseUrl,
      merchantSlug,
      pathname: "/transfer/confirm",
    }),
  );
  url.hash = `transfer=${encodeURIComponent(transferPublicId)}&token=${encodeURIComponent(token)}`;
  return url.toString();
}

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly security: CustomerSecurityService,
    private readonly hosts: HostResolutionService,
    private readonly environment: EnvironmentService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async inspect(host: string, qrPayload: string, developmentOverride?: string) {
    const context = await this.credentialContext(host, qrPayload, developmentOverride);
    return this.safeInspection(context);
  }

  async request(
    host: string,
    idempotencyKey: string,
    input: TransferRequestInput,
    request: WafloRequest,
    developmentOverride?: string,
  ) {
    if (!/^[A-Za-z0-9._:-]{16,255}$/.test(idempotencyKey)) {
      throw new AppError(
        "TRANSFER_IDEMPOTENCY_KEY_REQUIRED",
        "A valid transfer idempotency key is required.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const context = await this.credentialContext(host, input.qrPayload, developmentOverride);
    const membership = context.credential.membership;
    const primaryEmail = membership.customer.contacts.find(
      (contact) => contact.type === "EMAIL" && contact.isPrimary,
    );
    const emailPath = Boolean(primaryEmail);
    const policy = await this.prisma.client.programEnrollmentPolicy.findUnique({
      where: { programVersionId: membership.enrollmentProgramVersionId },
    });
    if (!emailPath && !policy?.transferWithoutEmailAllowed) {
      throw new AppError(
        "TRANSFER_EMAIL_REQUIRED",
        "This program requires email confirmation for card transfer.",
        HttpStatus.CONFLICT,
      );
    }

    const fingerprint = sha256({
      credentialId: context.credential.publicCredentialId,
      secretVersion: context.credential.secretVersion,
      preferredLocale: input.preferredLocale,
      method: emailPath ? "EMAIL_CONFIRMED" : "QR_WITHOUT_EMAIL",
    });
    const rawProof = this.security.createTransferToken();
    const browserNonce = emailPath ? null : this.security.createTransferToken();
    const createdFromCustomerSessionId = await this.optionalCurrentSessionId(
      request,
      membership.id,
    );
    const transfer = await withInvariantLock(
      this.prisma.client,
      `membership-transfer:${membership.id}`,
      async (transaction) => {
        const currentCredential = await transaction.membershipCredential.findUnique({
          where: { id: context.credential.id },
          include: {
            membership: { include: { program: true, customer: true, organization: true } },
          },
        });
        this.assertTransferable(currentCredential);
        const existingByKey = await transaction.membershipTransferCommand.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: membership.organizationId,
              idempotencyKey,
            },
          },
        });
        if (existingByKey) {
          if (existingByKey.requestFingerprint !== fingerprint) {
            throw new AppError(
              "TRANSFER_IDEMPOTENCY_KEY_CONFLICT",
              "This idempotency key was already used for another transfer request.",
              HttpStatus.CONFLICT,
            );
          }
          if (existingByKey.status !== "PENDING_CONFIRMATION") {
            return { command: existingByKey, replayed: true, proof: null as string | null };
          }
          const replayExpiresAt = this.security.transferTokenExpiresAt(emailPath);
          const refreshed = await transaction.membershipTransferCommand.update({
            where: { id: existingByKey.id },
            data: {
              confirmationTokenHash: this.transferProofHash({
                commandId: existingByKey.id,
                membershipId: existingByKey.membershipId,
                credentialId: existingByKey.oldCredentialId,
                rawProof,
                browserNonce,
              }),
              confirmationExpiresAt: replayExpiresAt,
            },
          });
          return { command: refreshed, replayed: true, proof: rawProof };
        }
        const active = await transaction.membershipTransferCommand.findFirst({
          where: {
            membershipId: membership.id,
            status: { in: ["PENDING_CONFIRMATION", "PROCESSING"] },
          },
        });
        if (active) {
          throw new AppError(
            "TRANSFER_ALREADY_PENDING",
            "A transfer is already pending for this card.",
            HttpStatus.CONFLICT,
            { transferPublicId: active.publicTransferId },
          );
        }
        const id = randomUUID();
        const expiresAt = this.security.transferTokenExpiresAt(emailPath);
        const proofHash = this.transferProofHash({
          commandId: id,
          membershipId: membership.id,
          credentialId: context.credential.id,
          rawProof,
          browserNonce,
        });
        const command = await transaction.membershipTransferCommand.create({
          data: {
            id,
            publicTransferId: this.security.createPublicTransferId(),
            organizationId: membership.organizationId,
            membershipId: membership.id,
            oldCredentialId: context.credential.id,
            transferMethod: emailPath ? "EMAIL_CONFIRMED" : "QR_WITHOUT_EMAIL",
            idempotencyKey,
            requestFingerprint: fingerprint,
            confirmationTokenHash: proofHash,
            confirmationExpiresAt: expiresAt,
            createdFromCustomerSessionId,
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId: membership.organizationId,
            action: "membership.transfer_requested",
            targetType: "membership_transfer_command",
            targetId: command.id,
            metadata: {
              method: command.transferMethod,
              oldCredentialVersion: context.credential.credentialVersion,
            },
          },
          request,
        );
        return { command, replayed: false, proof: rawProof };
      },
    );

    if (emailPath && primaryEmail && transfer.proof) {
      await this.sendTransferEmail(
        transfer.command,
        primaryEmail,
        membership.organization.name,
        membership.organization.merchantSlug,
        membership.program.internalName,
        input.preferredLocale,
        transfer.proof,
        request,
      );
    }
    return {
      transferPublicId: transfer.command.publicTransferId,
      status: transfer.command.status,
      method: transfer.command.transferMethod,
      expiresAt: transfer.command.confirmationExpiresAt,
      replayed: transfer.replayed,
      challenge: emailPath ? null : transfer.proof,
      browserNonce,
      emailSent: emailPath,
      warning: emailPath
        ? null
        : "Anyone with a valid screenshot of this card QR may be able to transfer it. Continue only on a device you control.",
    };
  }

  async resend(
    host: string,
    transferPublicId: string,
    request: WafloRequest,
    developmentOverride?: string,
  ) {
    const resolved = await this.hosts.resolveOrganization(host, developmentOverride);
    if (resolved.status !== "active") return { accepted: true };
    const transfer = await this.prisma.client.membershipTransferCommand.findFirst({
      where: {
        publicTransferId: transferPublicId,
        organizationId: resolved.organization.id,
        transferMethod: "EMAIL_CONFIRMED",
        status: "PENDING_CONFIRMATION",
      },
      include: {
        oldCredential: true,
        membership: {
          include: {
            customer: { include: { contacts: { where: { archivedAt: null, isPrimary: true } } } },
            organization: true,
            program: true,
          },
        },
      },
    });
    if (!transfer) return { accepted: true };
    const email = transfer.membership.customer.contacts.find((contact) => contact.type === "EMAIL");
    if (!email) return { accepted: true };
    const rawToken = this.security.createTransferToken();
    const expiresAt = this.security.transferTokenExpiresAt(true);
    await this.prisma.client.membershipTransferCommand.update({
      where: { id: transfer.id },
      data: {
        confirmationTokenHash: this.transferProofHash({
          commandId: transfer.id,
          membershipId: transfer.membershipId,
          credentialId: transfer.oldCredentialId,
          rawProof: rawToken,
          browserNonce: null,
        }),
        confirmationExpiresAt: expiresAt,
      },
    });
    await this.sendTransferEmail(
      { ...transfer, confirmationExpiresAt: expiresAt },
      email,
      transfer.membership.organization.name,
      transfer.membership.organization.merchantSlug,
      transfer.membership.program.internalName,
      transfer.membership.customer.preferredLocale === "AR" ? "ar" : "en",
      rawToken,
      request,
    );
    return { accepted: true };
  }

  async confirmEmail(
    host: string,
    transferPublicId: string,
    token: string,
    request: WafloRequest,
    developmentOverride?: string,
  ) {
    return this.confirm(
      host,
      transferPublicId,
      token,
      null,
      "EMAIL_CONFIRMED",
      request,
      developmentOverride,
    );
  }

  async confirmWithoutEmail(
    host: string,
    transferPublicId: string,
    challenge: string,
    browserNonce: string | undefined,
    request: WafloRequest,
    developmentOverride?: string,
  ) {
    if (!browserNonce) {
      throw new AppError(
        "TRANSFER_BROWSER_CHALLENGE_REQUIRED",
        "This transfer challenge must be completed in the same browser.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.confirm(
      host,
      transferPublicId,
      challenge,
      browserNonce,
      "QR_WITHOUT_EMAIL",
      request,
      developmentOverride,
    );
  }

  async status(host: string, transferPublicId: string, developmentOverride?: string) {
    const resolved = await this.hosts.resolveOrganization(host, developmentOverride);
    if (resolved.status !== "active") {
      throw new AppError("TRANSFER_NOT_FOUND", "Transfer not found.", HttpStatus.NOT_FOUND);
    }
    const transfer = await this.prisma.client.membershipTransferCommand.findFirst({
      where: { publicTransferId: transferPublicId, organizationId: resolved.organization.id },
      select: {
        publicTransferId: true,
        status: true,
        transferMethod: true,
        confirmationExpiresAt: true,
        completedAt: true,
        safeFailureCode: true,
      },
    });
    if (!transfer) {
      throw new AppError("TRANSFER_NOT_FOUND", "Transfer not found.", HttpStatus.NOT_FOUND);
    }
    return transfer;
  }

  async decodeQrImage(bytes: Buffer, mimeType: string) {
    try {
      const qrPayload = await decodeQrImage(bytes, mimeType, {
        maxBytes: this.environment.values.TRANSFER_QR_MAX_BYTES,
        maxPixels: this.environment.values.TRANSFER_QR_MAX_PIXELS,
      });
      const verified = await this.security.verifyCredentialPayload(qrPayload);
      if (!verified) throw new Error("Credential unavailable.");
      return { qrPayload };
    } catch {
      throw new AppError(
        "TRANSFER_QR_IMAGE_INVALID",
        "No active Waflo card QR was found in that image.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private async confirm(
    host: string,
    transferPublicId: string,
    rawProof: string,
    browserNonce: string | null,
    expectedMethod: "EMAIL_CONFIRMED" | "QR_WITHOUT_EMAIL",
    request: WafloRequest,
    developmentOverride?: string,
  ) {
    const resolved = await this.hosts.resolveOrganization(host, developmentOverride);
    if (resolved.status !== "active") {
      throw new AppError("TRANSFER_NOT_FOUND", "Transfer not found.", HttpStatus.NOT_FOUND);
    }
    const lockTarget = await this.prisma.client.membershipTransferCommand.findFirst({
      where: {
        publicTransferId: transferPublicId,
        organizationId: resolved.organization.id,
      },
      select: { membershipId: true, membership: { select: { programId: true } } },
    });
    if (!lockTarget) {
      throw new AppError("TRANSFER_NOT_FOUND", "Transfer not found.", HttpStatus.NOT_FOUND);
    }
    const result = await withProgramLifecycleInvariantLock(
      this.prisma.client,
      resolved.organization.id,
      lockTarget.membership.programId,
      async (lookupTransaction) => {
        const lookup = await lookupTransaction.membershipTransferCommand.findFirst({
          where: {
            publicTransferId: transferPublicId,
            organizationId: resolved.organization.id,
          },
        });
        if (!lookup) {
          throw new AppError("TRANSFER_NOT_FOUND", "Transfer not found.", HttpStatus.NOT_FOUND);
        }
        const expectedHash = this.transferProofHash({
          commandId: lookup.id,
          membershipId: lookup.membershipId,
          credentialId: lookup.oldCredentialId,
          rawProof,
          browserNonce,
        });
        if (
          lookup.transferMethod !== expectedMethod ||
          !lookup.confirmationTokenHash ||
          expectedHash !== lookup.confirmationTokenHash
        ) {
          throw new AppError(
            "TRANSFER_CONFIRMATION_INVALID",
            "This transfer confirmation is invalid.",
            HttpStatus.UNAUTHORIZED,
          );
        }
        if (lookup.status === "COMPLETED" && lookup.newCredentialId) {
          const membership = await lookupTransaction.membership.findUnique({
            where: { id: lookup.membershipId },
            select: { publicMembershipId: true },
          });
          if (!membership) throw new Error("Transferred membership is unavailable.");
          return this.completedPayload(
            lookup.id,
            membership.publicMembershipId,
            lookup.newCredentialId,
            true,
          );
        }
        if (
          lookup.status !== "PENDING_CONFIRMATION" ||
          !lookup.confirmationExpiresAt ||
          lookup.confirmationExpiresAt <= new Date()
        ) {
          if (
            lookup.status === "PENDING_CONFIRMATION" &&
            lookup.confirmationExpiresAt &&
            lookup.confirmationExpiresAt <= new Date()
          ) {
            await lookupTransaction.membershipTransferCommand.update({
              where: { id: lookup.id },
              data: { status: "EXPIRED", safeFailureCode: "CONFIRMATION_EXPIRED" },
            });
          }
          throw new AppError(
            "TRANSFER_CONFIRMATION_EXPIRED",
            "This transfer confirmation has expired.",
            HttpStatus.GONE,
          );
        }
        return (async (transaction) => {
          const command = await transaction.membershipTransferCommand.findUnique({
            where: { id: lookup.id },
          });
          if (!command) {
            throw new AppError("TRANSFER_NOT_FOUND", "Transfer not found.", HttpStatus.NOT_FOUND);
          }
          if (command.status === "COMPLETED" && command.newCredentialId) {
            const membership = await transaction.membership.findUnique({
              where: { id: command.membershipId },
              select: { publicMembershipId: true },
            });
            if (!membership) throw new Error("Transferred membership is unavailable.");
            return this.completedPayload(
              command.id,
              membership.publicMembershipId,
              command.newCredentialId,
              true,
            );
          }
          const membership = await transaction.membership.findUnique({
            where: { id: command.membershipId },
            include: {
              organization: true,
              customer: {
                include: { contacts: { where: { archivedAt: null, isPrimary: true } } },
              },
              program: true,
              credentials: { orderBy: { credentialVersion: "desc" }, take: 1 },
              walletPassInstances: true,
            },
          });
          const oldCredential = await transaction.membershipCredential.findUnique({
            where: { id: command.oldCredentialId },
          });
          if (
            !membership ||
            !oldCredential ||
            oldCredential.status !== "ACTIVE" ||
            membership.status !== "ACTIVE" ||
            membership.customer.status !== "ACTIVE" ||
            membership.organization.status !== "ACTIVE" ||
            !activeProgramStates.has(membership.program.status)
          ) {
            await transaction.membershipTransferCommand.update({
              where: { id: command.id },
              data: { status: "FAILED", safeFailureCode: "CARD_NOT_TRANSFERABLE" },
            });
            throw new AppError(
              "CARD_NOT_TRANSFERABLE",
              "This card can no longer be transferred.",
              HttpStatus.CONFLICT,
            );
          }
          await transaction.membershipTransferCommand.update({
            where: { id: command.id },
            data: { status: "PROCESSING", confirmedAt: new Date() },
          });
          const credentialVersion =
            (membership.credentials[0]?.credentialVersion ?? oldCredential.credentialVersion) + 1;
          const createdCredential = this.security.createCredential(credentialVersion);
          const newCredentialId = randomUUID();
          // Retire the old credential before creating its replacement so the
          // database's one-active-credential invariant remains true at every
          // statement boundary inside the transaction.
          await transaction.membershipCredential.update({
            where: { id: oldCredential.id },
            data: {
              status: "TRANSFERRED",
              transferredAt: new Date(),
            },
          });
          await transaction.membershipCredential.create({
            data: {
              id: newCredentialId,
              organizationId: membership.organizationId,
              membershipId: membership.id,
              credentialVersion,
              publicCredentialId: createdCredential.publicCredentialId,
              secretVersion: createdCredential.secretVersion,
              secretHash: createdCredential.secretHash,
              status: "ACTIVE",
            },
          });
          await transaction.membershipCredential.update({
            where: { id: oldCredential.id },
            data: {
              replacedByCredentialId: newCredentialId,
            },
          });
          await transaction.membershipAccessSession.updateMany({
            where: {
              membershipId: membership.id,
              membershipCredentialId: null,
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
          const sessionToken = this.security.deterministicTransferSessionToken(command.id);
          await transaction.membershipAccessSession.upsert({
            where: { tokenHash: this.security.hashSessionToken(sessionToken) },
            create: {
              organizationId: membership.organizationId,
              membershipId: membership.id,
              membershipCredentialId: newCredentialId,
              tokenHash: this.security.hashSessionToken(sessionToken),
              expiresAt: this.security.customerSessionExpiresAt(),
              userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
            },
            update: {},
          });
          if (membership.walletPassInstances.some((pass) => pass.provider === "APPLE")) {
            await lockApplePassUpdateSequence(transaction);
          }
          for (const oldPass of membership.walletPassInstances) {
            const newPassId = randomUUID();
            const providerIdentity =
              oldPass.provider === "APPLE"
                ? `waflo.${newPassId.replaceAll("-", "")}`
                : googleLoyaltyObjectId(
                    this.environment.values.GOOGLE_WALLET_ISSUER_ID ?? "test-issuer",
                    newPassId,
                  );
            const newPass = await transaction.walletPassInstance.create({
              data: {
                id: newPassId,
                organizationId: membership.organizationId,
                membershipId: membership.id,
                membershipCredentialId: newCredentialId,
                provider: oldPass.provider,
                walletProgramBindingId: oldPass.walletProgramBindingId,
                providerIdentity,
                status: "PENDING",
                providerState: { transferReplacement: true },
              },
            });
            await transaction.walletCommand.updateMany({
              where: {
                walletPassInstanceId: oldPass.id,
                commandType: { in: ["ISSUE", "UPDATE"] },
                status: { in: ["PENDING", "FAILED"] },
              },
              data: {
                status: "DEAD_LETTER",
                safeErrorCode: "CREDENTIAL_TRANSFERRED",
                completedAt: new Date(),
              },
            });
            await queueWalletPassStateChange(transaction, {
              walletPassInstanceId: oldPass.id,
              commandType: "INVALIDATE",
              reason: "MEMBERSHIP_TRANSFERRED",
              eventKey: `transfer:${command.id}`,
              safePayload: { transferCommandId: command.id },
            });
            await transaction.walletPassInstance.update({
              where: { id: oldPass.id },
              data: {
                providerState: { transferred: true },
              },
            });
            const issueKey = walletCommandIdempotencyKey({
              provider: oldPass.provider,
              commandType: "ISSUE",
              membershipId: membership.id,
              credentialVersion,
            });
            await transaction.walletCommand.create({
              data: {
                organizationId: membership.organizationId,
                membershipId: membership.id,
                walletPassInstanceId: newPass.id,
                provider: oldPass.provider,
                commandType: "ISSUE",
                idempotencyKey: issueKey,
                payloadFingerprint: sha256({ passId: newPass.id, credentialVersion }),
                safePayload: { credentialVersion, transferReplacement: true },
              },
            });
          }
          if (expectedMethod === "EMAIL_CONFIRMED") {
            await transaction.customerContact.updateMany({
              where: {
                customerId: membership.customerId,
                type: "EMAIL",
                isPrimary: true,
                archivedAt: null,
              },
              data: { verificationStatus: "VERIFIED", verifiedAt: new Date() },
            });
          }
          await transaction.membershipTransferEvent.create({
            data: {
              organizationId: membership.organizationId,
              membershipId: membership.id,
              oldCredentialId: oldCredential.id,
              newCredentialId,
              method: expectedMethod,
              actorType: "CUSTOMER",
              safeMetadata: {
                noEmailRiskPath: expectedMethod === "QR_WITHOUT_EMAIL",
                oldCredentialVersion: oldCredential.credentialVersion,
                newCredentialVersion: credentialVersion,
              },
            },
          });
          await transaction.membershipTransferCommand.update({
            where: { id: command.id },
            data: {
              status: "COMPLETED",
              newCredentialId,
              completedAt: new Date(),
              safeFailureCode: null,
            },
          });
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId: membership.organizationId,
              action: "membership.transferred",
              targetType: "membership",
              targetId: membership.id,
              metadata: {
                method: expectedMethod,
                oldCredentialVersion: oldCredential.credentialVersion,
                newCredentialVersion: credentialVersion,
              },
            },
            request,
          );
          return {
            status: "COMPLETED" as const,
            replayed: false,
            sessionToken: this.security.deterministicTransferSessionToken(command.id),
            publicMembershipId: membership.publicMembershipId,
            newCredentialId,
            cardPath: `/card/${membership.publicMembershipId}`,
            completionEmail:
              expectedMethod === "EMAIL_CONFIRMED"
                ? (membership.customer.contacts.find((contact) => contact.type === "EMAIL") ?? null)
                : null,
            organizationName: membership.organization.name,
            programName: membership.program.internalName,
            locale:
              membership.customer.preferredLocale === "AR" ? ("ar" as const) : ("en" as const),
          };
        })(lookupTransaction);
      },
      [`membership:${lockTarget.membershipId}`, `transfer-public:${transferPublicId}`],
    );
    if (result.completionEmail && result.locale && result.organizationName && result.programName) {
      try {
        await this.notifications.send({
          to: this.security.decryptEmail(result.completionEmail),
          locale: result.locale,
          kind: "membership_transfer_completed",
          organizationName: result.organizationName,
          programName: result.programName,
        });
      } catch {
        await this.audit.security(
          {
            organizationId: resolved.organization.id,
            eventType: "membership.transfer_completion_email_failed",
            severity: "LOW",
          },
          request,
        );
      }
    }
    return result;
  }

  private completedPayload(
    commandId: string,
    publicMembershipId: string,
    newCredentialId: string,
    replayed: boolean,
  ) {
    return {
      status: "COMPLETED" as const,
      replayed,
      sessionToken: this.security.deterministicTransferSessionToken(commandId),
      publicMembershipId,
      newCredentialId,
      cardPath: `/card/${publicMembershipId}`,
      completionEmail: null,
      organizationName: null,
      programName: null,
      locale: null,
    };
  }

  private async credentialContext(host: string, qrPayload: string, developmentOverride?: string) {
    const resolved = await this.hosts.resolveOrganization(host, developmentOverride);
    if (resolved.status !== "active") {
      throw new AppError(
        "TRANSFER_CARD_UNAVAILABLE",
        "This card is unavailable.",
        HttpStatus.NOT_FOUND,
      );
    }
    const credential = await this.security.verifyCredentialPayload(qrPayload);
    if (!credential || credential.organizationId !== resolved.organization.id) {
      throw new AppError(
        "TRANSFER_CARD_UNAVAILABLE",
        "This card is unavailable.",
        HttpStatus.NOT_FOUND,
      );
    }
    this.assertTransferable(credential);
    return { resolved, credential };
  }

  private safeInspection(context: Awaited<ReturnType<TransferService["credentialContext"]>>) {
    const credential = context.credential;
    const email = credential.membership.customer.contacts.find(
      (contact) => contact.type === "EMAIL" && contact.isPrimary,
    );
    return {
      merchant: { name: credential.membership.organization.name },
      program: { name: credential.membership.program.internalName },
      maskedEmail: email?.maskedDisplayValue ?? null,
      emailConfirmationRequired: Boolean(email),
      cardStatus: "ACTIVE" as const,
    };
  }

  private assertTransferable(
    credential: {
      status: string;
      membership: {
        status: string;
        customer: { status: string };
        organization: { status: string };
        program: { status: string };
      };
    } | null,
  ) {
    if (
      credential?.status !== "ACTIVE" ||
      credential.membership.status !== "ACTIVE" ||
      credential.membership.customer.status !== "ACTIVE" ||
      credential.membership.organization.status !== "ACTIVE" ||
      !activeProgramStates.has(credential.membership.program.status)
    ) {
      throw new AppError(
        "CARD_NOT_TRANSFERABLE",
        "This card cannot be transferred.",
        HttpStatus.CONFLICT,
      );
    }
  }

  private transferProofHash(input: {
    commandId: string;
    membershipId: string;
    credentialId: string;
    rawProof: string;
    browserNonce: string | null;
  }) {
    return this.security.hashTransferToken(
      [
        input.commandId,
        input.membershipId,
        input.credentialId,
        input.rawProof,
        input.browserNonce ?? "email",
      ].join(":"),
    );
  }

  private async optionalCurrentSessionId(request: WafloRequest, membershipId: string) {
    const token = request.cookies[this.environment.values.CUSTOMER_COOKIE_NAME];
    if (!token) return null;
    const session = await this.prisma.client.membershipAccessSession.findUnique({
      where: { tokenHash: this.security.hashSessionToken(token) },
      select: { id: true, membershipId: true, expiresAt: true, revokedAt: true },
    });
    return session &&
      session.membershipId === membershipId &&
      !session.revokedAt &&
      session.expiresAt > new Date()
      ? session.id
      : null;
  }

  private async sendTransferEmail(
    command: {
      id: string;
      publicTransferId: string;
      confirmationExpiresAt: Date | null;
      organizationId: string;
    },
    email: { id: string; organizationId: string; encryptedValue: string },
    organizationName: string,
    merchantSlug: string,
    programName: string,
    locale: "en" | "ar",
    token: string,
    request: WafloRequest,
  ) {
    try {
      await this.notifications.send({
        to: this.security.decryptEmail(email),
        locale,
        kind: "membership_transfer_confirmation",
        organizationName,
        programName,
        ...(command.confirmationExpiresAt ? { expiresAt: command.confirmationExpiresAt } : {}),
        actionUrl: transferActionUrl(
          this.environment.values.CUSTOMER_WEB_URL,
          merchantSlug,
          command.publicTransferId,
          token,
        ),
      });
      await this.audit.record(
        {
          organizationId: command.organizationId,
          action: "membership.transfer_email_sent",
          targetType: "membership_transfer_command",
          targetId: command.id,
        },
        request,
      );
    } catch {
      // The transfer command is already committed. Preserve truthful mutation
      // semantics and leave it pending so the existing resend path can retry.
      await this.audit
        .security(
          {
            organizationId: command.organizationId,
            eventType: "membership.transfer_confirmation_email_failed",
            severity: "MEDIUM",
            metadata: { retryAvailable: true },
          },
          request,
        )
        .catch(() => undefined);
    }
  }
}

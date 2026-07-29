import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { constantTimeTokenEquals } from "@waflo/customer-security";
import { appleAuthorizationToken } from "@waflo/wallet-apple";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { CustomerSecurityService } from "../customer/customer-security.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { WalletProviderRegistry } from "./wallet-provider.registry.js";
import { WalletService } from "./wallet.service.js";
import { withInvariantLock } from "../common/organization-transaction.js";

@Injectable()
export class AppleUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly security: CustomerSecurityService,
    private readonly wallets: WalletService,
    private readonly registry: WalletProviderRegistry,
    private readonly audit: AuditService,
  ) {}

  async register(
    deviceLibraryIdentifier: string,
    passTypeIdentifier: string,
    serialNumber: string,
    pushToken: string,
    authorizationHeader: string | undefined,
    request: WafloRequest,
  ) {
    const pass = await this.authorizedPass(
      passTypeIdentifier,
      serialNumber,
      authorizationHeader,
      request,
    );
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(deviceLibraryIdentifier) || pushToken.length > 512) {
      throw new AppError(
        "APPLE_REGISTRATION_INVALID",
        "Invalid Apple Wallet registration.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const deviceHash = this.security.protectedIdentifierHash(
      "apple-device",
      deviceLibraryIdentifier,
    );
    return withInvariantLock(
      this.prisma.client,
      `apple-registration:${pass.record.id}:${deviceHash}`,
      async (transaction) => {
        const existing = await transaction.applePassRegistration.findUnique({
          where: {
            walletPassInstanceId_deviceLibraryIdentifierHash: {
              walletPassInstanceId: pass.record.id,
              deviceLibraryIdentifierHash: deviceHash,
            },
          },
        });
        const registrationId = existing?.id ?? randomUUID();
        const protectedPush = this.security.protectProviderValue(
          pushToken,
          pass.record.organizationId,
          registrationId,
          "apple-push-token",
        );
        await transaction.applePassRegistration.upsert({
          where: {
            walletPassInstanceId_deviceLibraryIdentifierHash: {
              walletPassInstanceId: pass.record.id,
              deviceLibraryIdentifierHash: deviceHash,
            },
          },
          create: {
            id: registrationId,
            walletPassInstanceId: pass.record.id,
            deviceLibraryIdentifierHash: deviceHash,
            pushTokenEncrypted: protectedPush.serialized,
            encryptionKeyVersion: protectedPush.keyVersion,
          },
          update: {
            pushTokenEncrypted: protectedPush.serialized,
            encryptionKeyVersion: protectedPush.keyVersion,
            unregisteredAt: null,
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId: pass.record.organizationId,
            action: existing ? "apple.pass_registration_replayed" : "apple.pass_registered",
            targetType: "wallet_pass_instance",
            targetId: pass.record.id,
            metadata: { provider: "APPLE", replayed: Boolean(existing) },
          },
          request,
        );
        return { created: !existing };
      },
    );
  }

  async unregister(
    deviceLibraryIdentifier: string,
    passTypeIdentifier: string,
    serialNumber: string,
    authorizationHeader: string | undefined,
    request: WafloRequest,
  ) {
    const pass = await this.authorizedPass(
      passTypeIdentifier,
      serialNumber,
      authorizationHeader,
      request,
    );
    const deviceHash = this.security.protectedIdentifierHash(
      "apple-device",
      deviceLibraryIdentifier,
    );
    await withInvariantLock(
      this.prisma.client,
      `apple-registration:${pass.record.id}:${deviceHash}`,
      async (transaction) => {
        await transaction.applePassRegistration.updateMany({
          where: {
            walletPassInstanceId: pass.record.id,
            deviceLibraryIdentifierHash: deviceHash,
            unregisteredAt: null,
          },
          data: { unregisteredAt: new Date() },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId: pass.record.organizationId,
            action: "apple.pass_unregistered",
            targetType: "wallet_pass_instance",
            targetId: pass.record.id,
            metadata: { provider: "APPLE" },
          },
          request,
        );
      },
    );
  }

  async updatedSerials(
    deviceLibraryIdentifier: string,
    passTypeIdentifier: string,
    passesUpdatedSince?: string,
  ) {
    this.assertPassType(passTypeIdentifier);
    const since = passesUpdatedSince ? Number.parseInt(passesUpdatedSince, 10) : 0;
    const deviceHash = this.security.protectedIdentifierHash(
      "apple-device",
      deviceLibraryIdentifier,
    );
    const registrations = await this.prisma.client.applePassRegistration.findMany({
      where: {
        deviceLibraryIdentifierHash: deviceHash,
        unregisteredAt: null,
        walletPassInstance: {
          provider: "APPLE",
          updateTag: { gt: Number.isFinite(since) ? since : 0 },
        },
      },
      include: {
        walletPassInstance: {
          select: { providerIdentity: true, updateTag: true },
        },
      },
      orderBy: { walletPassInstance: { updateTag: "asc" } },
      take: 500,
    });
    if (registrations.length === 0) return null;
    return {
      serialNumbers: registrations.map(
        (registration) => registration.walletPassInstance.providerIdentity,
      ),
      lastUpdated: String(
        Math.max(...registrations.map((registration) => registration.walletPassInstance.updateTag)),
      ),
    };
  }

  async updatedPass(
    passTypeIdentifier: string,
    serialNumber: string,
    authorizationHeader: string | undefined,
    request: WafloRequest,
  ) {
    const pass = await this.authorizedPass(
      passTypeIdentifier,
      serialNumber,
      authorizationHeader,
      request,
    );
    const issued = await this.registry.get("APPLE").issueMembershipPass(pass.input);
    if (!issued.artifact) {
      throw new AppError(
        "APPLE_PASS_SIGNING_FAILED",
        "Pass generation failed.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return Buffer.from(issued.artifact);
  }

  async receiveLogs(logs: readonly string[], request: WafloRequest) {
    const safeCodes = logs.slice(0, 20).map((line) => {
      const normalized = line.replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED]").slice(0, 200);
      return normalized.includes("authentication")
        ? "AUTH"
        : normalized.includes("download")
          ? "DOWNLOAD"
          : "CLIENT";
    });
    await this.audit.security(
      {
        eventType: "apple.wallet_client_logs",
        severity: "LOW",
        metadata: { count: safeCodes.length, codes: safeCodes },
      },
      request,
    );
  }

  private async authorizedPass(
    passTypeIdentifier: string,
    serialNumber: string,
    authorizationHeader: string | undefined,
    request: WafloRequest,
  ) {
    this.assertPassType(passTypeIdentifier);
    const pass = await this.wallets.passByIdentity("APPLE", serialNumber);
    const suppliedToken = appleAuthorizationToken(authorizationHeader);
    if (!pass || !suppliedToken) {
      await this.authFailure(request);
      throw new AppError(
        "APPLE_PASS_UNAUTHORIZED",
        "Apple Wallet pass authorization failed.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const expected = this.security.appleAuthenticationToken(pass.record.id, serialNumber);
    if (!constantTimeTokenEquals(expected, suppliedToken)) {
      await this.authFailure(request, pass.record.organizationId);
      throw new AppError(
        "APPLE_PASS_UNAUTHORIZED",
        "Apple Wallet pass authorization failed.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    return pass;
  }

  private assertPassType(value: string) {
    const expected =
      this.environment.values.APPLE_PASS_TYPE_IDENTIFIER ??
      (this.environment.values.APPLE_WALLET_MODE === "TEST_ADAPTER"
        ? "pass.app.waflo.test-adapter"
        : "");
    if (!expected || value !== expected) {
      throw new AppError(
        "APPLE_PASS_NOT_FOUND",
        "Apple Wallet pass not found.",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async authFailure(request: WafloRequest, organizationId?: string) {
    await this.audit.security(
      {
        ...(organizationId ? { organizationId } : {}),
        eventType: "apple.web_service_auth_failed",
        severity: "HIGH",
        metadata: { authorizationPresent: Boolean(request.headers.authorization) },
      },
      request,
    );
  }
}

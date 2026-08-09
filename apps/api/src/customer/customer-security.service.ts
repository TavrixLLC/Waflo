import { createHmac, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  constantTimeTokenEquals,
  createCustomerDataKeyring,
  createOpaqueCustomerToken,
  createPublicIdentifier,
  decodeSecret,
  decryptCustomerValue,
  deriveAppleAuthenticationToken,
  deriveEnrollmentSessionToken,
  deriveTransferSessionToken,
  deriveMembershipCredentialSecret,
  encryptCustomerValue,
  hashCustomerToken,
  hashNormalizedEmail,
  maskEmail,
  membershipCredentialHash,
  normalizeEmail,
  type VersionedSecret,
} from "@waflo/customer-security";
import { formatMembershipQrPayload, parseMembershipQrPayload } from "@waflo/qr-core";
import { parseVersionedSecretEntries } from "@waflo/config";
import type { Prisma } from "@waflo/database";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class CustomerSecurityService {
  private readonly customerKeyring;
  private readonly credentialSecrets: ReadonlyMap<number, VersionedSecret>;
  private readonly appleAuthenticationSecrets: ReadonlyMap<number, VersionedSecret>;
  private readonly activeCredentialSecret: VersionedSecret;
  private readonly activeAppleAuthenticationSecret: VersionedSecret;
  private readonly contactLookupKey: Buffer;
  private readonly sessionSecret: Buffer;

  constructor(
    private readonly environment: EnvironmentService,
    private readonly prisma: PrismaService,
  ) {
    this.customerKeyring = createCustomerDataKeyring(
      environment.values.CUSTOMER_DATA_ACTIVE_KEY_VERSION,
      parseVersionedSecretEntries(
        environment.values.CUSTOMER_DATA_ENCRYPTION_KEYS_JSON,
        environment.values.CUSTOMER_DATA_ENCRYPTION_KEY_V1,
      ),
    );
    this.credentialSecrets = this.createSecretMap(
      parseVersionedSecretEntries(
        environment.values.MEMBERSHIP_CREDENTIAL_SECRETS_JSON,
        environment.values.MEMBERSHIP_CREDENTIAL_SECRET_V1,
      ),
    );
    this.appleAuthenticationSecrets = this.createSecretMap(
      parseVersionedSecretEntries(
        environment.values.APPLE_PASS_AUTH_SECRETS_JSON,
        environment.values.APPLE_PASS_AUTH_SECRET_V1,
      ),
    );
    this.activeCredentialSecret = this.requireSecret(
      this.credentialSecrets,
      environment.values.MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION,
      "membership credential",
    );
    this.activeAppleAuthenticationSecret = this.requireSecret(
      this.appleAuthenticationSecrets,
      environment.values.APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION,
      "Apple pass authentication",
    );
    this.contactLookupKey = decodeSecret(environment.values.CUSTOMER_CONTACT_LOOKUP_HMAC_KEY);
    this.sessionSecret = decodeSecret(environment.values.CUSTOMER_SESSION_SECRET);
  }

  prepareEmail(organizationId: string, email: string) {
    const id = randomUUID();
    const normalized = normalizeEmail(email);
    const encrypted = encryptCustomerValue(normalized, {
      organizationId,
      recordId: id,
      purpose: "customer-email",
      keyring: this.customerKeyring,
    });
    return {
      id,
      encryptedValue: encrypted.serialized,
      encryptionKeyVersion: encrypted.keyVersion,
      normalizedValueHash: hashNormalizedEmail(normalized, this.contactLookupKey),
      maskedDisplayValue: maskEmail(normalized),
    };
  }

  emailRequestFingerprint(email: string): string {
    return hashNormalizedEmail(normalizeEmail(email), this.contactLookupKey);
  }

  decryptEmail(contact: { id: string; organizationId: string; encryptedValue: string }): string {
    return decryptCustomerValue(contact.encryptedValue, {
      organizationId: contact.organizationId,
      recordId: contact.id,
      purpose: "customer-email",
      keyring: this.customerKeyring,
    });
  }

  protectProviderValue(value: string, organizationId: string, recordId: string, purpose: string) {
    return encryptCustomerValue(value, {
      organizationId,
      recordId,
      purpose,
      keyring: this.customerKeyring,
    });
  }

  unprotectProviderValue(
    value: string,
    organizationId: string,
    recordId: string,
    purpose: string,
  ): string {
    return decryptCustomerValue(value, {
      organizationId,
      recordId,
      purpose,
      keyring: this.customerKeyring,
    });
  }

  protectedIdentifierHash(purpose: string, value: string): string {
    return hashCustomerToken(`${purpose}:${value}`);
  }

  createCredential(credentialVersion: number): {
    publicCredentialId: string;
    secretVersion: number;
    secretHash: string;
    payload: string;
  } {
    const publicCredentialId = createPublicIdentifier("cred");
    const secret = deriveMembershipCredentialSecret(
      publicCredentialId,
      credentialVersion,
      this.activeCredentialSecret,
    );
    return {
      publicCredentialId,
      secretVersion: this.activeCredentialSecret.version,
      secretHash: membershipCredentialHash(
        publicCredentialId,
        credentialVersion,
        this.activeCredentialSecret,
      ),
      payload: formatMembershipQrPayload({
        publicCredentialId,
        secretVersion: this.activeCredentialSecret.version,
        secret,
      }),
    };
  }

  payloadForCredential(credential: {
    publicCredentialId: string;
    credentialVersion: number;
    secretVersion: number;
  }): string {
    const secretVersion = this.secretForCredentialVersion(credential.secretVersion);
    return formatMembershipQrPayload({
      publicCredentialId: credential.publicCredentialId,
      secretVersion: credential.secretVersion,
      secret: deriveMembershipCredentialSecret(
        credential.publicCredentialId,
        credential.credentialVersion,
        secretVersion,
      ),
    });
  }

  async verifyCredentialPayload(
    rawPayload: string,
    transaction: Prisma.TransactionClient | null = null,
  ) {
    let parsed: ReturnType<typeof parseMembershipQrPayload>;
    try {
      parsed = parseMembershipQrPayload(rawPayload);
    } catch {
      return null;
    }
    const client = transaction ?? this.prisma.client;
    const credential = await client.membershipCredential.findUnique({
      where: { publicCredentialId: parsed.publicCredentialId },
      include: {
        membership: {
          include: {
            program: true,
            customer: { include: { contacts: { where: { archivedAt: null, isPrimary: true } } } },
            organization: true,
          },
        },
      },
    });
    if (credential?.status !== "ACTIVE") return null;
    let secret: VersionedSecret;
    try {
      secret = this.secretForCredentialVersion(parsed.secretVersion);
    } catch {
      return null;
    }
    const expectedSecret = deriveMembershipCredentialSecret(
      credential.publicCredentialId,
      credential.credentialVersion,
      secret,
    );
    if (
      credential.secretVersion !== parsed.secretVersion ||
      !constantTimeTokenEquals(expectedSecret, parsed.secret) ||
      credential.secretHash !==
        membershipCredentialHash(
          credential.publicCredentialId,
          credential.credentialVersion,
          secret,
        )
    ) {
      return null;
    }
    return credential;
  }

  deterministicEnrollmentSessionToken(enrollmentCommandId: string): string {
    return deriveEnrollmentSessionToken(enrollmentCommandId, this.sessionSecret);
  }

  deterministicTransferSessionToken(transferCommandId: string): string {
    return deriveTransferSessionToken(transferCommandId, this.sessionSecret);
  }

  randomCustomerSessionToken(): string {
    return `wcs1.${createOpaqueCustomerToken()}`;
  }

  hashSessionToken(rawToken: string): string {
    return hashCustomerToken(rawToken);
  }

  customerCsrfToken(rawSessionToken: string): string {
    return `wcc1.${createHmac("sha256", this.sessionSecret)
      .update(`customer-csrf:${rawSessionToken}`, "utf8")
      .digest("base64url")}`;
  }

  hashTransferToken(rawToken: string): string {
    return hashCustomerToken(`transfer:${rawToken}`);
  }

  createTransferToken(): string {
    return createOpaqueCustomerToken();
  }

  createPublicMembershipId(): string {
    return createPublicIdentifier("member");
  }

  createPublicTransferId(): string {
    return createPublicIdentifier("transfer");
  }

  appleAuthenticationToken(walletPassInstanceId: string, serialNumber: string): string {
    return deriveAppleAuthenticationToken(
      walletPassInstanceId,
      serialNumber,
      this.activeAppleAuthenticationSecret,
    );
  }

  verifyAppleAuthenticationToken(
    walletPassInstanceId: string,
    serialNumber: string,
    suppliedToken: string,
  ): boolean {
    return [...this.appleAuthenticationSecrets.values()].some((secret) =>
      constantTimeTokenEquals(
        deriveAppleAuthenticationToken(walletPassInstanceId, serialNumber, secret),
        suppliedToken,
      ),
    );
  }

  keyVersionSummary() {
    return {
      customerData: {
        active: this.customerKeyring.activeVersion,
        readable: [...this.customerKeyring.keys.keys()].sort((left, right) => left - right),
      },
      membershipCredential: {
        active: this.activeCredentialSecret.version,
        verifiable: [...this.credentialSecrets.keys()].sort((left, right) => left - right),
      },
      applePassAuthentication: {
        active: this.activeAppleAuthenticationSecret.version,
        verifiable: [...this.appleAuthenticationSecrets.keys()].sort((left, right) => left - right),
      },
    };
  }

  customerSessionExpiresAt(): Date {
    return new Date(
      Date.now() + this.environment.values.CUSTOMER_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  transferTokenExpiresAt(emailPath: boolean): Date {
    const minutes = emailPath
      ? this.environment.values.TRANSFER_TOKEN_TTL_MINUTES
      : this.environment.values.TRANSFER_CHALLENGE_TTL_MINUTES;
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  private secretForCredentialVersion(version: number): VersionedSecret {
    const secret = this.credentialSecrets.get(version);
    if (!secret) {
      throw new Error("Membership credential secret version is unavailable.");
    }
    return secret;
  }

  private createSecretMap(
    entries: Readonly<Record<number, string>>,
  ): ReadonlyMap<number, VersionedSecret> {
    return new Map(
      Object.entries(entries).map(([version, secret]) => {
        const parsedVersion = Number(version);
        return [parsedVersion, { version: parsedVersion, secret: decodeSecret(secret) }] as const;
      }),
    );
  }

  private requireSecret(
    secrets: ReadonlyMap<number, VersionedSecret>,
    version: number,
    purpose: string,
  ): VersionedSecret {
    const secret = secrets.get(version);
    if (!secret) throw new Error(`The active ${purpose} secret version is not configured.`);
    return secret;
  }
}

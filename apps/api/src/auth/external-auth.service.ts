import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { hashOpaqueToken, normalizeEmail, verifyPassword } from "@waflo/auth";
import { type ExternalIdentityProvider, type Locale, type Prisma } from "@waflo/database";
import {
  APPLE_IDENTITY_ISSUER,
  createAppleClientSecret,
  createExternalAuthTokenKeyring,
  type ExternalAuthTokenKeyring,
  encryptExternalAuthToken,
  resolveApplePrivateKey,
} from "@waflo/external-auth-security";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthService } from "./auth.service.js";

type PublicProvider = "google" | "apple";
type CapabilityStatus = "AVAILABLE" | "NOT_CONFIGURED";

interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  appleTokens?: AppleTokenMaterial | undefined;
}

interface AppleTokenMaterial {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string | null;
}

interface CompletionInput {
  provider: PublicProvider;
  state: string;
  code: string;
  browserBinding: string;
  appleUser?: string | undefined;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;
const GOOGLE_CANONICAL_ISSUER = "https://accounts.google.com";
const APPLE_ISSUER = APPLE_IDENTITY_ISSUER;
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

function providerCode(provider: PublicProvider): ExternalIdentityProvider {
  return provider === "google" ? "GOOGLE" : "APPLE";
}

function safeDisplayName(identity: VerifiedIdentity): string {
  const supplied = identity.displayName?.trim().normalize("NFKC").slice(0, 100);
  if (supplied && supplied.length >= 2) return supplied;
  return identity.email?.split("@")[0]?.slice(0, 100) || "Waflo merchant";
}

@Injectable()
export class ExternalAuthService {
  providerFetch: typeof fetch = fetch;
  googleJwks = GOOGLE_JWKS;
  appleJwks = APPLE_JWKS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  publicCapabilities() {
    return {
      googleSignIn: this.providerStatus("google"),
      appleSignIn: this.providerStatus("apple"),
      googleSignInAvailable: this.providerStatus("google") === "AVAILABLE",
      appleSignInAvailable: this.providerStatus("apple") === "AVAILABLE",
    };
  }

  providerStatus(provider: PublicProvider): CapabilityStatus {
    if (provider === "google") {
      return this.environment.values.GOOGLE_SIGNIN_CLIENT_ID &&
        this.environment.values.GOOGLE_SIGNIN_CLIENT_SECRET &&
        this.validCallback(
          this.environment.values.GOOGLE_SIGNIN_REDIRECT_URI,
          "/v1/auth/external/google/callback",
        )
        ? "AVAILABLE"
        : "NOT_CONFIGURED";
    }
    return this.environment.values.APPLE_SIGNIN_CLIENT_ID &&
      this.environment.values.APPLE_SIGNIN_TEAM_ID &&
      this.environment.values.APPLE_SIGNIN_KEY_ID &&
      this.applePrivateKey() &&
      this.externalAuthTokenKeyring() &&
      this.validCallback(
        this.environment.values.APPLE_SIGNIN_REDIRECT_URI,
        "/v1/auth/external/apple/callback",
      )
      ? "AVAILABLE"
      : "NOT_CONFIGURED";
  }

  async verifyProviderReachability(provider: PublicProvider): Promise<void> {
    this.requireConfigured(provider);
    if (provider === "apple") {
      await this.appleClientSecret();
    }
    const endpoint =
      provider === "google"
        ? "https://www.googleapis.com/oauth2/v3/certs"
        : "https://appleid.apple.com/auth/keys";
    const response = await this.providerFetch(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("IDENTITY_PROVIDER_UNREACHABLE");
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error("IDENTITY_PROVIDER_INVALID_JWKS");
    }
  }

  async localeForState(provider: PublicProvider, state: string): Promise<"en" | "ar"> {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(state)) return "en";
    const flow = await this.prisma.client.oAuthAuthorizationRequest.findFirst({
      where: { stateHash: hashOpaqueToken(state), provider: providerCode(provider) },
      select: { locale: true },
    });
    return flow?.locale === "AR" ? "ar" : "en";
  }

  async start(
    provider: PublicProvider,
    input: {
      locale: "en" | "ar";
      allowRegistration: boolean;
      legalAccepted: boolean;
      linkUserId?: string | undefined;
      reauthenticatedSessionId?: string | undefined;
    },
  ) {
    this.requireConfigured(provider);
    if (input.allowRegistration && !input.legalAccepted) {
      throw new AppError(
        "LEGAL_ACCEPTANCE_REQUIRED",
        "Accept the Terms and Privacy Policy to create an account.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const browserBinding = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const locale: Locale = input.locale === "ar" ? "AR" : "EN";
    const expiresAt = new Date(
      Date.now() + this.environment.values.OAUTH_FLOW_TTL_MINUTES * 60 * 1000,
    );
    await this.prisma.client.oAuthAuthorizationRequest.create({
      data: {
        stateHash: hashOpaqueToken(state),
        provider: providerCode(provider),
        intent: input.linkUserId ? "LINK" : "SIGN_IN",
        userId: input.linkUserId ?? null,
        reauthenticatedSessionId: input.reauthenticatedSessionId ?? null,
        nonceHash: hashOpaqueToken(nonce),
        browserBindingHash: hashOpaqueToken(browserBinding),
        codeVerifierCiphertext: this.encryptVerifier(verifier),
        allowRegistration: input.allowRegistration,
        locale,
        expiresAt,
      },
    });
    const authorizationUrl =
      provider === "google"
        ? this.googleAuthorizationUrl(state, nonce, challenge)
        : this.appleAuthorizationUrl(state, nonce);
    return {
      authorizationUrl,
      browserBinding: {
        cookieName: this.browserBindingCookieName(provider, state),
        value: browserBinding,
        expiresAt,
      },
    };
  }

  async startLink(
    provider: PublicProvider,
    userId: string,
    sessionId: string,
    currentPassword: string,
    locale: "en" | "ar",
  ) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    const recentSession = !user.passwordHash
      ? await this.prisma.client.session.findFirst({
          where: {
            id: sessionId,
            userId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
            createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) },
          },
          select: { id: true },
        })
      : null;
    if (
      user.passwordHash
        ? !(await verifyPassword(user.passwordHash, currentPassword))
        : !recentSession
    ) {
      throw new AppError(
        "REAUTHENTICATION_REQUIRED",
        "Re-enter your password before linking an identity.",
        HttpStatus.FORBIDDEN,
      );
    }
    return this.start(provider, {
      locale,
      allowRegistration: false,
      legalAccepted: false,
      linkUserId: userId,
      reauthenticatedSessionId: sessionId,
    });
  }

  async complete(input: CompletionInput, request: WafloRequest) {
    this.requireConfigured(input.provider);
    const flow = await this.consumeFlow(input.provider, input.state, input.browserBinding);
    if (!input.code) this.invalidFlow();
    if (flow.intent === "LINK") {
      await this.assertLinkAuthorization(flow.userId, flow.reauthenticatedSessionId);
    }
    let identity: VerifiedIdentity;
    try {
      identity =
        input.provider === "google"
          ? await this.exchangeGoogle(
              input.code,
              this.decryptVerifier(flow.codeVerifierCiphertext),
              flow,
            )
          : await this.exchangeApple(input.code, flow, input.appleUser);
    } catch (error) {
      await this.audit.security(
        {
          ...(flow.userId ? { userId: flow.userId } : {}),
          eventType: "oauth.provider_validation_failed",
          severity: "HIGH",
          metadata: { provider: flow.provider },
        },
        request,
      );
      throw error instanceof AppError
        ? error
        : new AppError(
            "EXTERNAL_AUTH_FAILED",
            "External sign-in could not be completed.",
            HttpStatus.UNAUTHORIZED,
          );
    }

    const user =
      flow.intent === "LINK"
        ? await this.linkIdentity(flow.userId, flow.provider, identity, request)
        : await this.signInIdentity(
            flow.allowRegistration,
            flow.provider,
            identity,
            flow.locale,
            request,
          );
    const session = await this.auth.createSession(
      user.id,
      request,
      flow.intent === "LINK" ? (flow.reauthenticatedSessionId ?? undefined) : undefined,
    );
    if (flow.intent === "LINK" && flow.reauthenticatedSessionId) {
      await this.prisma.client.session.updateMany({
        where: { id: flow.reauthenticatedSessionId, userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: "external_identity_link_rotation" },
      });
    }
    await this.audit.record(
      {
        actorUserId: user.id,
        action: flow.intent === "LINK" ? "external_identity.linked" : "external_login.succeeded",
        targetType: "user",
        targetId: user.id,
        metadata: { provider: flow.provider },
      },
      request,
    );
    return { session, locale: flow.locale === "AR" ? "ar" : "en" } as const;
  }

  async handleAppleNotification(payload: string, request: WafloRequest) {
    this.requireConfigured("apple");
    if (!payload || payload.length > 32_768) this.providerFailure();
    const verified = await jwtVerify(payload, this.appleJwks, {
      issuer: APPLE_ISSUER,
      audience: this.environment.values.APPLE_SIGNIN_CLIENT_ID as string,
      algorithms: ["RS256"],
      clockTolerance: 60,
      maxTokenAge: "7 days",
    }).catch(() => this.providerFailure());
    const events = verified.payload.events;
    if (!events || typeof events !== "object" || Array.isArray(events)) this.providerFailure();
    const value = events as Record<string, unknown>;
    const eventType = value.type;
    const providerSubject = value.sub;
    const eventTimeSeconds = value.event_time;
    const notificationId = verified.payload.jti;
    if (
      !["email-enabled", "email-disabled", "consent-revoked", "account-deleted"].includes(
        String(eventType),
      ) ||
      typeof providerSubject !== "string" ||
      providerSubject.length < 1 ||
      providerSubject.length > 255 ||
      typeof eventTimeSeconds !== "number" ||
      !Number.isFinite(eventTimeSeconds) ||
      typeof notificationId !== "string" ||
      notificationId.length < 1 ||
      notificationId.length > 255
    ) {
      this.providerFailure();
    }
    const eventTime = new Date(eventTimeSeconds * 1_000);
    if (
      Number.isNaN(eventTime.getTime()) ||
      eventTime.getTime() > Date.now() + 60_000 ||
      eventTime.getTime() < Date.now() - 7 * 24 * 60 * 60 * 1_000
    ) {
      this.providerFailure();
    }
    let notificationEmail: string | null = null;
    if (typeof value.email === "string" && value.email.length <= 254) {
      try {
        notificationEmail = normalizeEmail(value.email);
      } catch {
        this.providerFailure();
      }
    }
    if ((eventType === "email-enabled" || eventType === "email-disabled") && !notificationEmail) {
      this.providerFailure();
    }
    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        const duplicate = await transaction.appleServerNotification.findUnique({
          where: { notificationId },
          select: { id: true },
        });
        if (duplicate) return { status: "duplicate" as const };
        await transaction.appleServerNotification.create({
          data: {
            notificationId,
            eventType: String(eventType),
            providerSubject,
            eventTime,
            processedAt: new Date(),
          },
        });
        const identity = await transaction.externalIdentity.findUnique({
          where: {
            provider_issuer_providerSubject: {
              provider: "APPLE",
              issuer: APPLE_ISSUER,
              providerSubject,
            },
          },
          include: { user: { include: { externalIdentities: true } } },
        });
        if (!identity) return { status: "processed" as const };
        if (eventType === "email-enabled" || eventType === "email-disabled") {
          await transaction.externalIdentity.update({
            where: { id: identity.id },
            data: {
              emailForwardingEnabled: eventType === "email-enabled",
              ...(eventType === "email-enabled" && notificationEmail
                ? { providerEmail: notificationEmail }
                : {}),
            },
          });
        } else {
          const now = new Date();
          await transaction.session.updateMany({
            where: { userId: identity.userId, revokedAt: null },
            data: { revokedAt: now, revocationReason: "apple_authorization_revoked" },
          });
          await transaction.oAuthAuthorizationRequest.updateMany({
            where: { userId: identity.userId, provider: "APPLE", consumedAt: null },
            data: { consumedAt: now },
          });
          await transaction.externalIdentity.delete({ where: { id: identity.id } });
          if (!identity.user.passwordHash && identity.user.externalIdentities.length <= 1) {
            await transaction.user.update({
              where: { id: identity.userId },
              data: { status: "DEACTIVATED", deactivatedAt: now },
            });
          }
          await this.audit.recordInTransaction(
            transaction,
            {
              action: "external_identity.apple_authorization_revoked",
              targetType: "user",
              targetId: identity.userId,
              metadata: { eventType },
            },
            request,
          );
        }
        return { status: "processed" as const };
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        return { status: "duplicate" as const };
      }
      throw error;
    }
  }

  async identities(userId: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        passwordHash: true,
        externalIdentities: {
          select: { provider: true, providerEmail: true, createdAt: true, lastUsedAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return {
      passwordEnabled: Boolean(user.passwordHash),
      identities: user.externalIdentities,
    };
  }

  async unlink(
    provider: PublicProvider,
    userId: string,
    sessionId: string,
    currentPassword: string | undefined,
    request: WafloRequest,
  ) {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      include: { externalIdentities: true },
    });
    const target = user.externalIdentities.find((item) => item.provider === providerCode(provider));
    if (!target) {
      throw new AppError(
        "IDENTITY_NOT_LINKED",
        "That sign-in method is not linked.",
        HttpStatus.NOT_FOUND,
      );
    }
    if (!user.passwordHash && user.externalIdentities.length <= 1) {
      throw new AppError(
        "FINAL_AUTH_METHOD",
        "Add another sign-in method before disconnecting this one.",
        HttpStatus.CONFLICT,
      );
    }
    const recentExternalSession = !user.passwordHash
      ? await this.prisma.client.session.findFirst({
          where: {
            id: sessionId,
            userId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
            createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) },
          },
          select: { id: true },
        })
      : null;
    if (
      user.passwordHash
        ? !currentPassword || !(await verifyPassword(user.passwordHash, currentPassword))
        : !recentExternalSession
    ) {
      throw new AppError(
        "REAUTHENTICATION_REQUIRED",
        "Re-enter your password before disconnecting this identity.",
        HttpStatus.FORBIDDEN,
      );
    }
    const unlinked = await withInvariantLock(
      this.prisma.client,
      `user-auth-lifecycle:${userId}`,
      async (transaction) => {
        const current = await transaction.user.findUniqueOrThrow({
          where: { id: userId },
          include: { externalIdentities: { include: { appleCredential: true } } },
        });
        const currentTarget = current.externalIdentities.find(
          (item) => item.provider === providerCode(provider),
        );
        if (!currentTarget) {
          throw new AppError(
            "IDENTITY_NOT_LINKED",
            "That sign-in method is not linked.",
            HttpStatus.NOT_FOUND,
          );
        }
        if (!current.passwordHash && current.externalIdentities.length <= 1) {
          throw new AppError(
            "FINAL_AUTH_METHOD",
            "Add another sign-in method before disconnecting this one.",
            HttpStatus.CONFLICT,
          );
        }
        if (currentTarget.provider === "APPLE" && currentTarget.appleCredential) {
          await this.enqueueAppleRevocation(
            transaction,
            currentTarget.id,
            currentTarget.appleCredential,
            "UNLINK",
            `unlink:${currentTarget.id}`,
          );
        }
        await transaction.externalIdentity.delete({ where: { id: currentTarget.id } });
        return currentTarget;
      },
    );
    await this.audit.record(
      {
        actorUserId: userId,
        action: "external_identity.unlinked",
        targetType: "user",
        targetId: userId,
        metadata: { provider: unlinked.provider },
      },
      request,
    );
    return { status: "unlinked" as const };
  }

  private async enqueueAppleRevocation(
    transaction: Prisma.TransactionClient,
    externalIdentityId: string,
    credential: {
      refreshTokenEncrypted: string | null;
      refreshTokenKeyVersion: number | null;
      accessTokenEncrypted: string | null;
      accessTokenKeyVersion: number | null;
    },
    reason: "UNLINK" | "ACCOUNT_DELETION",
    idempotencyKey: string,
  ) {
    const refreshUsable = credential.refreshTokenEncrypted && credential.refreshTokenKeyVersion;
    const tokenEncrypted = refreshUsable
      ? credential.refreshTokenEncrypted
      : credential.accessTokenEncrypted;
    const tokenKeyVersion = refreshUsable
      ? credential.refreshTokenKeyVersion
      : credential.accessTokenKeyVersion;
    if (!tokenEncrypted || !tokenKeyVersion) return;
    await transaction.appleTokenRevocationJob.upsert({
      where: { idempotencyKey },
      create: {
        idempotencyKey,
        encryptionContextId: externalIdentityId,
        tokenEncrypted,
        tokenKeyVersion,
        tokenType: refreshUsable ? "REFRESH_TOKEN" : "ACCESS_TOKEN",
        reason,
      },
      update: {},
    });
  }

  browserBindingCookieName(provider: PublicProvider, state: string): string {
    const flowId = createHash("sha256").update(state, "utf8").digest("base64url").slice(0, 24);
    const prefix =
      this.environment.values.DEPLOYMENT_ENVIRONMENT === "development" ? "" : "__Secure-";
    return `${prefix}waflo_oauth_${provider === "google" ? "g" : "a"}_${flowId}`;
  }

  private async consumeFlow(provider: PublicProvider, state: string, browserBinding: string) {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(state) || !/^[A-Za-z0-9_-]{40,100}$/.test(browserBinding)) {
      this.invalidFlow();
    }
    const now = new Date();
    return this.prisma.client.$transaction(async (transaction) => {
      const flow = await transaction.oAuthAuthorizationRequest.findUnique({
        where: { stateHash: hashOpaqueToken(state) },
      });
      if (!flow || flow.provider !== providerCode(provider)) this.invalidFlow();
      const claimed = await transaction.oAuthAuthorizationRequest.updateMany({
        where: {
          id: flow.id,
          browserBindingHash: hashOpaqueToken(browserBinding),
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) this.invalidFlow();
      return flow;
    });
  }

  private async assertLinkAuthorization(userId: string | null, sessionId: string | null) {
    if (!userId || !sessionId) this.invalidFlow();
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    const session = await this.prisma.client.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (user?.status !== "ACTIVE" || !session) this.invalidFlow();
  }

  private async signInIdentity(
    allowRegistration: boolean,
    provider: ExternalIdentityProvider,
    identity: VerifiedIdentity,
    locale: Locale,
    request: WafloRequest,
  ) {
    const existingIdentity = await this.prisma.client.externalIdentity.findUnique({
      where: {
        provider_issuer_providerSubject: {
          provider,
          issuer: identity.issuer,
          providerSubject: identity.subject,
        },
      },
      include: { user: true },
    });
    if (existingIdentity) {
      if (existingIdentity.user.status !== "ACTIVE") this.deniedIdentity();
      return this.prisma.client.$transaction(async (transaction) => {
        if (identity.appleTokens) {
          await this.upsertAppleCredential(transaction, existingIdentity.id, identity.appleTokens);
        }
        return transaction.user.update({
          where: { id: existingIdentity.userId },
          data: {
            lastLoginAt: new Date(),
            externalIdentities: {
              update: {
                where: { id: existingIdentity.id },
                data: {
                  ...(identity.email !== null ? { providerEmail: identity.email } : {}),
                  emailVerified: identity.emailVerified,
                  lastUsedAt: new Date(),
                },
              },
            },
          },
        });
      });
    }
    if (!allowRegistration || !identity.email || !identity.emailVerified) {
      this.deniedIdentity();
    }
    const normalizedEmail = normalizeEmail(identity.email);
    const collision = await this.prisma.client.user.findUnique({ where: { normalizedEmail } });
    if (collision) {
      await this.audit.security(
        {
          userId: collision.id,
          eventType: "oauth.email_collision",
          severity: "HIGH",
          metadata: { provider },
        },
        request,
      );
      this.deniedIdentity();
    }
    const now = new Date();
    const externalIdentityId = randomUUID();
    const appleCredential = identity.appleTokens
      ? this.encryptAppleTokenMaterial(externalIdentityId, identity.appleTokens, true)
      : null;
    return this.prisma.client.user.create({
      data: {
        displayName: safeDisplayName(identity),
        email: identity.email,
        normalizedEmail,
        emailVerifiedAt: now,
        passwordHash: null,
        preferredLocale: locale,
        termsVersion: this.environment.values.LEGAL_TERMS_VERSION,
        privacyVersion: this.environment.values.LEGAL_PRIVACY_VERSION,
        legalAcceptedAt: now,
        lastLoginAt: now,
        externalIdentities: {
          create: {
            id: externalIdentityId,
            provider,
            issuer: identity.issuer,
            providerSubject: identity.subject,
            providerEmail: identity.email,
            emailVerified: identity.emailVerified,
            ...(appleCredential
              ? {
                  appleCredential: {
                    create: appleCredential,
                  },
                }
              : {}),
          },
        },
      },
    });
  }

  private async linkIdentity(
    userId: string | null,
    provider: ExternalIdentityProvider,
    identity: VerifiedIdentity,
    request: WafloRequest,
  ) {
    if (!userId) this.invalidFlow();
    const result = await withInvariantLock(
      this.prisma.client,
      `user-auth-lifecycle:${userId}`,
      async (transaction) => {
        const user = await transaction.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.status !== "ACTIVE") this.deniedIdentity();
        const attached = await transaction.externalIdentity.findUnique({
          where: {
            provider_issuer_providerSubject: {
              provider,
              issuer: identity.issuer,
              providerSubject: identity.subject,
            },
          },
        });
        if (attached && attached.userId !== userId) return { user, conflict: true } as const;
        const currentProvider = await transaction.externalIdentity.findUnique({
          where: { userId_provider: { userId, provider } },
        });
        if (currentProvider && currentProvider.id !== attached?.id) {
          throw new AppError(
            "PROVIDER_ALREADY_LINKED",
            "A sign-in identity from this provider is already linked.",
            HttpStatus.CONFLICT,
          );
        }
        if (!attached) {
          const externalIdentityId = randomUUID();
          const appleCredential = identity.appleTokens
            ? this.encryptAppleTokenMaterial(externalIdentityId, identity.appleTokens, true)
            : null;
          await transaction.externalIdentity.create({
            data: {
              id: externalIdentityId,
              userId,
              provider,
              issuer: identity.issuer,
              providerSubject: identity.subject,
              providerEmail: identity.email,
              emailVerified: identity.emailVerified,
              ...(appleCredential
                ? {
                    appleCredential: {
                      create: appleCredential,
                    },
                  }
                : {}),
            },
          });
        } else {
          await transaction.externalIdentity.update({
            where: { id: attached.id },
            data: {
              ...(identity.email !== null ? { providerEmail: identity.email } : {}),
              emailVerified: identity.emailVerified,
              lastUsedAt: new Date(),
            },
          });
          if (identity.appleTokens) {
            await this.upsertAppleCredential(transaction, attached.id, identity.appleTokens);
          }
        }
        return { user, conflict: false } as const;
      },
    );
    if (result.conflict) {
      await this.audit.security(
        {
          userId,
          eventType: "external_identity.link_conflict",
          severity: "HIGH",
          metadata: { provider },
        },
        request,
      );
      this.deniedIdentity();
    }
    return result.user;
  }

  private encryptAppleTokenMaterial(
    externalIdentityId: string,
    tokens: AppleTokenMaterial,
    requireRefreshToken: boolean,
  ) {
    if (requireRefreshToken && !tokens.refreshToken) this.providerFailure();
    const keyring = this.externalAuthTokenKeyring();
    if (!keyring) this.providerFailure();
    const access = encryptExternalAuthToken(tokens.accessToken, {
      contextId: externalIdentityId,
      purpose: "apple-access-token",
      keyring,
    });
    const refresh = tokens.refreshToken
      ? encryptExternalAuthToken(tokens.refreshToken, {
          contextId: externalIdentityId,
          purpose: "apple-refresh-token",
          keyring,
        })
      : null;
    return {
      refreshTokenEncrypted: refresh?.serialized ?? null,
      refreshTokenKeyVersion: refresh?.keyVersion ?? null,
      accessTokenEncrypted: access.serialized,
      accessTokenKeyVersion: access.keyVersion,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    };
  }

  private async upsertAppleCredential(
    transaction: Prisma.TransactionClient,
    externalIdentityId: string,
    tokens: AppleTokenMaterial,
  ) {
    const existing = await transaction.appleAuthorizationCredential.findUnique({
      where: { externalIdentityId },
    });
    const encrypted = this.encryptAppleTokenMaterial(
      externalIdentityId,
      tokens,
      !existing?.refreshTokenEncrypted,
    );
    if (existing) {
      await transaction.appleAuthorizationCredential.update({
        where: { id: existing.id },
        data: {
          accessTokenEncrypted: encrypted.accessTokenEncrypted,
          accessTokenKeyVersion: encrypted.accessTokenKeyVersion,
          accessTokenExpiresAt: encrypted.accessTokenExpiresAt,
          ...(encrypted.refreshTokenEncrypted
            ? {
                refreshTokenEncrypted: encrypted.refreshTokenEncrypted,
                refreshTokenKeyVersion: encrypted.refreshTokenKeyVersion,
              }
            : {}),
        },
      });
      return;
    }
    await transaction.appleAuthorizationCredential.create({
      data: { externalIdentityId, ...encrypted },
    });
  }

  private googleAuthorizationUrl(state: string, nonce: string, challenge: string) {
    const values = this.environment.values;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: values.GOOGLE_SIGNIN_CLIENT_ID ?? "",
      redirect_uri: values.GOOGLE_SIGNIN_REDIRECT_URI ?? "",
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.toString();
  }

  private appleAuthorizationUrl(state: string, nonce: string) {
    const values = this.environment.values;
    const url = new URL("https://appleid.apple.com/auth/authorize");
    url.search = new URLSearchParams({
      client_id: values.APPLE_SIGNIN_CLIENT_ID ?? "",
      redirect_uri: values.APPLE_SIGNIN_REDIRECT_URI ?? "",
      response_type: "code",
      response_mode: "form_post",
      scope: "name email",
      state,
      nonce,
    }).toString();
    return url.toString();
  }

  private async exchangeGoogle(code: string, verifier: string, flow: { nonceHash: string }) {
    const values = this.environment.values;
    const response = await this.providerFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: values.GOOGLE_SIGNIN_CLIENT_ID ?? "",
        client_secret: values.GOOGLE_SIGNIN_CLIENT_SECRET ?? "",
        redirect_uri: values.GOOGLE_SIGNIN_REDIRECT_URI ?? "",
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) this.providerFailure();
    const token = (await response.json()) as { id_token?: unknown };
    if (typeof token.id_token !== "string") this.providerFailure();
    const verified = await jwtVerify(token.id_token, this.googleJwks, {
      issuer: [...GOOGLE_ISSUERS],
      audience: values.GOOGLE_SIGNIN_CLIENT_ID as string,
      clockTolerance: 60,
      maxTokenAge: "10 minutes",
    });
    this.assertNonce(verified.payload, flow.nonceHash);
    this.assertAzp(verified.payload, values.GOOGLE_SIGNIN_CLIENT_ID ?? "");
    if (!verified.payload.sub) this.providerFailure();
    return {
      issuer: GOOGLE_CANONICAL_ISSUER,
      subject: verified.payload.sub,
      email: typeof verified.payload.email === "string" ? verified.payload.email : null,
      emailVerified: verified.payload.email_verified === true,
      displayName: typeof verified.payload.name === "string" ? verified.payload.name : null,
    } satisfies VerifiedIdentity;
  }

  private async exchangeApple(
    code: string,
    flow: { nonceHash: string },
    appleUser: string | undefined,
  ) {
    const values = this.environment.values;
    const response = await this.providerFetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: values.APPLE_SIGNIN_CLIENT_ID ?? "",
        client_secret: await this.appleClientSecret(),
        redirect_uri: values.APPLE_SIGNIN_REDIRECT_URI ?? "",
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) this.providerFailure();
    const token = (await response.json()) as {
      id_token?: unknown;
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      token_type?: unknown;
    };
    if (
      typeof token.id_token !== "string" ||
      typeof token.access_token !== "string" ||
      token.access_token.length === 0 ||
      token.access_token.length > 32_768 ||
      (token.refresh_token !== undefined &&
        (typeof token.refresh_token !== "string" ||
          token.refresh_token.length === 0 ||
          token.refresh_token.length > 32_768)) ||
      typeof token.expires_in !== "number" ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0 ||
      token.expires_in > 86_400 ||
      typeof token.token_type !== "string" ||
      token.token_type.toLocaleLowerCase("en-US") !== "bearer"
    ) {
      this.providerFailure();
    }
    const verified = await jwtVerify(token.id_token, this.appleJwks, {
      issuer: APPLE_ISSUER,
      audience: values.APPLE_SIGNIN_CLIENT_ID as string,
      clockTolerance: 60,
      maxTokenAge: "10 minutes",
    });
    this.assertNonce(verified.payload, flow.nonceHash);
    if (!verified.payload.sub) this.providerFailure();
    const firstLogin = this.parseAppleUser(appleUser);
    return {
      issuer: APPLE_ISSUER,
      subject: verified.payload.sub,
      email: typeof verified.payload.email === "string" ? verified.payload.email : null,
      emailVerified:
        verified.payload.email_verified === true || verified.payload.email_verified === "true",
      displayName: firstLogin.displayName,
      appleTokens: {
        accessToken: token.access_token,
        accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1_000),
        refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : null,
      },
    } satisfies VerifiedIdentity;
  }

  private async appleClientSecret(): Promise<string> {
    const values = this.environment.values;
    return createAppleClientSecret({
      privateKey: this.applePrivateKey() ?? "",
      teamId: values.APPLE_SIGNIN_TEAM_ID ?? "",
      keyId: values.APPLE_SIGNIN_KEY_ID ?? "",
      clientId: values.APPLE_SIGNIN_CLIENT_ID ?? "",
    });
  }

  private applePrivateKey(): string | null {
    return resolveApplePrivateKey(
      this.environment.values.APPLE_SIGNIN_PRIVATE_KEY,
      this.environment.values.APPLE_SIGNIN_PRIVATE_KEY_BASE64,
    );
  }

  private parseAppleUser(value: string | undefined) {
    if (!value || value.length > 8_192) return { displayName: null };
    try {
      const parsed = JSON.parse(value) as {
        name?: { firstName?: unknown; lastName?: unknown };
      };
      const names = [parsed.name?.firstName, parsed.name?.lastName].filter(
        (part): part is string => typeof part === "string",
      );
      const normalized = names
        .map((part) =>
          part
            .normalize("NFKC")
            .replace(/\p{Cc}/gu, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 50),
        )
        .filter(Boolean)
        .join(" ")
        .trim()
        .slice(0, 100);
      return { displayName: normalized || null };
    } catch {
      return { displayName: null };
    }
  }

  private assertNonce(payload: JWTPayload, nonceHash: string) {
    if (typeof payload.nonce !== "string" || hashOpaqueToken(payload.nonce) !== nonceHash) {
      this.providerFailure();
    }
  }

  private assertAzp(payload: JWTPayload, clientId: string) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if ((audiences.length > 1 || payload.azp !== undefined) && payload.azp !== clientId) {
      this.providerFailure();
    }
  }

  private validCallback(value: string | undefined, expectedPath: string): boolean {
    if (!value) return false;
    try {
      const callback = new URL(value);
      const api = new URL(this.environment.values.API_PUBLIC_URL);
      const secure =
        this.environment.values.DEPLOYMENT_ENVIRONMENT === "development" ||
        callback.protocol === "https:";
      return (
        secure &&
        callback.origin === api.origin &&
        callback.pathname === expectedPath &&
        !callback.search &&
        !callback.hash
      );
    } catch {
      return false;
    }
  }

  private encryptVerifier(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.flowKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      "oaf1",
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  private decryptVerifier(value: string): string {
    const [version, iv, ciphertext, tag] = value.split(".");
    if (version !== "oaf1" || !iv || !ciphertext || !tag) this.invalidFlow();
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.flowKey(),
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      this.invalidFlow();
    }
  }

  private flowKey() {
    return createHash("sha256").update(this.environment.values.OAUTH_FLOW_SECRET, "utf8").digest();
  }

  private externalAuthTokenKeyring(): ExternalAuthTokenKeyring | null {
    const values = this.environment.values;
    if (
      !values.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEYS_JSON &&
      !values.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEY_V1
    ) {
      return null;
    }
    try {
      const entries = values.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEYS_JSON
        ? (JSON.parse(values.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEYS_JSON) as Record<number, string>)
        : { 1: values.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEY_V1 ?? "" };
      return createExternalAuthTokenKeyring(values.EXTERNAL_AUTH_TOKEN_ACTIVE_KEY_VERSION, entries);
    } catch {
      return null;
    }
  }

  private requireConfigured(provider: PublicProvider) {
    if (this.providerStatus(provider) !== "AVAILABLE") {
      throw new AppError(
        "PROVIDER_NOT_CONFIGURED",
        "This sign-in method is not available.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private invalidFlow(): never {
    throw new AppError(
      "EXTERNAL_AUTH_INVALID",
      "This sign-in request is invalid or has expired.",
      HttpStatus.GONE,
    );
  }

  private deniedIdentity(): never {
    throw new AppError(
      "EXTERNAL_AUTH_ACTION_REQUIRED",
      "This sign-in could not be completed. Use another sign-in method or contact support.",
      HttpStatus.CONFLICT,
    );
  }

  private providerFailure(): never {
    throw new AppError(
      "EXTERNAL_AUTH_FAILED",
      "External sign-in could not be completed.",
      HttpStatus.UNAUTHORIZED,
    );
  }
}

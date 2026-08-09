import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  randomBytes,
} from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { hashOpaqueToken, normalizeEmail, verifyPassword } from "@waflo/auth";
import type { ExternalIdentityProvider, Locale } from "@waflo/database";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from "jose";
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
}

interface CompletionInput {
  provider: PublicProvider;
  state: string;
  code: string;
  appleUser?: string | undefined;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;
const APPLE_ISSUER = "https://appleid.apple.com";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

function providerCode(provider: PublicProvider): ExternalIdentityProvider {
  return provider === "google" ? "GOOGLE" : "APPLE";
}

function safeDisplayName(identity: VerifiedIdentity): string {
  const supplied = identity.displayName?.trim().slice(0, 100);
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
      await importPKCS8(this.applePrivateKey() ?? "", "ES256");
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
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const locale: Locale = input.locale === "ar" ? "AR" : "EN";
    await this.prisma.client.oAuthAuthorizationRequest.create({
      data: {
        stateHash: hashOpaqueToken(state),
        provider: providerCode(provider),
        intent: input.linkUserId ? "LINK" : "SIGN_IN",
        userId: input.linkUserId ?? null,
        reauthenticatedSessionId: input.reauthenticatedSessionId ?? null,
        nonceHash: hashOpaqueToken(nonce),
        codeVerifierCiphertext: this.encryptVerifier(verifier),
        allowRegistration: input.allowRegistration,
        locale,
        expiresAt: new Date(
          Date.now() + this.environment.values.OAUTH_FLOW_TTL_MINUTES * 60 * 1000,
        ),
      },
    });
    const authorizationUrl =
      provider === "google"
        ? this.googleAuthorizationUrl(state, nonce, challenge)
        : this.appleAuthorizationUrl(state, nonce, challenge);
    return { authorizationUrl };
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
    const flow = await this.consumeFlow(input.provider, input.state);
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
          : await this.exchangeApple(
              input.code,
              this.decryptVerifier(flow.codeVerifierCiphertext),
              flow,
              input.appleUser,
            );
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
          include: { externalIdentities: true },
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

  private async consumeFlow(provider: PublicProvider, state: string) {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(state)) this.invalidFlow();
    const now = new Date();
    return this.prisma.client.$transaction(async (transaction) => {
      const flow = await transaction.oAuthAuthorizationRequest.findUnique({
        where: { stateHash: hashOpaqueToken(state) },
      });
      if (!flow || flow.provider !== providerCode(provider)) this.invalidFlow();
      const claimed = await transaction.oAuthAuthorizationRequest.updateMany({
        where: { id: flow.id, consumedAt: null, expiresAt: { gt: now } },
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
      return this.prisma.client.user.update({
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
            provider,
            issuer: identity.issuer,
            providerSubject: identity.subject,
            providerEmail: identity.email,
            emailVerified: identity.emailVerified,
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
          await transaction.externalIdentity.create({
            data: {
              userId,
              provider,
              issuer: identity.issuer,
              providerSubject: identity.subject,
              providerEmail: identity.email,
              emailVerified: identity.emailVerified,
            },
          });
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

  private appleAuthorizationUrl(state: string, nonce: string, challenge: string) {
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
      code_challenge: challenge,
      code_challenge_method: "S256",
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
      issuer: String(verified.payload.iss),
      subject: verified.payload.sub,
      email: typeof verified.payload.email === "string" ? verified.payload.email : null,
      emailVerified: verified.payload.email_verified === true,
      displayName: typeof verified.payload.name === "string" ? verified.payload.name : null,
    } satisfies VerifiedIdentity;
  }

  private async exchangeApple(
    code: string,
    verifier: string,
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
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) this.providerFailure();
    const token = (await response.json()) as { id_token?: unknown };
    if (typeof token.id_token !== "string") this.providerFailure();
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
      email: typeof verified.payload.email === "string" ? verified.payload.email : firstLogin.email,
      emailVerified:
        verified.payload.email_verified === true || verified.payload.email_verified === "true",
      displayName: firstLogin.displayName,
    } satisfies VerifiedIdentity;
  }

  private async appleClientSecret(): Promise<string> {
    const values = this.environment.values;
    const key = await importPKCS8(this.applePrivateKey() ?? "", "ES256");
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: values.APPLE_SIGNIN_KEY_ID as string })
      .setIssuer(values.APPLE_SIGNIN_TEAM_ID ?? "")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setAudience(APPLE_ISSUER)
      .setSubject(values.APPLE_SIGNIN_CLIENT_ID ?? "")
      .sign(key);
  }

  private applePrivateKey(): string | null {
    const raw = this.environment.values.APPLE_SIGNIN_PRIVATE_KEY;
    const base64 = this.environment.values.APPLE_SIGNIN_PRIVATE_KEY_BASE64;
    const value = raw
      ? raw.replace(/\\n/g, "\n")
      : base64
        ? Buffer.from(base64, "base64").toString("utf8")
        : "";
    if (!value.includes("BEGIN PRIVATE KEY")) return null;
    try {
      const key = createPrivateKey(value);
      return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
        ? value
        : null;
    } catch {
      return null;
    }
  }

  private parseAppleUser(value: string | undefined) {
    if (!value || value.length > 8_192) return { email: null, displayName: null };
    try {
      const parsed = JSON.parse(value) as {
        email?: unknown;
        name?: { firstName?: unknown; lastName?: unknown };
      };
      const email = typeof parsed.email === "string" ? parsed.email : null;
      const names = [parsed.name?.firstName, parsed.name?.lastName].filter(
        (part): part is string => typeof part === "string",
      );
      return { email, displayName: names.join(" ").trim() || null };
    } catch {
      return { email: null, displayName: null };
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

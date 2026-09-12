import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../../packages/database/src/index.js";

describe.sequential("synthetic Staff identity database barriers", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects every Merchant authentication path and identity takeover", async () => {
    const suffix = randomUUID();
    const email = `${suffix}@staff.waflo.invalid`;
    const staff = await prisma.user.create({
      data: {
        displayName: "Database-only Staff",
        email,
        normalizedEmail: email,
        interactiveLoginAllowed: false,
        passwordHash: null,
        emailVerifiedAt: null,
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const organization = await prisma.organization.create({
      data: {
        name: `Synthetic Staff ${suffix.slice(0, 8)}`,
        normalizedName: `synthetic staff ${suffix.slice(0, 8)}`,
        merchantSlug: `staff-${suffix.slice(0, 8)}`,
        timezone: "Asia/Baghdad",
        members: { create: { userId: staff.id, role: "STAFF" } },
      },
    });

    await expect(
      prisma.user.update({ where: { id: staff.id }, data: { passwordHash: "not-a-real-hash" } }),
    ).rejects.toThrow(/users_staff_identity_login_barrier/i);
    await expect(
      prisma.user.update({ where: { id: staff.id }, data: { emailVerifiedAt: new Date() } }),
    ).rejects.toThrow(/users_staff_identity_login_barrier/i);
    await expect(
      prisma.user.update({ where: { id: staff.id }, data: { interactiveLoginAllowed: true } }),
    ).rejects.toThrow(/users_staff_identity_login_barrier/i);
    await expect(
      prisma.user.update({
        where: { id: staff.id },
        data: { email: "attacker@example.com", normalizedEmail: "attacker@example.com" },
      }),
    ).rejects.toThrow(/users_staff_identity_login_barrier/i);
    await expect(
      prisma.session.create({
        data: {
          userId: staff.id,
          tokenHash: createHash("sha256").update(`session-${suffix}`).digest("hex"),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow(/synthetic staff identities cannot use interactive authentication/i);
    await expect(
      prisma.emailVerificationToken.create({
        data: {
          userId: staff.id,
          tokenHash: createHash("sha256").update(`verify-${suffix}`).digest("hex"),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow(/synthetic staff identities cannot use interactive authentication/i);
    await expect(
      prisma.passwordResetToken.create({
        data: {
          userId: staff.id,
          tokenHash: createHash("sha256").update(`reset-${suffix}`).digest("hex"),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow(/synthetic staff identities cannot use interactive authentication/i);
    await expect(
      prisma.externalIdentity.create({
        data: {
          userId: staff.id,
          provider: "GOOGLE",
          issuer: "https://accounts.google.com",
          providerSubject: suffix,
          emailVerified: true,
        },
      }),
    ).rejects.toThrow(/synthetic staff identities cannot use interactive authentication/i);
    await expect(
      prisma.user.create({
        data: {
          displayName: "Collision",
          email,
          normalizedEmail: email,
          interactiveLoginAllowed: false,
          termsVersion: "test",
          privacyVersion: "test",
          legalAcceptedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: staff.id } })).rejects.toThrow();

    expect(organization.id).toBeTruthy();
  });
});

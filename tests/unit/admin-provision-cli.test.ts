import type { PrismaClient } from "@waflo/database";
import { describe, expect, it } from "vitest";
import {
  AdminProvisionCliError,
  parseAdminProvisionArgs,
  provisionAdminFromCli,
} from "../../scripts/admin-provision-cli.ts";

const argv = ["--email", "  Operator@Example.com ", "--display-name", "Release Operator"] as const;

function writeOptions() {
  return parseAdminProvisionArgs([...argv, "--role", "SUPER_ADMIN", "--write"]);
}

describe("official admin provisioning CLI", () => {
  it("rejects incomplete input and roles outside the admin role authority", () => {
    expect(() => parseAdminProvisionArgs(["--email", "operator@example.com"])).toThrow(
      AdminProvisionCliError,
    );
    expect(() => parseAdminProvisionArgs([...argv, "--role", "OWNER"])).toThrow(
      "--role must be one of",
    );
    expect(() => parseAdminProvisionArgs([...argv, "--email", "not-an-email"])).toThrow(
      "valid email",
    );
  });

  it("defaults to dry-run and never opens a database connection", async () => {
    let opened = false;
    const result = await provisionAdminFromCli(parseAdminProvisionArgs(argv), {
      getClient: () => {
        opened = true;
        return {} as PrismaClient;
      },
    });
    expect(result).toMatchObject({
      mode: "dry-run",
      account: { normalizedEmail: "operator@example.com", role: "READ_ONLY" },
    });
    expect(opened).toBe(false);
  });

  it("rejects password confirmation mismatch before opening a database connection", async () => {
    let opened = false;
    await expect(
      provisionAdminFromCli(writeOptions(), {
        getClient: () => {
          opened = true;
          return {} as PrismaClient;
        },
        readSecret: async (prompt) =>
          prompt.startsWith("Confirm") ? "different" : "safe-password-12",
      }),
    ).rejects.toThrow("Passwords do not match");
    expect(opened).toBe(false);
  });

  it("reports duplicate administrators and disconnects the supported Prisma client", async () => {
    let disconnected = false;
    const client = {
      $disconnect: async () => {
        disconnected = true;
      },
      $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ adminUser: { findUnique: async () => ({ id: "existing" }) } }),
    } as unknown as PrismaClient;

    await expect(
      provisionAdminFromCli(writeOptions(), {
        getClient: () => client,
        readSecret: async () => "safe-password-12",
      }),
    ).rejects.toThrow("already exists");
    expect(disconnected).toBe(true);
  });

  it("creates and audits an administrator without returning any password material", async () => {
    let disconnected = false;
    const auditEvents: unknown[] = [];
    const client = {
      $disconnect: async () => {
        disconnected = true;
      },
      $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          adminUser: {
            findUnique: async () => null,
            create: async () => ({
              id: "admin-internal-id",
              publicId: "c1aef6ad-9d6a-4b68-8cf5-987c8a3dfce1",
              displayName: "Release Operator",
              normalizedEmail: "operator@example.com",
              role: "SUPER_ADMIN",
              preferredLocale: "EN",
              status: "ACTIVE",
            }),
          },
          auditLog: { create: async (event: unknown) => auditEvents.push(event) },
        }),
    } as unknown as PrismaClient;

    const result = await provisionAdminFromCli(writeOptions(), {
      getClient: () => client,
      readSecret: async () => "safe-password-12",
    });

    expect(result).toMatchObject({
      mode: "write",
      account: { normalizedEmail: "operator@example.com", role: "SUPER_ADMIN" },
    });
    expect(JSON.stringify(result)).not.toContain("safe-password-12");
    expect(auditEvents).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ action: "admin.account.provisioned" }),
      }),
    ]);
    expect(disconnected).toBe(true);
  });
});

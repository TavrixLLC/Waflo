import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { createOpaqueToken, hashOpaqueToken } from "../../packages/auth/src/index.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_USER_ID = "33333333-3333-4333-8333-333333333333";

describe.sequential("W4 repaired merchant HTTP boundary", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let environment: EnvironmentService;
  let ownerCookie: string;
  let staffCookie: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);
    const ownerToken = createOpaqueToken();
    const staffToken = createOpaqueToken();
    await prisma.client.session.createMany({
      data: [
        {
          userId: OWNER_ID,
          tokenHash: hashOpaqueToken(ownerToken),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
        {
          userId: STAFF_USER_ID,
          tokenHash: hashOpaqueToken(staffToken),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      ],
    });
    ownerCookie = `${environment.values.COOKIE_NAME}=${ownerToken}`;
    staffCookie = `${environment.values.COOKIE_NAME}=${staffToken}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function csrf(cookie: string) {
    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/csrf",
      headers: { cookie },
    });
    const setCookie = response.headers["set-cookie"];
    const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return {
      token: (response.json() as { data: { csrfToken: string } }).data.csrfToken,
      cookie: `${rawCookie?.split(";")[0] ?? ""}; ${cookie}`,
    };
  }

  function mutationHeaders(state: { token: string; cookie: string }) {
    return {
      origin: "http://localhost:3001",
      cookie: state.cookie,
      "x-csrf-token": state.token,
      "content-type": "application/json",
    };
  }

  it("requires authentication for every advanced analytics dimension", async () => {
    for (const route of ["programs", "locations", "staff", "cohorts"]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/organizations/${ORGANIZATION_ID}/analytics/${route}?limit=1`,
      });
      expect(response.statusCode, route).toBe(401);
    }
  });

  it("returns bounded typed dimension responses without exposing aggregate storage rows", async () => {
    for (const route of ["programs", "locations", "staff", "cohorts"]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/organizations/${ORGANIZATION_ID}/analytics/${route}?limit=1`,
        headers: { cookie: ownerCookie },
      });
      expect(response.statusCode, route).toBe(200);
      const data = (response.json() as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({ items: expect.any(Array), dateRange: expect.any(Object) });
      expect((data.items as unknown[]).length).toBeLessThanOrEqual(1);
      expect(JSON.stringify(data)).not.toContain("aggregateKey");
      expect(JSON.stringify(data)).not.toContain("sourceSequence");
    }
  });

  it("enforces CSRF, role, validation, replay, and conflict on merchant mutations", async () => {
    const membership = await prisma.client.membership.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID, status: "ACTIVE" },
      include: { progress: true },
    });
    const withoutCsrf = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/memberships/${membership.id}/rebuild-projection`,
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { commandId: randomUUID(), expectedProjectionVersion: 0 },
    });
    expect(withoutCsrf.statusCode).toBe(403);

    const staffCsrf = await csrf(staffCookie);
    const staffDenied = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/memberships/${membership.id}/suspend`,
      headers: mutationHeaders(staffCsrf),
      payload: {
        commandId: randomUUID(),
        reason: "Staff must not mutate membership status.",
        locationId: "a1111111-1111-4111-8111-111111111111",
      },
    });
    expect(staffDenied.statusCode).toBe(403);

    const ownerCsrf = await csrf(ownerCookie);
    const invalid = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/memberships/${membership.id}/rebuild-projection`,
      headers: mutationHeaders(ownerCsrf),
      payload: { expectedProjectionVersion: membership.progress?.projectionVersion ?? 0 },
    });
    expect(invalid.statusCode).toBe(422);

    const commandId = randomUUID();
    const payload = {
      commandId,
      expectedProjectionVersion: membership.progress?.projectionVersion ?? 0,
    };
    const first = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/memberships/${membership.id}/rebuild-projection`,
      headers: mutationHeaders(ownerCsrf),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/memberships/${membership.id}/rebuild-projection`,
      headers: mutationHeaders(ownerCsrf),
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { data: { replayed: boolean } }).data.replayed).toBe(true);
    const conflict = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/memberships/${membership.id}/rebuild-projection`,
      headers: mutationHeaders(ownerCsrf),
      payload: { commandId, expectedProjectionVersion: payload.expectedProjectionVersion + 1 },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it("durably schedules and replays an organization/date analytics rebuild", async () => {
    const state = await csrf(ownerCookie);
    const commandId = randomUUID();
    const payload = {
      commandId,
      from: "2026-07-01",
      to: "2026-07-31",
      sourceKinds: ["ENROLLMENT", "LEDGER", "RISK"],
    };
    const first = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/analytics/rebuild`,
      headers: mutationHeaders(state),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/analytics/rebuild`,
      headers: mutationHeaders(state),
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { data: { replayed: boolean } }).data.replayed).toBe(true);
    expect(
      await prisma.client.operationalAnalyticsJob.count({
        where: { organizationId: ORGANIZATION_ID, idempotencyKey: commandId },
      }),
    ).toBe(1);
  });
});

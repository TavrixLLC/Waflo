import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OperationalWorker } from "../../apps/operational-worker/src/main.js";
import { parseEnvironment } from "../../packages/config/src/index.js";
import { createPrismaClient, type PrismaClient } from "../../packages/database/src/index.js";

interface AnalyticsWorkerAccess {
  processAnalyticsSource(sourceKind: "RISK"): Promise<number>;
  processOneAnalyticsJob(): Promise<boolean>;
}

async function createAnalyticsFixtureProgram(
  prisma: PrismaClient,
  organizationId: string,
  label: string,
) {
  const creator = await prisma.organizationMember.findFirstOrThrow({
    where: { organizationId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return prisma.loyaltyProgram.create({
    data: {
      organizationId,
      internalName: `W4 Analytics Fixture ${label}`,
      status: "DRAFT",
      createdByUserId: creator.userId,
    },
  });
}

describe.sequential("W4 incremental analytics checkpoint and rebuild", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient(parseEnvironment(process.env).DATABASE_URL);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses bounded leased pages, resumes after interruption, replays idempotently, and rebuilds one organization", async () => {
    const staleSignals = await prisma.operationalRiskSignal.findMany({
      where: {
        ruleCode: {
          in: ["LATE_LEDGER_REVIEW", "WORKER_INTERRUPTION_REVIEW", "TENANT_ISOLATION_REVIEW"],
        },
        createdAt: { gte: new Date("2030-01-01T00:00:00.000Z") },
      },
      select: { id: true, organizationId: true },
    });
    if (staleSignals.length > 0) {
      const sourceIds = staleSignals.map((signal) => signal.id);
      await prisma.operationalAnalyticsContribution.deleteMany({
        where: { sourceKind: "RISK", sourceId: { in: sourceIds } },
      });
      await prisma.operationalAnalyticsFact.deleteMany({
        where: { sourceKind: "RISK", sourceId: { in: sourceIds } },
      });
      await prisma.operationalDailyAggregate.deleteMany({
        where: {
          organizationId: { in: [...new Set(staleSignals.map((signal) => signal.organizationId))] },
          localDate: new Date("2030-01-01T00:00:00.000Z"),
        },
      });
      await prisma.operationalRiskSignal.deleteMany({ where: { id: { in: sourceIds } } });
    }
    await prisma.operationalAnalyticsJob.deleteMany({
      where: { jobType: "DATE_RANGE_REBUILD", createdAt: { lt: new Date("1991-01-01") } },
    });
    const organizationA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const organizationB = (
      await prisma.organization.findFirstOrThrow({
        where: { id: { not: organizationA } },
        select: { id: true },
      })
    ).id;
    const [programA, programB] = await Promise.all([
      createAnalyticsFixtureProgram(prisma, organizationA, `A ${randomUUID().slice(0, 8)}`),
      createAnalyticsFixtureProgram(prisma, organizationB, `B ${randomUUID().slice(0, 8)}`),
    ]);
    expect(programA.organizationId).toBe(organizationA);
    expect(programB.organizationId).toBe(organizationB);
    const cursor = new Date("2030-01-01T00:00:00.000Z");
    await prisma.operationalAnalyticsCheckpoint.upsert({
      where: { sourceKind: "RISK" },
      create: {
        sourceKind: "RISK",
        status: "COMPLETED",
        cursorOccurredAt: cursor,
        nextAttemptAt: new Date(),
      },
      update: {
        status: "COMPLETED",
        cursorOccurredAt: cursor,
        cursorSourceId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(),
        attemptCount: 0,
      },
    });
    const sources = await Promise.all([
      prisma.operationalRiskSignal.create({
        data: {
          organizationId: organizationA,
          programId: programA.id,
          ruleCode: "LATE_LEDGER_REVIEW",
          severity: "MEDIUM",
          score: 50,
          safeEvidence: { source: "late-review" },
          createdAt: new Date("2030-01-01T00:00:01.000Z"),
        },
      }),
      prisma.operationalRiskSignal.create({
        data: {
          organizationId: organizationA,
          programId: programA.id,
          ruleCode: "WORKER_INTERRUPTION_REVIEW",
          severity: "HIGH",
          score: 75,
          safeEvidence: { source: "resume" },
          createdAt: new Date("2030-01-01T00:00:02.000Z"),
        },
      }),
      prisma.operationalRiskSignal.create({
        data: {
          organizationId: organizationB,
          programId: programB.id,
          ruleCode: "TENANT_ISOLATION_REVIEW",
          severity: "LOW",
          score: 25,
          safeEvidence: { source: "second-organization" },
          createdAt: new Date("2030-01-01T00:00:03.000Z"),
        },
      }),
    ]);
    const environment = { ...parseEnvironment(process.env), ANALYTICS_BATCH_SIZE: 1 };
    const firstWorker = new OperationalWorker(
      prisma,
      environment,
    ) as unknown as AnalyticsWorkerAccess;
    const secondWorker = new OperationalWorker(
      prisma,
      environment,
    ) as unknown as AnalyticsWorkerAccess;

    const concurrent = await Promise.all([
      firstWorker.processAnalyticsSource("RISK"),
      secondWorker.processAnalyticsSource("RISK"),
    ]);
    expect(concurrent.sort()).toEqual([0, 1]);
    expect(await secondWorker.processAnalyticsSource("RISK")).toBe(1);
    expect(await firstWorker.processAnalyticsSource("RISK")).toBe(1);
    expect(
      await prisma.operationalAnalyticsContribution.count({
        where: { sourceId: { in: sources.map((source) => source.id) } },
      }),
    ).toBe(3);
    const aggregateBeforeReplay = await prisma.operationalDailyAggregate.aggregate({
      where: {
        organizationId: organizationA,
        localDate: new Date("2030-01-01T00:00:00.000Z"),
      },
      _sum: { riskSignals: true },
    });
    expect(aggregateBeforeReplay._sum.riskSignals).toBe(2);

    await prisma.operationalAnalyticsCheckpoint.update({
      where: { sourceKind: "RISK" },
      data: {
        status: "PENDING",
        cursorOccurredAt: cursor,
        cursorSourceId: null,
        nextAttemptAt: new Date(),
      },
    });
    expect(await secondWorker.processAnalyticsSource("RISK")).toBe(1);
    expect(
      await prisma.operationalAnalyticsContribution.count({
        where: { sourceId: { in: sources.map((source) => source.id) } },
      }),
    ).toBe(3);
    expect(
      (
        await prisma.operationalDailyAggregate.aggregate({
          where: {
            organizationId: organizationA,
            localDate: new Date("2030-01-01T00:00:00.000Z"),
          },
          _sum: { riskSignals: true },
        })
      )._sum.riskSignals,
    ).toBe(2);

    const rebuild = await prisma.operationalAnalyticsJob.create({
      data: {
        organizationId: organizationA,
        jobType: "DATE_RANGE_REBUILD",
        fromDate: new Date("2030-01-01T00:00:00.000Z"),
        toDate: new Date("2030-01-01T00:00:00.000Z"),
        sourceKinds: ["RISK"],
        idempotencyKey: randomUUID(),
        requestFingerprint: createHash("sha256").update(randomUUID()).digest("hex"),
        createdAt: new Date("1990-01-01T00:00:00.000Z"),
      },
    });
    for (let page = 0; page < 5; page += 1) {
      await firstWorker.processOneAnalyticsJob();
      const state = await prisma.operationalAnalyticsJob.findUniqueOrThrow({
        where: { id: rebuild.id },
      });
      if (state.status === "COMPLETED") break;
    }
    expect(
      await prisma.operationalAnalyticsJob.findUniqueOrThrow({ where: { id: rebuild.id } }),
    ).toMatchObject({ status: "COMPLETED" });
    expect(
      await prisma.operationalDailyAggregate.count({
        where: {
          organizationId: organizationA,
          localDate: new Date("2030-01-01T00:00:00.000Z"),
        },
      }),
    ).toBe(0);
    expect(
      await prisma.operationalDailyAggregate.count({
        where: {
          organizationId: organizationB,
          localDate: new Date("2030-01-01T00:00:00.000Z"),
        },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.auditLog.count({
        where: { action: "analytics.rebuild_completed", targetId: rebuild.id },
      }),
    ).toBe(1);
  });
});

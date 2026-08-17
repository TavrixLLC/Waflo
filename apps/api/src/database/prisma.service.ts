import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { writeFile } from "node:fs/promises";
import { createPrismaClient, type PrismaClient } from "@waflo/database";
import { EnvironmentService } from "../config/environment.service.js";

@Injectable()
export class PrismaService implements OnModuleDestroy, OnModuleInit {
  readonly client: PrismaClient;

  constructor(environment: EnvironmentService) {
    this.client = createPrismaClient(environment.values.DATABASE_URL, {
      max: environment.values.DATABASE_POOL_MAX,
      connectionTimeoutMillis: environment.values.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: environment.values.DATABASE_POOL_IDLE_TIMEOUT_MS,
      maxLifetimeSeconds: environment.values.DATABASE_POOL_MAX_LIFETIME_SECONDS,
    });
  }

  async onModuleInit(): Promise<void> {
    const probeFile =
      process.env.WAFLO_ISOLATED_E2E === "1" ? process.env.WAFLO_API_DB_PROBE_FILE : undefined;
    if (!probeFile) return;
    const rows = await this.client.$queryRaw<Array<{ database_name: string }>>`
      SELECT current_database() AS database_name
    `;
    await writeFile(
      probeFile,
      JSON.stringify({ databaseName: rows[0]?.database_name, pid: process.pid }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

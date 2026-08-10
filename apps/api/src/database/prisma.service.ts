import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@waflo/database";
import { EnvironmentService } from "../config/environment.service.js";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(environment: EnvironmentService) {
    this.client = createPrismaClient(environment.values.DATABASE_URL, {
      max: environment.values.DATABASE_POOL_MAX,
      connectionTimeoutMillis: environment.values.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: environment.values.DATABASE_POOL_IDLE_TIMEOUT_MS,
      maxLifetimeSeconds: environment.values.DATABASE_POOL_MAX_LIFETIME_SECONDS,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

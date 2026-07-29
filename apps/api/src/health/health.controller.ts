import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../common/decorators.js";
import { PrismaService } from "../database/prisma.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../programs/object-storage.js";

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimits: RateLimitService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  @Get("health")
  @Public()
  health() {
    return {
      status: "ok",
      service: "waflo-api",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  @Public()
  async ready() {
    try {
      // A model count is intentionally used instead of raw SQL for readiness.
      await Promise.all([
        this.prisma.client.organization.count(),
        this.rateLimits.assertReady(),
        this.objectStorage.ensureReady(),
      ]);
      return {
        status: "ready",
        dependencies: {
          database: "ready",
          rateLimitStorage: "ready",
          objectStorage: "ready",
        },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException("Critical dependencies are unavailable.");
    }
  }
}

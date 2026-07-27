import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../common/decorators.js";
import { PrismaService } from "../database/prisma.service.js";

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
      await this.prisma.client.organization.count();
      return {
        status: "ready",
        dependencies: { database: "ready" },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException("Critical dependencies are unavailable.");
    }
  }
}

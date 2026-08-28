import { Controller, Get, Param, Query } from "@nestjs/common";
import { AdminRoute, CurrentAdmin, RequireAdminPermissions } from "../common/decorators.js";
import type { AuthenticatedAdmin } from "../common/request-context.js";
import { parseInput } from "../common/validation.js";
import { adminStripeHealthIssueQuerySchema } from "./admin-stripe-health.js";
import { AdminStripeHealthService } from "./admin-stripe-health.service.js";

@Controller("v1/admin/stripe-health")
@AdminRoute()
export class AdminStripeHealthController {
  constructor(private readonly health: AdminStripeHealthService) {}

  @Get("overview")
  @RequireAdminPermissions("admin.stripe_health.read")
  overview(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.health.overview({
      canViewFinance: admin.permissions.includes("admin.finance.read"),
    });
  }

  @Get("issues")
  @RequireAdminPermissions("admin.stripe_health.read")
  issues(@Query() query: unknown) {
    return this.health.issues(parseInput(adminStripeHealthIssueQuerySchema, query));
  }

  @Get("issues/:issueId")
  @RequireAdminPermissions("admin.stripe_health.read")
  issue(@Param("issueId") issueId: string) {
    return this.health.issue(issueId);
  }

  @Get("webhooks")
  @RequireAdminPermissions("admin.stripe_health.read")
  webhooks() {
    return this.health.webhooks();
  }

  @Get("reconciliation")
  @RequireAdminPermissions("admin.stripe_health.read")
  reconciliation() {
    return this.health.reconciliation();
  }

  @Get("payments")
  @RequireAdminPermissions("admin.stripe_health.read")
  payments(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.health.payments({
      canViewFinance: admin.permissions.includes("admin.finance.read"),
    });
  }

  @Get("catalog")
  @RequireAdminPermissions("admin.stripe_health.read")
  catalog() {
    return this.health.catalog();
  }
}

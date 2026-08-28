import { Controller, Get, Query } from "@nestjs/common";
import { AdminRoute, RequireAdminPermissions } from "../common/decorators.js";
import { AdminAnalyticsService } from "./admin-analytics.service.js";

@Controller("v1/admin/analytics")
@AdminRoute()
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get("overview")
  @RequireAdminPermissions("admin.dashboard.read")
  overview(@Query("range") range?: string) {
    return this.analytics.overview(range);
  }

  @Get("finance")
  @RequireAdminPermissions("admin.finance.read")
  finance(@Query("range") range?: string) {
    return this.analytics.finance(range);
  }
}

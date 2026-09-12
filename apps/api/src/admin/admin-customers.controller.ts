import { Controller, Get, Param, Query } from "@nestjs/common";
import { AdminRoute, CurrentAdmin, RequireAdminPermissions } from "../common/decorators.js";
import type { AuthenticatedAdmin } from "../common/request-context.js";
import { parseUuid } from "../common/validation.js";
import { parseAdminCustomerDirectoryQuery } from "./admin-customers.js";
import { AdminCustomersService } from "./admin-customers.service.js";

@Controller("v1/admin/customers")
@AdminRoute()
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get()
  @RequireAdminPermissions("admin.customers.read")
  list(@Query() query: Record<string, unknown>) {
    return this.customers.list(parseAdminCustomerDirectoryQuery(query));
  }

  @Get(":customerId")
  @RequireAdminPermissions("admin.customers.read")
  detail(@Param("customerId") customerId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.customers.detail(parseUuid(customerId), {
      canViewFinance: admin.permissions.includes("admin.finance.read"),
    });
  }
}

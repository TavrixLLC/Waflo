import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { createErrorReporter } from "@waflo/security";
import { AuditController } from "./audit/audit.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { BillingController, WebhooksController } from "./billing/billing.controller.js";
import { BillingService } from "./billing/billing.service.js";
import { EnvelopeInterceptor } from "./common/request-context.js";
import { ErrorEnvelopeFilter } from "./common/error.filter.js";
import { ERROR_REPORTER } from "./common/error-reporter.js";
import { EnvironmentService } from "./config/environment.service.js";
import { PrismaService } from "./database/prisma.service.js";
import { HealthController } from "./health/health.controller.js";
import { LocationsController } from "./locations/locations.controller.js";
import { LocationsService } from "./locations/locations.service.js";
import { NotificationService } from "./notifications/notification.service.js";
import { OrganizationsController } from "./organizations/organizations.controller.js";
import { OrganizationsService } from "./organizations/organizations.service.js";
import { PublicController } from "./public/public.controller.js";
import { HostResolutionService } from "./public/host-resolution.service.js";
import { ApiRateLimitGuard, CsrfGuard, SessionGuard } from "./security/guards.js";
import { RateLimitService } from "./security/rate-limit.service.js";
import { InvitationsController, TeamController } from "./team/team.controller.js";
import { TeamService } from "./team/team.service.js";
import { TenantService } from "./tenancy/tenant.service.js";
import { ProgramsController } from "./programs/programs.controller.js";
import { ProgramsService } from "./programs/programs.service.js";
import { AssetsController } from "./programs/assets.controller.js";
import { AssetsService } from "./programs/assets.service.js";

@Module({
  controllers: [
    AuthController,
    OrganizationsController,
    LocationsController,
    TeamController,
    InvitationsController,
    BillingController,
    WebhooksController,
    AuditController,
    PublicController,
    HealthController,
    ProgramsController,
    AssetsController,
  ],
  providers: [
    EnvironmentService,
    PrismaService,
    AuditService,
    NotificationService,
    RateLimitService,
    TenantService,
    AuthService,
    OrganizationsService,
    LocationsService,
    TeamService,
    ProgramsService,
    AssetsService,
    BillingService,
    HostResolutionService,
    {
      provide: ERROR_REPORTER,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService) =>
        createErrorReporter(environment.values.SENTRY_DSN || undefined),
    },
    { provide: APP_GUARD, useClass: ApiRateLimitGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}

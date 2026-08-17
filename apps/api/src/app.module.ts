import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { createErrorReporter } from "@waflo/security";
import { AuditController } from "./audit/audit.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { AccountAccessService } from "./account/account-access.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { ExternalAuthController } from "./auth/external-auth.controller.js";
import { ExternalAuthService } from "./auth/external-auth.service.js";
import { BillingController, WebhooksController } from "./billing/billing.controller.js";
import { BillingService } from "./billing/billing.service.js";
import { ErrorEnvelopeFilter } from "./common/error.filter.js";
import { ERROR_REPORTER } from "./common/error-reporter.js";
import { EnvelopeInterceptor } from "./common/request-context.js";
import { EnvironmentService } from "./config/environment.service.js";
import { CustomerCardController } from "./customer/customer-card.controller.js";
import { CustomerCardService } from "./customer/customer-card.service.js";
import { CustomerSecurityService } from "./customer/customer-security.service.js";
import { TransferController } from "./customer/transfer.controller.js";
import { TransferService } from "./customer/transfer.service.js";
import { PrismaService } from "./database/prisma.service.js";
import { EnrollmentSettingsController } from "./enrollment/enrollment-settings.controller.js";
import { EnrollmentSettingsService } from "./enrollment/enrollment-settings.service.js";
import { PublicEnrollmentController } from "./enrollment/public-enrollment.controller.js";
import { PublicEnrollmentService } from "./enrollment/public-enrollment.service.js";
import { CapabilitiesController } from "./health/capabilities.controller.js";
import { HealthController } from "./health/health.controller.js";
import { LocationsController, LocationToolsController } from "./locations/locations.controller.js";
import { LocationsService } from "./locations/locations.service.js";
import { LoyaltyOperationService } from "./loyalty/loyalty-operation.service.js";
import { StaffOperationsController } from "./loyalty/staff-operations.controller.js";
import { NotificationService } from "./notifications/notification.service.js";
import { MerchantOperationsController } from "./operations/merchant-operations.controller.js";
import { MerchantOperationsService } from "./operations/merchant-operations.service.js";
import { OrganizationsController } from "./organizations/organizations.controller.js";
import { OrganizationsService } from "./organizations/organizations.service.js";
import { AssetsController } from "./programs/assets.controller.js";
import { AssetsService } from "./programs/assets.service.js";
import { OBJECT_STORAGE, S3ObjectStorage } from "./programs/object-storage.js";
import { ProgramsController } from "./programs/programs.controller.js";
import { ProgramsService } from "./programs/programs.service.js";
import { HostResolutionService } from "./public/host-resolution.service.js";
import { PublicController } from "./public/public.controller.js";
import {
  ApiRateLimitGuard,
  CsrfGuard,
  CustomerCsrfGuard,
  SessionGuard,
  StaffDeviceSignatureGuard,
} from "./security/guards.js";
import { RateLimitService } from "./security/rate-limit.service.js";
import {
  MerchantStaffDeviceController,
  StaffDevicePairingController,
} from "./staff-devices/staff-device.controller.js";
import { StaffDeviceService } from "./staff-devices/staff-device.service.js";
import { InvitationsController, TeamController } from "./team/team.controller.js";
import { TeamService } from "./team/team.service.js";
import { TenantService } from "./tenancy/tenant.service.js";
import { AppleUpdateController } from "./wallet/apple-update.controller.js";
import { AppleUpdateService } from "./wallet/apple-update.service.js";
import { PublicWalletAssetsController } from "./wallet/public-wallet-assets.controller.js";
import { WalletController } from "./wallet/wallet.controller.js";
import { WalletService } from "./wallet/wallet.service.js";
import { WalletProviderRegistry } from "./wallet/wallet-provider.registry.js";
import {
  CustomerWalletEngagementController,
  MerchantWalletEngagementController,
} from "./wallet-engagement/wallet-engagement.controller.js";
import { WalletEngagementService } from "./wallet-engagement/wallet-engagement.service.js";

@Module({
  controllers: [
    AuthController,
    ExternalAuthController,
    OrganizationsController,
    LocationsController,
    LocationToolsController,
    TeamController,
    InvitationsController,
    BillingController,
    WebhooksController,
    AuditController,
    PublicController,
    HealthController,
    CapabilitiesController,
    ProgramsController,
    AssetsController,
    EnrollmentSettingsController,
    PublicEnrollmentController,
    CustomerCardController,
    TransferController,
    WalletController,
    AppleUpdateController,
    PublicWalletAssetsController,
    MerchantStaffDeviceController,
    StaffDevicePairingController,
    StaffOperationsController,
    MerchantOperationsController,
    MerchantWalletEngagementController,
    CustomerWalletEngagementController,
  ],
  providers: [
    EnvironmentService,
    PrismaService,
    AuditService,
    AccountAccessService,
    NotificationService,
    RateLimitService,
    TenantService,
    AuthService,
    ExternalAuthService,
    OrganizationsService,
    LocationsService,
    TeamService,
    ProgramsService,
    AssetsService,
    EnrollmentSettingsService,
    PublicEnrollmentService,
    CustomerSecurityService,
    CustomerCardService,
    TransferService,
    WalletProviderRegistry,
    WalletService,
    AppleUpdateService,
    StaffDeviceService,
    LoyaltyOperationService,
    MerchantOperationsService,
    WalletEngagementService,
    {
      provide: OBJECT_STORAGE,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService) =>
        new S3ObjectStorage({
          endpoint: environment.values.OBJECT_STORAGE_ENDPOINT,
          region: environment.values.OBJECT_STORAGE_REGION,
          bucket: environment.values.OBJECT_STORAGE_BUCKET,
          accessKeyId: environment.values.OBJECT_STORAGE_ACCESS_KEY_ID,
          secretAccessKey: environment.values.OBJECT_STORAGE_SECRET_ACCESS_KEY,
          forcePathStyle: environment.values.OBJECT_STORAGE_FORCE_PATH_STYLE,
        }),
    },
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
    { provide: APP_GUARD, useClass: CustomerCsrfGuard },
    { provide: APP_GUARD, useClass: StaffDeviceSignatureGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}

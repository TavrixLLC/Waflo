import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AdminPermission } from "../admin/admin-rbac.js";
import type { AuthenticatedUser, WafloRequest } from "./request-context.js";

export const IS_PUBLIC = "waflo:is-public";
export const SKIP_CSRF = "waflo:skip-csrf";
export const CUSTOMER_CSRF = "waflo:customer-csrf";
export const RATE_LIMIT = "waflo:rate-limit";
export const STAFF_DEVICE_SIGNED = "waflo:staff-device-signed";
export const IS_ADMIN_ROUTE = "waflo:is-admin-route";
export const IS_ADMIN_PUBLIC = "waflo:is-admin-public";
export const ADMIN_PERMISSIONS = "waflo:admin-permissions";

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);
export const CustomerCsrf = () => SetMetadata(CUSTOMER_CSRF, true);
export const CustomerCsrfOptionalSession = () => SetMetadata(CUSTOMER_CSRF, "optional");
export const RateLimit = (limit: number, windowSeconds = 60) =>
  SetMetadata(RATE_LIMIT, { limit, windowSeconds });
export const StaffDeviceSigned = () => SetMetadata(STAFF_DEVICE_SIGNED, true);
export const AdminRoute = () => SetMetadata(IS_ADMIN_ROUTE, true);
export const AdminPublic = () => SetMetadata(IS_ADMIN_PUBLIC, true);
export const RequireAdminPermissions = (...permissions: AdminPermission[]) =>
  SetMetadata(ADMIN_PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<WafloRequest>();
    if (!request.currentUser) throw new Error("CurrentUser used without the session guard.");
    return request.currentUser;
  },
);

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<WafloRequest>();
    if (!request.currentSessionId)
      throw new Error("CurrentSession used without the session guard.");
    return request.currentSessionId;
  },
);

export const CurrentAdmin = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<WafloRequest>();
  if (!request.currentAdmin) throw new Error("CurrentAdmin used without the admin session guard.");
  return request.currentAdmin;
});

export const CurrentAdminSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<WafloRequest>();
    if (!request.currentAdminSessionId) {
      throw new Error("CurrentAdminSession used without the admin session guard.");
    }
    return request.currentAdminSessionId;
  },
);

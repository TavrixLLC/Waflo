import { randomUUID } from "node:crypto";
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { ApiSuccess } from "@waflo/contracts";
import type { AdminRole } from "@waflo/database";
import type { FastifyRequest } from "fastify";
import { map, type Observable } from "rxjs";
import type { AdminPermission } from "../admin/admin-rbac.js";

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  email: string;
  preferredLocale: "EN" | "AR";
  emailVerifiedAt: Date | null;
}

export interface AuthenticatedAdmin {
  id: string;
  publicId: string;
  displayName: string;
  email: string;
  preferredLocale: "EN" | "AR";
  role: AdminRole;
  permissions: readonly AdminPermission[];
}

export interface StaffDeviceRequestContext {
  organizationId: string;
  organizationMemberId: string;
  role: "OWNER" | "MANAGER" | "STAFF";
  locationId: string;
  deviceId: string;
  devicePublicId: string;
  deviceSessionId: string;
  platform: "IOS" | "ANDROID" | "TEST_CLIENT";
  appVersion: string;
  minimumSupportedAppVersion: string;
  appVersionSupported: true;
  requestId: string;
}

export interface WafloRequest extends FastifyRequest {
  requestId: string;
  rawBody?: Buffer;
  currentUser?: AuthenticatedUser;
  currentSessionId?: string;
  currentSessionToken?: string;
  currentAdmin?: AuthenticatedAdmin;
  currentAdminSessionId?: string;
  currentAdminSessionToken?: string;
  staffDeviceContext?: StaffDeviceRequestContext;
}

@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    const request = context.switchToHttp().getRequest<WafloRequest>();
    request.requestId ||= request.id || randomUUID();
    return next.handle().pipe(map((data) => ({ data, requestId: request.requestId })));
  }
}

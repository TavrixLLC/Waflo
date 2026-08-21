import { randomUUID } from "node:crypto";
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { ApiSuccess } from "@waflo/contracts";
import type { FastifyRequest } from "fastify";
import { map, type Observable } from "rxjs";

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  email: string;
  preferredLocale: "EN" | "AR";
  emailVerifiedAt: Date | null;
}

export interface WafloRequest extends FastifyRequest {
  requestId: string;
  rawBody?: Buffer;
  currentUser?: AuthenticatedUser;
  currentSessionId?: string;
  currentSessionToken?: string;
  staffDeviceContext?: {
    organizationId: string;
    organization: {
      id: string;
      displayName: string;
    };
    organizationMemberId: string;
    role: "OWNER" | "MANAGER" | "STAFF";
    locationId: string;
    currentLocation: {
      id: string;
      displayName: string;
    };
    deviceId: string;
    devicePublicId: string;
    deviceSessionId: string;
    platform: "IOS" | "ANDROID" | "TEST_CLIENT";
    appVersion: string;
    minimumSupportedAppVersion: string;
    appVersionSupported: true;
    requestId: string;
  };
}

@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    const request = context.switchToHttp().getRequest<WafloRequest>();
    request.requestId ||= request.id || randomUUID();
    return next.handle().pipe(map((data) => ({ data, requestId: request.requestId })));
  }
}

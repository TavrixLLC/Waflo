import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  createDevicePairingSessionSchema,
  devicePairingChallengeSchema,
  devicePairingClaimSchema,
  devicePairingCompleteSchema,
  reviewAccessAuthorizeSchema,
  staffDeviceSessionRefreshSchema,
  staffLocationAssignmentUpsertSchema,
} from "@waflo/contracts";
import { AppError } from "../common/app-error.js";
import {
  CurrentUser,
  Public,
  RateLimit,
  SkipCsrf,
  StaffDeviceSigned,
} from "../common/decorators.js";
import type { AuthenticatedUser, WafloRequest } from "../common/request-context.js";
import {
  parseInput,
  parseOptionalCursor,
  parseOptionalPaginationLimit,
  parseUuid,
} from "../common/validation.js";
import { StaffDeviceService } from "./staff-device.service.js";

@Controller("v1/organizations/:organizationId")
export class MerchantStaffDeviceController {
  constructor(private readonly devices: StaffDeviceService) {}

  @Get("staff-devices")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.devices.list(
      user.id,
      parseUuid(organizationId),
      parseOptionalCursor(cursor),
      parseOptionalPaginationLimit(limit),
    );
  }

  @Get("members/:memberId/location-assignments")
  listLocationAssignments(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.devices.listLocationAssignments(
      user.id,
      parseUuid(organizationId),
      parseUuid(memberId),
    );
  }

  @Put("members/:memberId/location-assignments/:locationId")
  putLocationAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("memberId") memberId: string,
    @Param("locationId") locationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.devices.putLocationAssignment(
      user.id,
      parseUuid(organizationId),
      parseUuid(memberId),
      parseUuid(locationId),
      parseInput(staffLocationAssignmentUpsertSchema, body),
      request,
    );
  }

  @Delete("members/:memberId/location-assignments/:locationId")
  revokeLocationAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("memberId") memberId: string,
    @Param("locationId") locationId: string,
    @Req() request: WafloRequest,
  ) {
    return this.devices.revokeLocationAssignment(
      user.id,
      parseUuid(organizationId),
      parseUuid(memberId),
      parseUuid(locationId),
      request,
    );
  }

  @Post("device-pairing-sessions")
  @RateLimit(20)
  createPairing(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    return this.devices.createPairing(
      user.id,
      parseUuid(organizationId),
      parseInput(createDevicePairingSessionSchema, body),
      request,
    );
  }

  @Get("device-pairing-sessions/:sessionId")
  getPairing(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.devices.getPairing(user.id, parseUuid(organizationId), parseUuid(sessionId));
  }

  @Post("device-pairing-sessions/:sessionId/cancel")
  cancelPairing(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Req() request: WafloRequest,
  ) {
    return this.devices.cancelPairing(
      user.id,
      parseUuid(organizationId),
      parseUuid(sessionId),
      request,
    );
  }

  @Post("staff-devices/:deviceId/revoke")
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("deviceId") deviceId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const value =
      body && typeof body === "object" && "reason" in body && typeof body.reason === "string"
        ? body.reason.trim()
        : "";
    if (value.length < 3 || value.length > 240) {
      throw new AppError(
        "REVOCATION_REASON_REQUIRED",
        "A revocation reason is required.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.devices.revoke(
      user.id,
      parseUuid(organizationId),
      parseUuid(deviceId),
      value,
      false,
      request,
    );
  }

  @Post("staff-devices/:deviceId/mark-compromised")
  markCompromised(
    @CurrentUser() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("deviceId") deviceId: string,
    @Body() body: unknown,
    @Req() request: WafloRequest,
  ) {
    const value =
      body && typeof body === "object" && "reason" in body && typeof body.reason === "string"
        ? body.reason.trim()
        : "";
    if (value.length < 3 || value.length > 240) {
      throw new AppError(
        "REVOCATION_REASON_REQUIRED",
        "A compromise reason is required.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.devices.revoke(
      user.id,
      parseUuid(organizationId),
      parseUuid(deviceId),
      value,
      true,
      request,
    );
  }
}

@Controller("v1/staff")
@Public()
@SkipCsrf()
export class StaffDevicePairingController {
  constructor(private readonly devices: StaffDeviceService) {}

  @Post("devices/pairing/claim")
  @RateLimit(10)
  @HttpCode(HttpStatus.OK)
  claim(@Body() body: unknown) {
    return this.devices.claim(parseInput(devicePairingClaimSchema, body));
  }

  @Post("review-access/authorize")
  @RateLimit(5)
  @HttpCode(HttpStatus.OK)
  authorizeReview(@Body() body: unknown, @Req() request: WafloRequest) {
    return this.devices.createReviewPairing(parseInput(reviewAccessAuthorizeSchema, body), request);
  }

  @Post("devices/pairing/challenge")
  @RateLimit(20)
  @HttpCode(HttpStatus.OK)
  challenge(@Body() body: unknown) {
    const input = parseInput(devicePairingChallengeSchema, body);
    return this.devices.challenge(input.pairingPublicId);
  }

  @Post("devices/pairing/complete")
  @RateLimit(10)
  @HttpCode(HttpStatus.OK)
  complete(@Body() body: unknown) {
    return this.devices.complete(parseInput(devicePairingCompleteSchema, body));
  }

  @Post("devices/session/refresh")
  @StaffDeviceSigned()
  @HttpCode(HttpStatus.OK)
  refresh(@Req() request: WafloRequest, @Body() body: unknown) {
    const context = request.staffDeviceContext;
    if (!context) throw new AppError("STAFF_DEVICE_NOT_ACTIVE", "Device context missing.", 401);
    const input = parseInput(staffDeviceSessionRefreshSchema, body);
    return this.devices.refreshSession(context.deviceSessionId, input.refreshToken);
  }

  @Post("devices/session/logout")
  @StaffDeviceSigned()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: WafloRequest) {
    const context = request.staffDeviceContext;
    if (!context) throw new AppError("STAFF_DEVICE_NOT_ACTIVE", "Device context missing.", 401);
    await this.devices.logout(context.deviceSessionId);
  }

  @Get("device-context")
  @StaffDeviceSigned()
  context(@Req() request: WafloRequest, @Headers("x-waflo-device-id") _deviceId: string) {
    const context = request.staffDeviceContext;
    if (!context) throw new AppError("STAFF_DEVICE_NOT_ACTIVE", "Device context missing.", 401);
    return {
      organizationId: context.organizationId,
      role: context.role,
      locationId: context.locationId,
      devicePublicId: context.devicePublicId,
      deviceSessionId: context.deviceSessionId,
      platform: context.platform,
      appVersion: context.appVersion,
      minimumSupportedAppVersion: context.minimumSupportedAppVersion,
      appVersionSupported: context.appVersionSupported,
      sessionMode: context.sessionMode,
      requestId: context.requestId,
    };
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  issueStampSchema,
  membershipResolveSchema,
  redeemRewardSchema,
  reverseOperationSchema,
} from "@waflo/contracts";
import { Public, RateLimit, SkipCsrf, StaffDeviceSigned } from "../common/decorators.js";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { parseInput, parseOperationCommandId, parseUuid } from "../common/validation.js";
import { LoyaltyOperationService } from "./loyalty-operation.service.js";

function staffContext(request: WafloRequest) {
  if (!request.staffDeviceContext) {
    throw new AppError(
      "STAFF_DEVICE_NOT_ACTIVE",
      "Staff device context is unavailable.",
      HttpStatus.UNAUTHORIZED,
    );
  }
  return request.staffDeviceContext;
}

@Controller("v1/staff")
@Public()
@SkipCsrf()
@StaffDeviceSigned()
export class StaffOperationsController {
  constructor(private readonly operations: LoyaltyOperationService) {}

  @Post("memberships/resolve")
  @RateLimit(120)
  @HttpCode(HttpStatus.OK)
  resolve(@Req() request: WafloRequest, @Body() body: unknown) {
    const input = parseInput(membershipResolveSchema, body);
    return this.operations.resolveMembership(staffContext(request), input.qrPayload);
  }

  @Post("operations/stamps")
  @RateLimit(120)
  @HttpCode(HttpStatus.OK)
  issue(
    @Req() request: WafloRequest,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.operations.issueStamps(
      staffContext(request),
      parseOperationCommandId(idempotencyKey),
      parseInput(issueStampSchema, body),
      request,
    );
  }

  @Post("operations/redeem")
  @RateLimit(120)
  @HttpCode(HttpStatus.OK)
  redeem(
    @Req() request: WafloRequest,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.operations.redeemReward(
      staffContext(request),
      parseOperationCommandId(idempotencyKey),
      parseInput(redeemRewardSchema, body),
      request,
    );
  }

  @Post("operations/reverse")
  @RateLimit(120)
  @HttpCode(HttpStatus.OK)
  reverse(
    @Req() request: WafloRequest,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.operations.reverseOperation(
      staffContext(request),
      parseOperationCommandId(idempotencyKey),
      parseInput(reverseOperationSchema, body),
      request,
    );
  }

  @Get("operations/:operationPublicId")
  status(@Req() request: WafloRequest, @Param("operationPublicId") publicId: string) {
    return this.operations.operationStatus(staffContext(request), parseUuid(publicId));
  }
}

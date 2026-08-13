import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { reviewResetSchema, reviewScenarioSelectSchema } from "@waflo/contracts";
import { AppError } from "../common/app-error.js";
import {
  Public,
  RateLimit,
  ReviewDeviceOnly,
  SkipCsrf,
  StaffDeviceSigned,
} from "../common/decorators.js";
import type { WafloRequest } from "../common/request-context.js";
import { parseInput } from "../common/validation.js";
import { ReviewAccessService } from "./review-access.service.js";

@Controller("v1/staff/review")
@Public()
@SkipCsrf()
@StaffDeviceSigned()
@ReviewDeviceOnly()
export class ReviewAccessController {
  constructor(private readonly review: ReviewAccessService) {}

  @Get("scenarios")
  @RateLimit(60)
  scenarios(@Req() request: WafloRequest) {
    return this.review.scenarios(reviewContext(request));
  }

  @Post("scenarios/select")
  @RateLimit(30)
  @HttpCode(HttpStatus.OK)
  selectScenario(@Req() request: WafloRequest, @Body() body: unknown) {
    return this.review.selectScenario(
      reviewContext(request),
      parseInput(reviewScenarioSelectSchema, body),
      request,
    );
  }

  @Post("reset")
  @RateLimit(10)
  @HttpCode(HttpStatus.OK)
  reset(@Req() request: WafloRequest, @Body() body: unknown) {
    return this.review.reset(reviewContext(request), parseInput(reviewResetSchema, body), request);
  }
}

function reviewContext(request: WafloRequest) {
  const context = request.staffDeviceContext;
  if (!context) {
    throw new AppError(
      "REVIEW_SESSION_INVALID",
      "A valid Review Access session is required.",
      HttpStatus.FORBIDDEN,
    );
  }
  return context;
}

import { HttpStatus } from "@nestjs/common";
import type { ApiErrorDetails } from "@waflo/contracts";

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = HttpStatus.BAD_REQUEST,
    readonly details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "AppError";
  }
}

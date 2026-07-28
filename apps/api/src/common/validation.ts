import { z } from "zod";
import { HttpStatus } from "@nestjs/common";
import { AppError } from "./app-error.js";

const uuidSchema = z.uuid();
const optionalCursorSchema = z.uuid().optional();
const hostSchema = z.string().trim().min(1).max(253);
const actionSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9_.:-]+$/i)
  .optional();
const paginationLimitSchema = z.coerce.number().int().min(1).max(100).optional();

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  return schema.parse(input);
}

export function parseUuid(value: unknown): string {
  return uuidSchema.parse(value);
}

export function parseOptionalCursor(value: unknown): string | undefined {
  return optionalCursorSchema.parse(value);
}

export function parseHost(value: unknown): string {
  return hostSchema.parse(value);
}

export function parseOptionalAction(value: unknown): string | undefined {
  return actionSchema.parse(value);
}

export function parseOptionalPaginationLimit(value: unknown): number | undefined {
  return paginationLimitSchema.parse(value);
}

/** Checkout command IDs are UUIDs at the HTTP boundary and stay within Stripe's key limit. */
export function parseCheckoutIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError(
      "CHECKOUT_IDEMPOTENCY_KEY_REQUIRED",
      "A checkout command ID is required.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (value !== value.trim() || value.length > 255 || !uuidSchema.safeParse(value).success) {
    throw new AppError(
      "CHECKOUT_IDEMPOTENCY_KEY_INVALID",
      "The checkout command ID must be a UUID without whitespace.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return value;
}

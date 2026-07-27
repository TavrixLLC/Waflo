import { z } from "zod";

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

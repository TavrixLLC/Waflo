import type { z } from "zod";

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  return schema.parse(input);
}

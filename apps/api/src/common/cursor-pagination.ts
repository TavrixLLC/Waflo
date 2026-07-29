import { HttpStatus } from "@nestjs/common";
import { AppError } from "./app-error.js";

export interface TimestampCursor {
  id: string;
  timestamp: string;
}

export interface NumberCursor {
  id: string;
  value: number;
}

export function encodeCursor(value: TimestampCursor | NumberCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeTimestampCursor(value?: string): TimestampCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      id?: unknown;
      timestamp?: unknown;
    };
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.timestamp !== "string" ||
      Number.isNaN(Date.parse(parsed.timestamp))
    )
      throw new Error("invalid cursor");
    return { id: parsed.id, timestamp: parsed.timestamp };
  } catch {
    throw new AppError(
      "PAGINATION_CURSOR_INVALID",
      "The pagination cursor is invalid.",
      HttpStatus.BAD_REQUEST,
    );
  }
}

export function decodeNumberCursor(value?: string): NumberCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      id?: unknown;
      value?: unknown;
    };
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.value !== "number" ||
      !Number.isInteger(parsed.value)
    )
      throw new Error("invalid cursor");
    return { id: parsed.id, value: parsed.value };
  } catch {
    throw new AppError(
      "PAGINATION_CURSOR_INVALID",
      "The pagination cursor is invalid.",
      HttpStatus.BAD_REQUEST,
    );
  }
}

export function pageLimit(value?: string): number {
  if (value === undefined) return 20;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100)
    throw new AppError(
      "PAGINATION_LIMIT_INVALID",
      "Pagination limit must be an integer from 1 to 100.",
      HttpStatus.BAD_REQUEST,
    );
  return parsed;
}

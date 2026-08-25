import { z } from "zod";

const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const strictSemanticVersionSchema = z
  .string()
  .min(5)
  .max(40)
  .regex(SEMANTIC_VERSION_PATTERN, "A strict semantic version is required.");

export interface ParsedSemanticVersion {
  readonly raw: string;
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}

export function parseStrictSemanticVersion(value: string): ParsedSemanticVersion {
  const parsed = strictSemanticVersionSchema.parse(value);
  const match = SEMANTIC_VERSION_PATTERN.exec(parsed);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error("A strict semantic version is required.");
  }
  return {
    raw: parsed,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: match[4]?.split(".") ?? [],
    build: match[5]?.split(".") ?? [],
  };
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function compareSemanticVersions(left: string, right: string): number {
  const leftVersion = parseStrictSemanticVersion(left);
  const rightVersion = parseStrictSemanticVersion(right);
  for (const field of ["major", "minor", "patch"] as const) {
    const comparison = compareNumericIdentifier(leftVersion[field], rightVersion[field]);
    if (comparison !== 0) return comparison;
  }
  if (!leftVersion.prerelease.length && !rightVersion.prerelease.length) return 0;
  if (!leftVersion.prerelease.length) return 1;
  if (!rightVersion.prerelease.length) return -1;
  const maximumLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < maximumLength; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      const comparison = compareNumericIdentifier(leftIdentifier, rightIdentifier);
      if (comparison !== 0) return comparison;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (leftIdentifier !== rightIdentifier) return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function isSemanticVersionBelowMinimum(version: string, minimum: string): boolean {
  return compareSemanticVersions(version, minimum) < 0;
}

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const windows = process.platform === "win32";
const command = windows ? "cmd.exe" : "pnpm";
const arguments_ = windows
  ? ["/d", "/s", "/c", "pnpm audit --prod --json"]
  : ["audit", "--prod", "--json"];
const result = spawnSync(command, arguments_, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  shell: false,
});

if (!result.stdout?.trim()) {
  throw new Error(
    `pnpm audit did not return JSON (exit ${result.status ?? "unknown"}): ${result.error?.message ?? (result.stderr.trim() || "no output")}`,
  );
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  throw new Error("pnpm audit returned invalid JSON.");
}

const advisories = Object.values(report.advisories ?? {});
const acceptedAdvisory = "GHSA-f88m-g3jw-g9cj";
const acceptedPaths = new Set([
  "apps__customer-web>next>sharp",
  "apps__marketing-web>next>sharp",
  "apps__merchant-dashboard>next>sharp",
]);

function isAcceptedSharpBaseline(advisory) {
  if (
    advisory.github_advisory_id !== acceptedAdvisory ||
    advisory.module_name !== "sharp" ||
    advisory.severity !== "high"
  ) {
    return false;
  }
  const findings = advisory.findings ?? [];
  const paths = findings.flatMap((finding) => finding.paths ?? []);
  return (
    findings.length === 1 &&
    findings[0].optional === true &&
    paths.length === acceptedPaths.size &&
    paths.every((path) => acceptedPaths.has(path))
  );
}

const blocked = advisories.filter((advisory) => !isAcceptedSharpBaseline(advisory));
if (blocked.length > 0) {
  const summary = blocked
    .map(
      (advisory) =>
        `${advisory.github_advisory_id ?? advisory.id ?? "unknown"} ${advisory.module_name ?? "unknown"} ${advisory.severity ?? "unknown"}`,
    )
    .join("\n");
  throw new Error(`Production dependency audit contains an unaccepted advisory:\n${summary}`);
}

const nextConfigs = [
  "apps/customer-web/next.config.ts",
  "apps/marketing-web/next.config.ts",
  "apps/merchant-dashboard/next.config.ts",
];
if (
  advisories.some(isAcceptedSharpBaseline) &&
  nextConfigs.some((path) => !/unoptimized:\s*true/u.test(readFileSync(resolve(path), "utf8")))
) {
  throw new Error("The accepted Sharp baseline requires image optimization to remain disabled.");
}

if (result.status !== 0 && advisories.length === 0) {
  throw new Error(`pnpm audit failed without a recognized advisory (exit ${result.status}).`);
}

process.stdout.write(
  advisories.length === 0
    ? "Production dependency audit passed with no advisories.\n"
    : `Production dependency audit passed with only ${acceptedAdvisory}; Next image optimization remains disabled.\n`,
);

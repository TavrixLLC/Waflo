import { spawnSync } from "node:child_process";

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
const acceptedPrismaDeepmergeAdvisory = "GHSA-ggr8-5vv4-36mx";
const acceptedPrismaDeepmergePaths = new Set([
  "deploy__vps__migrate>prisma>@prisma/config>deepmerge-ts",
  "packages__database>@prisma/client>prisma>@prisma/config>deepmerge-ts",
]);

function isAcceptedPrismaDeepmergeBaseline(advisory) {
  if (
    advisory.github_advisory_id !== acceptedPrismaDeepmergeAdvisory ||
    advisory.module_name !== "deepmerge-ts" ||
    advisory.severity !== "high"
  ) {
    return false;
  }
  const findings = advisory.findings ?? [];
  const paths = findings.flatMap((finding) => finding.paths ?? []);
  return (
    findings.length === 1 &&
    paths.length === acceptedPrismaDeepmergePaths.size &&
    paths.every((path) => acceptedPrismaDeepmergePaths.has(path))
  );
}

function isAcceptedAdvisory(advisory) {
  // Prisma 7 is the supported production line. Its CLI/config package owns
  // this dependency and Waflo only gives it repository-authored, acyclic
  // configuration; no request or tenant input reaches the vulnerable merge.
  // Remove this exception as soon as a compatible Prisma 7 release patches it.
  return isAcceptedPrismaDeepmergeBaseline(advisory);
}

const blocked = advisories.filter((advisory) => !isAcceptedAdvisory(advisory));
if (blocked.length > 0) {
  const summary = blocked
    .map(
      (advisory) =>
        `${advisory.github_advisory_id ?? advisory.id ?? "unknown"} ${advisory.module_name ?? "unknown"} ${advisory.severity ?? "unknown"}`,
    )
    .join("\n");
  throw new Error(`Production dependency audit contains an unaccepted advisory:\n${summary}`);
}

if (result.status !== 0 && advisories.length === 0) {
  throw new Error(`pnpm audit failed without a recognized advisory (exit ${result.status}).`);
}

process.stdout.write(
  advisories.length === 0
    ? "Production dependency audit passed with no advisories.\n"
    : "Production dependency audit passed with the accepted Prisma CLI/config baseline advisory.\n",
);

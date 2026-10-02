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

const acceptedBaselineAdvisories = new Set([
  "GHSA-ggr8-5vv4-36mx", // deepmerge-ts
  "GHSA-6vj9-mwq6-2f5v", // nodemailer
  "GHSA-8vvx-rff5-p5rq", // nodemailer
  "GHSA-g57g-f23g-4646", // nodemailer
  "GHSA-v53p-9fqp-m79j", // nodemailer
  "GHSA-prgh-xp8r-p3m5", // nodemailer
  "GHSA-qw65-cvwx-89v3", // fast-uri
  "GHSA-58mr-gqgx-xq4g", // fast-uri
  "GHSA-hrr3-gc8f-f4qj", // fast-uri
  "GHSA-jvvf-x445-j334", // fast-uri
  "GHSA-q2hr-2g5m-vwhr", // brace-expansion
  "GHSA-qhr7-859c-m2p7", // brace-expansion
  "GHSA-6j4f-fj2g-mc7p", // brace-expansion
  "GHSA-r3ph-w7gj-g6xm", // js-yaml
  "GHSA-vcvr-r3jv-pc5j", // next
  "GHSA-9c5c-9qcx-q35q", // @nestjs/platform-fastify
  "GHSA-4mh8-r7rc-xpvc", // fastify
  "GHSA-667r-xxjv-c9mm", // fastify
  "GHSA-p68q-wchp-6fh7", // fastify
  "GHSA-hwr6-493r-vm6h", // fastify
  "GHSA-9q9j-q6p8-xq58", // fastify
  "GHSA-86w9-cpqp-85rv", // node-forge
]);

function isAcceptedAdvisory(advisory) {
  const id = advisory.github_advisory_id ?? advisory.id;
  if (id && acceptedBaselineAdvisories.has(id)) {
    return true;
  }
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

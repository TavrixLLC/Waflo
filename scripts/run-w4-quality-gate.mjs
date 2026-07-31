import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const outputDirectory = resolve(root, "artifacts/handoff-w4-round-1/raw-test-output");
const pnpmEntry = Reflect.get(process.env, "npm_execpath");
if (!pnpmEntry) throw new Error("Run this quality gate through pnpm.");

const commands = [
  ["frozen-install", ["install", "--frozen-lockfile"]],
  ["format-check", ["format:check"]],
  ["lint", ["lint"]],
  ["typecheck", ["typecheck"]],
  ["w4-unit", ["test:w4:unit"]],
  ["w4-integration", ["test:w4:integration"]],
  ["w4-http", ["test:w4:http"]],
  ["w4-concurrency", ["test:w4:concurrency"]],
  ["w4-failure", ["test:w4:failure"]],
  ["w4-database", ["test:w4:database"]],
  ["w4-load", ["test:w4:load"]],
  ["full-vitest", ["test"]],
  ["prisma-validate", ["db:validate"]],
  ["migration-deploy", ["db:migrate:deploy"]],
  ["migration-status", ["--filter", "@waflo/database", "exec", "prisma", "migrate", "status"]],
  ["production-build", ["build"]],
  ["provider-artifacts", ["w4:provider-artifacts"]],
  [
    "operational-worker-once",
    ["--filter", "@waflo/operational-worker", "exec", "node", "dist/main.js", "--once"],
  ],
  ["secret-scan", ["w4:secret-scan"]],
  ["no-flutter", ["w4:no-flutter"]],
];

await mkdir(outputDirectory, { recursive: true });
const summary = [];
for (const [label, arguments_] of commands) {
  process.stdout.write(`\n[W4 quality gate] ${label}\n`);
  const startedAt = new Date();
  const output = [];
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [pnpmEntry, ...arguments_], {
      cwd: root,
      env: {
        ...process.env,
        RATE_LIMIT_NAMESPACE: `w4-quality-${label}-${startedAt.getTime()}`,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output.push(chunk);
        process.stdout.write(chunk);
      });
    }
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveCode(exitCode ?? 1));
  });
  const finishedAt = new Date();
  output.push(`\nexit_code=${code}\n`);
  await writeFile(resolve(outputDirectory, `${label}.log`), output.join(""), "utf8");
  summary.push({
    label,
    command: `pnpm ${arguments_.join(" ")}`,
    exitCode: code,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  });
}

const failures = summary.filter((item) => item.exitCode !== 0);
await writeFile(
  resolve(outputDirectory, "quality-gate-summary.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      commands: summary,
      failures: failures.map((item) => item.label),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
if (failures.length) {
  throw new Error(`W4 quality gate failed: ${failures.map((item) => item.label).join(", ")}`);
}
process.stdout.write(`\nW4 core quality gate passed (${summary.length} commands).\n`);

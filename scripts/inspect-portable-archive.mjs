import { spawn } from "node:child_process";
import { resolve } from "node:path";

const archiveArgument = process.argv.slice(2).find((argument) => argument !== "--");
const archive = resolve(archiveArgument ?? "");
if (!archiveArgument) throw new Error("Provide the portable archive path.");

const listing = await new Promise((resolvePromise, reject) => {
  const child = spawn("tar", ["-tf", archive], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) resolvePromise(output);
    else reject(new Error(`tar exited with ${code ?? "no status"}.`));
  });
});

const forbiddenDirectoryNames = new Set([
  ".git",
  ".next",
  ".pnpm-store",
  ".turbo",
  "coverage",
  "dist",
  "docker-volumes",
  "minio-data",
  "node_modules",
  "playwright-report",
  "postgres-data",
  "redis-data",
  "test-results",
  "tmp",
]);
const forbiddenExtensions = new Set([
  ".cer",
  ".crt",
  ".der",
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pem",
  ".pfx",
]);
const violations = [];
const entries = listing
  .split(/\r?\n/)
  .map((entry) => entry.replaceAll("\\", "/").replace(/^\.?\//, ""))
  .filter(Boolean);
for (const entry of entries) {
  const parts = entry.split("/");
  if (parts.some((part) => forbiddenDirectoryNames.has(part))) violations.push(entry);
  const name = parts.at(-1) ?? "";
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example"))
    violations.push(entry);
  const extension = name.slice(name.lastIndexOf(".")).toLocaleLowerCase();
  if (forbiddenExtensions.has(extension)) violations.push(entry);
  if (/service[-_.]?account.*\.json$/iu.test(name)) violations.push(entry);
  if (name.endsWith(".tsbuildinfo")) violations.push(entry);
  if (name.endsWith(".log") || name.endsWith(".tmp")) violations.push(entry);
}
if (violations.length) {
  throw new Error(
    `Portable archive contains forbidden entries:\n${[...new Set(violations)].join("\n")}`,
  );
}
process.stdout.write(
  `Archive inspection passed.\nEntries: ${entries.length}\nForbidden entries: 0\n`,
);

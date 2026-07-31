import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = process.cwd();
const forbiddenDirectories = new Set([
  ".git",
  ".next",
  ".pnpm-store",
  ".turbo",
  "artifacts",
  "coverage",
  "dist",
  "docker-volumes",
  "minio-data",
  "node_modules",
  "playwright-report",
  "postgres-data",
  "redis-data",
  "test-results",
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
const contentPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /"private_key"\s*:\s*"-----BEGIN/u,
  /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  /\bsk_live_[0-9A-Za-z]{20,}\b/u,
  /\bgh[opsu]_[0-9A-Za-z]{30,}\b/u,
];
const violations = [];
let inspectedFiles = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && forbiddenDirectories.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === ".env" || (entry.name.startsWith(".env.") && entry.name !== ".env.example"))
      continue;
    const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLocaleLowerCase();
    if (forbiddenExtensions.has(extension)) {
      violations.push(`${path}: credential-like file extension`);
      continue;
    }
    if (/service[-_.]?account.*\.json$/iu.test(entry.name)) {
      violations.push(`${path}: service-account filename`);
      continue;
    }
    const bytes = await readFile(absolute);
    inspectedFiles += 1;
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    if (contentPatterns.some((pattern) => pattern.test(text))) {
      violations.push(`${path}: live-secret pattern`);
    }
  }
}

await walk(root);
if (violations.length) {
  throw new Error(`Secret scan failed:\n${violations.join("\n")}`);
}
process.stdout.write(
  `${process.argv[2] ?? "W3"} secret scan passed.\nInspected source files: ${inspectedFiles}\nViolations: 0\n`,
);

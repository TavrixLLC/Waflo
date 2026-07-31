import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".pnpm-store",
  ".turbo",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
  "tmp",
]);
const violations = [];
let inspectedFiles = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (entry.isDirectory()) {
      if (["android", "ios"].includes(entry.name.toLocaleLowerCase("en-US"))) {
        const entries = await readdir(absolute);
        if (entries.some((name) => name === "Flutter" || name.endsWith(".dart"))) {
          violations.push(`${path}: Flutter mobile scaffold`);
        }
      }
      await walk(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    inspectedFiles += 1;
    if (entry.name === "pubspec.yaml" || entry.name.endsWith(".dart")) {
      violations.push(`${path}: Flutter/Dart source`);
      continue;
    }
    if (entry.name === "package.json") {
      const packageJson = await readFile(absolute, "utf8");
      if (/"(?:flutter|dart)(?:_|\b)/iu.test(packageJson)) {
        violations.push(`${path}: Flutter/Dart dependency`);
      }
    }
  }
}

await walk(root);
if (violations.length) {
  throw new Error(`No-Flutter scan failed:\n${violations.join("\n")}`);
}
process.stdout.write(
  `No-Flutter scan passed.\nInspected source files: ${inspectedFiles}\nFlutter/Dart artifacts: 0\n`,
);

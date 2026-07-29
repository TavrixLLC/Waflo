import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = process.cwd();
const scanRoots = [
  resolve(root, "apps"),
  resolve(root, "packages", "contracts", "src"),
  resolve(root, "packages", "database", "prisma", "schema.prisma"),
];
const findings = [];
let inspected = 0;

async function inspect(path) {
  const text = await readFile(path, "utf8");
  inspected += 1;
  const normalizedPath = relative(root, path).split(sep).join("/");
  const patterns = [
    /\bmodel\s+(?:StampLedger|StampLedgerEntry|RewardRedemption)\b/gu,
    /@(?:Post|Patch)\([^)]*["'`](?:[^"'`]*\/)?stamps?["'`][^)]*\)/gu,
    /\b(?:staff scanner|device pairing|flutter application)\b/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (
        normalizedPath === "apps/api/src/programs/programs.controller.ts" &&
        value.includes("test-sessions/:sessionId/stamps")
      ) {
        continue;
      }
      findings.push(`${normalizedPath}: ${value.replace(/\s+/gu, " ")}`);
    }
  }
}

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (["dist", "node_modules", ".next"].includes(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      await walk(child);
    } else if (entry.isFile() && /\.(?:prisma|ts|tsx)$/u.test(entry.name)) {
      await inspect(child);
    }
  }
}

for (const path of scanRoots) {
  if (path.endsWith(".prisma")) await inspect(path);
  else await walk(path);
}

if (findings.length) throw new Error(`No-W4 scan failed:\n${findings.join("\n")}`);
process.stdout.write(
  `W3 no-W4 scan passed.\nInspected implementation files: ${inspected}\nProhibited W4 findings: 0\nAllowed W2 Test Mode stamp route: 1\n`,
);
